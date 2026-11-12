import { createHash, randomBytes } from "node:crypto";

import type { AuthRefreshStatus, AuthSession, AuthTokens, LoginProvider } from "@shared/gfn";
import { buildGfnLcarsHeaders, GFN_USER_AGENT } from "./gfn/clientHeaders";
import {
  CLIENT_ID,
  CLIENT_TOKEN_REFRESH_WINDOW_MS,
  DEFAULT_IDP_ID,
  SERVICE_URLS_ENDPOINT,
  TOKEN_REFRESH_WINDOW_MS,
} from "./gfn/auth/constants";
import { exchangeDeviceCode, requestDeviceAuthorization } from "./gfn/auth/deviceLogin";
import {
  effectiveTokenExpiryMs,
  isExpired,
  isNearExpiry,
  jwtExpiryMs,
  parseExpiresInSeconds,
  receivedJwtExpiryMs,
  toExpiresAt,
} from "./gfn/auth/helpers";
import { fetchUserInfo } from "./gfn/auth/userInfo";
import {
  refreshAuthTokens,
  refreshWithClientToken,
  requestClientToken,
  type TokenResponse,
} from "./gfn/auth/tokenRefresh";
import { fetchDynamicRegions, fetchSubscription } from "./gfn/subscription";

interface DeviceAttempt {
  provider: LoginProvider;
  deviceCode: string;
  expiresAt: number;
}

// Single-flight + reuse window for token refresh. A page reload or multi-tab
// visit fires several authorized requests carrying the same pre-refresh cookie
// snapshot; sharing one in-flight refresh and briefly caching its result keeps
// rotating tokens from invalidating each other across concurrent requests.
interface RefreshCacheEntry {
  tokens: AuthTokens;
  atMs: number;
}
const refreshInFlight = new Map<string, Promise<AuthTokens>>();
const refreshRecentlyCompleted = new Map<string, RefreshCacheEntry>();
const clientTokenRetryAfter = new Map<string, number>();

const REFRESH_REUSE_WINDOW_MS = 2 * 60 * 1000;
const REFRESH_AHEAD_MS = TOKEN_REFRESH_WINDOW_MS;
const CLIENT_TOKEN_FAILURE_BACKOFF_MS = 30_000;

function sessionRefreshKey(userId: string, tokens: AuthTokens): string {
  const material = `${userId}:${tokens.clientToken ?? ""}:${tokens.refreshToken ?? ""}`;
  return createHash("sha256").update(material).digest("hex").slice(0, 32);
}

function isDefinitiveRevocation(error: unknown): boolean {
  if (
    typeof error === "object"
    && error !== null
    && "definitiveRevocation" in error
    && typeof (error as { definitiveRevocation?: unknown }).definitiveRevocation === "boolean"
  ) {
    return (error as { definitiveRevocation: boolean }).definitiveRevocation;
  }
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes("invalid_grant")
    || message.includes("invalid_token")
    || message.includes("token_revoked")
    || message.includes("unauthorized_client")
  );
}

function mergeFromTokenResponse(previous: AuthTokens, refreshed: TokenResponse): AuthTokens {
  const now = Date.now();
  const nextIdToken = refreshed.id_token ?? previous.idToken;
  const nextIdTokenExpiresAt = refreshed.id_token
    ? receivedJwtExpiryMs(refreshed.id_token, now)
    : (previous.idTokenExpiresAt ?? jwtExpiryMs(previous.idToken));
  const explicitSeconds = parseExpiresInSeconds(refreshed.expires_in);
  const expiresAt = explicitSeconds !== undefined
    ? now + explicitSeconds * 1000
    : (receivedJwtExpiryMs(refreshed.access_token, now) ?? nextIdTokenExpiresAt ?? toExpiresAt(undefined, 86400, now));
  const clientTokenRotated = Boolean(refreshed.client_token && refreshed.client_token !== previous.clientToken);
  const rotatedClientExpiry = clientTokenRotated ? receivedJwtExpiryMs(refreshed.client_token, now) : undefined;

  return {
    ...previous,
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token ?? previous.refreshToken,
    idToken: nextIdToken,
    idTokenExpiresAt: nextIdTokenExpiresAt,
    expiresAt,
    authClientId: previous.authClientId ?? CLIENT_ID,
    clientToken: refreshed.client_token ?? previous.clientToken,
    clientTokenExpiresAt: clientTokenRotated ? rotatedClientExpiry : previous.clientTokenExpiresAt,
    clientTokenLifetimeMs: clientTokenRotated
      ? (rotatedClientExpiry !== undefined ? Math.max(0, rotatedClientExpiry - now) : undefined)
      : previous.clientTokenLifetimeMs,
  };
}

function mergeFromAuthTokens(previous: AuthTokens, refreshed: AuthTokens): AuthTokens {
  const now = Date.now();
  const nextIdToken = refreshed.idToken ?? previous.idToken;
  const nextIdTokenExpiresAt = refreshed.idToken
    ? (refreshed.idTokenExpiresAt ?? receivedJwtExpiryMs(refreshed.idToken, now))
    : (previous.idTokenExpiresAt ?? jwtExpiryMs(previous.idToken));
  const clientTokenRotated = Boolean(refreshed.clientToken && refreshed.clientToken !== previous.clientToken);
  const rotatedClientExpiry = clientTokenRotated
    ? (refreshed.clientTokenExpiresAt ?? receivedJwtExpiryMs(refreshed.clientToken, now))
    : undefined;

  return {
    ...previous,
    ...refreshed,
    refreshToken: refreshed.refreshToken ?? previous.refreshToken,
    idToken: nextIdToken,
    idTokenExpiresAt: nextIdTokenExpiresAt,
    authClientId: refreshed.authClientId ?? previous.authClientId,
    clientToken: refreshed.clientToken ?? previous.clientToken,
    clientTokenExpiresAt: clientTokenRotated ? rotatedClientExpiry : previous.clientTokenExpiresAt,
    clientTokenLifetimeMs: clientTokenRotated
      ? (rotatedClientExpiry !== undefined ? Math.max(0, rotatedClientExpiry - now) : undefined)
      : previous.clientTokenLifetimeMs,
  };
}

function shouldRotateClientToken(tokens: AuthTokens, now = Date.now()): boolean {
  if (isExpired(tokens.expiresAt, now)) {
    return false;
  }
  if (!tokens.clientToken) {
    // Only bootstrap a missing client token when no standard refresh token is
    // available either (e.g. initial /client_token call failed transiently).
    return !tokens.refreshToken;
  }
  if (tokens.clientTokenExpiresAt === undefined) {
    return false;
  }
  return isNearExpiry(tokens.clientTokenExpiresAt, CLIENT_TOKEN_REFRESH_WINDOW_MS, now);
}

async function ensureFreshClientToken(
  userId: string,
  tokens: AuthTokens,
  options?: { forceWhenUnstamped?: boolean },
): Promise<AuthTokens> {
  const now = Date.now();
  if (isExpired(tokens.expiresAt, now)) {
    return tokens;
  }
  const needsUpdate = options?.forceWhenUnstamped && tokens.clientToken && tokens.clientTokenExpiresAt === undefined
    ? true
    : shouldRotateClientToken(tokens, now);
  if (!needsUpdate) {
    return tokens;
  }

  const backoffUntil = clientTokenRetryAfter.get(userId) ?? 0;
  if (now < backoffUntil) {
    return tokens;
  }

  try {
    const issued = await requestClientToken(tokens.accessToken, tokens.authClientId);
    if (!issued?.token) {
      return tokens;
    }
    clientTokenRetryAfter.delete(userId);
    return {
      ...tokens,
      clientToken: issued.token,
      clientTokenExpiresAt: issued.expiresAt,
      clientTokenLifetimeMs: issued.lifetimeMs,
    };
  } catch (error) {
    clientTokenRetryAfter.set(userId, Date.now() + CLIENT_TOKEN_FAILURE_BACKOFF_MS);
    console.warn("[Auth] Client token renewal failed; keeping existing session tokens.", error);
    return tokens;
  }
}

async function refreshSessionTokens(userId: string, previous: AuthTokens): Promise<AuthTokens> {
  const errors: unknown[] = [];
  const now = Date.now();

  // 1. Primary path (matches desktop OpenNOW): NVIDIA QR/device sign-in uses
  //    the `tk_client` scope and renews via `urn:ietf:params:oauth:grant-type:client_token`
  //    rather than issuing a standard OAuth `refresh_token`.
  //    Attempt the client_token grant whenever it has not locally expired, or
  //    as a last resort when no `refresh_token` fallback exists.
  const canTryClientToken = Boolean(
    previous.clientToken
    && (
      previous.clientTokenExpiresAt === undefined
      || previous.clientTokenExpiresAt > now
      || !previous.refreshToken
    ),
  );

  if (canTryClientToken && previous.clientToken) {
    try {
      const response = await refreshWithClientToken(
        previous.clientToken,
        userId,
        previous.authClientId,
      );
      const merged = mergeFromTokenResponse(previous, response);
      // If the token endpoint rotated client_token without an embedded expiry,
      // or the existing client_token is nearing expiry, refresh /client_token too.
      return await ensureFreshClientToken(userId, merged, {
        forceWhenUnstamped: Boolean(response.client_token && response.client_token !== previous.clientToken),
      });
    } catch (error) {
      errors.push(error);
    }
  }

  // 2. Fallback path: standard OAuth refresh_token grant when present.
  if (previous.refreshToken) {
    try {
      const refreshed = await refreshAuthTokens(previous.refreshToken, previous.authClientId);
      const merged = mergeFromAuthTokens(previous, refreshed);
      return await ensureFreshClientToken(userId, merged);
    } catch (error) {
      errors.push(error);
    }
  }

  const allDefinitive = errors.length > 0 && errors.every(isDefinitiveRevocation);
  const primaryError = errors[errors.length - 1];
  const combinedMessage = errors
    .map((entry) => (entry instanceof Error ? entry.message : String(entry)))
    .join(" | ") || "Session has no usable refresh mechanism.";
  throw Object.assign(
    new Error(combinedMessage, primaryError instanceof Error ? { cause: primaryError } : undefined),
    { definitiveRevocation: allDefinitive },
  );
}

async function refreshSessionTokensShared(
  userId: string,
  previous: AuthTokens,
): Promise<AuthTokens> {
  const key = sessionRefreshKey(userId, previous);
  const now = Date.now();

  const recent = refreshRecentlyCompleted.get(key);
  if (
    recent
    && now - recent.atMs <= REFRESH_REUSE_WINDOW_MS
    && !isNearExpiry(effectiveTokenExpiryMs(recent.tokens), REFRESH_AHEAD_MS, now)
  ) {
    return recent.tokens;
  }

  const inFlight = refreshInFlight.get(key);
  if (inFlight) {
    return inFlight;
  }

  const promise = (async (): Promise<AuthTokens> => {
    try {
      const refreshed = await refreshSessionTokens(userId, previous);
      for (const [cachedKey, entry] of refreshRecentlyCompleted) {
        if (now - entry.atMs > REFRESH_REUSE_WINDOW_MS * 2) {
          refreshRecentlyCompleted.delete(cachedKey);
        }
      }
      refreshRecentlyCompleted.set(key, { tokens: refreshed, atMs: Date.now() });
      return refreshed;
    } finally {
      refreshInFlight.delete(key);
    }
  })();

  refreshInFlight.set(key, promise);
  return promise;
}

export interface WebAuthSessionSnapshot {
  version: 1;
  auth: AuthSession | null;
  attempts: Array<[string, DeviceAttempt]>;
  activeSessionIds: string[];
  /**
   * When this snapshot was written to the cookie. Absent on cookies saved
   * before sliding renewal existed, which simply means "renew on next write".
   */
  savedAt?: number;
}

export interface BrowserSession {
  provider: LoginProvider;
  user: AuthSession["user"];
}

export interface BrowserChallenge {
  attemptId: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresAt: number;
  intervalSeconds: number;
}

interface ServiceUrlsResponse {
  gfnServiceInfo?: {
    gfnServiceEndpoints?: Array<{
      idpId: string;
      loginProviderCode: string;
      loginProviderDisplayName: string;
      streamingServiceUrl: string;
      loginProviderPriority?: number;
    }>;
  };
}

function defaultProvider(): LoginProvider {
  return {
    idpId: DEFAULT_IDP_ID,
    code: "NVIDIA",
    displayName: "NVIDIA",
    streamingServiceUrl: "https://prod.cloudmatchbeta.nvidiagrid.net/",
    priority: 0,
  };
}

function normalizeProvider(provider: LoginProvider): LoginProvider {
  return {
    ...provider,
    streamingServiceUrl: provider.streamingServiceUrl.endsWith("/")
      ? provider.streamingServiceUrl
      : `${provider.streamingServiceUrl}/`,
  };
}

let providerCache: LoginProvider[] | null = null;

export async function getLoginProviders(): Promise<LoginProvider[]> {
  if (providerCache) return providerCache;
  try {
    const response = await fetch(SERVICE_URLS_ENDPOINT, {
      headers: { Accept: "application/json", "User-Agent": GFN_USER_AGENT },
    });
    if (!response.ok) throw new Error(`Provider request failed (${response.status})`);
    const payload = (await response.json()) as ServiceUrlsResponse;
    const providers = (payload.gfnServiceInfo?.gfnServiceEndpoints ?? [])
      .map((entry): LoginProvider => normalizeProvider({
        idpId: entry.idpId,
        code: entry.loginProviderCode,
        displayName: entry.loginProviderCode === "BPC" ? "bro.game" : entry.loginProviderDisplayName,
        streamingServiceUrl: entry.streamingServiceUrl,
        priority: entry.loginProviderPriority ?? 0,
      }))
      .sort((a, b) => a.priority - b.priority);
    providerCache = providers.length > 0 ? providers : [defaultProvider()];
  } catch (error) {
    console.warn("[Auth] Provider discovery failed; using NVIDIA default.", error);
    providerCache = [defaultProvider()];
  }
  return providerCache;
}

export class WebAuthSession {
  /** FIFO bound so the encrypted cookie snapshot cannot grow without limit. */
  private static readonly MAX_ACTIVE_SESSION_IDS = 16;
  private static readonly MAX_DEVICE_ATTEMPTS = 4;

  private auth: AuthSession | null = null;
  private readonly attempts = new Map<string, DeviceAttempt>();
  private readonly activeSessionIds = new Set<string>();
  /** Last time this snapshot reached the cookie; drives sliding renewal. */
  private savedAt: number | null = null;
  // Fresh sessions start clean: an empty snapshot carries no state worth
  // persisting, and writing one would clobber a valid auth cookie whenever a
  // single request transiently failed to read/decrypt the incoming cookies.
  private dirty = false;

  static fromSnapshot(snapshot: WebAuthSessionSnapshot): WebAuthSession {
    const session = new WebAuthSession();
    session.auth = snapshot.auth;
    session.attempts.clear();
    for (const [attemptId, attempt] of snapshot.attempts) {
      if (attempt?.expiresAt > Date.now()) session.attempts.set(attemptId, attempt);
    }
    session.activeSessionIds.clear();
    for (const sessionId of snapshot.activeSessionIds) {
      if (typeof sessionId === "string" && sessionId.length > 0) session.activeSessionIds.add(sessionId);
    }
    session.savedAt = typeof snapshot.savedAt === "number" && Number.isFinite(snapshot.savedAt)
      ? snapshot.savedAt
      : null;
    session.dirty = false;
    return session;
  }

  toSnapshot(): WebAuthSessionSnapshot {
    const now = Date.now();
    const attempts = [...this.attempts.entries()]
      .filter(([, attempt]) => attempt?.expiresAt > now)
      .slice(-WebAuthSession.MAX_DEVICE_ATTEMPTS);
    const activeSessionIds = [...this.activeSessionIds].slice(-WebAuthSession.MAX_ACTIVE_SESSION_IDS);
    return {
      version: 1,
      auth: this.auth,
      attempts,
      activeSessionIds,
      savedAt: Date.now(),
    };
  }

  /** Is there anything in this session worth keeping in a cookie? */
  hasPersistedState(): boolean {
    return this.auth !== null || this.activeSessionIds.size > 0;
  }

  /**
   * Sliding expiry check.
   *
   * Browsers clamp cookie lifetimes to roughly 400 days, so "stay signed in
   * forever" can only be built as a long window that is pushed forward while
   * the visitor keeps using the app. Rewriting up to four cookie chunks on
   * every response would be wasteful, so renewal is throttled by the caller to
   * a fraction of the window.
   */
  needsCookieRenewal(renewAfterMs: number, now = Date.now()): boolean {
    if (!this.hasPersistedState()) return false;
    if (this.savedAt === null) return true;
    return now - this.savedAt >= renewAfterMs;
  }

  /**
   * Emergency size reduction for cookie persistence: drops QR attempts and
   * keeps only the most recent stream ids. Called when the encrypted snapshot
   * would exceed the cookie chunk budget.
   */
  reduceVolatileState(): void {
    this.attempts.clear();
    const keep = [...this.activeSessionIds].slice(-4);
    this.activeSessionIds.clear();
    for (const sessionId of keep) {
      this.activeSessionIds.add(sessionId);
    }
  }

  isDirty(): boolean {
    return this.dirty;
  }

  markPersisted(): void {
    this.dirty = false;
  }

  addActiveSession(sessionId: string): void {
    if (!this.activeSessionIds.has(sessionId)) {
      // Bound growth: abandoned sessions (tab closed without stop) would
      // otherwise accumulate for the cookie's lifetime and push the encrypted
      // snapshot toward the chunk/header limits.
      while (this.activeSessionIds.size >= WebAuthSession.MAX_ACTIVE_SESSION_IDS) {
        const oldest = this.activeSessionIds.values().next().value;
        if (oldest === undefined) break;
        this.activeSessionIds.delete(oldest);
      }
      this.activeSessionIds.add(sessionId);
      this.dirty = true;
    }
  }

  removeActiveSession(sessionId: string): void {
    if (this.activeSessionIds.delete(sessionId)) this.dirty = true;
  }

  ownsActiveSession(sessionId: string): boolean {
    return this.activeSessionIds.has(sessionId);
  }

  publicSession(): BrowserSession | null {
    return this.auth ? { provider: this.auth.provider, user: this.auth.user } : null;
  }

  async startDeviceLogin(providerIdpId?: string, previousAttemptId?: string): Promise<BrowserChallenge> {
    if (previousAttemptId) {
      this.attempts.delete(previousAttemptId);
    }
    const now = Date.now();
    for (const [id, attempt] of this.attempts) {
      if (!attempt || attempt.expiresAt <= now) {
        this.attempts.delete(id);
      }
    }
    while (this.attempts.size >= WebAuthSession.MAX_DEVICE_ATTEMPTS) {
      const oldest = this.attempts.keys().next().value;
      if (oldest === undefined) break;
      this.attempts.delete(oldest);
    }

    const providers = await getLoginProviders();
    const provider = providers.find((item) => item.idpId === providerIdpId) ?? providers[0] ?? defaultProvider();
    const challenge = await requestDeviceAuthorization(provider);
    const attemptId = randomBytes(24).toString("base64url");
    this.attempts.set(attemptId, {
      provider,
      deviceCode: challenge.deviceCode,
      expiresAt: challenge.expiresAt,
    });
    this.dirty = true;
    return {
      attemptId,
      userCode: challenge.userCode,
      verificationUri: challenge.verificationUri,
      verificationUriComplete: challenge.verificationUriComplete,
      expiresAt: challenge.expiresAt,
      intervalSeconds: challenge.intervalSeconds,
    };
  }

  cancelDeviceLogin(attemptId: string): void {
    // Once signed in, never rewrite the cookie for a stale cancel request that
    // raced with login completion.
    if (this.auth !== null) return;
    if (this.attempts.delete(attemptId)) this.dirty = true;
  }

  async pollDeviceLogin(attemptId: string): Promise<{
    status: "pending" | "slow_down" | "expired" | "access_denied" | "authorized" | "error";
    session?: BrowserSession;
    error?: string;
    intervalSeconds?: number;
  }> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt || attempt.expiresAt <= Date.now()) {
      this.attempts.delete(attemptId);
      this.dirty = true;
      return { status: "expired", error: "The QR code expired. Start again to get a new one." };
    }

    const result = await exchangeDeviceCode(attempt.deviceCode);
    if (!("accessToken" in result)) {
      const status = result.error === "authorization_pending"
        ? "pending"
        : result.error === "slow_down"
          ? "slow_down"
          : result.error === "expired_token"
            ? "expired"
            : result.error === "access_denied"
              ? "access_denied"
              : "error";
      if (status !== "pending" && status !== "slow_down") {
        this.attempts.delete(attemptId);
        this.dirty = true;
      }
      return { status, error: result.error_description, intervalSeconds: status === "slow_down" ? 10 : undefined };
    }

    let tokens: AuthTokens = result;
    const user = await fetchUserInfo(tokens);
    try {
      const clientToken = await requestClientToken(tokens.accessToken, tokens.authClientId);
      tokens = {
        ...tokens,
        clientToken: clientToken.token,
        clientTokenExpiresAt: clientToken.expiresAt,
        clientTokenLifetimeMs: clientToken.lifetimeMs,
      };
    } catch (error) {
      console.warn("[Auth] Client token request failed; continuing with OAuth token.", error);
    }

    this.auth = { provider: normalizeProvider(attempt.provider), tokens, user };
    this.attempts.clear();
    this.dirty = true;
    try {
      const token = this.tokenFrom(this.auth);
      const { vpcId } = await fetchDynamicRegions(token, this.auth.provider.streamingServiceUrl);
      const subscription = await fetchSubscription(token, user.userId, vpcId ?? undefined);
      this.auth.user.membershipTier = subscription.membershipTier ?? this.auth.user.membershipTier;
    } catch (error) {
      console.warn("[Auth] Membership enrichment failed.", error);
    }
    return { status: "authorized", session: this.publicSession() ?? undefined };
  }

  logout(): void {
    this.auth = null;
    this.attempts.clear();
    this.activeSessionIds.clear();
    this.dirty = true;
  }

  private tokenFrom(session: AuthSession): string {
    return session.tokens.idToken ?? session.tokens.accessToken;
  }

  async requireAuth(): Promise<AuthSession> {
    if (!this.auth) throw Object.assign(new Error("Sign in with the QR code first."), { statusCode: 401 });

    const previous = this.auth.tokens;
    const effectiveExpiry = effectiveTokenExpiryMs(previous);

    if (isNearExpiry(effectiveExpiry, REFRESH_AHEAD_MS)) {
      const hasRefreshMechanism = Boolean(previous.clientToken || previous.refreshToken);
      if (!hasRefreshMechanism) {
        if (!isExpired(effectiveExpiry)) {
          // No refresh credential is available, but the current access/id token
          // is still valid — keep serving until it genuinely expires rather
          // than wiping the session cookie 10 minutes early.
          return this.auth;
        }
        this.logout();
        throw Object.assign(new Error("Your NVIDIA session expired. Sign in again."), { statusCode: 401 });
      }

      try {
        const refreshed = await refreshSessionTokensShared(this.auth.user.userId, previous);
        this.auth.tokens = refreshed;
        this.dirty = true;
        return this.auth;
      } catch (error) {
        // While the current token is still within its validity window, keep
        // serving with it and retry on the next request.
        if (!isExpired(effectiveExpiry)) {
          console.warn(
            "[Auth] Token refresh failed; continuing with the current token and retrying on the next request.",
            error,
          );
          return this.auth;
        }
        // Only wipe the persistent session cookie when NVIDIA definitively
        // rejected the refresh grant (e.g. invalid_grant / revoked). On a
        // transient network or 5xx failure, preserve the cookie so the next
        // request or boot retry can recover automatically.
        if (isDefinitiveRevocation(error)) {
          console.warn("[Auth] Token refresh was rejected by NVIDIA; requiring re-sign-in.", error);
          this.logout();
          throw Object.assign(new Error("Your NVIDIA session expired. Sign in again."), { statusCode: 401 });
        }
        console.warn(
          "[Auth] Token refresh failed due to a transient error after token expiry; preserving session cookie for retry.",
          error,
        );
        throw Object.assign(
          new Error("NVIDIA authentication service is temporarily unavailable. Retrying shortly."),
          { statusCode: 503 },
        );
      }
    }

    // Access/ID tokens are still fresh, so rotate `client_token` proactively if
    // its own expiry window is approaching (or bootstrap it if initial sign-in
    // missed it).
    if (shouldRotateClientToken(previous)) {
      const updated = await ensureFreshClientToken(this.auth.user.userId, previous);
      if (updated !== previous) {
        this.auth.tokens = updated;
        this.dirty = true;
      }
    }

    return this.auth;
  }

  /**
   * Used by `GET /api/session` during app boot and background session checks.
   * Refreshes near-expiry or expired tokens up front in a single request so the
   * browser receives updated session cookies before firing parallel catalog/API
   * requests, while resolving cleanly to `{ session: null }` if the session was
   * definitively revoked.
   */
  async resolveBrowserSession(): Promise<{
    session: BrowserSession | null;
    refresh: AuthRefreshStatus;
  }> {
    if (!this.auth) {
      return {
        session: null,
        refresh: {
          attempted: false,
          forced: false,
          outcome: "not_attempted",
          message: "No saved session found.",
        },
      };
    }

    const previousAccess = this.auth.tokens.accessToken;
    const previousId = this.auth.tokens.idToken;
    const previousClient = this.auth.tokens.clientToken;
    const wasNearExpiry = isNearExpiry(effectiveTokenExpiryMs(this.auth.tokens), REFRESH_AHEAD_MS);

    try {
      await this.requireAuth();
      const changed = this.auth.tokens.accessToken !== previousAccess
        || this.auth.tokens.idToken !== previousId
        || this.auth.tokens.clientToken !== previousClient;
      if (changed) {
        return {
          session: this.publicSession(),
          refresh: {
            attempted: true,
            forced: false,
            outcome: "refreshed",
            message: "Saved session token refreshed.",
          },
        };
      }
      if (wasNearExpiry) {
        const missingRefresh = !this.auth.tokens.clientToken && !this.auth.tokens.refreshToken;
        return {
          session: this.publicSession(),
          refresh: {
            attempted: !missingRefresh,
            forced: false,
            outcome: missingRefresh ? "missing_refresh_token" : "failed",
            message: missingRefresh
              ? "Session has no refresh credential; continuing with current token."
              : "Token refresh failed; continuing with unexpired token.",
          },
        };
      }
      return {
        session: this.publicSession(),
        refresh: {
          attempted: false,
          forced: false,
          outcome: "not_attempted",
          message: "Session token is still valid.",
        },
      };
    } catch (error) {
      const status = typeof error === "object" && error && "statusCode" in error
        ? (error as { statusCode?: number }).statusCode
        : undefined;
      if (status === 401) {
        return {
          session: null,
          refresh: {
            attempted: true,
            forced: false,
            outcome: "failed",
            message: error instanceof Error ? error.message : "Saved session expired.",
          },
        };
      }
      throw error;
    }
  }

  async token(): Promise<string> {
    return this.tokenFrom(await this.requireAuth());
  }

  async regions() {
    const auth = await this.requireAuth();
    return fetchDynamicRegions(this.tokenFrom(auth), auth.provider.streamingServiceUrl);
  }
}

export const webAuthInternals = {
  resetRefreshCaches(): void {
    refreshInFlight.clear();
    refreshRecentlyCompleted.clear();
    clientTokenRetryAfter.clear();
  },
};

export function buildAuthenticatedHeaders(session: AuthSession): Record<string, string> {
  return buildGfnLcarsHeaders({
    token: session.tokens.idToken ?? session.tokens.accessToken,
    clientType: "BROWSER",
    clientStreamer: "WEBRTC",
    includeUserAgent: true,
  });
}

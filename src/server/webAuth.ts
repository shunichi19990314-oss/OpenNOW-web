import { randomBytes } from "node:crypto";

import type { AuthSession, AuthTokens, LoginProvider } from "@shared/gfn";
import { buildGfnLcarsHeaders, GFN_USER_AGENT } from "./gfn/clientHeaders";
import {
  DEFAULT_IDP_ID,
  SERVICE_URLS_ENDPOINT,
} from "./gfn/auth/constants";
import { exchangeDeviceCode, requestDeviceAuthorization } from "./gfn/auth/deviceLogin";
import { isNearExpiry } from "./gfn/auth/helpers";
import { fetchUserInfo } from "./gfn/auth/userInfo";
import { refreshAuthTokens, requestClientToken } from "./gfn/auth/tokenRefresh";
import { fetchDynamicRegions, fetchSubscription } from "./gfn/subscription";

interface DeviceAttempt {
  provider: LoginProvider;
  deviceCode: string;
  expiresAt: number;
}

export interface WebAuthSessionSnapshot {
  version: 1;
  auth: AuthSession | null;
  attempts: Array<[string, DeviceAttempt]>;
  activeSessionIds: string[];
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
  private auth: AuthSession | null = null;
  private readonly attempts = new Map<string, DeviceAttempt>();
  private readonly activeSessionIds = new Set<string>();
  private dirty = true;

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
    session.dirty = false;
    return session;
  }

  toSnapshot(): WebAuthSessionSnapshot {
    return {
      version: 1,
      auth: this.auth,
      attempts: [...this.attempts.entries()],
      activeSessionIds: [...this.activeSessionIds],
    };
  }

  isDirty(): boolean {
    return this.dirty;
  }

  markPersisted(): void {
    this.dirty = false;
  }

  addActiveSession(sessionId: string): void {
    if (!this.activeSessionIds.has(sessionId)) {
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

  async startDeviceLogin(providerIdpId?: string): Promise<BrowserChallenge> {
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
    this.attempts.delete(attemptId);
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
    if (isNearExpiry(this.auth.tokens.expiresAt, 10 * 60 * 1000)) {
      const refreshToken = this.auth.tokens.refreshToken;
      if (!refreshToken) {
        this.logout();
        throw Object.assign(new Error("Your NVIDIA session expired. Sign in again."), { statusCode: 401 });
      }
      const previous = this.auth.tokens;
      const refreshed = await refreshAuthTokens(refreshToken, previous.authClientId!);
      this.auth.tokens = {
        ...previous,
        ...refreshed,
        clientToken: previous.clientToken,
        clientTokenExpiresAt: previous.clientTokenExpiresAt,
        clientTokenLifetimeMs: previous.clientTokenLifetimeMs,
      };
      this.dirty = true;
    }
    return this.auth;
  }

  async token(): Promise<string> {
    return this.tokenFrom(await this.requireAuth());
  }

  async regions() {
    const auth = await this.requireAuth();
    return fetchDynamicRegions(this.tokenFrom(auth), auth.provider.streamingServiceUrl);
  }
}

export function buildAuthenticatedHeaders(session: AuthSession): Record<string, string> {
  return buildGfnLcarsHeaders({
    token: session.tokens.idToken ?? session.tokens.accessToken,
    clientType: "BROWSER",
    clientStreamer: "WEBRTC",
    includeUserAgent: true,
  });
}

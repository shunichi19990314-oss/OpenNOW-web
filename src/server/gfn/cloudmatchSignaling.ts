import dns from "node:dns";

import type { IceServer, MediaConnectionInfo } from "@shared/gfn";

import type { CloudMatchResponse } from "./types";
import { isZoneHostname } from "./cloudmatchTransport";

const READY_SESSION_STATUSES = new Set([2, 3]);

function collectRtspsEndpoints(
  connections: Array<{ usage?: number; port?: number; resourcePath?: string | null }>,
  fallbackHost?: string | null,
): string[] {
  const endpoints: string[] = [];
  const seen = new Set<string>();
  for (const connection of connections) {
    if (connection.usage !== 14) continue;
    const resourcePath = typeof connection.resourcePath === "string" ? connection.resourcePath.trim() : "";
    const endpoint = /^rtsps?:\/\//i.test(resourcePath)
      ? resourcePath
      : fallbackHost && connection.port
        ? `rtsps://${fallbackHost}:${connection.port}`
        : "";
    if (endpoint && !seen.has(endpoint)) {
      seen.add(endpoint);
      endpoints.push(endpoint);
    }
  }
  return endpoints;
}

export function isReadySessionStatus(status: number): boolean {
  return READY_SESSION_STATUSES.has(status);
}

/**
 * How long a single hostname resolution may take before it is abandoned.
 *
 * This sits directly on the critical path of a queue poll: `toSessionInfo`
 * awaits `normalizeIceServers` before the poll response can be returned, so a
 * slow resolver delays the *queue position* the visitor is waiting for. 1.2 s
 * is enough for any healthy resolver and short enough that a broken one cannot
 * add a visible stall.
 */
const DNS_LOOKUP_TIMEOUT_MS = 1200;

/**
 * STUN/TURN hostnames are infrastructure, not per-session data: they resolve to
 * the same addresses for hours. Without this cache a three-host config did up to
 * nine DNS lookups per poll (system resolver plus two fallbacks, per host) on
 * every queue tick — which is what made the position appear tens of seconds
 * after the poll that contained it.
 */
const DNS_CACHE_TTL_MS = 30 * 60 * 1000;
const dnsCache = new Map<string, { address: string | null; at: number }>();

/** Hostnames currently being resolved in the background. */
const dnsInFlight = new Set<string>();

/**
 * Overridable resolver, purely so tests can prove that a slow DNS cannot delay
 * a poll. Production always uses `resolveHostnameWithFallback`.
 */
let hostnameResolver: (hostname: string) => Promise<string | null> = resolveHostnameWithFallback;

/** Test seam: replace the resolver (pass `null` to restore the real one). */
export function setHostnameResolverForTests(
  resolver: ((hostname: string) => Promise<string | null>) | null,
): void {
  hostnameResolver = resolver ?? resolveHostnameWithFallback;
  dnsCache.clear();
  dnsInFlight.clear();
}

/** Test seam: clears the resolved-hostname cache. */
export function resetIceHostnameCache(): void {
  dnsCache.clear();
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function resolveHostnameWithFallback(hostname: string): Promise<string | null> {
  const cached = dnsCache.get(hostname);
  if (cached && Date.now() - cached.at < DNS_CACHE_TTL_MS) {
    return cached.address;
  }

  // System resolver and both public fallbacks race each other. They used to run
  // strictly in sequence (system, then 1.1.1.1, then 8.8.8.8), so a failed
  // system lookup cost the full timeout before the first fallback even started.
  const attempts: Array<Promise<string | null>> = [
    withTimeout(dns.promises.lookup(hostname), DNS_LOOKUP_TIMEOUT_MS, "system dns")
      .then((r) => (r && (r as { address?: string }).address) || null),
  ];

  for (const server of ["1.1.1.1", "8.8.8.8"]) {
    attempts.push(
      (async () => {
        const resolver = new dns.Resolver();
        resolver.setServers([server]);
        const addrs = await withTimeout(
          new Promise<string[]>((resolve, reject) => {
            resolver.resolve4(hostname, (err, addresses) => {
              if (err) reject(err);
              else resolve(addresses);
            });
          }),
          DNS_LOOKUP_TIMEOUT_MS,
          `dns ${server}`,
        );
        return addrs && addrs.length > 0 ? addrs[0] : null;
      })().catch(() => null),
    );
  }

  // First successful answer wins; a total failure resolves to null so the
  // caller keeps the original hostname (the browser can still resolve it).
  const address = await Promise.race([
    Promise.any(attempts.map(async (attempt) => {
      const value = await attempt;
      if (!value) throw new Error("no address");
      return value;
    })),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), DNS_LOOKUP_TIMEOUT_MS + 200)),
  ]).catch(() => null);

  dnsCache.set(hostname, { address, at: Date.now() });
  return address;
}

/**
 * Cache-only lookup. Never awaits anything, so callers can build a response
 * without paying for DNS.
 */
function cachedHostname(hostname: string): string | null {
  const cached = dnsCache.get(hostname);
  if (cached && Date.now() - cached.at < DNS_CACHE_TTL_MS) {
    return cached.address;
  }
  return null;
}

/**
 * Start resolving a hostname in the background, if it is not already known or
 * already in flight. The result lands in `dnsCache` for a later poll.
 */
function primeHostname(hostname: string): void {
  if (cachedHostname(hostname) !== null) return;
  if (dnsInFlight.has(hostname)) return;
  dnsInFlight.add(hostname);
  void hostnameResolver(hostname)
    .catch(() => null)
    .finally(() => dnsInFlight.delete(hostname));
}

export async function normalizeIceServers(response: CloudMatchResponse): Promise<IceServer[]> {
  const raw = response.session.iceServerConfiguration?.iceServers ?? [];
  const servers = raw
    .map((entry) => {
      const urls = Array.isArray(entry.urls) ? entry.urls : [entry.urls];
      return {
        urls,
        username: entry.username,
        credential: entry.credential,
      };
    })
    .filter((entry) => entry.urls.length > 0);

  if (servers.length > 0) {
    // Attempt to resolve any hostnames in STUN/TURN URLs to IPs to avoid relying on the
    // renderer's DNS resolution. This makes it possible to try alternate DNS servers
    // when the system resolver fails.
    //
    // Resolved in parallel. This ran strictly one URL at a time, and each
    // unresolved host is an `await` on DNS — so a session with three ICE hosts
    // paid three DNS lookups end to end *before* the launch could hand the
    // signalling data back to the browser. Nothing here depends on another
    // URL's result.
    const resolvedServers: IceServer[] = await Promise.all(servers.map(async (s) => {
      const resolvedUrls: string[] = [];
      for (const u of s.urls) {
          try {
          const m = u.match(/^([a-zA-Z0-9+.-]+):([^/]+)/);
          if (m) {
            const scheme = m[1];
            const hostPort = m[2];
            const host = hostPort.split(":")[0];
            const portPart = hostPort.includes(":") ? ":" + hostPort.split(":").slice(1).join(":") : "";

            // Helper to bracket IPv6 literals when necessary
            const bracketIfIpv6 = (h: string) => {
              if (h.startsWith("[") && h.endsWith("]")) return h;
              // Heuristic: contains ':' and is not an IPv4 dotted-quad
              if (h.includes(":") && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(h)) {
                return `[${h}]`;
              }
              return h;
            };

            // If host already looks like an IPv4 or bracketed IPv6, keep original URL
            if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || /^\[[0-9a-fA-F:]+\]$/.test(host)) {
              resolvedUrls.push(u);
            } else {
              /*
               * Never block a poll on DNS.
               *
               * This used to `await resolveHostnameWithFallback(host)` inline,
               * which put a resolver round trip — up to 1.2 s with the timeout,
               * and previously unbounded — in front of *every* queue poll, for
               * every host, before the response carrying the queue position
               * could be returned. The measured worst case in this environment
               * was 23 s for a single unreachable fallback resolver.
               *
               * The queue position does not depend on STUN addresses, so the
               * response now ships with whatever is already known (often the
               * hostname itself, which the browser can resolve) and the next
               * resolution happens in the background. By the time a session is
               * actually ready there have been several polls, so the cache is
               * warm and the addresses are the resolved IPs.
               */
              const ip = cachedHostname(host);
              if (ip === null) primeHostname(host);
              const finalHost = ip ?? host;
              const maybeBracketted = bracketIfIpv6(finalHost);
              resolvedUrls.push(`${scheme}:${maybeBracketted}${portPart}`);
            }
          } else {
            resolvedUrls.push(u);
          }
        } catch {
          resolvedUrls.push(u);
        }
      }
      return { urls: resolvedUrls, username: s.username, credential: s.credential };
    }));

    return resolvedServers;
  }

  // Default fallbacks — same treatment, and the same reason: these three hosts
  // were resolved one after another before every poll when the session had no
  // ICE config, which is the common case while queued.
  const defaults = ["s1.stun.gamestream.nvidia.com:19308", "stun.l.google.com:19302", "stun1.l.google.com:19302"];
  const bracketIfIpv6 = (h: string) => (h.includes(":") && !h.startsWith("[") ? `[${h}]` : h);
  return defaults.map((d) => {
    const parts = d.split(":");
    const host = parts[0];
    const port = parts.length > 1 ? `:${parts.slice(1).join(":")}` : "";
    const ip = cachedHostname(host);
    if (ip === null) primeHostname(host);
    return { urls: [`stun:${bracketIfIpv6(ip ?? host)}${port}`] };
  });
}

/**
 * Extract the streaming server IP from the CloudMatch response, matching Rust's
 * `streaming_server_ip()` priority chain:
 *   1. connectionInfo[usage==14].ip (direct IP)
 *   2. Host extracted from connectionInfo[usage==14].resourcePath (for rtsps:// URLs)
 *   3. sessionControlInfo.ip (fallback)
 */
export function streamingServerIp(response: CloudMatchResponse): string | null {
  const connections = response.session.connectionInfo ?? [];
  const sigConn = connections.find((conn) => conn.usage === 14);

  if (sigConn) {
    // Priority 1: Direct IP field
    const rawIp = sigConn.ip;
    const directIp = Array.isArray(rawIp) ? rawIp[0] : rawIp;
    if (directIp && directIp.length > 0) {
      return directIp;
    }

    // Priority 2: Extract host from resourcePath (Alliance format: rtsps://host:port)
    if (sigConn.resourcePath) {
      const host = extractHostFromUrl(sigConn.resourcePath);
      if (host) return host;
    }
  }

  // Priority 3: sessionControlInfo.ip
  const controlIp = response.session.sessionControlInfo?.ip;
  if (controlIp && controlIp.length > 0) {
    return Array.isArray(controlIp) ? controlIp[0] : controlIp;
  }

  return null;
}

/**
 * Extract host from a URL string (handles rtsps://, rtsp://, wss://, https://).
 * Matches Rust's extract_host_from_url().
 */
export function extractHostFromUrl(url: string): string | null {
  const prefixes = ["rtsps://", "rtsp://", "wss://", "https://"];
  let afterProto: string | null = null;
  for (const prefix of prefixes) {
    if (url.startsWith(prefix)) {
      afterProto = url.slice(prefix.length);
      break;
    }
  }
  if (!afterProto) return null;

  // Get host (before port or path)
  const host = afterProto.split(":")[0]?.split("/")[0];
  if (!host || host.length === 0 || host.startsWith(".")) return null;
  return host;
}

export function resolveSignaling(response: CloudMatchResponse): {
  serverIp: string;
  signalingServer: string;
  signalingUrl: string;
  mediaConnectionInfo?: MediaConnectionInfo;
  rtspsEndpoints: string[];
} {
  const connections = response.session.connectionInfo ?? [];
  const signalingConnection =
    connections.find((conn) => conn.usage === 14 && conn.ip) ?? connections.find((conn) => conn.ip);

  // Use the Rust-matching priority chain for server IP
  const serverIp = streamingServerIp(response);
  if (!serverIp) {
    throw new Error("CloudMatch response did not include a signaling host");
  }

  const resourcePath = signalingConnection?.resourcePath ?? "/nvst/";

  // Build signaling URL matching Rust's build_signaling_url() behavior:
  // - rtsps://host:port -> extract host, convert to wss://host/nvst/
  // - wss://... -> use as-is
  // - /path -> wss://serverIp:443/path
  // - fallback -> wss://serverIp:443/nvst/
  const { signalingUrl, signalingHost } = buildSignalingUrl(resourcePath, serverIp);

  // Use the resolved signaling host (which may differ from serverIp if extracted from rtsps:// URL)
  const effectiveHost = signalingHost ?? serverIp;
  const signalingServer = effectiveHost.includes(":")
    ? effectiveHost
    : `${effectiveHost}:443`;

  const rtspsHost =
    connections
      .map((connection) => typeof connection.resourcePath === "string"
        ? extractHostFromUrl(connection.resourcePath)
        : null)
      .find((host): host is string => Boolean(host)) ??
    signalingHost ??
    (isZoneHostname(serverIp) ? null : serverIp);

  return {
    serverIp,
    signalingServer,
    signalingUrl,
    mediaConnectionInfo: resolveMediaConnectionInfo(connections, serverIp, {
      logMissing: isReadySessionStatus(response.session.status),
    }),
    rtspsEndpoints: collectRtspsEndpoints(connections, rtspsHost),
  };
}

/**
 * Resolve the media connection endpoint (IP + port) from the session's connectionInfo array.
 * Matches Rust's media_connection_info() priority chain:
 *   1. usage=2 (Primary media path, UDP)
 *   2. usage=17 (Alternative media path)
 *   3. usage=14 with highest port (Alliance fallback — distinguishes media port from signaling port)
 *   4. Fallback: use serverIp with the highest port from any usage=14 entry
 *
 * For each entry, IP is extracted from:
 *   a. The .ip field directly
 *   b. The hostname in .resourcePath (e.g. rtsps://80-250-97-40.server.net:48322)
 *   c. Fallback to serverIp (only for usage=14 Alliance fallback)
 */
export function resolveMediaConnectionInfo(
  connections: Array<{ ip?: string; port: number; usage: number; protocol?: number; resourcePath?: string }>,
  serverIp: string,
  options?: { logMissing?: boolean },
): { ip: string; port: number; usage: number } | undefined {
  // Helper: extract IP from a connection entry
  const extractIp = (conn: { ip?: string; resourcePath?: string }): string | null => {
    // Try direct IP field
    const rawIp = conn.ip;
    const directIp = Array.isArray(rawIp) ? rawIp[0] : rawIp;
    if (directIp && directIp.length > 0) return directIp;

    // Try hostname from resourcePath
    if (conn.resourcePath) {
      const host = extractHostFromUrl(conn.resourcePath);
      if (host) return host;
    }

    return null;
  };

  // Helper: extract port from a connection entry (fallback to resourcePath URL port)
  const extractPort = (conn: { port: number; resourcePath?: string }): number => {
    if (conn.port > 0) return conn.port;

    // Try extracting port from resourcePath URL
    if (conn.resourcePath) {
      try {
        const url = new URL(conn.resourcePath.replace("rtsps://", "https://").replace("rtsp://", "http://"));
        const portStr = url.port;
        if (portStr) return parseInt(portStr, 10);
      } catch {
        // Ignore
      }
    }

    return 0;
  };

  // Priority 1: usage=2 (Primary media path, UDP)
  const primary = connections.find((c) => c.usage === 2);
  if (primary) {
    const ip = extractIp(primary);
    const port = extractPort(primary);
    console.log(`[CloudMatch] resolveMediaConnectionInfo: usage=2 candidate: ip=${ip}, port=${port}`);
    if (ip && port > 0) return { ip, port, usage: primary.usage };
  }

  // Priority 2: usage=17 (Alternative media path)
  const alt = connections.find((c) => c.usage === 17);
  if (alt) {
    const ip = extractIp(alt);
    const port = extractPort(alt);
    console.log(`[CloudMatch] resolveMediaConnectionInfo: usage=17 candidate: ip=${ip}, port=${port}`);
    if (ip && port > 0) return { ip, port, usage: alt.usage };
  }

  // Priority 3: usage=14 with highest port (Alliance fallback)
  const alliance = connections
    .filter((c) => c.usage === 14)
    .sort((a, b) => b.port - a.port);

  for (const conn of alliance) {
    const ip = extractIp(conn) ?? serverIp;
    const port = extractPort(conn);
    console.log(`[CloudMatch] resolveMediaConnectionInfo: usage=14 candidate: ip=${ip}, port=${port} (serverIp fallback=${serverIp})`);
    if (ip && port > 0) return { ip, port, usage: conn.usage };
  }

  if (options?.logMissing ?? true) {
    console.log("[CloudMatch] resolveMediaConnectionInfo: NO valid media connection info found");
  }
  return undefined;
}

/**
 * Build signaling WSS URL from the resourcePath, matching Rust implementation.
 * Returns the URL and optionally the extracted host (if different from serverIp).
 */
export function buildSignalingUrl(
  raw: string,
  serverIp: string,
): { signalingUrl: string; signalingHost: string | null } {
  if (raw.startsWith("rtsps://") || raw.startsWith("rtsp://")) {
    // Extract hostname from RTSP URL, convert to wss://
    const withoutScheme = raw.startsWith("rtsps://")
      ? raw.slice("rtsps://".length)
      : raw.slice("rtsp://".length);
    const host = withoutScheme.split(":")[0]?.split("/")[0];
    if (host && host.length > 0 && !host.startsWith(".")) {
      return {
        signalingUrl: `wss://${host}/nvst/`,
        signalingHost: host,
      };
    }
    return {
      signalingUrl: `wss://${serverIp}:443/nvst/`,
      signalingHost: null,
    };
  }

  if (raw.startsWith("wss://")) {
    // Already a full WSS URL, use as-is; extract host
    const withoutScheme = raw.slice("wss://".length);
    const host = withoutScheme.split("/")[0] ?? null;
    return { signalingUrl: raw, signalingHost: host };
  }

  if (raw.startsWith("/")) {
    // Relative path
    return {
      signalingUrl: `wss://${serverIp}:443${raw}`,
      signalingHost: null,
    };
  }

  // Fallback
  return {
    signalingUrl: `wss://${serverIp}:443/nvst/`,
    signalingHost: null,
  };
}

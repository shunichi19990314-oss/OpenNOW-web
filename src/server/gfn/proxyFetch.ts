import { ProxyAgent, fetch as undiciFetch } from "undici";

import {
  normalizeSessionProxyUrl,
} from "./proxyUrl";

const httpProxyAgents = new Map<string, ProxyAgent>();

function getHttpProxyAgent(normalizedProxyUrl: string): ProxyAgent {
  const existing = httpProxyAgents.get(normalizedProxyUrl);
  if (existing) {
    return existing;
  }

  const agent = new ProxyAgent(normalizedProxyUrl);
  httpProxyAgents.set(normalizedProxyUrl, agent);
  return agent;
}

export function initSessionProxyAuth(): void {
  // HTTP(S) proxy authentication is handled by undici's ProxyAgent.
}

export async function fetchWithOptionalProxy(
  input: string,
  init: RequestInit | undefined,
  proxyUrl?: string,
): Promise<Response> {
  const normalizedProxyUrl = normalizeSessionProxyUrl(proxyUrl);
  if (!normalizedProxyUrl) {
    return fetch(input, init);
  }

  const protocol = new URL(normalizedProxyUrl).protocol;
  if (protocol === "http:" || protocol === "https:") {
    const agent = getHttpProxyAgent(normalizedProxyUrl);
    return undiciFetch(input, {
      ...(init ?? {}),
      dispatcher: agent,
    } as Parameters<typeof undiciFetch>[1]) as unknown as Response;
  }

  throw new Error(`Unsupported web server proxy protocol: ${protocol}`);
}

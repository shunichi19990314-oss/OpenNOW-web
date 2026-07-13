import type { Express, NextFunction, Request, Response } from "express";

import type { CatalogBrowseRequest, SessionAdReportRequest, SessionClaimRequest, SessionCreateRequest, SessionPollRequest, SessionStopRequest } from "@shared/gfn";
import { browseCatalogUncached } from "./gfn/catalogBrowse";
import { resolveLaunchAppId, resolveStoreUrl } from "./gfn/gameAppMapper";
import { fetchLibraryGamesUncached, markGameOwned } from "./gfn/libraryGames";
import { fetchPublicGamesUncached } from "./gfn/publicGames";
import { claimSession, createSession, getActiveSessions, pollSession, reportSessionAd, stopSession } from "./gfn/cloudmatch";
import { fetchSubscription } from "./gfn/subscription";
import { getLoginProviders } from "./webAuth";
import { getSession } from "./sessionStore";

function asyncRoute(handler: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction) => {
    void handler(request, response).catch(next);
  };
}

export function registerApi(app: Express): void {
  app.get("/api/health", (_request, response) => {
    response.json({ ok: true, runtime: "web", streamer: "webrtc" });
  });

  app.get("/api/providers", asyncRoute(async (_request, response) => {
    response.json(await getLoginProviders());
  }));

  app.get("/api/session", asyncRoute(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.json({ session: getSession(request, response).publicSession() });
  }));

  app.post("/api/auth/qr/start", asyncRoute(async (request, response) => {
    const challenge = await getSession(request, response).startDeviceLogin(request.body?.providerIdpId);
    response.json(challenge);
  }));

  app.post("/api/auth/qr/poll", asyncRoute(async (request, response) => {
    const attemptId = String(request.body?.attemptId ?? "");
    if (!attemptId) throw Object.assign(new Error("Missing QR login attempt."), { statusCode: 400 });
    response.json(await getSession(request, response).pollDeviceLogin(attemptId));
  }));

  app.post("/api/auth/qr/cancel", asyncRoute(async (request, response) => {
    getSession(request, response).cancelDeviceLogin(String(request.body?.attemptId ?? ""));
    response.status(204).end();
  }));

  app.post("/api/logout", asyncRoute(async (request, response) => {
    getSession(request, response).logout();
    response.status(204).end();
  }));

  app.get("/api/bootstrap", asyncRoute(async (request, response) => {
    const state = getSession(request, response);
    const auth = await state.requireAuth();
    const token = auth.tokens.idToken ?? auth.tokens.accessToken;
    const { regions, vpcId } = await state.regions();
    const subscription = await fetchSubscription(token, auth.user.userId, vpcId ?? undefined).catch(() => null);
    response.json({ session: state.publicSession(), regions, subscription });
  }));

  app.get("/api/regions", asyncRoute(async (request, response) => {
    response.json((await getSession(request, response).regions()).regions);
  }));

  app.get("/api/subscription", asyncRoute(async (request, response) => {
    const state = getSession(request, response);
    const auth = await state.requireAuth();
    const token = auth.tokens.idToken ?? auth.tokens.accessToken;
    const { vpcId } = await state.regions();
    response.json(await fetchSubscription(token, auth.user.userId, vpcId ?? undefined));
  }));

  app.get("/api/library", asyncRoute(async (request, response) => {
    const state = getSession(request, response);
    const auth = await state.requireAuth();
    const token = auth.tokens.idToken ?? auth.tokens.accessToken;
    const games = await fetchLibraryGamesUncached(token, auth.provider.streamingServiceUrl);
    response.json({ games });
  }));

  app.get("/api/catalog", asyncRoute(async (request, response) => {
    const state = getSession(request, response);
    const auth = await state.requireAuth();
    const input: CatalogBrowseRequest = {
      token: auth.tokens.idToken ?? auth.tokens.accessToken,
      providerStreamingBaseUrl: auth.provider.streamingServiceUrl,
      searchQuery: typeof request.query.q === "string" ? request.query.q : undefined,
      fetchCount: 100,
    };
    response.json(await browseCatalogUncached(input));
  }));

  app.get("/api/public-games", asyncRoute(async (_request, response) => {
    response.json(await fetchPublicGamesUncached());
  }));

  app.post("/api/resolve-launch-id", asyncRoute(async (request, response) => {
    const state = getSession(request, response);
    const auth = await state.requireAuth();
    const appId = await resolveLaunchAppId(
      auth.tokens.idToken ?? auth.tokens.accessToken,
      String(request.body?.appIdOrUuid ?? ""),
      auth.provider.streamingServiceUrl,
    );
    response.json({ appId });
  }));

  app.post("/api/resolve-store-url", asyncRoute(async (request, response) => {
    const state = getSession(request, response);
    const auth = await state.requireAuth();
    const url = await resolveStoreUrl(
      auth.tokens.idToken ?? auth.tokens.accessToken,
      String(request.body?.appIdOrUuid ?? ""),
      auth.provider.streamingServiceUrl,
      {
        variantId: request.body?.variantId,
        store: request.body?.store,
      },
    );
    response.json({ url });
  }));

  app.post("/api/mark-owned", asyncRoute(async (request, response) => {
    const state = getSession(request, response);
    const auth = await state.requireAuth();
    const token = auth.tokens.idToken ?? auth.tokens.accessToken;
    const result = await markGameOwned({
      token,
      userId: auth.user.userId,
      variantId: String(request.body?.variantId ?? ""),
      providerStreamingBaseUrl: auth.provider.streamingServiceUrl,
      tokens: [auth.tokens.idToken, auth.tokens.accessToken],
    });
    response.json(result);
  }));

  app.get("/api/active-sessions", asyncRoute(async (request, response) => {
    const state = getSession(request, response);
    const auth = await state.requireAuth();
    const active = await getActiveSessions(
      auth.tokens.idToken ?? auth.tokens.accessToken,
      auth.provider.streamingServiceUrl,
    );
    for (const item of active) state.addActiveSession(item.sessionId);
    response.json({ sessions: active });
  }));

  app.post("/api/stream/create", asyncRoute(async (request, response) => {
    const state = getSession(request, response);
    const auth = await state.requireAuth();
    const requestedId = String(request.body?.appId ?? "");
    const appId = await resolveLaunchAppId(
      auth.tokens.idToken ?? auth.tokens.accessToken,
      requestedId,
      auth.provider.streamingServiceUrl,
    );
    if (!appId) throw Object.assign(new Error("This game does not expose a launchable GFN app ID."), { statusCode: 400 });

    const input = request.body as Omit<SessionCreateRequest, "token" | "appId" | "streamingBaseUrl">;
    const session = await createSession({
      ...input,
      appId,
      token: auth.tokens.idToken ?? auth.tokens.accessToken,
      streamingBaseUrl: auth.provider.streamingServiceUrl,
      internalTitle: String(input.internalTitle || appId),
      settings: { ...input.settings, clientMode: "web", transportMode: "webrtc" },
    });
    state.addActiveSession(session.sessionId);
    response.json(session);
  }));

  app.post("/api/stream/poll", asyncRoute(async (request, response) => {
    const state = getSession(request, response);
    const input = request.body as SessionPollRequest;
    if (!state.ownsActiveSession(input.sessionId)) {
      throw Object.assign(new Error("This stream does not belong to the current browser session."), { statusCode: 403 });
    }
    const auth = await state.requireAuth();
    const session = await pollSession({
      ...input,
      token: auth.tokens.idToken ?? auth.tokens.accessToken,
      streamingBaseUrl: input.streamingBaseUrl ?? auth.provider.streamingServiceUrl,
    });
    response.json(session);
  }));

  app.post("/api/stream/report-ad", asyncRoute(async (request, response) => {
    const state = getSession(request, response);
    const input = request.body as SessionAdReportRequest;
    if (!state.ownsActiveSession(input.sessionId)) {
      throw Object.assign(new Error("This stream does not belong to the current browser session."), { statusCode: 403 });
    }
    const auth = await state.requireAuth();
    response.json(await reportSessionAd({
      ...input,
      token: auth.tokens.idToken ?? auth.tokens.accessToken,
      streamingBaseUrl: input.streamingBaseUrl ?? auth.provider.streamingServiceUrl,
    }));
  }));

  app.post("/api/stream/claim", asyncRoute(async (request, response) => {
    const state = getSession(request, response);
    const auth = await state.requireAuth();
    const input = request.body as SessionClaimRequest;
    const claimed = await claimSession({
      ...input,
      token: auth.tokens.idToken ?? auth.tokens.accessToken,
      streamingBaseUrl: input.streamingBaseUrl ?? auth.provider.streamingServiceUrl,
      settings: input.settings ? { ...input.settings, clientMode: "web", transportMode: "webrtc" } : undefined,
    });
    state.addActiveSession(claimed.sessionId);
    response.json(claimed);
  }));

  app.post("/api/stream/stop", asyncRoute(async (request, response) => {
    const state = getSession(request, response);
    const input = request.body as SessionStopRequest;
    if (!state.ownsActiveSession(input.sessionId)) {
      throw Object.assign(new Error("This stream does not belong to the current browser session."), { statusCode: 403 });
    }
    const auth = await state.requireAuth();
    await stopSession({
      ...input,
      token: auth.tokens.idToken ?? auth.tokens.accessToken,
      streamingBaseUrl: input.streamingBaseUrl ?? auth.provider.streamingServiceUrl,
    });
    state.removeActiveSession(input.sessionId);
    response.status(204).end();
  }));
}

import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";

import type { IceCandidatePayload, KeyframeRequest, SendAnswerRequest, SignalingConnectRequest } from "@shared/gfn";
import { GfnSignalingClient } from "./gfn/signaling";
import { getExistingSession } from "./sessionStore";

type ClientMessage =
  | { type: "connect"; payload: SignalingConnectRequest }
  | { type: "answer"; payload: SendAnswerRequest }
  | { type: "ice"; payload: IceCandidatePayload }
  | { type: "keyframe"; payload: KeyframeRequest }
  | { type: "disconnect" };

function originAllowed(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin) return process.env.NODE_ENV !== "production";
  if (process.env.OPENNOW_ORIGIN) return origin === process.env.OPENNOW_ORIGIN;
  const host = request.headers.host;
  return origin === `http://${host}` || origin === `https://${host}`;
}

export function attachSignalingBridge(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });

  server.on("upgrade", (request, socket: Duplex, head) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname !== "/api/signaling" || !originAllowed(request)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
  });

  wss.on("connection", (socket: WebSocket, request) => {
    const browserSession = getExistingSession(request as never);
    if (!browserSession) {
      socket.close(4401, "Authentication required");
      return;
    }

    let signaling: GfnSignalingClient | null = null;
    let unsubscribe: (() => void) | null = null;
    const send = (payload: unknown) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(payload));
      } else {
        // A dropped "offer" here means the browser leg died (e.g. an edge
        // proxy idle timeout), not that NVIDIA was silent — make that
        // distinction visible in the logs.
        const eventType = (payload as { payload?: { type?: string } })?.payload?.type ?? "unknown";
        console.warn(`[Bridge] Dropped event "${eventType}": browser socket state ${socket.readyState}`);
      }
    };

    // Edge proxies (Render's free plan in particular) drop idle WebSockets.
    // NVIDIA can stay silent for a minute or more while the rig prepares the
    // offer, so ping at the protocol level every 25 s; browsers answer with
    // pongs automatically, keeping traffic flowing in both directions.
    const pingTimer = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        try {
          socket.ping();
        } catch {
          // Socket already closing; the close handler cleans up.
        }
      }
    }, 25_000);

    // Process messages strictly in arrival order. Concurrent async handlers
    // could let an "answer"/"ice" message reach the NVIDIA socket before
    // "connect" finished opening it (sendJson silently drops when not OPEN),
    // and a trailing "disconnect" could tear down an already-established new
    // session after a quick reconnect.
    let messageQueue: Promise<void> = Promise.resolve();
    socket.on("message", (raw) => {
      messageQueue = messageQueue.then(async () => {
        const message = JSON.parse(raw.toString("utf8")) as ClientMessage;
        if (message.type === "connect") {
          const input = message.payload;
          if (!browserSession.ownsActiveSession(input.sessionId)) {
            throw new Error("Stream ownership check failed.");
          }
          signaling?.disconnect();
          unsubscribe?.();
          signaling = new GfnSignalingClient(input.signalingServer, input.sessionId, input.signalingUrl);
          unsubscribe = signaling.onEvent((event) => {
            console.log(`[Bridge] Relaying NVIDIA event: ${event.type}`);
            send({ type: "event", payload: event });
          });
          await signaling.connect();
        } else if (message.type === "answer") {
          await signaling?.sendAnswer(message.payload);
        } else if (message.type === "ice") {
          await signaling?.sendIceCandidate(message.payload);
        } else if (message.type === "keyframe") {
          await signaling?.requestKeyframe(message.payload);
        } else if (message.type === "disconnect") {
          signaling?.disconnect();
        }
      }).catch((error) => send({ type: "event", payload: { type: "error", message: error instanceof Error ? error.message : String(error) } }));
    });

    socket.on("close", () => {
      clearInterval(pingTimer);
      unsubscribe?.();
      signaling?.disconnect();
    });
  });
}

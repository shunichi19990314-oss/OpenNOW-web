# OpenNOW Web

OpenNOW Web is a browser-native GeForce NOW client. It reuses the proven catalog, CloudMatch, signaling, input, and WebRTC protocol work from the desktop OpenNOW project without Electron or the native streamer.

The client UI is the official OpenNOW renderer copied from `OpenNOW/opennow-stable/src/renderer/src`, including the original stylesheet, assets, home and library views, settings modal, queue experience, stream loading screens, and in-stream controls. The intentional web-only UI removals are redirect-based sign-in, native-streamer settings, and desktop application updater controls.

## What changed

- QR-code device authorization is the only sign-in flow. There is no redirect-based NVIDIA sign-in.
- Each visitor's profile, QR attempt, NVIDIA tokens, and owned stream IDs are stored in compressed AES-256-GCM encrypted, HTTP-only cookies. They are never returned to page JavaScript.
- Session cookies are scoped to `/api`, use `SameSite=Strict`, and are marked `Secure` in production.
- The session layer is stateless: any server instance can handle any visitor when every instance uses the same `SESSION_SECRET`.
- Game video, audio, keyboard, mouse, and controller input use browser WebRTC.
- Region latency is measured from each visitor's browser with bounded HTTPS checks; unreachable regions remain selectable and show a neutral unavailable state.
- NVIDIA signaling is relayed through an ownership-checked same-origin WebSocket.
- Electron updates, native streaming, local media recording, Discord RPC, and desktop window controls are not part of the web app.

## Development

Requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Production

```bash
npm install
npm run build
NODE_ENV=production OPENNOW_ORIGIN=https://your-domain.example SESSION_SECRET=replace-with-at-least-32-random-characters npm start
```

On PowerShell:

```powershell
$env:NODE_ENV = "production"
$env:OPENNOW_ORIGIN = "https://your-domain.example"
$env:SESSION_SECRET = "replace-with-at-least-32-random-characters"
npm start
```

Put the Node server behind a reverse proxy that provides HTTPS and forwards WebSocket upgrades for `/api/signaling`. Browser streaming and microphone access should be served over HTTPS in production.

Important deployment notes:

- Use the same strong `SESSION_SECRET` on every server instance. Sticky sessions and a shared session database are not required.
- Rotating `SESSION_SECRET` signs everyone out immediately. Keep it in your deployment secret manager, never in source control.
- Set `OPENNOW_ORIGIN` to the exact public origin so signaling WebSocket origin checks are strict.
- Do not deploy the Vite development server publicly.

## Checks

```bash
npm run typecheck
npm test
npm run build
```

With the development server running, the isolated-session concurrency check can be run with:

```bash
npm run test:load
```

Set `LOAD_TEST_REQUESTS`, `LOAD_TEST_CONCURRENCY`, or `LOAD_TEST_URL` to change its scope.

Full login, queue, and gameplay validation requires a real NVIDIA/GeForce NOW account. The unauthenticated provider discovery and QR-device authorization start/cancel flow can be tested without entering credentials.

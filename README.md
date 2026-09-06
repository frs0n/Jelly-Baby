# Jelly Baby · Anonymous Table

A lightweight multiplayer adaptation of [scottstts/Jelly-Baby](https://github.com/scottstts/Jelly-Baby), hosted on Cloudflare Workers and Durable Objects.

Opening the page seats you automatically. Each table holds up to six players, with overflow players routed to another table. There are no accounts, nicknames, chat, player lists, records, wins, or losses; leaving ends the session. Move with WASD or the arrow keys, jump with Space, dash with Shift, and drag the table to rotate the camera. Hold your own jelly to stretch and fling it; other jellies within roughly 22 cm can also be dragged. Release to let go—no extra buttons are added. Walk up to the swing or the trampoline and press `E`, or the prompt button that appears, to get on and off again. Mobile uses the original joystick and jump controls plus that same prompt button. The original interface and copy are retained, with only a player-count indicator added and the colour picker removed; colours are generated gradients only. The table is open, with no visible circle or circular movement boundary.

Colours are generated as two-colour gradients from the Cloudflare-provided IP and a digest of ordinary browser properties, using an HMAC with a private server-side salt. The app does not retain raw IP addresses, browser properties, or fingerprint digests; it sets no identity cookies or localStorage entries and sends no fingerprint data to other players. Each entry receives only a fresh, temporary connection ID. The same environment will usually receive the same colour; changes to the network or browser properties may change it, and the finite colour space does not guarantee absolute mathematical uniqueness.

## Run and deploy

```sh
npm install
npm run dev
```

`dev` builds the frontend first, then runs the real room service in local Wrangler. For frontend hot reload, run `npm run dev:client` in a separate terminal; Vite proxies `/api` and WebSockets to Wrangler on port 8787.

```sh
npx wrangler login
npm run deploy
```

`wrangler.jsonc` deploys `jelly-baby-playground`; static files and the WebSocket API share the same origin. SQLite Durable Object migrations create the room and matcher namespaces automatically. No external database or colour-key configuration is required.

## Implementation boundaries

- The server runs simplified colliders at 30 Hz with three collision substeps per tick. Ordinary movement broadcasts delta states at up to 15 Hz, while grab start/end events broadcast immediately and idle state is kept alive once per second. Joining sends an identity/appearance baseline; afterwards, only changed fields are sent, using short in-room IDs, field bitmasks, and 0.1 mm quantised integers (grab keepalives are not sent). Movement directions are normalised, and the server decides jump and dash cooldowns. The colliders are not per-vertex soft-body collisions.
- Local soft-body motion remains immediate; only significant server-position errors are smoothed. Minor errors and an idle landing height do not wake the soft body or trigger optical recalculation. Measured round-trip time compensates snapshot latency, and remote characters use an approximately 100 ms snapshot interpolation buffer.
- The local character retains the full skin and 240 Hz FEM. Remote characters use the existing roughly 20,000-triangle surface (down from about 144,000) and 120 Hz FEM, while retaining gait, facial expressions, and soft-body constraints. Ordinary remote simulation updates at up to 30 Hz; a remote character currently being dragged locally rises to 60 Hz. The display interpolates skin and normals continuously at the screen refresh rate. Meshes, character centres, and grab points all play in coordinates relative to the character root; Worker frames do not replace the rendered frame directly, preventing mesh updates from jumping against server-position correction. Each character computes in a browser-local Web Worker with at most one request in flight and reusable transferable buffers. The main thread keeps stable GPU attribute buffers and culls off-screen objects. When idle and expressionless, the Worker sends no vertices and does not re-upload after playback completes. Expression vertices reuse their bound skin triangles and are re-located only when an expression changes their source positions. Other characters still do not run separate optical tracking. Grabs bind to the actual skin: dragging another player extends the existing local hand to the true grabbed-skin position; release removes the constraint. Dragging another player's skin and reaching with the hand are predicted locally without waiting for a server round trip. The server validates distance and ownership, rolls prediction back on rejection, limits pulling force, and retains release momentum. Unchanged movement/drag targets receive a keepalive only every 200 ms; stops, jumps, and releases are never swallowed by deduplication. Automatic colours use bright, analogous gradients while retaining the original shader and absorption calculations.
- Handshake seats expire after 20 seconds and can be used once only. Connections have message-size limits, rate limits, and same-origin checks. Movement stops if its input has not been updated for 350 ms (heartbeats and drag messages cannot extend movement input); a lost connection releases its seat after 15 seconds. Empty tables stop their timers. Disconnects explicitly instruct the player to rejoin instead of switching to fake online or single-player mode.
- The swing and trampoline merged from upstream run locally. While a facility owns the body the server only sees a standing player, so server reconciliation is suspended for the duration of the ride and blends the position back afterwards; other players do not see the ride itself. Facility sound, shadows and the laughing expression are unchanged from upstream.
- The matcher allocates serially to avoid simultaneous over-capacity joins, checking at most the 32 most recent tables each time. Room game state is ephemeral, so players must rejoin after a deployment or service restart.
- A WebGPU-capable HTTPS browser is still required; there is no WebGL fallback. The original models, HDR, and textures remain, so the initial asset load is still large. A lightweight multiplayer protocol does not make the original renderer lightweight on every phone.

## Verification

```sh
npm run lint
npm run typecheck
npm run test:online
npm run test:protocol
npm run test:network-budget
npm run test:playback
npm run test:faces
npm run test:drag
npm run test:reconcile
npm run test:remote
npm run test:impact
npm run build
npm run test:rooms
npm run test:physics
npm run test:swing
npm run test:trampoline
npm run test:facility-shadows
npm run test:facility-sound
npm run test:multitouch
npm run test:performance
```

`test:online` verifies input, collisions, jumping, dash cooldowns, sustained six-player stability, and deterministic colours. `test:rooms` verifies concurrent joins, capacity, real WebSocket broadcasting, reuse after leaving, rejected seat replays, colour privacy, and the absence of chat in Miniflare/workerd. Room tests use temporary local storage and never access online players. `test:swing`, `test:trampoline`, `test:facility-shadows` and `test:facility-sound` are the upstream facility suites and run unchanged here.

In development, open `http://localhost:5173/?profile` and click **Measure 5 seconds** to record frame intervals and main-thread time for each stage; this diagnostic entry point is removed from production builds. After starting `npm run dev` and `npm run dev:client`, run `npm run test:bots` to connect five WebSocket test players that access localhost only; use Ctrl-C to release them. The built-in browser has verified a six-player scene: a five-second sample recorded 301 frames, with a mean frame interval of 16.67 ms and a P95 of 17.7 ms. This result represents this machine only and does not guarantee performance on every device.

Collisions are delivered to local and remote soft bodies as numbered, short-lived contact events, applying local impulses and torsion at the contact point. Light contact compresses and wobbles the body; stronger impacts briefly relax standing control, allowing the physical soft body to fall and recover gradually. Model scale and shaders are not changed. The camera keeps the original default distance and zoom range.

Multiplayer performance regression tests: `test:protocol` checks delta encoding/decoding for six-player movement and dragging, member departures/ID reuse, and immutable baselines and historical snapshots; its test traces use about 86% less data than complete JSON snapshots. `test:network-budget` checks input deduplication, timely stop/release behaviour, local prediction, and bounded Worker scheduling at 60/120/144 Hz displays. `test:remote` covers five Workers dragging and releasing simultaneously and reusing transferable buffers. `test:playback` verifies that arriving Worker frames do not jump, that 30 Hz samples play continuously on a 60 Hz display, that root-node spaces stay consistent, that grab points follow the displayed skin, and that idle states do not upload. Mesh vertices are always transferred only inside the browser and never through the server.

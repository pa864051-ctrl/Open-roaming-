# Wildlands Online — playable multiplayer prototype

A small, runnable Three.js + Node.js + Express + Socket.IO open-world **vertical slice**. This is source code for an early prototype, not a finished commercial game. It intentionally separates implemented behavior from ideas that still need production work.

## Requirements

- Node.js 20 or newer and npm
- A modern Android browser (Chrome recommended) or desktop browser
- Internet access to load Three.js from jsDelivr CDN (or vendor Three.js locally for offline hosting)

## Run locally

```bash
cp .env.example .env
npm install
npm start
```

Open `http://localhost:3000` on the computer. To test on an Android phone on the same Wi-Fi, find the computer's LAN IP and open `http://COMPUTER_LAN_IP:3000` on the phone. Allow the port through the computer firewall if necessary. Both devices must be able to reach the server. Landscape orientation is recommended, though portrait is supported.

For two-player testing, open the URL in two separate browser profiles/devices. The first client presses **JOIN WORLD** and the other joins; the server chooses the least-populated available lobby. Try lobby chat, walk around, swing/shoot, and enter a car. The health endpoint is `http://localhost:3000/health`.

## Hosting for remote players

1. Deploy on a Node.js host or VPS that supports persistent WebSocket connections.
2. Copy `.env.example` to `.env`; set a long random `RECOVERY_PEPPER` before accepting real player recovery codes. Never commit `.env`.
3. Run `npm install --omit=dev && npm start` (or use a process manager such as systemd/PM2).
4. Put the app behind HTTPS/WSS using a trusted reverse proxy and a domain. Set `TRUST_PROXY=true` only when the app is actually behind a trusted proxy. Configure the proxy to forward WebSocket upgrades.
5. Back up `data/progress.json` and `data/reports.log`. Restrict filesystem access. Use a persistent disk; ephemeral hosting loses saved progress.
6. Three.js currently loads from a CDN. For restrictive/offline environments, install a pinned `three` package and serve its module locally.

Do not expose the prototype publicly without reviewing account recovery, abuse handling, persistence, moderation, and operational security. The recovery code acts like a bearer credential: anyone who knows it can load that saved profile. Use a unique private code and store a backup somewhere safe. This prototype hashes recovery codes with HMAC and does not store passwords, but it does not have email/identity verification or account takeover recovery.

## Controls

### Touch
- Left virtual joystick: move
- Drag the world view: rotate the camera
- Jump, Sword, Fire, Reload: right-side buttons
- Enter Car, then use the driving controls and Exit
- Chat and menu/profile controls are along the bottom/top

### Keyboard
- WASD or arrow keys: move
- Shift: run
- Space: jump
- Drag with pointer: rotate camera
- E: enter/exit nearby car
- F: sword, G: pistol, R: reload

## Lobby behavior

- Ten numbered lobbies, server-managed membership, target cap of 100 per lobby.
- Join selects the least populated lobby with room, ties resolved by lower lobby number.
- Live occupancy is broadcast to connected clients; disconnects remove a player from the count.
- Lobby chat is server-routed, limited to five messages per five seconds per connection, sanitized and length-limited.
- A full server returns `All lobbies are full`.

The cap is a configured limit, **not a claim that 1,000 concurrent players have been tested**. Reconnects restore the Socket.IO transport, but a disconnected session must press JOIN WORLD again; the prototype does not yet preserve an authenticated session across reconnects.

## Included now

- Stylized Three.js landscape with trees, rocks, hills, roads, lake and a mansion shell with interior partitions and furniture.
- Third-person camera, keyboard and touch movement, jump, graphics presets.
- Ten least-populated lobby selection, occupancy, same-lobby player replication, chat and disconnect cleanup.
- Basic melee/pistol actions validated by server cooldown, range/aim checks and server-applied damage; server-side HP, defeat and timed respawn.
- Eight drivable car models, server-owned driver-seat assignment and server-updated vehicle motion.
- Profile name/skin, simple level/XP/coins, local settings and optional recovery-code-keyed server progress.
- Basic mission reward, report log endpoint behavior and health endpoint.

## Incomplete / simplified

- This is a prototype, not a complete open-world game. The map is stylized and relatively small; mansion architecture is a shell/interior layout, not a polished navigable building. The roof can obscure some views.
- Collision is client-side AABB for movement and is not comprehensive. Server movement is bounded/rate-limited but does not run authoritative world collision or anti-cheat physics. Players may still exploit movement or line-of-sight edge cases.
- Pistol hit validation uses a simplified 2D directional/range check, not full server raycasting through world geometry. No safe-zone system yet.
- Vehicle physics/collision are intentionally simple. The server owns occupancy and basic movement, but vehicle/world collision and per-lobby vehicle instances need improvement.
- Hide-and-seek is not yet a complete game mode; marked hide spots are visual guidance only. No dedicated race mode, matchmaking queue, full mission system, or server-authoritative closet/under-bed hiding state.
- Profile recovery codes are not a complete secure account system. No registration, code rotation/revocation workflow, verified identity, database transactions, or multi-instance persistence. JSON file writes are suitable only for a small prototype.
- Reports are written to a local log; no moderator dashboard, mute UI, persistent bans, or advanced abuse protection.
- No automated end-to-end browser tests, Android device matrix, security audit, or load test has been run as part of this delivery.

## Load testing lobby capacity

Install development dependencies and run a modest local test first:

```bash
npm install
npm run loadtest -- --url http://127.0.0.1:3000 --clients 50 --duration 30
```

The script creates Socket.IO clients, joins them and reports connection/join outcomes. Increase in steps (100, 250, 500, 1000) only on a dedicated test machine/server with monitoring. Run the load generator on a different machine from the server for more representative results. Monitor CPU, memory, event-loop lag, network bandwidth, socket count and process restarts. Test reconnect storms and chat rates separately. The provided script is a connection/lobby smoke test; it does **not** simulate realistic movement, combat or browser rendering and does not certify 100 players per lobby or 1,000 concurrent users. If testing the configured 100-player lobby cap, verify joins stop at capacity and excess clients are assigned to another lobby; reaching 1,000 would require all ten lobbies to fill.

## Project layout

```text
wildlands-online/
  server.js          Express, Socket.IO, lobby state, combat and vehicle validation
  public/index.html  HUD and touch controls
  public/style.css   Responsive mobile UI
  public/game.js     Three.js world, rendering and input
  loadtest.js        Socket.IO lobby smoke/load-test client
  data/              Created at runtime for progress and reports
  .env.example       Environment configuration template
```

## Important security notes

Use HTTPS/WSS for public hosting, set a private pepper, add rate limits at the edge, and use a real database and proper account recovery before treating progress as valuable. The current prototype validates basic bounds/cooldowns server-side, but is not cheat-proof. Do not rely on client-only UI restrictions for game integrity.

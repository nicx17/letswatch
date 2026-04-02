# SyncPlay Security Architecture & Features

SyncPlay is designed with a **"Decentralized Data, Centralized Control"** architecture. While video playback depends entirely on the user's local filesystem (meaning zero raw video data flows through our infrastructure), the synchronization layer requires real-time persistent and bi-directional WebSocket connections. 

To harden the Raspberry Pi 5 node and ensure robust real-time communication without exposing the system to abuse, we have implemented an **"Onion"** security strategy, layering HTTP hardening, packet sanitization, Rate Limiting, and Role-Based Access Control (RBAC).

Here is a detailed breakdown of all the active security features deployed in the project:

## 1. Application-Level HTTP Shield 

Our Node.js Express server acts as the gateway to the Socket.io WebSocket server. We have secured this layer using modern middleware standardizations:

- **Helmet.js Integration:** The `helmet()` middleware automatically establishes foundational security headers to mitigate common web vulnerabilities.
  - **XSS Protection (`X-XSS-Protection`)**: Prevents maliciously mapped cross-site scripts.
  - **Frameguard (`X-Frame-Options`)**: Completely denies iframe rendering (`DENY` or `SAMEORIGIN`), killing Clickjacking vectors outright.
  - **Content Security Policy (CSP)**: Ensures scripts only execute from our origin, blocking unsanctioned foreign scripts if injected.
  - **Sniffing Protection (`X-Content-Type-Options`)**: Prevents browsers from confusing our packet MIME types.
- **Strict CORS Policies**: Express and Socket.io Cross-Origin Resource Sharing is completely deterministic. It actively prohibits wildcard (`origin: "*"`) requests. Connections uniquely accept valid local loopbacks during development (`http://localhost:5173`, `http://127.0.0.1:5173`) and resolve strict Production App URLs via the `process.env.APP_URL` environmental boundary.

## 2. Real-Time Socket.io Hardening

Because Socket.io establishes raw persistent full-duplex pipes natively open to the browser's developer tools, validating incoming JSON payloads against arbitrary tampering is critical.

### Zod Schema Packet Validation 
Never trust arbitrary inbound socket traffic. Hackers often try to inject non-numerical or infinite objects (`NaN`, raw strings, SQL injects) into a `position` parameter to computationally bottleneck or panic the active Express runtime.

Every incoming `sync_state` event is forced through strict structural runtime checks via the `Zod` validation library:
```typescript
const SeekSchema = z.object({
  position: z.number().nonnegative(),
  playing: z.boolean(),
});
...
const result = SeekSchema.safeParse(update);
if (!result.success) return; // Silent reject without crashing the Node process
```
If an event payload deviates from a strict non-negative boolean structure, we silently ignore the packet. 

### Socket Rate Limiting (Button Mashing Mitigation)
To prevent **"Intentional Desync"** or DDoS attacks—where a malicious user writes a script to spam the Socket server thousands of times a second with `play`/`pause` pinging logic—we built an isolated time-window based Rate Limiting engine logic via an in-memory `Map`.
- Users are computationally restricted to **15 actions per 2 seconds**. 
- If a single `socket.id` breaches this threshold, the server mutes and drops subsequent packets from that specific client until their timer `resetAt` clears, preserving the integrity and frame-rate for the rest of the room.

### Leader-Enforced Authority (Anarchy Exploit Prevention)
Our room logic employs a strict Master (Leader) / Viewer (Spectator) relationship array map. If a non-leader intercepts the `sync_state` event header and tries to dictate playback across the array, they are locked out natively. 
- *Backend logic:* `if (room.leaderId !== socket.id) return;` completely shutters unauthorized state changes originating from arbitrary guests.
- *Frontend logic:* To preserve network bandwidth, we double-check `if (isLeader)` cleanly before the client ever attempts to generate an `emit`. This protects the backend from processing unnecessary, destined-to-fail logic queues from non-host guests.

## 3. Disconnection & State Recovery 
A common exploit or frustration in WebSocket lobbies stems from ghost-connections failing to deregister, confusing the participant arrays over hours or days.
- If an edge-disconnection occurs, the frontend inherently detects the broken heartbeat, natively transitioning the user into a graceful visual **"Disconnected"** fallback state instead of leaving an unresponsive player. 
- When the socket automatically background re-connects, it triggers a `handleReconnect` background loop—immediately pushing a quiet `join_room` to fetch updated backend states, and avoiding ghost sessions or hanging rooms.
- **Leader Handoff:** If the Host explicitly leaves, the room doesn't stall indefinitely. The backend strips them from the array and bumps the authority to `participants[0]`, broadcasting a `leader_changed` event seamlessly so playback control is not lost.

## 4. Runtime & Dependency Security
- **Deprecation Clearing:** Our Node instance explicitly utilizes the `tsx` wrapper instead of legacy `ts-node`. Node warnings like `--experimental-loader` and native pathing flaws have been completely patched to prevent runtime memory leaks or deprecation halts scaling out.
- **Native Test Coverages:** We run automated Vitest regression suites against the Server Room Logic to prove out:
  1. Valid payload mapping & leader assignments.
  2. The failure and nullification of negative-timestamp injections.
  3. Strict drops of anarchy (Spectator) payload overrides.
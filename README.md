<div align="center">
  <a href="https://unsplash.com/illustrations/a-blue-and-orange-circle-with-an-orange-spiral-in-the-center-_B2A99CU0bA?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText">
    <img src="client/public/app-icon.svg" alt="Lets Watch App Icon" width="128" />
  </a>
</div>

# Lets Watch

Lets Watch is a high-performance, real-time video synchronization application that prioritizes **Local-First Privacy**. It acts as a Decentralized Data, Centralized Control video platform, meaning the video data never touches the network. Only the "state" (play/pause/seek) is handled by the WebSocket server, ensuring full visual quality and absolute privacy. 

This project was built using a **React + TypeScript + Vite + Tailwind v4** frontend and a **Node.js + Express + Socket.io** backend, optimized for self-hosting on a Raspberry Pi 5.

---

## Interface & UI Identity

Lets Watch includes built-in Light and Dark themes referencing custom typography and aesthetics:
*   **Dark Mode:** Default active theme applying deep ambient magenta gradients (`fuchsia-950` to `purple-950`). Features glass-morphic frosted UI cards via backdrop blurs (`black/40 backdrop-blur-xl`) and glowing neon accents.
*   **Light Mode:** A crisp, sophisticated transition adopting `#FAF9F6` creamy-ivory backgrounds, structured contrast text (`#2D2D2D`), and serif typographics (`ui-serif, Georgia, "Times New Roman"`) to match minimalist portfolios.

---

## Architecture

The monorepo contains two primary isolated layers:

### 1. `client/` - React 19 Frontend
-   **Local Video Access (Blob URLs):** Users select an `.mp4`, `.mkv`, or `.webm` locally. The application constructs a native standard DOM `blob://` URI mapped directly to RAM/Filesystem memory without transferring bytes over the network.
-   **State Interpreter:** Binds `<video />` events (`onPlay`, `onPause`, `onSeeked`) to broadcast socket state updates.
-   **Sub-Second Sync Engine:** The `SyncController` runs a background check every 3000ms. If network lag causes a watcher to drift $> 0.5\text{s}$, the app emits visual warnings and offers a manual "Force Sync". Programmatic event rebouncing (infinite socket loops) is strictly blocked referencing a mutable `ignoreEvents` blocker.

### 2. `server/` - Node.js Backend
-   **Socket State Machine:** Operates an in-memory `Map` tracking each Session ID, mapping connected Socket Clients.
-   **Leader Enforcement:** The first participant initializes the room as `leaderId`. To prevent "Anarchy Mode" scrubbing sabotage, only the Leader dictates the exact state footprint. If the leader disconnects, leadership gracefully migrates to the next participant.
-   **Rate Limiting & Hardening:** A `Map`-driven limiter thresholds aggressive clients (spamming > 15 socket events per 2 seconds). Rooms implicitly cap at 20 participants and IDs must map cleanly to 36-character bounds.

---

## Local Development

Ensure you have **Node.js (v18+)** installed.

### 1. Start the Backend
```bash
cd server
npm install
npm run dev
```
*The WebSocket server will mount on `http://localhost:4000` via nodemon.*

### 2. Start the Frontend
```bash
cd client
npm install
npm run dev
```
*Vite will compile and serve the frontend locally on `http://localhost:5173`.*

---

## Testing

The frontend math engine dictates exactly what frame clients must lock to via `calculateDrift` and `getTargetTime`. These functions have full Vitest coverage checking the millisecond deltas of expected server lag and paused-state interpolation.

```bash
cd client
npm run test # OR npx vitest run
```

---

## Security

Read the full security implementation breakdown mapping our App-Level Shields and Runtime Defenses within [SECURITY.md](SECURITY.md).

---

## Deployment

Check out [DEPLOYMENT.md](DEPLOYMENT.md) for deploying to Production, hooking up environment variables, and properly routing the WebSocket server.

---
## Attribution
  <p>
    <a href="https://unsplash.com/illustrations/a-blue-and-orange-circle-with-an-orange-spiral-in-the-center-_B2A99CU0bA?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText">Illustration</a> by <a href="https://unsplash.com/@sigmund/illustrations?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText">Compagnons</a> on <a href="https://unsplash.com/illustrations?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText">Unsplash</a>
  </p>

## License

This project is open-source and released under the **GNU General Public License v3.0 (GPL-3.0)**. See the `LICENSE` file for more details.

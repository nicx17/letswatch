# Lets Watch

Lets Watch is a local-first watch-party app for self-hosted environments. Each viewer opens the video file from their own machine, while the server only coordinates playback state over Socket.IO.

## What It Does

- Syncs play, pause, and seek events across a room with shared participant control.
- Lets viewers create rooms with their own room code and 6-digit join PIN.
- Offers room chat with viewer-selected names, quick emoji reactions, emoji-rendered text, and lightweight image sharing.
- Serves the React frontend and the Socket.IO backend from one Node process in production.
- Keeps media local to each participant instead of uploading it to the server.
- Broadcasts chat messages live without storing chat history on the server.
- Includes basic hardening such as Helmet, payload validation with Zod, and lightweight rate limiting.
- Obfuscates sensitive identifiers in backend logs so room and participant metadata are not written in plain text.
- Applies dedicated authentication throttling to room create/join flows to reduce brute-force attempts.

## Repository Layout

- `client/`: React 19 + Vite frontend.
- `server/`: Express + Socket.IO backend.
- `README.md`: project overview and development guide.
- `SECURITY.md`: current controls, limitations, and security workflow.
- `DEPLOYMENT.md`: production setup and hosting notes.

## Prerequisites

- Node.js 20 or newer.
- npm 10 or newer.

## Local Development

Install dependencies in both packages:

```bash
npm run install:all
```

Start the backend:

```bash
cd server
npm run dev
```

Start the frontend in a second terminal:

```bash
cd client
npm run dev
```

The default local URLs are:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:4000`

## Environment Variables

### Server

Copy [`server/.env.example`](server/.env.example) to `server/.env`:

```env
PORT=4000
NODE_ENV=production
APP_URL=https://www.example.com
```

### Client

Copy [`client/.env.example`](client/.env.example) to `client/.env` if the frontend needs to talk to a separately hosted backend:

```env
VITE_SOCKET_URL=http://localhost:4000
```

In production, the client falls back to `window.location.origin` when `VITE_SOCKET_URL` is not set.

## Quality Checks

Run from the repo root after both packages are installed:

```bash
npm run lint
npm run test
npm run build
```

What these commands do:

- `npm run lint`: runs frontend ESLint and backend TypeScript checks.
- `npm run test`: runs client and server Vitest suites.
- `npm run build`: builds the frontend and type-checks the backend.

## Production Notes

- The frontend must be built before starting the server in production.
- The backend serves `client/dist` when `NODE_ENV=production`.
- Static assets under `/assets` are cached aggressively because Vite fingerprints them.
- `index.html` is served with `no-store` caching so browsers always pick up the latest asset references.
- In production, `index.html` is served through a nonce-injecting response path so CSP `script-src` remains strict while app bundles still load.
- Open the app at `/` in production. Direct `/index.html` requests are redirected to `/` so CSP nonce injection is consistently applied.
- Chat images are resized in the browser before they are sent over Socket.IO.
- Joining an existing room requires both the chosen room code and its 6-digit PIN.
- Room codes are normalized to uppercase and PIN inputs are reduced to six digits during create and join.
- Rooms also expose a copyable share link with a room-specific token so invite links can join directly without re-entering the PIN.
- PIN-based joins rotate the current share token, so older copied links stop working after a fresh PIN join.
- Room state is in-memory only. When the last participant disconnects, room membership and playback state are dropped.

## Security Headers Summary

- CSP is emitted as an HTTP response header and uses nonce-augmented `script-src` with strict-dynamic support (without `unsafe-inline` for scripts).
- Trusted Types is enforced via CSP (`require-trusted-types-for 'script'`) and the HTML shell injects an early default policy bootstrap for runtime compatibility.
- HSTS is enabled in production with long max-age, subdomain coverage, and preload.

See [`DEPLOYMENT.md`](DEPLOYMENT.md) for a full deployment walkthrough.


## Security

See [`SECURITY.md`](SECURITY.md) for the current threat model, implemented controls, and known gaps.

## License

This project is licensed under `GPL-3.0-or-later`. See [`LICENSE`](LICENSE) for details.

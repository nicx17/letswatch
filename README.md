# Lets Watch

Lets Watch is a local-first watch-party app for self-hosted environments. Each viewer opens the video file from their own machine, while the server only coordinates playback state over Socket.IO.

## What It Does

- Syncs play, pause, and seek events across a room.
- Serves the React frontend and the Socket.IO backend from one Node process in production.
- Keeps media local to each participant instead of uploading it to the server.
- Includes basic hardening such as Helmet, payload validation with Zod, and lightweight rate limiting.

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

See [`DEPLOYMENT.md`](DEPLOYMENT.md) for a full deployment walkthrough.


## Security

See [`SECURITY.md`](SECURITY.md) for the current threat model, implemented controls, and known gaps.

## License

This project is licensed under `GPL-3.0-or-later`. See [`LICENSE`](LICENSE) for details.

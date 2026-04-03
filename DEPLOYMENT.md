# Deployment Guide

## Overview

Lets Watch is deployed as a unified Node application:

- the React app is built into `client/dist`
- the Express server serves that frontend in production
- Socket.IO runs from the same Node process

## 1. Prepare The Server

Clone the repository and install dependencies:

```bash
git clone https://github.com/nicx17/letswatch.git
cd letswatch
npm run install:all
```

## 2. Configure Environment Variables

Create the backend environment file:

```bash
cp server/.env.example server/.env
```

Set the production values:

```env
PORT=4000
NODE_ENV=production
APP_URL=https://letswatch.example.com
```

Only create `client/.env` when the frontend must point at a different backend origin. For the unified deployment model, the client can use the default production fallback of `window.location.origin`.

## 3. Build The Frontend

Build the frontend bundle before starting the server:

```bash
npm run build
```

Notes:

- the client package produces `client/dist`
- the server package does not emit a separate runtime bundle today; its `build` command is a TypeScript validation step

## 4. Start The Application

Run the backend from the `server/` package:

```bash
cd server
npm run start
```

The production process expects `client/dist` to already exist.

Important runtime note:

- In production, open the app via `/` rather than `/index.html`.
- The server injects CSP nonces into HTML before responding, and direct `/index.html` is redirected to `/` to preserve that behavior.

## 5. Process Management

Using `pm2` is a straightforward way to keep the server alive:

```bash
pm2 start "npm --prefix /path/to/letswatch/server run start" --name letswatch
pm2 save
```

## 6. Reverse Proxy Notes

If you run the app behind Nginx, Caddy, or another reverse proxy:

- forward normal HTTP traffic to the Node port
- forward WebSocket upgrade requests to the same port
- terminate TLS at the proxy or upstream load balancer
- keep `APP_URL` aligned with the externally visible origin

## 7. Verification Checklist

After deployment, verify:

- the frontend loads successfully from the public origin
- the HTML response includes a CSP header and script tags include CSP nonces
- loading `/index.html` redirects to `/`
- the browser can connect to Socket.IO
- a new room can be created with a chosen room code and 6-digit PIN
- a second device can only join with the correct room code and PIN
- repeated failed room-join attempts are throttled with a retry-later response
- the `Copy Room Link` action produces a URL containing both a room code and a token
- opening that shared link joins the room without re-entering the PIN
- joining again with the PIN rotates the share token so older links stop working
- mixed-case room codes and pasted PIN values still resolve cleanly because the app normalizes them before validation
- shared playback updates still work across both devices
- live chat works for text, quick emoji reactions, and a small image message
- the `client/dist` assets are being served
- `index.html` is returning fresh cache headers after a deploy
- HSTS is present in production responses (with includeSubDomains and preload)
- rooms disappear after the last participant leaves and do not recover old chat history on rejoin

## CI And Release Hygiene

Before promoting changes, run:

```bash
npm run lint
npm run test
npm run build
```

The GitHub Actions workflows mirror those same commands so local validation and CI stay aligned.

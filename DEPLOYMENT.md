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
- the browser can connect to Socket.IO
- a new room can be created with a chosen room code and 6-digit PIN
- a second device can only join with the correct room code and PIN
- mixed-case room codes and pasted PIN values still resolve cleanly because the app normalizes them before validation
- shared playback updates still work across both devices
- live chat works for text and a small image message
- the `client/dist` assets are being served
- `index.html` is returning fresh cache headers after a deploy
- rooms disappear after the last participant leaves and do not recover old chat history on rejoin

## CI And Release Hygiene

Before promoting changes, run:

```bash
npm run lint
npm run test
npm run build
```

The GitHub Actions workflows mirror those same commands so local validation and CI stay aligned.

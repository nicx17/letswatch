# Deployment Guide

## Overview

Production deployment for this repository uses one Node process:

- the client is built into `client/dist`
- the server serves the built frontend
- Socket.IO runs from the same process

## Setup

Clone the repository and install dependencies:

```bash
git clone https://github.com/nicx17/letswatch.git
cd letswatch
npm run install:all
```

Create the backend environment file:

```bash
cp server/.env.example server/.env
```

Set production values:

```env
PORT=4000
NODE_ENV=production
APP_URL=https://letswatch.example.com
```

Only create `client/.env` when the frontend must point to a different backend origin.

## Build

Build the frontend before starting the server:

```bash
npm run build
```

Build output:

- `client/dist` contains the frontend assets
- the server package does not emit a separate runtime bundle

## Start

Run the backend from `server/`:

```bash
cd server
npm run start
```

Production expects `client/dist` to exist before startup.

## Reverse Proxy

If the app runs behind Nginx, Caddy, or another proxy:

- forward HTTP traffic to the Node port
- forward WebSocket upgrades to the same port
- terminate TLS at the proxy or load balancer
- keep `APP_URL` aligned with the public origin

## Runtime Notes

- Open the app at `/` in production.
- Requests to `/index.html` are redirected to `/`.
- The server injects CSP nonces into the HTML shell before sending it.
- Static assets under `/assets` are fingerprinted and cached long-term.
- `index.html` is returned with short-lived, non-sticky cache headers.

## Validation Checklist

After deployment, verify:

- the frontend loads from the public origin
- `/index.html` redirects to `/`
- the HTML response includes a CSP header
- Socket.IO connects successfully
- a room can be created with a room code and 6-digit PIN
- a second client can only join with the correct PIN or a valid share link
- failed join attempts are throttled
- the share link contains both `room` and `token`
- joining with the PIN rotates the share token
- text chat and image chat both work
- rooms disappear after the last participant disconnects

## CI Parity

Before release, run:

```bash
npm run lint
npm run test
npm run build
```

The GitHub Actions workflows mirror these commands.

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
# Behind a reverse proxy on the same machine:
HOST=127.0.0.1
TRUST_PROXY=1
```

See the [environment variable table](README.md#server) for every option, and [Reverse Proxy](#reverse-proxy) for how to choose `HOST` and `TRUST_PROXY`.

Only create `client/.env` when the frontend must point to a different backend origin.

## Build

Build the frontend before starting the server:

```bash
npm run build
```

Build output:

- `client/dist` contains the frontend assets
- the server package does not emit a separate runtime bundle. `npm run start` runs `src/index.ts` directly with Node's built-in TypeScript type stripping, so production needs Node 22.18 or newer and no extra transpiler.

## Start

Run the backend from `server/` using PM2:

```bash
cd server
pm2 start npm --name "letswatch" -- start
```

Or to run it directly:

```bash
cd server
npm run start
```

Production expects `client/dist` to exist before startup.

### Run exactly one instance

All room, playback, and rate-limit state lives in the memory of a single Node process. Do not use PM2 cluster mode (`pm2 start -i max`), multiple containers, or several replicas behind a load balancer. Clients routed to different processes would not see each other's rooms, and each process would keep its own rate limits. Under PM2 cluster mode, every worker except the first refuses to start.

Any restart (deploy, crash, `pm2 restart`) drops every active room. Viewers then have to create a new room.

On `SIGTERM` or `SIGINT` the server stops accepting connections, closes open sockets, and exits. If that takes longer than 5 seconds, it exits with status 1.

## Reverse Proxy

If the app runs behind Nginx, Caddy, or another proxy:

- forward HTTP traffic to the Node port
- forward WebSocket upgrades to the same port
- terminate TLS at the proxy or load balancer
- keep `APP_URL` aligned with the public origin
- pass the original `Host` header through. When a Socket.IO request has no `Origin` header, the server admits it only if `Host` matches the host in `APP_URL`.

### Listen address

The server listens on `HOST:PORT`, with `HOST` defaulting to `0.0.0.0`. When the proxy runs on the same machine, set `HOST=127.0.0.1` so nobody can reach Node directly and skip TLS. Otherwise, firewall the port so only the proxy can reach it.

### Client IP and `TRUST_PROXY`

Rate limits are keyed by client address. Without `TRUST_PROXY`, every client looks like the proxy, so all users share one authentication budget.

Set `TRUST_PROXY` to the **number of proxies** in front of the server. Each proxy appends the address it received the request from to `X-Forwarded-For`. The server therefore reads the client from that many entries from the right, and ignores anything a client wrote further left. `true` means `1`.

| Setup | `TRUST_PROXY` |
| --- | --- |
| Node exposed directly | unset |
| Nginx or Caddy in front | `1` |
| Cloudflare, then Nginx | `2` |

A hop count is only safe if every request really passes through that many proxies. With Cloudflare in front, restrict the origin proxy to Cloudflare's published IP ranges. Otherwise, someone connecting to the proxy directly could supply the entry the server trusts.

Nginx example using the standard appending header:

```nginx
location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### Health checks

`GET /healthz` returns `{"status":"ok"}` with `Cache-Control: no-store`. It is not rate limited, and it works in development as well as production.

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
- `/healthz` returns `{"status":"ok"}`
- the share link has the form `/?room=CODE#token=...`, with the token in the fragment
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

The GitHub Actions workflows run these commands. They then start the production server with `npm run start` and check that `/healthz` and `/` respond.

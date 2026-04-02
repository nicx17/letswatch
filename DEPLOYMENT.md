# Deployment Guide

Lets Watch utilizes a split architecture (React Single Page App + Node WebSocket Server) which requires deploying the frontend and backend separately. 

## 1. Backend Server Deployment (Render / Railway / VPS)

The backend (`server/`) is a simple Node.js HTTP + Socket.io server.

### Standard VPS / Self-Hosting (e.g. Raspberry Pi, DigitalOcean, Hetzner)
We use `tsx` to run the TypeScript files seamlessly in production.
1. Clone the repository on your server.
2. Install dependencies:
   ```bash
   cd server
   npm install
   ```
3. Set your internal bindings or port variables (it mounts to `process.env.PORT || 4000`).
4. Keep it running via `pm2` or systemd:
   ```bash
   npm install -g pm2
   pm2 start "npm run start" --name letswatch-server
   ```

### PaaS (Render / Railway)
1. Point your platform to your Git repository.
2. Tell it to deploy the `server/` directory as a "Web Service".
3. **Build Command**: `npm install`
4. **Start Command**: `npm run start`

Make note of the final deployed HTTPS / WSS URL of your backend. You will need this for the frontend!

---

## 2. Frontend Deployment (Vercel / Netlify / Cloudflare Pages)

The frontend (`client/`) is a static bundle shipped by Vite.

1. Point your chosen hosting provider at the `client/` folder.
2. **Build Settings**:
   *   **Framework**: Vite (if not auto-detected)
   *   **Install Command**: `npm install`
   *   **Build Command**: `npm run build`
   *   **Publish Directory**: `dist`
3. **Environment Variables**:
   You must set `VITE_SOCKET_URL` to point to the secure URL of the deployed backend.
   ```
   VITE_SOCKET_URL=https://your-deployed-backend-url.com
   ```
   *(If not set, it falls back to `http://localhost:4000` for local dev).*

4. Deploy the frontend and visit your live page!

## Quick Checklist
- [x] Backend deployed & listening for requests (check with browser).
- [x] `VITE_SOCKET_URL` correctly wired into frontend build environment.
- [x] SSL/TLS correctly terminating WebSockets (all modern PaaS do this wss:// implicitly over HTTPS routing).

# Deployment Guide (Unified Server)

Since both the React client and the Node backend will be hosted on the same server, the deployment architecture is unified. The Node.js Express server is configured to serve the React frontend as static files alongside the WebSocket server.

## 1. Setup and Build

1. Clone your repository to the server.
2. Install dependencies and build the frontend codebase correctly into `client/dist`:
   ```bash
   cd client
   npm install
   npm run build
   ```

3. Install the server dependencies:
   ```bash
   cd ../server
   npm install
   ```

## 2. Server Environment

Inside the `server/` directory, create a `.env` file from the example:
```bash
cp .env.example .env
```

Your `.env` should look like this:
```env
PORT=4000
NODE_ENV=production
APP_URL=https://letswatch.hyclotron.com
```

*Note: Since the server directly serves the static files in production, you do not need to configure `VITE_SOCKET_URL` in the frontend `client/`. The `import.meta.env.PROD` flag will automatically bind the socket connection to `window.location.origin` out of the box when you build it!*

## 3. Run It

The Node server will now intercept all API / socket events, and default everything else back to the React app serving your HTML.

Deploy using `pm2` or systemd:
```bash
cd server
npm install -g pm2
pm2 start "npm run start" --name letswatch-unified
```

## Security Reminders!
- ✅ **Helmet Content Security Policy (CSP)** is configured to explicitly allow reading native Local Blobs (`blob:`) so that your `video/mp4` streams render completely offline.
- ✅ **Host Verification**: The `APP_URL` inside `.env` will explicitly map trust to your custom domain `letswatch.hyclotron.com`.

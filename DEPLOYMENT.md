# Deployment Guide (Unified Server)

Since both the React client and the Node backend will be hosted on the same server, the deployment architecture is unified. The Node.js Express server is configured to serve the React frontend as static files alongside the WebSocket server.

## 🔴 IMPORTANT: The Build Step

You MUST build the frontend before starting the server. If you skip this, the server will have no HTML/JS files to serve at `client/dist`.

### Step-by-Step Command Guide:

1. **Clone your repository to the server:**
   ```bash
   git clone https://github.com/nicx17/letswatch.git
   cd letswatch
   ```

2. **Build the React Frontend:**
   The backend statically serves `/client/dist`. You must generate this folder:
   ```bash
   cd client
   npm install
   npm run build
   ```
   *(This takes all your React code and minifies it into static, production-ready files).*

3. **Prepare the Node Backend:**
   ```bash
   cd ../server
   npm install
   ```
   *(We use `tsx` to run the backend natively in TypeScript without needing a separate backend build step!)*

---

## Server Environment Configuration

Inside the `server/` directory, copy the example variables:
```bash
cp .env.example .env
```

Edit your `server/.env` to secure your domain:
```env
PORT=4000
NODE_ENV=production
APP_URL=https://letswatch.hyclotron.com
```

*Note: Since the server directly serves the static files in production, you do not need to configure `VITE_SOCKET_URL` in the frontend `client/`. The `import.meta.env.PROD` flag will automatically bind the socket connection to `window.location.origin` out of the box!*

---

## 🚀 Run It

The Node server will now intercept all API / socket events, and seamlessly default everything else back to the React `dist` folder.

Deploy using `pm2` to keep it running forever in the background:
```bash
# Assuming you are still in the `server/` directory:
npm install -g pm2
pm2 start "npm run start" --name letswatch-unified
```

## Security Reminders
- ✅ **Helmet Content Security Policy (CSP)** is configured to explicitly allow reading native Local Blobs (`blob:`) so that your `video/mp4` streams render completely offline.
- ✅ **Host Verification**: The `APP_URL` inside `.env` will explicitly map trust to your custom domain `letswatch.hyclotron.com`.

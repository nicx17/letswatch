import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'vendor';
          }
          if (id.includes('node_modules/socket.io-client') || id.includes('node_modules/socket.io-parser')) {
            return 'socket';
          }
        }
      }
    }
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});

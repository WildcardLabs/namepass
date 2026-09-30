import { defineConfig } from "vite";

// Serve operator HTML directly, without the application's Nitro renderer.
export default defineConfig({
  server: { host: "127.0.0.1", port: 5174, strictPort: true },
});

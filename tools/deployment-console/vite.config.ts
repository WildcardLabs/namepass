import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const rpcTargets: Record<string, string> = {
  "1": "https://ethereum.reth.rs/rpc",
  "11155111": "https://ethereum-sepolia-rpc.publicnode.com",
  "84532": "https://sepolia.base.org",
  "421614": "https://sepolia-rollup.arbitrum.io/rpc",
  "5042002": "https://rpc.testnet.arc.network",
};
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  server: {
    host: "127.0.0.1", port: 4177, strictPort: true,
    proxy: { "/sourcify": { target: "https://sourcify.dev/server", changeOrigin: true, rewrite: path => path.replace(/^\/sourcify/, "") }, "/iris": { target: "https://iris-api-sandbox.circle.com", changeOrigin: true, rewrite: path => path.replace(/^\/iris/, "") }, ...Object.fromEntries(Object.entries(rpcTargets).map(([id, target]) => [`^/rpc/${id}(?:/|$)`, {
      target, changeOrigin: true, rewrite: () => "/",
    }])) },
    fs: { allow: [fileURLToPath(new URL("../../", import.meta.url))] },
  },
  build: { outDir: "dist", emptyOutDir: true },
});

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import { workflow } from "workflow/vite";

export default defineConfig({
	plugins: [react(), tailwindcss(), nitro(), workflow({ dirs: ["workflows"] })],
	nitro: {
		serverDir: "./",
		rollupConfig: { output: { chunkFileNames: "_chunks/[hash].mjs" } },
	},
});

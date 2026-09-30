import { defineConfig } from "vitest/config";

export default defineConfig({
	test: { include: ["src/lib/*.test.ts", "src/App.test.tsx", "tools/*.test.ts"] },
});

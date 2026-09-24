import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("RPC budget invariants", () => {
	test("no scheduled endpoint polls chain health", () => {
		const root = new URL("../../", import.meta.url);
		const config = JSON.parse(readFileSync(new URL("vercel.json", root), "utf8")) as {
			crons?: Array<{ path: string }>;
		};
		expect(config.crons?.map((cron) => cron.path)).toEqual([
			"/api/cron/recover",
			"/api/cron/retention",
		]);
		expect(existsSync(new URL("routes/api/cron/health.ts", root))).toBe(false);
	});
});

import { describe, expect, test } from "vitest";

import { YEAR_SECONDS } from "./pricing";
import { fmtDuration } from "./format";

describe("compact renewal duration", () => {
	test("shows the live three-character renewal in hours instead of zero days", () => {
		expect(fmtDuration(44_347n)).toBe("+12h");
	});

	test("uses the smallest useful unit at sub-day boundaries", () => {
		expect(fmtDuration(1n)).toBe("+1m");
		expect(fmtDuration(3_599n)).toBe("+60m");
		expect(fmtDuration(3_600n)).toBe("+1h");
		expect(fmtDuration(86_399n)).toBe("+23h");
		expect(fmtDuration(86_400n)).toBe("+1d");
	});

	test("keeps year formatting for long renewals", () => {
		expect(fmtDuration(YEAR_SECONDS)).toBe("+1.0y");
	});
});

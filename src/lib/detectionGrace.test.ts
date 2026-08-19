import { describe, expect, it } from "vitest";
import {
	DETECTION_GRACE_MS,
	isDetectionPending,
	updateDetectionObservations,
} from "./detectionGrace";

describe("detection grace", () => {
	it("keeps the first unmatched balance in the preparing state", () => {
		const observations = updateDetectionObservations({}, ["11155111"], 1_000);
		expect(isDetectionPending("not_detected", true, observations["11155111"], 30_000)).toBe(true);
	});

	it("requires two reads and the full grace time before offering a retry", () => {
		const first = updateDetectionObservations({}, ["11155111"], 1_000);
		const second = updateDetectionObservations(first, ["11155111"], 16_000);

		expect(isDetectionPending("not_detected", true, second["11155111"], 20_999)).toBe(true);
		expect(isDetectionPending("not_detected", true, second["11155111"], 1_000 + DETECTION_GRACE_MS)).toBe(false);
	});

	it("does not delay an explicit flow failure", () => {
		expect(isDetectionPending("flow_failed", true, undefined, 1_000)).toBe(false);
	});

	it("removes observations for balances that clear or gain a flow", () => {
		const first = updateDetectionObservations({}, ["11155111", "84532"], 1_000);
		const next = updateDetectionObservations(first, ["84532"], 2_000);

		expect(next["11155111"]).toBeUndefined();
		expect(next["84532"].reads).toBe(2);
	});
});

import { describe, expect, test } from "vitest";

import { HUB_CHAIN } from "./chains";
import { ACTIVE_FLOW_STATUSES, flowFailurePresentation, flowPresentation } from "./flowPresentation";

describe("flow presentation", () => {
	test("every active backend state has complete feed and detail copy", () => {
		for (const status of ACTIVE_FLOW_STATUSES) {
			const presentation = flowPresentation(status, "84532");
			expect(presentation.feed.length).toBeGreaterThan(0);
			expect(presentation.detail.length).toBeGreaterThan(0);
		}
	});

	test("an Ethereum origin is a renewal and never a burn or transfer", () => {
		for (const status of ["submitting_origin", "waiting_origin"] as const) {
			const presentation = flowPresentation(status, String(HUB_CHAIN.chainId));
			expect(presentation.feed).toBe("Renewing");
			expect(presentation.detail.toLowerCase()).toContain("renewal");
			expect(presentation.detail.toLowerCase()).not.toMatch(/burn|transfer/);
		}
	});

	test("a non-Ethereum origin starts a Circle transfer before attestation", () => {
		expect(flowPresentation("submitting_origin", "84532")).toEqual({
			feed: "Transferring",
			detail: "Starting the Circle transfer",
		});
		expect(flowPresentation("waiting_attestation", "84532").detail).toBe(
			"Waiting for Circle attestation",
		);
	});

	test("an origin failure also keeps its chain meaning", () => {
		expect(flowFailurePresentation(String(HUB_CHAIN.chainId)).label).toBe(
			"Renewal did not go through",
		);
		expect(flowFailurePresentation("84532").label).toBe("Transfer did not go through");
		expect(flowFailurePresentation("84532", "empty_wallet").label).toBe("Automatic processing stopped");
	});
});

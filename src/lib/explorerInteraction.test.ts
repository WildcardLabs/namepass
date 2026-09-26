// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import Explorer from "../components/Explorer";
import { PUBLIC_CHAINS } from "./chains";
import { getActivity, getPublicConfig, type ActivityRead } from "./publicApi";

vi.mock("./publicApi", async (original) => ({
	...await original<typeof import("./publicApi")>(),
	getActivity: vi.fn(), getPublicConfig: vi.fn(),
}));

// Row expansion must not intercept a name navigation or toggle twice when
// the disclosure button's click bubbles through the row.
test("desktop and mobile flow rows separate name navigation from expansion", async () => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.spyOn(window, "scrollTo").mockImplementation(() => {});
	const address = `0x${"1".repeat(40)}`;
	const at = "2026-09-26T00:00:00Z";
	const feed: ActivityRead = {
		items: [{
			name: {
				label: "example", displayName: "example.eth", depositAddress: address,
				activatedAt: at, currentExpiry: null, renewableBy: "registrar", ensSyncedAt: at,
				unscannedChainIds: [], lifetimeReceived: "1000000", lifetimeApplied: "900000",
				timeDeliveredSeconds: "86400", renewalCount: "1",
			},
			renewal: {
				eventId: "row-renewal", flowId: "row-flow", originChainId: "84532",
				funderAddress: address, executorAddress: address, executorIsRelayer: true,
				amountReceived: "1000000", gasAllowance: "100000", amountApplied: "900000",
				durationSeconds: "86400", expiryAfter: null, fromCctp: false,
				depositTxHash: null, originTxHash: null, claimTxHash: null,
				renewalTxHash: `0x${"2".repeat(64)}`, blockTime: at,
			},
		}],
		flows: [], nextCursor: null,
	};
	vi.mocked(getActivity).mockResolvedValue(feed);
	vi.mocked(getPublicConfig).mockResolvedValue({ chains: PUBLIC_CHAINS.map(({ chainId }) => ({ chainId, minimumTriggerAmount: "500000" })) });
	const onSelect = vi.fn();
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	try {
		await act(async () => root.render(createElement(Explorer, { selected: null, onSelect, onActivated: () => {}, onSupportedTokens: () => {} })));
		const disclosures = [...container.querySelectorAll<HTMLButtonElement>('button[aria-controls="flow-details-row-renewal"]')];
		expect(disclosures).toHaveLength(2);
		for (const disclosure of disclosures) {
			const row = disclosure.closest<HTMLElement>('.lg\\:hidden') ?? disclosure.parentElement!;
			await act(async () => row.click());
			expect(disclosure.getAttribute("aria-expanded")).toBe("true");
			await act(async () => disclosure.click());
			expect(disclosure.getAttribute("aria-expanded")).toBe("false");
			const name = row.querySelector<HTMLButtonElement>('button[aria-label="Open example.eth"]')!;
			expect(name).not.toBeNull();
			onSelect.mockClear();
			await act(async () => name.querySelector("span")!.click());
			expect(onSelect).toHaveBeenCalledExactlyOnceWith("example.eth");
			expect(disclosure.getAttribute("aria-expanded")).toBe("false");
		}
	} finally {
		await act(async () => root.unmount());
		container.remove();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	}
});

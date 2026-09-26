// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import PassCard from "../components/PassCard";
import SupportedTokens from "../components/SupportedTokens";

const address = "0x043c184003266644372bA5fA4946777b3f1cFC3D";

// The observable contract is truthful, stable feedback on every public copy field.
// The existing QR test does not exercise clipboard success or rejection.
test.each(["deposit", "contracts"])("%s copy feedback only confirms a successful write and keeps the target stable", async (surface) => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.useFakeTimers();
	const writeText = vi.fn().mockRejectedValueOnce(new Error("Denied")).mockResolvedValue(undefined);
	vi.stubGlobal("navigator", { clipboard: { writeText } });
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	try {
		await act(async () => root.render(surface === "deposit"
			? createElement(PassCard, { name: "vitalik.eth", address, onSupportedTokens: () => {} })
			: createElement(SupportedTokens, { onBack: () => {} })));
		const buttons = [...container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Copy"]')];
		const target = buttons[0];
		const originalLabel = target.getAttribute("aria-label");
		const originalText = target.textContent;
		await act(async () => target.click());
		expect(container.querySelector('[role="status"]')?.textContent).toBe("");
		expect(container.querySelector('[role="alert"]')?.textContent).toContain("Could not copy");
		await act(async () => target.click());
		expect(container.querySelector('[role="alert"]')).toBeNull();
		expect(container.querySelector('[role="status"]')?.textContent).toBe("Copied to clipboard");
		expect(target.getAttribute("aria-label")).toBe(originalLabel);
		expect(target.textContent).toBe(originalText);
		expect(writeText).toHaveBeenLastCalledWith(surface === "deposit" ? "vitalik.namepass.eth" : expect.stringMatching(/^0x[a-fA-F0-9]{40}$/));
		await act(async () => vi.advanceTimersByTime(1000));
		await act(async () => buttons[1].click());
		await act(async () => vi.advanceTimersByTime(600));
		expect(container.querySelector('[role="status"]')?.textContent).toBe("Copied to clipboard");
		await act(async () => vi.advanceTimersByTime(1000));
		expect(container.querySelector('[role="status"]')?.textContent).toBe("");
	} finally {
		await act(async () => root.unmount());
		container.remove();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	}
});

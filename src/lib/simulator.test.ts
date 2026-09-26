// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import Simulator from "../components/Simulator";
import { ceilToCent, payableThresholds, setRates, solve } from "./pricing";
import { GAS_ALLOWANCE } from "./fees";
import { fmtDurationPrecise } from "./format";
import type { OracleRates } from "./oracle";

const rates: OracleRates = {
	oracle: "0x0000000000000000000000000000000000000001",
	denom: 100000000n,
	baseRates: [0n, 0n, 20294267n, 5073567n, 253679n],
	points: [
		{ duration: 63072000n, numer: 87500000n },
		{ duration: 94608000n, numer: 68750000n },
		{ duration: 189216000n, numer: 56250000n },
	],
	tokenNumer: 1n,
	tokenDenom: 1000000n,
	readAt: 1,
};

test("a pricing refresh updates the mounted simulator without resetting its budget", async () => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.spyOn(window, "scrollTo").mockImplementation(() => {});
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);

	try {
		setRates(rates);
		const budget = ceilToCent(payableThresholds(5)[2].exact + GAS_ALLOWANCE);
		const render = () => root.render(createElement(Simulator, { priced: true, problem: null, onRetry: () => {} }));
		await act(async () => render());
		const amount = container.querySelector('[title="Click to type an amount"]')!;
		const originalAmount = amount.textContent;
		const originalTime = fmtDurationPrecise(solve(budget - GAS_ALLOWANCE, 5).seconds);
		expect(container.textContent).toContain(originalTime);
		setRates({ ...rates, baseRates: rates.baseRates.map(rate => rate * 2n), readAt: 2 });
		const newTime = fmtDurationPrecise(solve(budget - GAS_ALLOWANCE, 5).seconds);
		expect(newTime).not.toBe(originalTime);
		await act(async () => render());
		expect(container.textContent).toContain(newTime);
		expect(container.querySelector('[title="Click to type an amount"]')).toBe(amount);
		expect(amount.textContent).toBe(originalAmount);
	} finally {
		await act(async () => root.unmount());
		container.remove();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	}
});

// Native pointer/keyboard movement is verified in a browser. This regression
// protects React's live update contract: dragging must not remount its result.
test("moving the amount range keeps renewal output mounted and exposes USDC values", async () => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.spyOn(window, "scrollTo").mockImplementation(() => {});
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	try {
		setRates(rates);
		await act(async () => root.render(createElement(Simulator, { priced: true, problem: null, onRetry: () => {} })));
		const slider = container.querySelector<HTMLInputElement>('input[type="range"]')!;
		const outputLabel = [...container.querySelectorAll("div")].find(el => el.textContent?.trim() === "Renewal time bought")!;
		const output = outputLabel.nextElementSibling;
		const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
		await act(async () => {
			setValue.call(slider, "0");
			slider.dispatchEvent(new Event("input", { bubbles: true }));
		});
		expect(slider.getAttribute("aria-valuetext")).toBe("$0 USDC");
		expect(outputLabel.nextElementSibling).toBe(output);
		await act(async () => {
			setValue.call(slider, "0.35");
			slider.dispatchEvent(new Event("input", { bubbles: true }));
		});
		expect(outputLabel.nextElementSibling).toBe(output);
		expect(slider.getAttribute("aria-valuetext")).toMatch(/^\$[\d,.]+ USDC$/);
		expect(slider.getAttribute("aria-valuetext")).not.toBe("$0 USDC");
		expect(container.querySelector('button[aria-pressed="true"]')?.textContent).toContain("5+ characters");
	} finally {
		await act(async () => root.unmount());
		container.remove();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	}
});

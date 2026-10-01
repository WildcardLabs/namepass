// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "./App";
import { loadOracleRates, type OracleRates } from "./lib/oracle";
import { assertGasAllowance } from "./lib/fees";
import { setRates } from "./lib/pricing";

vi.mock("./lib/oracle", () => ({ loadOracleRates: vi.fn() }));
vi.mock("./lib/fees", () => ({ assertGasAllowance: vi.fn() }));
vi.mock("./lib/pricing", () => ({ setRates: vi.fn() }));
vi.mock("./components/Navbar", () => ({ default: () => null }));
vi.mock("./components/PageShell", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("./components/Hero", () => ({ default: () => null }));
vi.mock("./components/Protocol", () => ({ default: () => null }));
vi.mock("./components/CtaBand", () => ({ default: () => null }));
vi.mock("./components/Simulator", () => ({
	default: ({ priced, problem, onRetry }: { priced: boolean; problem: string | null; onRetry: () => void }) => (
		<section id="simulator" data-priced={priced}>
			{problem && <><p role="alert">{problem}</p><button onClick={onRetry}>Retry pricing</button></>}
		</section>
	),
}));
vi.mock("./components/Explorer", () => ({
	default: ({ selected, onSelect }: { selected: string | null; onSelect: (name: string | null) => void }) => (
		<section id="explorer">
			<input aria-label="Search names" defaultValue="" />
			{selected
				? <><h2>{selected}</h2><button onClick={() => onSelect(null)}>All activity</button></>
				: <button onClick={() => onSelect("example.eth")}>example.eth</button>}
		</section>
	),
}));
vi.mock("./components/Leaderboard", () => ({ default: () => null }));
vi.mock("./components/Terms", () => ({ default: () => null }));
vi.mock("./components/Privacy", () => ({ default: () => null }));
vi.mock("./components/SupportedTokens", () => ({ default: () => null }));
vi.mock("./components/TestnetBanner", () => ({ default: () => null, VIEWPORT_BELOW_BANNER: "" }));
vi.mock("./components/Footer", () => ({ default: () => null }));

const rates: OracleRates = {
	oracle: "0x0000000000000000000000000000000000000001",
	denom: 100n,
	baseRates: [1n, 1n, 1n, 1n, 1n],
	points: [],
	tokenNumer: 1n,
	tokenDenom: 1n,
	readAt: 1,
};

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	vi.resetAllMocks();
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubEnv("VITE_NAMEPASS_MAINTENANCE", "0");
	vi.mocked(loadOracleRates).mockResolvedValue(rates);
	vi.mocked(assertGasAllowance).mockResolvedValue(undefined);
	window.history.replaceState({}, "", "/");
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

async function render() {
	await act(async () => root.render(<App />));
}

async function click(text: string) {
	const button = [...container.querySelectorAll("button")].find((item) => item.textContent === text);
	expect(button, `Button: ${text}`).toBeDefined();
	await act(async () => button!.click());
}

function nextPopState() {
	return new Promise<PopStateEvent>((resolve) => {
		window.addEventListener("popstate", resolve, { once: true });
	});
}

test("Explorer stays available while pricing waits for oracle and allowance validation", async () => {
	const allowance = deferred<void>();
	vi.mocked(assertGasAllowance).mockReturnValueOnce(allowance.promise);
	await render();
	const explorer = container.querySelector("#explorer");
	expect(explorer).not.toBeNull();
	expect(setRates).not.toHaveBeenCalled();
	await act(async () => allowance.resolve());
	expect(container.querySelector("#explorer")).toBe(explorer);
	expect(setRates).toHaveBeenCalledWith(rates);
});

test("opening a name keeps the Explorer mounted while pricing refreshes", async () => {
	await render();
	const explorer = container.querySelector("#explorer");
	const refresh = deferred<OracleRates>();
	vi.mocked(loadOracleRates).mockReturnValueOnce(refresh.promise);
	await click("example.eth");
	expect(loadOracleRates).toHaveBeenCalledTimes(2);
	expect(container.querySelector("#explorer")).toBe(explorer);
	expect(explorer?.querySelector("h2")?.textContent).toBe("example.eth");
	await act(async () => refresh.resolve({ ...rates, readAt: 2 }));
	expect(container.querySelector("#explorer")).toBe(explorer);
	expect(setRates).toHaveBeenLastCalledWith({ ...rates, readAt: 2 });
});

test("returning to activity keeps the Explorer mounted while pricing refreshes", async () => {
	await render();
	await click("example.eth");
	const explorer = container.querySelector("#explorer");
	const refresh = deferred<OracleRates>();
	vi.mocked(loadOracleRates).mockReturnValueOnce(refresh.promise);
	const popstate = nextPopState();
	await click("All activity");
	await act(async () => { await popstate; });
	expect(container.querySelector("#explorer")).toBe(explorer);
	expect(explorer?.querySelector("button")?.textContent).toBe("example.eth");
});

test("browser back from a name returns to Explorer before leaving the site", async () => {
	await render();
	await click("example.eth");
	expect(window.history.state).toMatchObject({ __namepassName: "example.eth" });
	const explorer = container.querySelector("#explorer");
	const popstate = nextPopState();
	await act(async () => {
		window.history.back();
		await popstate;
	});
	expect(window.location.pathname).toBe("/");
	expect(explorer?.querySelector("h2")).toBeNull();
	expect(window.history.state).not.toHaveProperty("__namepassName");
});

test("tab focus preserves the selected name and the Explorer input", async () => {
	await render();
	await click("example.eth");
	const explorer = container.querySelector("#explorer");
	const input = explorer!.querySelector("input")!;
	input.value = "another.eth";
	const refresh = deferred<OracleRates>();
	vi.mocked(loadOracleRates).mockReturnValueOnce(refresh.promise);
	await act(async () => window.dispatchEvent(new Event("focus")));
	expect(container.querySelector("#explorer")).toBe(explorer);
	expect(container.querySelector("#simulator")?.getAttribute("data-priced")).toBe("true");
	await act(async () => refresh.resolve(rates));
	expect(container.querySelector("#explorer input")).toBe(input);
	expect(input.value).toBe("another.eth");
	expect(explorer?.querySelector("h2")?.textContent).toBe("example.eth");
});

test("a failed configuration refresh disables pricing and a retry validates it again", async () => {
	await render();
	vi.mocked(assertGasAllowance).mockRejectedValueOnce(new Error("The allowance changed."));
	await act(async () => window.dispatchEvent(new Event("focus")));
	expect(container.querySelector("#simulator")?.getAttribute("data-priced")).toBe("false");
	expect(container.querySelector('[role="alert"]')?.textContent).toBe("The allowance changed.");
	expect(setRates).toHaveBeenCalledTimes(1);
	const retry = deferred<OracleRates>();
	vi.mocked(loadOracleRates).mockReturnValueOnce(retry.promise);
	const explorer = container.querySelector("#explorer");
	await click("Retry pricing");
	expect(container.querySelector("#explorer")).toBe(explorer);
	await act(async () => retry.resolve(rates));
	expect(container.querySelector("#explorer")).toBe(explorer);
	expect(setRates).toHaveBeenCalledTimes(2);
});

test("an older refresh cannot overwrite a newer validated result", async () => {
	await render();
	const earlier = deferred<OracleRates>();
	const latest = deferred<OracleRates>();
	vi.mocked(loadOracleRates).mockReturnValueOnce(earlier.promise).mockReturnValueOnce(latest.promise);
	await click("example.eth");
	await act(async () => window.dispatchEvent(new Event("focus")));
	await act(async () => latest.resolve({ ...rates, readAt: 3 }));
	await act(async () => earlier.reject(new Error("Old request failed.")));
	expect(container.querySelector("#explorer h2")?.textContent).toBe("example.eth");
	expect(container.querySelector('[role="alert"]')).toBeNull();
	expect(setRates).toHaveBeenLastCalledWith({ ...rates, readAt: 3 });
});

test("documentation opens directly and supports navigation without price or chain reads", async () => {
  window.history.replaceState({}, "", "/docs");
  const network = vi.fn();
  vi.stubGlobal("fetch", network);
  vi.stubGlobal("scrollTo", vi.fn());
  await render();
  await act(async () => { await import("./components/Docs"); });
  await vi.waitFor(() => expect(container.querySelector("#three-steps")).not.toBeNull());
  expect(container.querySelector('.docs-example code')?.textContent).toContain("https://beta.namepass.com/api/v1/address");
  const copiedRequest = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copiedRequest } });
  await click("Copy request");
  expect(copiedRequest).toHaveBeenLastCalledWith(expect.stringContaining("https://beta.namepass.com/api/v1/address"));
  await click("Copy page");
  expect(copiedRequest).toHaveBeenLastCalledWith(expect.stringContaining("# Introduction"));
  const settlement = container.querySelector<HTMLAnchorElement>('a[href="/docs/status"]');
  expect(settlement).not.toBeNull();
  await act(async () => settlement!.click());
  expect(window.location.pathname).toBe("/docs/status");
  expect(container.querySelector("h1")?.textContent).toBe("Poll status");
  expect(container.querySelector("table")?.textContent).toContain("processing");
  const popstate = nextPopState();
  await act(async () => { window.history.back(); await popstate; });
  expect(container.querySelector("#three-steps")).not.toBeNull();
  const quickstart = container.querySelector<HTMLAnchorElement>('a[href="/docs/quickstart"]');
  await act(async () => quickstart!.click());
  expect(container.querySelector('.docs-prose pre')?.textContent).toContain("https://beta.namepass.com/api/v1/address");
  expect(container.querySelector('.docs-prose')?.textContent).not.toContain(window.location.origin);
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(loadOracleRates).not.toHaveBeenCalled();
  expect(assertGasAllowance).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
  const home = container.querySelector<HTMLAnchorElement>('.docs-brand');
  await act(async () => home!.click());
  expect(window.location.pathname).toBe("/");
  expect(container.querySelector("#explorer")).not.toBeNull();
  expect(container.querySelector(".docs-shell")).toBeNull();
});

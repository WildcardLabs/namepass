import { Skeleton } from "./components/ui/skeleton";
import { lazy, Suspense, useCallback, useRef, useEffect, useState } from "react";
import Navbar from "./components/Navbar";
import PageShell from "./components/PageShell";
import Hero from "./components/Hero";
import Protocol from "./components/Protocol";
import CtaBand from "./components/CtaBand";
import Simulator from "./components/Simulator";
import Explorer from "./components/Explorer";
import Leaderboard from "./components/Leaderboard";
import Terms from "./components/Terms";
import Privacy from "./components/Privacy";
import SupportedTokens from "./components/SupportedTokens";
import TestnetBanner, { VIEWPORT_BELOW_BANNER } from "./components/TestnetBanner";
import Footer from "./components/Footer";
import PricingError from "./components/PricingError";
import { loadOracleRates } from "./lib/oracle";
import { assertGasAllowance } from "./lib/fees";
import { setRates } from "./lib/pricing";

const Docs = lazy(() => import("./components/Docs"));
const Monitoring = lazy(() => import("./components/Monitoring"));
const VIDEO_URL = `${import.meta.env.BASE_URL}assets/namepass-bg.mp4`;

type Page = "docs" | "monitoring" | "home" | "leaderboard" | "supported" | "terms" | "privacy";

const BASE = import.meta.env.BASE_URL;
const NAME_HISTORY_KEY = "__namepassName";

function nameFromHistoryState(state: unknown): string | null {
	if (!state || typeof state !== "object" || Array.isArray(state)) return null;
	const name = (state as Record<string, unknown>)[NAME_HISTORY_KEY];
	return typeof name === "string" ? name : null;
}

function pathToPage(pathname: string): Page {
	const rel = pathname.startsWith(BASE)
		? pathname.slice(BASE.length)
		: pathname.replace(/^\//, "");
	if (rel.startsWith("docs")) return "docs";
	if (rel.startsWith("monitoring")) return "monitoring";
	if (rel.startsWith("leaderboard")) return "leaderboard";
	if (rel.startsWith("supported")) return "supported";
	if (rel.startsWith("terms")) return "terms";
	if (rel.startsWith("privacy")) return "privacy";
	return "home";
}

function pageToPath(page: Page): string {
	if (page === "home") return BASE;
	return `${BASE}${page}`.replace(/\/{2,}/g, "/");
}

export default function App() {
	if (import.meta.env.VITE_NAMEPASS_MAINTENANCE === "1") return <main style={{ padding: "4rem", fontFamily: "sans-serif" }}><h1>Namepass is being upgraded</h1><p>Deposits and renewals are temporarily paused. Please return shortly.</p></main>;
	return <ActiveApp/>;
}

function ActiveApp() {
	const [page, setPage] = useState<Page>(() => pathToPage(window.location.pathname));
	const [selected, setSelected] = useState<string | null>(null);

	/**
	 * ENS's live pricing, read at boot, on name selection, and on window focus.
	 *
	 * Everything that quotes a price is downstream of this. `pricing.ts`
	 * throws until the live values arrive.
	 *
	 * Only the parts that actually quote wait on it. The hero is copy over
	 * video and paints immediately; the Simulator renders its own chrome with
	 * skeletons where the numbers go. Nothing announces the read — it takes
	 * ~150ms and a page narrating its own network calls is noise. Only a
	 * failure gets words, because there's no cached price to fall back to.
	 */
	type Boot =
		| { status: "loading" }
		| { status: "ready" }
		| { status: "error"; message: string };

	const [boot, setBoot] = useState<Boot>({ status: "loading" });

	const pricingRequest = useRef(0);
	const loadPricing = useCallback(() => {
		const request = ++pricingRequest.current;
		/* Keep mounted views during a refresh. Only the initial read and a
		   retry after a failed validation need the loading state. */
		setBoot((current) => current.status === "ready" ? current : { status: "loading" });
		/* In parallel: ENS's rates, which the app can't price without, and a
		   check that the gateway's gas allowance is still the dime every quoted
		   send amount is built around. */
		Promise.all([loadOracleRates(), assertGasAllowance()])
			.then(([live]) => {
				if (request !== pricingRequest.current) return;
				setRates(live);
				setBoot({ status: "ready" });
			})
			.catch((err: unknown) => {
				if (request !== pricingRequest.current) return;
				setBoot({
					status: "error",
					message: err instanceof Error ? err.message : String(err),
				});
			});
	}, []);

	useEffect(() => { if (page !== "monitoring" && page !== "docs") loadPricing(); }, [loadPricing, selected, page]);
	useEffect(() => {
		const refresh = () => { if (document.visibilityState === "visible" && page !== "monitoring" && page !== "docs") loadPricing(); };
		window.addEventListener("focus", refresh);
		return () => { window.removeEventListener("focus", refresh); pricingRequest.current++; };
	}, [loadPricing, page]);

	useEffect(() => {
		if ("scrollRestoration" in window.history) {
			window.history.scrollRestoration = "manual";
		}
		const onPop = () => {
			setPage(pathToPage(window.location.pathname));
			setSelected(nameFromHistoryState(window.history.state));
		};
		window.addEventListener("popstate", onPop);
		return () => window.removeEventListener("popstate", onPop);
	}, []);

	const selectName = useCallback((name: string | null) => {
		const currentState = window.history.state;
		const currentName = nameFromHistoryState(currentState);
		if (name === null) {
			setSelected(null);
			if (currentName !== null) window.history.back();
			return;
		}

		if (currentName !== name) {
			const state = currentState && typeof currentState === "object" && !Array.isArray(currentState)
				? currentState as Record<string, unknown>
				: {};
			window.history.pushState({ ...state, [NAME_HISTORY_KEY]: name }, "", window.location.href);
		}
		setSelected(name);
	}, []);

	const navigate = useCallback((next: Page) => {
		setPage(next);
		window.history.pushState({}, "", pageToPath(next));
		window.scrollTo({ top: 0 });
	}, []);

	const scrollTo = useCallback((id: string) => {
		document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
	}, []);

	/** Navigate home (if needed) then scroll to a same-page section. */
	const goToSection = useCallback(
		(id: string) => {
			if (page !== "home") {
				setPage("home");
				window.history.pushState({}, "", pageToPath("home"));
				setTimeout(() => scrollTo(id), 80);
			} else {
				scrollTo(id);
			}
		},
		[page, scrollTo],
	);

	const goHome = useCallback(() => navigate("home"), [navigate]);
	const goProtocol = useCallback(() => goToSection("protocol"), [goToSection]);
	const goDocs = useCallback(() => navigate("docs"), [navigate]);
	const goSimulate = useCallback(() => goToSection("simulator"), [goToSection]);
	const goLeaderboard = useCallback(() => navigate("leaderboard"), [navigate]);
	const goSupported = useCallback(() => navigate("supported"), [navigate]);
	const goTerms = useCallback(() => navigate("terms"), [navigate]);
	const goPrivacy = useCallback(() => navigate("privacy"), [navigate]);

	const focusSearch = useCallback(() => {
		selectName(null);
		goToSection("explorer");
		setTimeout(() => {
			document.querySelector<HTMLInputElement>("#explorer input")?.focus();
		}, 600);
	}, [goToSection, selectName]);
	const goExplorer = focusSearch;

	/**
	 * Open a name's Explorer profile from anywhere. Used after activation (no
	 * success modal — land the user on the live profile) and from the
	 * Leaderboard, which shows an address but no history.
	 */
	const goToName = useCallback(
		(name: string) => {
			if (page !== "home") {
				setPage("home");
				window.history.pushState({}, "", pageToPath("home"));
			}
			selectName(name);
			setTimeout(() => scrollTo("explorer"), 260);
		},
		[page, scrollTo, selectName],
	);

	const navProps = {
		onProtocol: goProtocol,
		onSimulate: goSimulate,
		onSearch: focusSearch,
		onHome: goHome,
		onDocs: () => navigate("docs"),
	};

	if (page === "monitoring") {
		return (
			<Suspense fallback={<Skeleton role="status" aria-label="Loading dashboard" className="min-h-[100dvh] w-full animate-none rounded-none bg-[#f7f8fb]" />}>
				<Monitoring onBack={goHome} />
			</Suspense>
		);
	}

	return (
		<main className="public-ui min-h-screen bg-surface-canvas flex flex-col">
			<TestnetBanner />
			<div className="flex-1">
				{/* The hero is copy over video and quotes nothing, so it renders
				    immediately and the oracle read happens behind it. Only the
				    sections that price wait — they're below the fold at load, so the
				    wait is invisible. Holding Home back as a whole put a white card
				    where the hero belongs for ~220ms on every reload. */}
				{page === "docs" && <PageShell><Navbar {...navProps}/><Suspense fallback={<p className="p-12">Loading documentation…</p>}><Docs/></Suspense></PageShell>}
				{page === "home" && (
					<>
						<PageShell
							video={VIDEO_URL}
							outerClassName={VIEWPORT_BELOW_BANNER}
							cardClassName="h-full"
						>
							<Navbar {...navProps} />
							<Hero
								onExplore={goExplorer}
								onLeaderboard={goLeaderboard}
								priced={boot.status === "ready"}
							/>
						</PageShell>

						{/* What the protocol actually is — four real properties, in the
						    RIVR template's bento. Static copy, so it never waits on pricing. */}
						<Protocol />

						{/* Search and public activity remain available while price quotes load. */}
						<Explorer
							selected={selected}
							onSelect={selectName}
							onActivated={goToName}
							onSupportedTokens={goSupported}
						/>

						{/* Renders its own frame either way — heading, card, tabs — with
						    skeletons standing in for the two panels that quote a price.
						    So `#simulator` stays a valid scroll target and the section
						    doesn't change height when the numbers arrive. */}
						<Simulator
							priced={boot.status === "ready"}
							problem={boot.status === "error" ? boot.message : null}
							onRetry={loadPricing}
						/>

						<CtaBand onDocs={() => navigate("docs")} />
					</>
				)}

				{page === "leaderboard" && (
					<PageShell cardClassName="min-h-[70vh]">
						<Navbar {...navProps} showMenu={false} />
						{/* Every row here is priced, so there's no useful partial state —
						    the card just stays empty at its `min-h` until the read lands,
						    which for ~150ms reads as the page still painting rather than
						    as something missing. */}
						{boot.status === "ready" && (
							<Leaderboard
								onBack={goHome}
								onViewName={goToName}
							/>
						)}
						{boot.status === "error" && (
							<div className="w-full px-5 md:px-10 py-24 md:py-32">
								<PricingError message={boot.message} onRetry={loadPricing} />
							</div>
						)}
					</PageShell>
				)}

				{page === "supported" && (
					<PageShell cardClassName="min-h-[70vh]">
						<Navbar {...navProps} showMenu={false} />
						<SupportedTokens onBack={goHome} />
					</PageShell>
				)}

				{page === "terms" && (
					<PageShell cardClassName="min-h-[70vh]">
						<Navbar {...navProps} showMenu={false} />
						<Terms onBack={goHome} />
					</PageShell>
				)}

				{page === "privacy" && (
					<PageShell cardClassName="min-h-[70vh]">
						<Navbar {...navProps} showMenu={false} />
						<Privacy onBack={goHome} />
					</PageShell>
				)}
			</div>

			<Footer
				onExplore={goExplorer}
				onSimulate={goSimulate}
				onSupported={goSupported}
				onDocs={goDocs}
				onTerms={goTerms}
				onPrivacy={goPrivacy}
			/>
		</main>
	);
}

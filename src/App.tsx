import { useCallback, useEffect, useState } from "react";
import Navbar from "./components/Navbar";
import PageShell from "./components/PageShell";
import Hero from "./components/Hero";
import Simulator from "./components/Simulator";
import Explorer from "./components/Explorer";
import Leaderboard from "./components/Leaderboard";
import Terms from "./components/Terms";
import Privacy from "./components/Privacy";
import SupportedTokens from "./components/SupportedTokens";
import TestnetBanner, { VIEWPORT_BELOW_BANNER } from "./components/TestnetBanner";
import Footer from "./components/Footer";
import ClaimModal from "./components/ClaimModal";
import PricingError from "./components/PricingError";
import { loadOracleRates } from "./lib/oracle";
import { assertGasAllowance } from "./lib/fees";
import { setRates } from "./lib/pricing";

const VIDEO_URL = `${import.meta.env.BASE_URL}assets/namepass-bg.mp4`;

type Page = "home" | "leaderboard" | "supported" | "terms" | "privacy";

const BASE = import.meta.env.BASE_URL;

function pathToPage(pathname: string): Page {
	const rel = pathname.startsWith(BASE)
		? pathname.slice(BASE.length)
		: pathname.replace(/^\//, "");
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
	const [page, setPage] = useState<Page>(() => pathToPage(window.location.pathname));
	const [claimOpen, setClaimOpen] = useState(false);
	const [selected, setSelected] = useState<string | null>(null);

	/**
	 * ENS's live pricing, read once at boot.
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

	const loadPricing = useCallback(() => {
		setBoot({ status: "loading" });
		/* In parallel: ENS's rates, which the app can't price without, and a
		   check that the helper's gas allowance is still the dime every quoted
		   send amount is built around. */
		Promise.all([loadOracleRates(), assertGasAllowance()])
			.then(([live]) => {
				setRates(live);
				setBoot({ status: "ready" });
			})
			.catch((err: unknown) => {
				setBoot({
					status: "error",
					message: err instanceof Error ? err.message : String(err),
				});
			});
	}, []);

	useEffect(loadPricing, [loadPricing]);

	useEffect(() => {
		if ("scrollRestoration" in window.history) {
			window.history.scrollRestoration = "manual";
		}
		const onPop = () => setPage(pathToPage(window.location.pathname));
		window.addEventListener("popstate", onPop);
		return () => window.removeEventListener("popstate", onPop);
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
	const goExplorer = useCallback(() => goToSection("explorer"), [goToSection]);
	const goSimulate = useCallback(() => goToSection("simulator"), [goToSection]);
	const goLeaderboard = useCallback(() => navigate("leaderboard"), [navigate]);
	const goSupported = useCallback(() => navigate("supported"), [navigate]);
	const goTerms = useCallback(() => navigate("terms"), [navigate]);
	const goPrivacy = useCallback(() => navigate("privacy"), [navigate]);

	const focusSearch = useCallback(() => {
		setSelected(null);
		goToSection("explorer");
		setTimeout(() => {
			document.querySelector<HTMLInputElement>("#explorer input")?.focus();
		}, 600);
	}, [goToSection]);

	/**
	 * Open a name's Explorer profile from anywhere. Used after activation (no
	 * success modal — land the user on the live profile) and from the
	 * Leaderboard, which shows an address but no history.
	 */
	const goToName = useCallback(
		(name: string) => {
			setSelected(name);
			if (page !== "home") {
				setPage("home");
				window.history.pushState({}, "", pageToPath("home"));
			}
			setTimeout(() => scrollTo("explorer"), 260);
		},
		[page, scrollTo],
	);

	const navProps = {
		onClaim: () => setClaimOpen(true),
		onExplore: goExplorer,
		onSimulate: goSimulate,
		onSearch: focusSearch,
		onHome: goHome,
	};

	return (
		<main className="min-h-screen bg-[#f0f0f0] flex flex-col">
			<TestnetBanner />
			<div className="flex-1">
				{/* The hero is copy over video and quotes nothing, so it renders
				    immediately and the oracle read happens behind it. Only the
				    sections that price wait — they're below the fold at load, so the
				    wait is invisible. Holding Home back as a whole put a white card
				    where the hero belongs for ~220ms on every reload. */}
				{page === "home" && (
					<>
						<PageShell
							video={VIDEO_URL}
							outerClassName={VIEWPORT_BELOW_BANNER}
							cardClassName="h-full"
						>
							<Navbar {...navProps} />
							<Hero
								onExplore={() => scrollTo("explorer")}
								onLeaderboard={goLeaderboard}
								priced={boot.status === "ready"}
							/>
						</PageShell>

						{/* Renders its own frame either way — heading, card, tabs — with
						    skeletons standing in for the two panels that quote a price.
						    So `#simulator` stays a valid scroll target and the section
						    doesn't change height when the numbers arrive. */}
						<Simulator
							priced={boot.status === "ready"}
							problem={boot.status === "error" ? boot.message : null}
							onRetry={loadPricing}
						/>

						{/* Explorer owns its public API loading state. */}
						{boot.status === "ready" && (
							<Explorer
								selected={selected}
								onSelect={setSelected}
								onActivated={goToName}
								onSupportedTokens={goSupported}
							/>
						)}
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
				onLeaderboard={goLeaderboard}
				onSupported={goSupported}
				onTerms={goTerms}
				onPrivacy={goPrivacy}
			/>

			<ClaimModal
				open={claimOpen}
				onClose={() => setClaimOpen(false)}
				onActivated={goToName}
			/>
		</main>
	);
}

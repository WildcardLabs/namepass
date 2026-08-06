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

const VIDEO_URL = `${import.meta.env.BASE_URL}assets/cinematic2.mp4`;

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
				{page === "home" && (
					<>
						<PageShell
							video={VIDEO_URL}
							outerClassName={VIEWPORT_BELOW_BANNER}
							cardClassName="h-full"
						>
							<Navbar {...navProps} />
							<Hero onExplore={() => scrollTo("explorer")} onLeaderboard={goLeaderboard} />
						</PageShell>
						<Simulator />
						<Explorer
							selected={selected}
							onSelect={setSelected}
							onActivated={goToName}
							onSupportedTokens={goSupported}
						/>
					</>
				)}

				{page === "leaderboard" && (
					<PageShell cardClassName="min-h-[70vh]">
						<Navbar {...navProps} showMenu={false} />
						<Leaderboard
							onBack={goHome}
							onViewName={goToName}
							onSupportedTokens={goSupported}
						/>
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

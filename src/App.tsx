import { useCallback, useState } from "react";
import Hero from "./components/Hero";
import Simulator from "./components/Simulator";
import Explorer from "./components/Explorer";
import ClaimModal from "./components/ClaimModal";

export default function App() {
	const [claimOpen, setClaimOpen] = useState(false);
	const [claimPrefill, setClaimPrefill] = useState<string>("");
	const [selected, setSelected] = useState<string | null>(null);

	const scrollTo = useCallback((id: string) => {
		document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
	}, []);

	const focusSearch = useCallback(() => {
		setSelected(null);
		scrollTo("explorer");
		setTimeout(() => {
			document
				.querySelector<HTMLInputElement>("#explorer input")
				?.focus();
		}, 600);
	}, [scrollTo]);

	const openClaim = useCallback((prefill = "") => {
		setClaimPrefill(prefill);
		setClaimOpen(true);
	}, []);

	/* After activation: no success modal — land the user on the live profile. */
	const handleActivated = useCallback(
		(name: string) => {
			setSelected(name);
			setTimeout(() => scrollTo("explorer"), 260);
		},
		[scrollTo],
	);

	return (
		<main className="min-h-screen bg-[#f0f0f0]">
			<Hero
				onClaim={() => openClaim()}
				onExplore={() => scrollTo("explorer")}
				onSimulate={() => scrollTo("simulator")}
				onSearch={focusSearch}
			/>
			<Simulator />
			<Explorer
				selected={selected}
				onSelect={setSelected}
				onActivate={(name) => openClaim(name)}
			/>
			<ClaimModal
				open={claimOpen}
				onClose={() => setClaimOpen(false)}
				onActivated={handleActivated}
				initialName={claimPrefill}
			/>
		</main>
	);
}

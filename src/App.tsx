import { useCallback, useState } from "react";
import Hero from "./components/Hero";
import Explorer from "./components/Explorer";
import ClaimModal from "./components/ClaimModal";

export default function App() {
	const [claimOpen, setClaimOpen] = useState(false);
	const [selected, setSelected] = useState<string | null>(null);

	const scrollToExplorer = useCallback(() => {
		document.getElementById("explorer")?.scrollIntoView({ behavior: "smooth" });
	}, []);

	const viewName = useCallback(
		(name: string) => {
			setSelected(name);
			/* Wait for the modal exit before scrolling. */
			setTimeout(scrollToExplorer, 320);
		},
		[scrollToExplorer],
	);

	return (
		<main className="min-h-screen bg-[#f0f0f0]">
			<Hero onClaim={() => setClaimOpen(true)} onExplore={scrollToExplorer} />
			<Explorer selected={selected} onSelect={setSelected} />
			<ClaimModal
				open={claimOpen}
				onClose={() => setClaimOpen(false)}
				onView={viewName}
			/>
		</main>
	);
}

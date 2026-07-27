import { XIcon } from "./icons";

interface Props {
	onExplore: () => void;
	onSimulate: () => void;
	onLeaderboard: () => void;
	onTerms: () => void;
	onPrivacy: () => void;
}

export default function Footer({ onExplore, onSimulate, onLeaderboard, onTerms, onPrivacy }: Props) {
	const product = [
		{ label: "Explorer", action: onExplore },
		{ label: "Cost simulator", action: onSimulate },
		{ label: "Leaderboard", action: onLeaderboard },
	];
	const legal = [
		{ label: "Terms of service", action: onTerms },
		{ label: "Privacy policy", action: onPrivacy },
	];

	return (
		<footer className="bg-white border-t border-[rgba(30,50,90,0.08)] px-5 md:px-10 py-14 md:py-16">
			<div className="max-w-[1100px] mx-auto">
				<div className="flex flex-col md:flex-row md:justify-between gap-10 md:gap-6">
					<div className="max-w-xs">
						<img
							src={`${import.meta.env.BASE_URL}logo.svg`}
							alt="Namepass"
							className="h-6 w-auto"
						/>
						<p className="mt-3 text-[13px] text-[rgba(30,50,90,0.55)] leading-relaxed">
							Renewal addresses for ENS names. Every payment received extends the
							registration, automatically.
						</p>
						<a
							href="https://x.com/namepass_com"
							target="_blank"
							rel="noopener noreferrer"
							aria-label="Namepass on X"
							className="mt-5 inline-flex items-center justify-center w-9 h-9 rounded-full border border-[rgba(30,50,90,0.12)] text-[rgba(30,50,90,0.7)] hover:text-[rgba(30,50,90,0.95)] hover:border-[rgba(30,50,90,0.3)] transition-colors"
						>
							<XIcon className="w-4 h-4" />
						</a>
					</div>

					<div className="grid grid-cols-2 gap-10 sm:gap-16">
						<div>
							<div className="text-[10px] uppercase tracking-wider text-[rgba(30,50,90,0.45)]">
								Product
							</div>
							<ul className="mt-3 space-y-2.5">
								{product.map((l) => (
									<li key={l.label}>
										<button
											onClick={l.action}
											className="text-[13.5px] text-[rgba(30,50,90,0.65)] hover:text-[rgba(30,50,90,0.95)] transition-colors"
										>
											{l.label}
										</button>
									</li>
								))}
							</ul>
						</div>

						<div>
							<div className="text-[10px] uppercase tracking-wider text-[rgba(30,50,90,0.45)]">
								Legal
							</div>
							<ul className="mt-3 space-y-2.5">
								{legal.map((l) => (
									<li key={l.label}>
										<button
											onClick={l.action}
											className="text-[13.5px] text-[rgba(30,50,90,0.65)] hover:text-[rgba(30,50,90,0.95)] transition-colors"
										>
											{l.label}
										</button>
									</li>
								))}
							</ul>
						</div>
					</div>
				</div>

				<div className="mt-12 pt-6 border-t border-[rgba(30,50,90,0.08)] flex flex-col-reverse sm:flex-row items-center justify-between gap-4">
					<span className="text-[12px] text-[rgba(30,50,90,0.45)]">
						© {new Date().getFullYear()} Namepass. All rights reserved.
					</span>
					<span className="text-[12px] text-[rgba(30,50,90,0.4)]">
						Built on ENS · Facilitated by CDP Agentic Wallets
					</span>
				</div>
			</div>
		</footer>
	);
}

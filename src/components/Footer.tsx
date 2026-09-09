import { XIcon } from "./icons";

interface Props {
	onExplore: () => void;
	onSimulate: () => void;
	onLeaderboard: () => void;
	onSupported: () => void;
	onTerms: () => void;
	onPrivacy: () => void;
}

export default function Footer({
	onExplore,
	onSimulate,
	onLeaderboard,
	onSupported,
	onTerms,
	onPrivacy,
}: Props) {
	const product = [
		{ label: "Explorer", action: onExplore },
		{ label: "ENS v2 pricing", action: onSimulate },
		{ label: "Leaderboard", action: onLeaderboard },
		{ label: "Supported networks & USDC", action: onSupported },
	];
	const legal = [
		{ label: "Terms of service", action: onTerms },
		{ label: "Privacy policy", action: onPrivacy },
	];

	return (
		<footer className="bg-[#f0f0f0] border-t border-[rgba(28,58,41,0.08)] px-5 md:px-10 py-14 md:py-16">
			<div className="max-w-[1100px] mx-auto">
				<div className="flex flex-col md:flex-row md:justify-between gap-10 md:gap-6">
					<div className="max-w-xs">
						<img
							src={`${import.meta.env.BASE_URL}namepass-logo.png`}
							alt="Namepass"
							className="h-4 w-auto"
						/>
						<p className="mt-3 text-[13px] text-[rgba(28,58,41,0.55)] leading-relaxed">
							Send USDC to a Namepass address. Namepass monitors the
							payment, triggers the flow, and keeps the activity public.
						</p>
						<a
							href="https://x.com/namepass_com"
							target="_blank"
							rel="noopener noreferrer"
							aria-label="Namepass on X"
							className="mt-5 inline-flex items-center justify-center w-9 h-9 rounded-[10px] border border-[rgba(28,58,41,0.12)] text-[rgba(28,58,41,0.7)] hover:text-[rgba(28,58,41,0.95)] hover:border-[rgba(28,58,41,0.3)] transition-colors"
						>
							<XIcon className="w-4 h-4" />
						</a>
					</div>

					<div className="grid grid-cols-2 gap-10 sm:gap-16">
						<div>
							<div className="text-[10px] uppercase tracking-wider text-[rgba(28,58,41,0.45)]">
								Product
							</div>
							<ul className="mt-3 space-y-2.5">
								{product.map((l) => (
									<li key={l.label}>
										<button
											onClick={l.action}
											className="text-[13.5px] text-[rgba(28,58,41,0.65)] hover:text-[rgba(28,58,41,0.95)] transition-colors"
										>
											{l.label}
										</button>
									</li>
								))}
							</ul>
						</div>

						<div>
							<div className="text-[10px] uppercase tracking-wider text-[rgba(28,58,41,0.45)]">
								Legal
							</div>
							<ul className="mt-3 space-y-2.5">
								{legal.map((l) => (
									<li key={l.label}>
										<button
											onClick={l.action}
											className="text-[13.5px] text-[rgba(28,58,41,0.65)] hover:text-[rgba(28,58,41,0.95)] transition-colors"
										>
											{l.label}
										</button>
									</li>
								))}
							</ul>
						</div>
					</div>
				</div>

				<div className="mt-12 pt-6 border-t border-[rgba(28,58,41,0.08)] flex flex-col-reverse sm:flex-row items-center justify-between gap-4">
					<span className="text-[12px] text-[rgba(28,58,41,0.45)]">
						© {new Date().getFullYear()} Namepass. All rights reserved.
					</span>
					<span className="text-[12px] text-[rgba(28,58,41,0.4)]">
						Built on ENS · Transfers via Circle CCTP
					</span>
				</div>
			</div>
		</footer>
	);
}

import { Github } from "lucide-react";
import { XIcon } from "./icons";

interface Props {
	onExplore: () => void;
	onSimulate: () => void;
	onSupported: () => void;
	onDocs: () => void;
	onTerms: () => void;
	onPrivacy: () => void;
}

export default function Footer({
	onExplore,
	onSimulate,
	onSupported,
	onDocs,
	onTerms,
	onPrivacy,
}: Props) {
	const product = [
		{ label: "Explorer", action: onExplore },
		{ label: "Rates", action: onSimulate },
		{ label: "Supported networks", action: onSupported },
		{ label: "Docs", action: onDocs },
	];
	const legal = [
		{ label: "Terms of service", action: onTerms },
		{ label: "Privacy policy", action: onPrivacy },
	];

	return (
		<footer className="bg-surface-canvas border-t border-[rgba(28,58,41,0.08)] px-5 md:px-10 py-14 md:py-16">
			<div className="max-w-[1100px] mx-auto">
				<div className="flex flex-col md:flex-row md:justify-between gap-10 md:gap-6">
					<div className="max-w-xs">
						<img
							src={`${import.meta.env.BASE_URL}namepass-logo.png`}
							alt="Namepass"
							className="h-4 w-auto"
						/>
						<p className="mt-3 text-[13px] text-ink-secondary leading-relaxed">
							Keep your name alive. ENS renewals via universal USDC deposit addresses.
						</p>
						<div className="mt-5 flex items-center gap-2">
							<a
								href="https://x.com/namepass_eth"
								target="_blank"
								rel="noopener noreferrer"
								aria-label="Namepass on X"
								className="inline-flex items-center justify-center w-9 h-9 rounded-[10px] bg-white text-ink-action shadow-[0_2px_8px_rgba(28,58,41,0.06)] hover:text-ink-primary transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(28,58,41,0.6)]"
							>
								<XIcon className="w-4 h-4" />
							</a>
							<a
								href="https://github.com/WildcardLabs/namepass"
								target="_blank"
								rel="noopener noreferrer"
								aria-label="Namepass on GitHub"
								className="inline-flex items-center justify-center w-9 h-9 rounded-[10px] bg-white text-ink-action shadow-[0_2px_8px_rgba(28,58,41,0.06)] hover:text-ink-primary transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(28,58,41,0.6)]"
							>
								<Github aria-hidden="true" className="w-4 h-4" />
							</a>
						</div>
					</div>

					<div className="grid grid-cols-2 gap-10 sm:gap-16">
						<div>
							<div className="text-[10px] uppercase tracking-wider text-ink-label">
								Product
							</div>
							<ul className="mt-3 space-y-2.5">
								{product.map((l) => (
									<li key={l.label}>
										<button
											onClick={l.action}
											className="text-[13.5px] text-ink-action hover:text-ink-primary transition-colors"
										>
											{l.label}
										</button>
									</li>
								))}
							</ul>
						</div>

						<div>
							<div className="text-[10px] uppercase tracking-wider text-ink-label">
								Legal
							</div>
							<ul className="mt-3 space-y-2.5">
								{legal.map((l) => (
									<li key={l.label}>
										<button
											onClick={l.action}
											className="text-[13.5px] text-ink-action hover:text-ink-primary transition-colors"
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
					<span className="text-[12px] text-ink-secondary">
						© {new Date().getFullYear()} Namepass. All rights reserved.
					</span>
					<span className="text-[12px] text-ink-secondary">
						Built on ENS · Transfers via Circle CCTP
					</span>
				</div>
			</div>
		</footer>
	);
}

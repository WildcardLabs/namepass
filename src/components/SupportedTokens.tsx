import { useState } from "react";
import { ArrowLeft, Check, Copy, ExternalLink, FlaskConical, ShieldAlert } from "lucide-react";
import { SUPPORTED_TOKENS, IS_TESTNET } from "../lib/tokens";

/**
 * What a deposit address accepts, and the exact contract to check.
 *
 * Three deliberate calls:
 *
 * - Addresses render in full, never truncated, same as `PassCard` and for the
 *   same reason: the middle is where an address-swap attack lands.
 * - The page is a whitelist. Listing bridged `USDC.e` addresses as things to
 *   avoid inverts the check into "is this on the bad list", which fails open
 *   for every token nobody enumerated. Matching one of four fails closed.
 * - Chains are named in plain text rather than with `ChainTag`, the one place
 *   that component is deliberately not reused: its pulsing dot reads as a live
 *   signal and nothing here is live.
 *
 * Copy is short on purpose. This is a page people check something against,
 * not one they read.
 */
export default function SupportedTokens({ onBack }: { onBack: () => void }) {
	const [copied, setCopied] = useState<string | null>(null);

	function copy(address: string) {
		const done = () => {
			setCopied(address);
			setTimeout(() => setCopied(null), 1600);
		};
		if (navigator.clipboard) navigator.clipboard.writeText(address).then(done, done);
		else done();
	}

	return (
		<div className="w-full px-5 md:px-10 pt-4 pb-20 md:pb-28">
			<div className="max-w-[720px] mx-auto">
				<button
					onClick={onBack}
					className="flex items-center gap-2 text-[13px] text-[rgba(28,58,41,0.55)] hover:text-[rgba(28,58,41,0.9)] transition-colors"
				>
					<ArrowLeft className="w-4 h-4" />
					Back to Namepass
				</button>

				<h1 className="mt-8 text-[32px] md:text-[44px] font-normal text-[rgba(28,58,41,0.95)] tracking-tight leading-tight">
					Supported networks & USDC
				</h1>
				<p className="mt-6 text-[15px] text-[rgba(28,58,41,0.65)] leading-relaxed">
					Namepass currently accepts USDC on the four test networks below.
				</p>

				<div className="mt-8 space-y-3">
					{IS_TESTNET && (
						<div className="flex items-start gap-2.5 rounded-[1.4rem] border border-[rgba(28,58,41,0.14)] bg-[rgba(28,58,41,0.03)] px-5 py-4">
							<FlaskConical className="w-4 h-4 shrink-0 mt-0.5 text-[rgba(28,58,41,0.9)]" />
							<p className="text-[13.5px] text-[rgba(28,58,41,0.75)] leading-relaxed">
								Testnet only. This USDC has no real value.
							</p>
						</div>
					)}

					<div className="flex items-start gap-2.5 rounded-[1.4rem] border border-[rgba(28,58,41,0.14)] bg-[rgba(28,58,41,0.03)] px-5 py-4">
						<ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-[rgba(28,58,41,0.9)]" />
						<p className="text-[13.5px] text-[rgba(28,58,41,0.75)] leading-relaxed">
							Anything else sent to a deposit address cannot be recovered. There is no
							rescue function.
						</p>
					</div>
				</div>

				<h2 className="mt-12 flex items-center gap-2 text-[16px] text-[rgba(28,58,41,0.9)] tracking-tight">
					<img
						src={`${import.meta.env.BASE_URL}logos/usdc.svg`}
						alt=""
						aria-hidden="true"
						className="w-[18px] h-[18px]"
					/>
					USDC contracts
				</h2>
				<p className="mt-2 text-[14px] text-[rgba(28,58,41,0.6)] leading-relaxed">
					Match the address for your network exactly before sending. Some networks carry
					other tokens also labelled USDC.
				</p>

				<div className="mt-6 space-y-3">
					{SUPPORTED_TOKENS.map((t) => (
						<div
							key={t.chain}
							className="rounded-[1.4rem] border border-[rgba(28,58,41,0.1)] bg-white px-4 py-4"
						>
							<div className="flex items-center justify-between gap-3">
								<div className="flex items-center gap-2.5 min-w-0">
									<img
										src={`${import.meta.env.BASE_URL}logos/${t.logo}`}
										alt=""
										aria-hidden="true"
										className="w-5 h-5 shrink-0"
									/>
									<div className="min-w-0">
										<div className="text-[15px] text-[rgba(28,58,41,0.95)] tracking-tight">
											{t.chain}
										</div>
										<div className="text-[11.5px] text-[rgba(28,58,41,0.45)]">
											{t.network}
										</div>
									</div>
								</div>
								<a
									href={t.explorer}
									target="_blank"
									rel="noopener noreferrer"
									className="flex items-center gap-1.5 shrink-0 text-[12px] text-[rgba(28,58,41,0.5)] hover:text-[rgba(28,58,41,0.85)] transition-colors"
								>
									Verify
									<ExternalLink className="w-3.5 h-3.5" />
								</a>
							</div>

							{/* Full address, never truncated. The middle is what an
							    address-swap attack changes. */}
							<button
								onClick={() => copy(t.address)}
								className="mt-3 w-full text-left rounded-[1.1rem] border border-[rgba(28,58,41,0.1)] bg-[rgba(28,58,41,0.03)] hover:border-[rgba(28,58,41,0.25)] px-3.5 py-2.5 transition-colors group"
							>
								<div className="flex items-start justify-between gap-3">
									<span className="text-[12.5px] leading-snug text-[rgba(28,58,41,0.95)] font-mono break-all">
										{t.address}
									</span>
									{copied === t.address ? (
										<span className="flex items-center gap-1.5 shrink-0 text-[12px] text-[rgba(28,58,41,0.8)]">
											<Check className="w-3.5 h-3.5" />
											Copied
										</span>
									) : (
										<Copy className="w-4 h-4 shrink-0 text-[rgba(28,58,41,0.35)] group-hover:text-[rgba(28,58,41,0.75)] transition-colors" />
									)}
								</div>
							</button>

							{t.note && (
								<p className="mt-2.5 text-[12.5px] text-[rgba(28,58,41,0.55)] leading-relaxed">
									{t.note}
								</p>
							)}
						</div>
					))}
				</div>

				<h2 className="mt-10 text-[16px] text-[rgba(28,58,41,0.9)] tracking-tight">
					Balances do not combine
				</h2>
				<p className="mt-2 text-[14px] text-[rgba(28,58,41,0.6)] leading-relaxed">
					A name's deposit address is the same on all four networks, but USDC sent on
					each is a separate balance. Every one converts to renewal time on its own.
				</p>

				<p className="mt-12 text-[12px] text-[rgba(28,58,41,0.45)] leading-relaxed">
					Addresses verified 5 August 2026 against Circle's published list.
				</p>
			</div>
		</div>
	);
}

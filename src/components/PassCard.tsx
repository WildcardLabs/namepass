import { motion } from "motion/react";
import { useMemo } from "react";
import { ArrowUpRight, Check, Copy, Infinity as InfinityIcon } from "lucide-react";
import { normalizeLabel } from "../lib/namepass";
import { encodeQR } from "../lib/qr";
import { useCopyFeedback } from "../hooks/use-copy-feedback";
import { FUNDING_CHAINS } from "../lib/chains";

interface Props {
	/** ENS name being funded, e.g. "vitalik.eth" */
	name: string;
	/** Permanent deposit address. */
	address: string;
	/**
	 * Navigate to the supported-tokens page.
	 *
	 * Required rather than optional on purpose: this link is the mitigation for
	 * sending the wrong token to an address with no rescue path, so a new usage
	 * of `PassCard` should fail to compile rather than quietly ship without it.
	 */
	onSupportedTokens: () => void;
	/** Animate the QR in. Off for returning users so the card is instantly usable. */
	animate?: boolean;
	/** Visual weight — "glass" over video/blur, "solid" on white. */
	surface?: "glass" | "solid";
	/** "stack" keeps QR above details; "split" places them side by side on sm+. */
	layout?: "stack" | "split";
}

/* Staggered reveal: modules light up in a diagonal wave, finished in ~560ms.
   Deliberately one-shot — a QR that keeps moving is a QR nobody can scan. */
const WAVE_MS = 420;
const MODULE_MS = 140;

export default function PassCard({
	name,
	address,
	onSupportedTokens,
	animate = false,
	surface = "solid",
	layout = "stack",
}: Props) {
	const { copied, error, copy } = useCopyFeedback();
	const subdomain = `${normalizeLabel(name)}.namepass.eth`;

	const matrix = useMemo(() => {
		try {
			return encodeQR(address);
		} catch {
			return null;
		}
	}, [address]);

	const glass = surface === "glass";
	const cardBg = glass
		? "bg-white/45"
		: "bg-white shadow-[0_3px_10px_rgba(28,58,41,0.08)]";

	const size = matrix?.length ?? 0;
	/* Draw at unit scale in a 0..size viewBox — crisp at any rendered size. */

	const split = layout === "split";

	return (
		<div className={`site-pass-card rounded-[1.4rem] ${cardBg} p-5 md:p-6`}>
			<div className={split ? "sm:flex sm:items-start sm:gap-6" : ""}>
			<div className={split ? "sm:w-[200px] sm:shrink-0" : ""}>
			{/* QR */}
			<div className="flex justify-center">
				<div className="relative">
					<div
						className={`site-qr rounded-[1.4rem] p-4 ${glass ? "bg-white/80" : "bg-white"}`}
					>
						{matrix ? (
							<svg
								viewBox={`0 0 ${size} ${size}`}
								className="w-[152px] h-[152px] md:w-[168px] md:h-[168px] block"
								shapeRendering="crispEdges"
								role="img"
								aria-label={`QR code for ${address}`}
							>
								{!animate ? (
									<path fill="rgba(28,58,41,0.92)" d={matrix.flatMap((row, r) =>
										row.flatMap((on, c) => on ? [`M${c} ${r}h1v1h-1z`] : []),
									).join("")} />
								) : matrix.map((row, r) =>
									row.map((on, c) =>
										on ? (
											<motion.rect
												key={`${r}-${c}`}
												x={c}
												y={r}
												width={1}
												height={1}
												fill="rgba(28,58,41,0.92)"
												initial={
													animate ? { opacity: 0, scale: 0.4 } : false
												}
												animate={animate ? { opacity: 1, scale: 1 } : undefined}
												style={{ transformOrigin: `${c + 0.5}px ${r + 0.5}px` }}
												transition={
													animate
														? {
																duration: MODULE_MS / 1000,
																delay:
																	(((r + c) / (size * 2)) * WAVE_MS) / 1000,
																ease: [0.16, 1, 0.3, 1],
															}
														: undefined
												}
											/>
										) : null,
									),
								)}
							</svg>
						) : (
							<div className="w-[152px] h-[152px] md:w-[168px] md:h-[168px]" />
						)}
					</div>
				</div>
			</div>

			<p className="mt-3 text-center text-[12px] text-ink-secondary">
				Scan to send from any wallet
			</p>

			</div>

			<div className={split ? "sm:flex-1 sm:min-w-0" : ""}>
			<button
				onClick={() => void copy(subdomain)}
				className={`${split ? "mt-5 sm:mt-0" : "mt-5"} inset-panel inset-action w-full text-left group`}
				aria-label={`Copy ${subdomain}`}
			>
				<span className="block text-[10px] uppercase tracking-wider text-ink-label">Namepass</span>
				<span className="mt-1 flex items-center gap-3 text-ink-primary">
					<span className="min-w-0 flex-1 break-all text-[15px] leading-snug">{subdomain}</span>
					{copied === subdomain ? <Check aria-hidden="true" className="w-4 h-4 shrink-0" /> : <Copy className="w-4 h-4 shrink-0" />}
				</span>
			</button>
			<button
				onClick={() => void copy(address)}
				aria-label={`Copy deposit address ${address}`}
				className="mt-3 inset-panel inset-action w-full text-left group"
			>
				<div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-ink-label">
					<InfinityIcon className="w-3 h-3" />
					Deposit address · any supported chain
				</div>
				<div className="mt-1 flex items-center gap-3">
					<span className="min-w-0 flex-1 break-all text-[12.5px] leading-snug text-ink-primary font-mono">{address}</span>
					{copied === address ? (
						<span className="shrink-0 text-ink-action">
							<Check className="w-4 h-4" />
						</span>
					) : (
						<Copy className="w-4 h-4 shrink-0 text-ink-secondary group-hover:text-ink-primary transition-colors" />
					)}
				</div>
			</button>

			<p role="status" className="sr-only">{copied ? "Copied to clipboard" : ""}</p>
			{error && <p role="alert" className="mt-2 text-[12px] text-red-700">{error.message}</p>}

			<p className="mt-4 text-center text-[12px] text-ink-secondary leading-relaxed">
				Every payment extends{" "}
				<span className="text-ink-action">{name}</span>
			</p>
			</div>
			</div>

			{/* What this address accepts — the question every sender has. */}
			<div className="inset-panel mt-5">
				<div className="flex items-center justify-center gap-2">
					<img
						src={`${import.meta.env.BASE_URL}logos/usdc.svg`}
						alt=""
						className="w-[18px] h-[18px]"
					/>
					<span className="text-[13.5px] text-ink-action">
						USDC accepted
					</span>
				</div>

				<div className="mt-3 pt-3 border-t border-[rgba(28,58,41,0.08)]">
					<div className="text-[10px] uppercase tracking-wider text-ink-label text-center">
						On any of these chains
					</div>
					<div className="mt-2.5 flex items-center justify-center gap-x-5 gap-y-2 flex-wrap">
						{FUNDING_CHAINS.map((c) => (
							<span
								key={c.name}
								className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-secondary"
							>
								<img
									src={`${import.meta.env.BASE_URL}logos/${c.logo}`}
									alt=""
									className="w-4 h-4 shrink-0"
								/>
								{c.name}
							</span>
						))}
					</div>

					{/* Bridged USDC.e is a different contract that displays the same
					    name, and a deposit address has no way to return it. Naming
					    the token isn't enough — point at the exact contracts. */}
					<button
						onClick={onSupportedTokens}
						className="mt-3 min-h-11 w-full inline-flex items-center justify-center gap-1 text-[12px] text-ink-secondary hover:text-ink-primary transition-colors"
					>
						Check contract addresses
						<ArrowUpRight className="w-3.5 h-3.5" />
					</button>
				</div>
			</div>

		</div>
	);
}

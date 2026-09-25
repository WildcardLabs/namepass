import { motion } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Check, Copy, Infinity as InfinityIcon } from "lucide-react";
import { normalizeLabel } from "../lib/namepass";
import { encodeQR } from "../lib/qr";
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
const NAME_FONT_SIZE = 15;
const ADDRESS_FONT_SIZE = 12.5;
const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export default function PassCard({
	name,
	address,
	onSupportedTokens,
	animate = false,
	surface = "solid",
	layout = "stack",
}: Props) {
	const [copied, setCopied] = useState<string | null>(null);
	const subdomain = `${normalizeLabel(name)}.namepass.eth`;
	const [valueScale, setValueScale] = useState(1);
	const nameSpaceRef = useRef<HTMLSpanElement>(null);
	const addressSpaceRef = useRef<HTMLSpanElement>(null);
	const nameMeasureRef = useRef<HTMLSpanElement>(null);
	const addressMeasureRef = useRef<HTMLSpanElement>(null);

	useBrowserLayoutEffect(() => {
		const nameSpace = nameSpaceRef.current;
		const addressSpace = addressSpaceRef.current;
		const nameMeasure = nameMeasureRef.current;
		const addressMeasure = addressMeasureRef.current;
		if (!nameSpace || !addressSpace || !nameMeasure || !addressMeasure) return;

		let active = true;
		const fitValues = () => {
			const nameWidth = nameMeasure.getBoundingClientRect().width;
			const addressWidth = addressMeasure.getBoundingClientRect().width;
			const nameSpaceWidth = nameSpace.clientWidth;
			const addressSpaceWidth = addressSpace.clientWidth;
			if (!nameWidth || !addressWidth || !nameSpaceWidth || !addressSpaceWidth) return;
			// Use the tighter field to set one scale for both values. The small
			// margin covers fractional pixel rounding on narrow mobile screens.
			setValueScale(Math.min(1, nameSpaceWidth / nameWidth * 0.99, addressSpaceWidth / addressWidth * 0.99));
		};

		fitValues();
		const observer = new ResizeObserver(fitValues);
		observer.observe(nameSpace);
		observer.observe(addressSpace);
		document.fonts?.ready.then(() => { if (active) fitValues(); });
		return () => { active = false; observer.disconnect(); };
	}, [subdomain, address]);

	const matrix = useMemo(() => {
		try {
			return encodeQR(address);
		} catch {
			return null;
		}
	}, [address]);

	function copy(text: string) {
		const done = () => {
			setCopied(text);
			setTimeout(() => setCopied(null), 1600);
		};
		if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, done);
		else done();
	}

	const glass = surface === "glass";
	const cardBg = glass
		? "bg-white/45 border-white/50"
		: "bg-white border-[rgba(28,58,41,0.1)]";
	const fieldBg = glass
		? "bg-white/50 border-white/60 hover:bg-white/70"
		: "bg-[rgba(28,58,41,0.03)] border-[rgba(28,58,41,0.1)] hover:border-[rgba(28,58,41,0.25)]";

	const size = matrix?.length ?? 0;
	/* Draw at unit scale in a 0..size viewBox — crisp at any rendered size. */

	const split = layout === "split";

	return (
		<div className={`rounded-[1.4rem] border ${cardBg} p-5 md:p-6`}>
			<div className={split ? "sm:flex sm:items-start sm:gap-6" : ""}>
			<div className={split ? "sm:w-[200px] sm:shrink-0" : ""}>
			{/* QR */}
			<div className="flex justify-center">
				<div className="relative">
					<div
						className={`rounded-[1.4rem] p-4 ${glass ? "bg-white/80" : "bg-white"} border ${
							glass ? "border-white/60" : "border-[rgba(28,58,41,0.08)]"
						}`}
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

			<p className="mt-3 text-center text-[12px] text-[rgba(28,58,41,0.5)]">
				Scan to send from any wallet
			</p>

			</div>

			<div className={split ? "sm:flex-1 sm:min-w-0" : ""}>
			<button
				onClick={() => copy(subdomain)}
				className={`${split ? "mt-5 sm:mt-0" : "mt-5"} w-full text-left rounded-[8px] border px-4 py-3 group ${fieldBg}`}
				aria-label={`Copy ${subdomain}`}
			>
				<span className="block text-[10px] uppercase tracking-wider text-[rgba(28,58,41,0.5)]">Namepass</span>
				<span className="mt-1 flex items-center gap-3 text-[rgba(28,58,41,0.95)]">
					<span ref={nameSpaceRef} className="relative min-w-0 flex-1 whitespace-nowrap">
						<span style={{ fontSize: NAME_FONT_SIZE * valueScale }}>{subdomain}</span>
						<span ref={nameMeasureRef} aria-hidden="true" className="pointer-events-none invisible absolute left-0 top-0 w-max text-[15px]">{subdomain}</span>
					</span>
					{copied === subdomain ? <Check aria-label="Copied" className="w-4 h-4 shrink-0" /> : <Copy className="w-4 h-4 shrink-0" />}
				</span>
			</button>
			<button
				onClick={() => copy(address)}
				className={`mt-3 w-full text-left rounded-[8px] border px-4 py-3 transition-colors group ${fieldBg}`}
			>
				<div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[rgba(28,58,41,0.5)]">
					<InfinityIcon className="w-3 h-3" />
					Deposit address · any supported chain
				</div>
				<div className="mt-1 flex items-center gap-3">
					<span ref={addressSpaceRef} className="relative min-w-0 flex-1 whitespace-nowrap leading-snug text-[rgba(28,58,41,0.95)] font-mono">
						<span style={{ fontSize: ADDRESS_FONT_SIZE * valueScale }}>{address}</span>
						<span ref={addressMeasureRef} aria-hidden="true" className="pointer-events-none invisible absolute left-0 top-0 w-max text-[12.5px]">{address}</span>
					</span>
					{copied === address ? (
						<span className="shrink-0 text-[rgba(28,58,41,0.8)]">
							<Check className="w-4 h-4" />
							<span className="sr-only" role="status">Copied</span>
						</span>
					) : (
						<Copy className="w-4 h-4 shrink-0 text-[rgba(28,58,41,0.35)] group-hover:text-[rgba(28,58,41,0.75)] transition-colors" />
					)}
				</div>
			</button>

			<p className="mt-4 text-center text-[12px] text-[rgba(28,58,41,0.5)] leading-relaxed">
				Every payment extends{" "}
				<span className="text-[rgba(28,58,41,0.8)]">{name}</span>
			</p>
			</div>
			</div>

			{/* What this address accepts — the question every sender has. */}
			<div
				className={`mt-5 rounded-[8px] border px-4 py-3.5 ${
					glass ? "bg-white/35 border-white/50" : "bg-[rgba(28,58,41,0.025)] border-[rgba(28,58,41,0.08)]"
				}`}
			>
				<div className="flex items-center justify-center gap-2">
					<img
						src={`${import.meta.env.BASE_URL}logos/usdc.svg`}
						alt=""
						className="w-[18px] h-[18px]"
					/>
					<span className="text-[13.5px] text-[rgba(28,58,41,0.9)]">
						USDC accepted
					</span>
				</div>

				<div className="mt-3 pt-3 border-t border-[rgba(28,58,41,0.08)]">
					<div className="text-[10px] uppercase tracking-wider text-[rgba(28,58,41,0.45)] text-center">
						On any of these chains
					</div>
					<div className="mt-2.5 flex items-center justify-center gap-x-5 gap-y-2 flex-wrap">
						{FUNDING_CHAINS.map((c) => (
							<span
								key={c.name}
								className="inline-flex items-center gap-1.5 text-[12.5px] text-[rgba(28,58,41,0.7)]"
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
						className="mt-3 w-full inline-flex items-center justify-center gap-1 text-[12px] text-[rgba(28,58,41,0.5)] hover:text-[rgba(28,58,41,0.85)] transition-colors"
					>
						Check contract addresses
						<ArrowUpRight className="w-3.5 h-3.5" />
					</button>
				</div>
			</div>

		</div>
	);
}

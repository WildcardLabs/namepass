import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { Check, Copy, Infinity as InfinityIcon } from "lucide-react";
import { encodeQR } from "../lib/qr";
import { truncAddress } from "../lib/format";

const CHAINS = [
	{ name: "Base", file: "base.svg" },
	{ name: "Arbitrum", file: "arbitrum.svg" },
	{ name: "Polygon", file: "polygon.svg" },
	{ name: "Ethereum", file: "ethereum.svg" },
];

interface Props {
	/** ENS name being funded, e.g. "vitalik.eth" */
	name: string;
	/** Permanent Namepass subdomain, e.g. "vitalik.namepass.eth" */
	pass: string;
	/** Permanent deposit address. */
	address: string;
	/** Animate the QR in. Off for returning users so the card is instantly usable. */
	animate?: boolean;
	/** Visual weight — "glass" over video/blur, "solid" on white. */
	surface?: "glass" | "solid";
}

/* Staggered reveal: modules light up in a diagonal wave, finished in ~560ms.
   Deliberately one-shot — a QR that keeps moving is a QR nobody can scan. */
const WAVE_MS = 420;
const MODULE_MS = 140;

export default function PassCard({
	name,
	pass,
	address,
	animate = false,
	surface = "solid",
}: Props) {
	const [copied, setCopied] = useState<"pass" | "address" | null>(null);
	const [showRaw, setShowRaw] = useState(false);

	const matrix = useMemo(() => {
		try {
			return encodeQR(address);
		} catch {
			return null;
		}
	}, [address]);

	function copy(text: string, which: "pass" | "address") {
		const done = () => {
			setCopied(which);
			setTimeout(() => setCopied(null), 1600);
		};
		if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, done);
		else done();
	}

	const glass = surface === "glass";
	const cardBg = glass
		? "bg-white/45 border-white/50"
		: "bg-white border-[rgba(30,50,90,0.1)]";
	const fieldBg = glass
		? "bg-white/50 border-white/60 hover:bg-white/70"
		: "bg-[rgba(30,50,90,0.03)] border-[rgba(30,50,90,0.1)] hover:border-[rgba(30,50,90,0.25)]";

	const size = matrix?.length ?? 0;
	/* Draw at unit scale in a 0..size viewBox — crisp at any rendered size. */

	return (
		<div className={`rounded-[1.4rem] border ${cardBg} p-5 md:p-6`}>
			{/* QR */}
			<div className="flex justify-center">
				<div className="relative">
					<div
						className={`rounded-2xl p-4 ${glass ? "bg-white/80" : "bg-white"} border ${
							glass ? "border-white/60" : "border-[rgba(30,50,90,0.08)]"
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
								{matrix.map((row, r) =>
									row.map((on, c) =>
										on ? (
											<motion.rect
												key={`${r}-${c}`}
												x={c}
												y={r}
												width={1}
												height={1}
												fill="rgba(30,50,90,0.92)"
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

			<p className="mt-3 text-center text-[12px] text-[rgba(30,50,90,0.5)]">
				Scan to send from any wallet
			</p>

			{/* What this address accepts — the question every sender has. */}
			<div
				className={`mt-4 rounded-2xl border px-4 py-3.5 ${
					glass ? "bg-white/35 border-white/50" : "bg-[rgba(30,50,90,0.025)] border-[rgba(30,50,90,0.08)]"
				}`}
			>
				<div className="flex items-center justify-center gap-2">
					<img
						src={`${import.meta.env.BASE_URL}logos/usdc.svg`}
						alt=""
						className="w-[18px] h-[18px]"
					/>
					<span className="text-[13.5px] text-[rgba(30,50,90,0.9)]">
						USDC accepted
					</span>
				</div>

				<div className="mt-3 pt-3 border-t border-[rgba(30,50,90,0.08)]">
					<div className="text-[10px] uppercase tracking-wider text-[rgba(30,50,90,0.45)] text-center">
						On any of these chains
					</div>
					<div className="mt-2.5 flex items-center justify-center gap-x-4 gap-y-2 flex-wrap">
						{CHAINS.map((c) => (
							<span
								key={c.name}
								className="inline-flex items-center gap-1.5 text-[12.5px] text-[rgba(30,50,90,0.7)]"
							>
								<img
									src={`${import.meta.env.BASE_URL}logos/${c.file}`}
									alt=""
									className="w-4 h-4 shrink-0"
								/>
								{c.name}
							</span>
						))}
					</div>
				</div>
			</div>

			{/* Primary: the human-readable name */}
			<button
				onClick={() => copy(pass, "pass")}
				className={`mt-5 w-full text-left rounded-2xl border px-4 py-3 transition-colors group ${fieldBg}`}
			>
				<div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[rgba(30,50,90,0.5)]">
					<InfinityIcon className="w-3 h-3" />
					Send here · permanent
				</div>
				<div className="mt-1 flex items-center justify-between gap-3">
					<span className="text-[15px] md:text-[16px] text-[rgba(30,50,90,0.95)] truncate">
						{pass}
					</span>
					{copied === "pass" ? (
						<span className="flex items-center gap-1.5 shrink-0 text-[12px] text-[rgba(30,50,90,0.8)]">
							<Check className="w-3.5 h-3.5" />
							Copied
						</span>
					) : (
						<Copy className="w-4 h-4 shrink-0 text-[rgba(30,50,90,0.35)] group-hover:text-[rgba(30,50,90,0.75)] transition-colors" />
					)}
				</div>
			</button>

			{/* Secondary: the raw address, tucked away until wanted */}
			{!showRaw ? (
				<button
					onClick={() => setShowRaw(true)}
					className="mt-2.5 w-full text-center text-[12.5px] text-[rgba(30,50,90,0.5)] hover:text-[rgba(30,50,90,0.8)] transition-colors py-1"
				>
					or use the raw address
				</button>
			) : (
				<motion.button
					initial={{ opacity: 0, height: 0 }}
					animate={{ opacity: 1, height: "auto" }}
					transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
					onClick={() => copy(address, "address")}
					className={`mt-2.5 w-full text-left rounded-2xl border px-4 py-3 transition-colors group overflow-hidden ${fieldBg}`}
				>
					<div className="text-[10px] uppercase tracking-wider text-[rgba(30,50,90,0.5)]">
						Deposit address · any chain
					</div>
					<div className="mt-1 flex items-center justify-between gap-3">
						<span className="text-[14px] text-[rgba(30,50,90,0.95)] font-mono">
							{truncAddress(address)}
						</span>
						{copied === "address" ? (
							<span className="flex items-center gap-1.5 shrink-0 text-[12px] text-[rgba(30,50,90,0.8)]">
								<Check className="w-3.5 h-3.5" />
								Copied
							</span>
						) : (
							<Copy className="w-4 h-4 shrink-0 text-[rgba(30,50,90,0.35)] group-hover:text-[rgba(30,50,90,0.75)] transition-colors" />
						)}
					</div>
				</motion.button>
			)}

			<p className="mt-4 text-center text-[12px] text-[rgba(30,50,90,0.5)] leading-relaxed">
				Every payment extends{" "}
				<span className="text-[rgba(30,50,90,0.8)]">{name}</span>
			</p>
		</div>
	);
}

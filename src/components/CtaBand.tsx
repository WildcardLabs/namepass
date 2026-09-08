import { motion } from "motion/react";
import { ArrowUpRight } from "lucide-react";

interface Props {
	onClaim: () => void;
	onSimulate: () => void;
}

/**
 * Near-footer CTA band — the RIVR template's landscape panel: a dark graphic
 * so the heading reads white, with the copy left and two actions right. The
 * left action is a solid white button; the right is a frosted "liquid glass"
 * button (translucent, blurred, hairline highlight). The background is a dark
 * forest gradient with drifting glow and layered ridge silhouettes, animated in
 * CSS (see index.css `.cta-*`).
 */
export default function CtaBand({ onClaim, onSimulate }: Props) {
	return (
		<section className="px-5 md:px-10 pb-14 md:pb-20">
			<div className="relative max-w-[1100px] mx-auto overflow-hidden rounded-[1.25rem] md:rounded-[1.75rem] min-h-[220px] md:min-h-[260px]">
				{/* Dark forest sky */}
				<div
					className="cta-pan absolute inset-0"
					style={{
						background:
							"linear-gradient(120deg, #12241a 0%, #1c3a29 46%, #0e1c14 100%)",
					}}
				/>
				{/* Drifting glow */}
				<div
					className="cta-blob-a absolute -top-24 right-16 w-[380px] h-[380px] rounded-full blur-3xl opacity-60"
					style={{ background: "radial-gradient(circle, rgba(104,168,126,0.45), transparent 68%)" }}
				/>

				{/* Layered ridge silhouettes */}
				<svg
					className="absolute bottom-0 left-0 w-full h-[52%]"
					viewBox="0 0 1536 260"
					preserveAspectRatio="none"
					fill="none"
				>
					<path
						d="M0 190 L220 120 L430 175 L640 95 L860 165 L1080 110 L1290 170 L1536 120 L1536 260 L0 260 Z"
						fill="rgba(255,255,255,0.05)"
					/>
					<path
						d="M0 225 L260 165 L520 210 L760 150 L1010 205 L1270 160 L1536 205 L1536 260 L0 260 Z"
						fill="rgba(0,0,0,0.22)"
					/>
				</svg>

				{/* Content: heading left, actions right */}
				<div className="relative z-10 h-full min-h-[220px] md:min-h-[260px] flex flex-col md:flex-row md:items-center md:justify-between gap-6 px-7 py-10 md:px-14 md:py-12">
					<motion.h2
						initial={{ opacity: 0, y: 16 }}
						whileInView={{ opacity: 1, y: 0 }}
						viewport={{ once: true, margin: "-80px" }}
						transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
						className="text-[30px] md:text-[42px] font-normal text-white tracking-tight leading-[1.05] max-w-md"
					>
						Never let a name expire again.
					</motion.h2>

					<motion.div
						initial={{ opacity: 0, y: 12 }}
						whileInView={{ opacity: 1, y: 0 }}
						viewport={{ once: true, margin: "-80px" }}
						transition={{ duration: 0.7, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
						className="flex flex-wrap items-center gap-3 shrink-0"
					>
						{/* Left: solid white */}
						<button
							onClick={onClaim}
							className="inline-flex items-center gap-2 rounded-[10px] bg-white text-[rgba(18,36,26,0.95)] px-5 py-3 text-[15px] hover:bg-white/90 transition-colors"
						>
							Claim address
							<ArrowUpRight className="w-4 h-4" />
						</button>
						{/* Right: liquid glass */}
						<button
							onClick={onSimulate}
							className="inline-flex items-center rounded-[10px] bg-white/10 backdrop-blur-md border border-white/25 text-white px-5 py-3 text-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] hover:bg-white/20 transition-colors"
						>
							Cost simulator
						</button>
					</motion.div>
				</div>
			</div>
		</section>
	);
}

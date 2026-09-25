import { motion } from "motion/react";
import { Github } from "lucide-react";
import { AnimatedBeamDemo } from "./AnimatedBeamDemo";

/* The RIVR template's "Architected for high-performance DeFi" bento, repurposed
   as the four things that actually make Namepass work. Each card is one real
   property of the protocol — nothing here is aspirational copy. */

const NUM = "font-normal text-[13px] text-[rgba(28,58,41,0.35)] tabular-nums";
const TAG =
	"text-[11px] uppercase tracking-[0.16em] text-[rgba(28,58,41,0.5)]";
const CARD =
	"rounded-[1.25rem] bg-white p-6 md:p-7";

export default function Protocol() {
	return (
		<section id="protocol" className="bg-[#f0f0f0] px-5 md:px-10 py-14 md:py-20">
			<div className="max-w-[1100px] mx-auto">
				<div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6">
					<div className="max-w-2xl">
						<span className={TAG}>The protocol</span>
						<h2 className="mt-3 text-[36px] md:text-[52px] font-normal text-[rgba(28,58,41,0.95)] tracking-tight leading-[1.03]">
							The protocol behind ENS renewals.
						</h2>
						<p className="mt-3 text-[15px] md:text-[16px] text-[rgba(28,58,41,0.6)] leading-relaxed">
							Namepass contracts derive a deterministic USDC deposit address for every name and
							execute renewals at ENS's on-chain rates.
						</p>
					</div>
					<motion.a
						whileTap={{ scale: 0.98 }}
						href="https://github.com/stevegachau/namepass-v2"
						target="_blank"
						rel="noopener noreferrer"
						className="group shrink-0 self-start sm:self-auto inline-flex items-center gap-2 rounded-[10px] bg-white px-5 py-2.5 text-[14px] text-[rgba(28,58,41,0.9)] shadow-[0_3px_10px_rgba(28,58,41,0.08)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(28,58,41,0.6)]"
					>
						<Github aria-hidden="true" className="w-4 h-4 transition-transform duration-200 group-hover:-translate-y-0.5" />
						View source
					</motion.a>
				</div>

				{/* Bento: tall card left, one wide + two half cards right */}
				<div className="mt-10 grid md:grid-cols-2 gap-4">
					{/* 01 — tall */}
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						whileInView={{ opacity: 1, y: 0 }}
						viewport={{ once: true, margin: "-80px" }}
						transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
						className={`${CARD} md:row-span-2 flex flex-col`}
					>
						<div className="flex items-center justify-between">
							<span className={TAG}>Deposit Address</span>
							<span className={NUM}>01</span>
						</div>

						<AnimatedBeamDemo />

						<div>
							<h3 className="text-[22px] md:text-[26px] font-normal text-[rgba(28,58,41,0.95)] tracking-tight leading-tight">
								One address, any chain
							</h3>
							<p className="mt-2 text-[14px] text-[rgba(28,58,41,0.6)] leading-relaxed">
								Each ENS name maps to the same deposit address across supported chains.
							</p>
						</div>
					</motion.div>

					{/* 02 — wide */}
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						whileInView={{ opacity: 1, y: 0 }}
						viewport={{ once: true, margin: "-80px" }}
						transition={{ duration: 0.7, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
						className={CARD}
					>
						<div className="flex items-center justify-between">
							<span className={TAG}>Renewal execution</span>
							<span className={NUM}>02</span>
						</div>
						<h3 className="mt-6 text-[22px] md:text-[26px] font-normal text-[rgba(28,58,41,0.95)] tracking-tight leading-tight">
							USDC buys renewal time
						</h3>
						<p className="mt-2 text-[14px] text-[rgba(28,58,41,0.6)] leading-relaxed max-w-md">
							Namepass turns USDC into renewal time at ENS rates. Larger amounts qualify for discounted rates.
						</p>
					</motion.div>

					{/* 03 + 04 — two halves */}
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
						<motion.div
							initial={{ opacity: 0, y: 20 }}
							whileInView={{ opacity: 1, y: 0 }}
							viewport={{ once: true, margin: "-80px" }}
							transition={{ duration: 0.7, delay: 0.16, ease: [0.16, 1, 0.3, 1] }}
							className={CARD}
						>
							<div className="flex items-center justify-between">
								<span className={TAG}>Walkaway test</span>
								<span className={NUM}>03</span>
							</div>
							<h3 className="mt-6 text-[22px] md:text-[26px] font-normal text-[rgba(28,58,41,0.95)] tracking-tight leading-tight">
								Anyone can trigger
							</h3>
							<p className="mt-2 text-[13.5px] text-[rgba(28,58,41,0.6)] leading-relaxed">
								Renewal flows remain executable even if the Namepass service goes offline.
							</p>
						</motion.div>

						<motion.div
							initial={{ opacity: 0, y: 20 }}
							whileInView={{ opacity: 1, y: 0 }}
							viewport={{ once: true, margin: "-80px" }}
							transition={{ duration: 0.7, delay: 0.24, ease: [0.16, 1, 0.3, 1] }}
							className={`${CARD} relative`}
						>
							<div className="flex items-center justify-between">
								<span className={TAG}>Cross-chain</span>
								<span className={NUM}>04</span>
							</div>
							<h3 className="mt-6 text-[22px] md:text-[26px] font-normal text-[rgba(28,58,41,0.95)] tracking-tight leading-tight">
								Circle CCTP
							</h3>
							<p className="mt-2 text-[13.5px] text-[rgba(28,58,41,0.6)] leading-relaxed">
								USDC moves natively across chains before the renewal settles.
							</p>
										</motion.div>
					</div>
				</div>
			</div>
		</section>
	);
}

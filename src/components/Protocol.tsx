import { motion } from "motion/react";
import { ArrowUpRight, ArrowRight, Infinity as InfinityIcon } from "lucide-react";
import { FUNDING_CHAINS } from "../lib/chains";

interface Props {
	onClaim: () => void;
	onSupportedTokens: () => void;
}

/* The RIVR template's "Architected for high-performance DeFi" bento, repurposed
   as the four things that actually make Namepass work. Each card is one real
   property of the protocol — nothing here is aspirational copy. */

const NUM = "font-normal text-[13px] text-[rgba(18,36,26,0.35)] tabular-nums";
const TAG =
	"text-[11px] uppercase tracking-[0.16em] text-[rgba(18,36,26,0.5)]";
const CARD =
	"rounded-2xl border border-[rgba(18,36,26,0.09)] bg-white p-6 md:p-7";

export default function Protocol({ onClaim, onSupportedTokens }: Props) {
	return (
		<section id="protocol" className="bg-[#f0f0f0] px-5 md:px-10 py-14 md:py-20">
			<div className="max-w-[1100px] mx-auto">
				{/* Header row */}
				<div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6">
					<div className="max-w-2xl">
						<span className={TAG}>The protocol</span>
						<h2 className="mt-3 text-[36px] md:text-[52px] font-normal text-[rgba(18,36,26,0.95)] tracking-tight leading-[1.03]">
							Architected to keep names alive.
						</h2>
						<p className="mt-3 text-[15px] md:text-[16px] text-[rgba(18,36,26,0.6)] leading-relaxed">
							Permissionless renewal infrastructure. Any USDC, from any supported
							chain, converted into ENS time at the exact on-chain rate.
						</p>
					</div>
					<motion.button
						whileHover={{ scale: 1.02 }}
						whileTap={{ scale: 0.98 }}
						onClick={onClaim}
						className="shrink-0 self-start sm:self-auto inline-flex items-center gap-2 rounded-[10px] border border-[rgba(18,36,26,0.2)] bg-white px-5 py-2.5 text-[14px] text-[rgba(18,36,26,0.9)] hover:bg-[rgba(18,36,26,0.04)] transition-colors"
					>
						Claim an address
						<ArrowUpRight className="w-4 h-4" />
					</motion.button>
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
							<span className={TAG}>Permanent address</span>
							<span className={NUM}>01</span>
						</div>

						{/* Product visual: one address, every chain */}
						<div className="my-8 md:my-10 flex-1 flex flex-col items-center justify-center gap-5">
							<div className="w-16 h-16 rounded-2xl bg-[rgba(18,36,26,0.05)] border border-[rgba(18,36,26,0.1)] flex items-center justify-center">
								<InfinityIcon className="w-7 h-7 text-[rgba(18,36,26,0.75)]" />
							</div>
							<div className="flex items-center gap-4">
								{FUNDING_CHAINS.map((c) => (
									<img
										key={c.name}
										src={`${import.meta.env.BASE_URL}logos/${c.logo}`}
										alt={c.name}
										className="w-5 h-5"
									/>
								))}
							</div>
						</div>

						<div>
							<h3 className="text-[22px] md:text-[26px] font-normal text-[rgba(18,36,26,0.95)] tracking-tight leading-tight">
								One address, any chain
							</h3>
							<p className="mt-2 text-[14px] text-[rgba(18,36,26,0.6)] leading-relaxed">
								Every ENS name gets its own USDC deposit address, derived
								deterministically with CREATE2. No custodian holds keys, and the
								same address works on every supported chain.
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
							<span className={TAG}>Automatic renewal</span>
							<span className={NUM}>02</span>
						</div>
						<h3 className="mt-6 text-[22px] md:text-[26px] font-normal text-[rgba(18,36,26,0.95)] tracking-tight leading-tight">
							Payments become time
						</h3>
						<p className="mt-2 text-[14px] text-[rgba(18,36,26,0.6)] leading-relaxed max-w-md">
							Any USDC that lands is converted into ENS renewal time
							automatically, at the exact on-chain rate — no dashboard to open, no
							transaction to sign.
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
								<span className={TAG}>Permissionless</span>
								<span className={NUM}>03</span>
							</div>
							<h3 className="mt-6 text-[19px] md:text-[21px] font-normal text-[rgba(18,36,26,0.95)] tracking-tight leading-tight">
								Anyone can fund a name
							</h3>
							<p className="mt-2 text-[13.5px] text-[rgba(18,36,26,0.6)] leading-relaxed">
								Ownership isn't required. Anyone can extend a name from any
								supported chain.
							</p>
							<button
								onClick={onSupportedTokens}
								className="mt-4 inline-flex items-center gap-1.5 text-[13px] text-[rgba(18,36,26,0.7)] hover:text-[rgba(18,36,26,0.95)] transition-colors"
							>
								Supported tokens
								<ArrowUpRight className="w-3.5 h-3.5" />
							</button>
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
							<h3 className="mt-6 text-[19px] md:text-[21px] font-normal text-[rgba(18,36,26,0.95)] tracking-tight leading-tight">
								Native USDC via CCTP
							</h3>
							<p className="mt-2 text-[13.5px] text-[rgba(18,36,26,0.6)] leading-relaxed">
								USDC moves natively across chains and the renewal settles in the
								same transaction that completes the transfer.
							</p>
							<ArrowRight className="mt-4 w-5 h-5 text-[rgba(18,36,26,0.4)]" />
						</motion.div>
					</div>
				</div>
			</div>
		</section>
	);
}

import { motion } from "motion/react";
import { Github, Timer, Unplug, WalletMinimal } from "lucide-react";
import { AnimatedBeamDemo } from "./AnimatedBeamDemo";

/* The RIVR template's "Architected for high-performance DeFi" bento, repurposed
   as the four things that actually make Namepass work. Each card is one real
   property of the protocol — nothing here is aspirational copy. */

const NUM = "font-normal text-[13px] text-ink-decorative tabular-nums";
const TAG =
	"text-[11px] uppercase tracking-section text-ink-label";
const META_ICON = "h-3.5 w-3.5 shrink-0 text-ink-secondary";
const CARD =
	"rounded-[1.25rem] bg-white p-6 md:p-7";
const HOVER = { y: -2, boxShadow: "0 12px 28px rgba(28,58,41,0.06)", transition: { duration: 0.18 } };

export default function Protocol() {
	return (
		<section id="protocol" className="bg-surface-canvas px-5 md:px-10 py-14 md:py-20">
			<div className="max-w-[1100px] mx-auto">
				<div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6">
					<div className="max-w-2xl">
						<span className={TAG}>The protocol</span>
						<h2 className="mt-3 text-[36px] md:text-[52px] font-normal text-ink-primary tracking-tight leading-[1.03]">
							A USDC payment protocol for ENS renewals.
						</h2>
						<p className="mt-3 text-[15px] md:text-[16px] text-ink-secondary leading-relaxed">
							No wallet connection, message signing, or token approvals.
							Just send USDC from your wallet, exchange, or neobank.
						</p>
					</div>
					<motion.a
						whileTap={{ scale: 0.98 }}
						href="https://github.com/stevegachau/namepass-v2"
						target="_blank"
						rel="noopener noreferrer"
						className="group shrink-0 self-start sm:self-auto inline-flex items-center gap-2 rounded-[10px] bg-white px-5 py-2.5 text-[14px] text-ink-action shadow-[0_3px_10px_rgba(28,58,41,0.08)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(28,58,41,0.6)]"
					>
						<Github aria-hidden="true" className="w-4 h-4 transition-transform duration-200 group-hover:-translate-y-0.5" />
						View source
					</motion.a>
				</div>

				{/* Bento: tall card left, one wide + two half cards right */}
				<div className="mt-10 grid lg:grid-cols-2 gap-4">
					{/* 01 — tall */}
					<motion.div
						whileHover={HOVER}
						initial={{ opacity: 0, y: 20 }}
						whileInView={{ opacity: 1, y: 0 }}
						viewport={{ once: true, margin: "-80px" }}
						transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
						className={`${CARD} lg:row-span-2 flex flex-col`}
					>
						<div className="flex items-center justify-between gap-2">
							<span className={`${TAG} inline-flex items-center gap-2`}>
								<WalletMinimal aria-hidden="true" className={META_ICON} strokeWidth={1.6} />
								Deposit Address
							</span>
							<span className={NUM}>01</span>
						</div>

						<AnimatedBeamDemo />

						<div>
							<h3 className="text-[22px] md:text-[26px] font-normal text-ink-primary tracking-tight leading-tight">
								One name. One universal address.
							</h3>
							<p className="mt-2 text-[14px] text-ink-secondary leading-relaxed">
								The deposit address is derived from the ENS name. It stays the same across supported chains
								and can be used by any application.
							</p>
						</div>
					</motion.div>

					{/* 02 — wide */}
					<motion.div
						whileHover={HOVER}
						initial={{ opacity: 0, y: 20 }}
						whileInView={{ opacity: 1, y: 0 }}
						viewport={{ once: true, margin: "-80px" }}
						transition={{ duration: 0.7, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
						className={CARD}
					>
						<div className="flex items-center justify-between gap-2">
							<span className={`${TAG} inline-flex items-center gap-2`}>
								<Timer aria-hidden="true" className={META_ICON} strokeWidth={1.6} />
								Automated execution
							</span>
							<span className={NUM}>02</span>
						</div>
						<h3 className="mt-6 text-[22px] md:text-[26px] font-normal text-ink-primary tracking-tight leading-tight">
							From deposit to renewal
						</h3>
						<p className="mt-2 text-[14px] text-ink-secondary leading-relaxed max-w-md">
							Namepass monitors deposits, manages settlement, and executes renewals.
							The deposit wallet has no private key or owner withdrawal path. Deposited USDC can only follow the configured renewal route.
						</p>
					</motion.div>

					{/* 03 + 04 — two halves */}
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
						<motion.div
							whileHover={HOVER}
							initial={{ opacity: 0, y: 20 }}
							whileInView={{ opacity: 1, y: 0 }}
							viewport={{ once: true, margin: "-80px" }}
							transition={{ duration: 0.7, delay: 0.16, ease: [0.16, 1, 0.3, 1] }}
							className={CARD}
						>
							<div className="flex items-center justify-between gap-2">
								<span className={`${TAG} inline-flex items-center gap-2`}>
									<Unplug aria-hidden="true" className={META_ICON} strokeWidth={1.6} />
									Permissionless
								</span>
								<span className={NUM}>03</span>
							</div>
							<h3 className="mt-6 text-[22px] md:text-[26px] font-normal text-ink-primary tracking-tight leading-tight">
								Open by design. Operated by Namepass.
							</h3>
							<p className="mt-2 text-[13.5px] text-ink-secondary leading-relaxed">
								Namepass keeps renewals moving day to day. Anyone can also execute the contract flow when needed.
							</p>
						</motion.div>

						<motion.div
							whileHover={HOVER}
							initial={{ opacity: 0, y: 20 }}
							whileInView={{ opacity: 1, y: 0 }}
							viewport={{ once: true, margin: "-80px" }}
							transition={{ duration: 0.7, delay: 0.24, ease: [0.16, 1, 0.3, 1] }}
							className={`${CARD} relative`}
						>
							<div className="flex items-center justify-between gap-2">
								<span className={`${TAG} inline-flex items-center gap-2`}>
									<span
										aria-hidden="true"
										className="inline-block h-3.5 w-3.5 shrink-0 bg-current text-ink-secondary"
										style={{
											mask: `url(${import.meta.env.BASE_URL}logos/ens.svg) center / contain no-repeat`,
											WebkitMask: `url(${import.meta.env.BASE_URL}logos/ens.svg) center / contain no-repeat`,
										}}
									/>
									Subnames
								</span>
								<span className={NUM}>04</span>
							</div>
							<h3 className="mt-6 text-[22px] md:text-[26px] font-normal text-ink-primary tracking-tight leading-tight">
								A readable deposit address.
							</h3>
							<p className="mt-2 text-[13.5px] text-ink-secondary leading-relaxed">
								<span className="box-decoration-clone rounded-md bg-surface-inset px-0.5 py-0.5 text-ink-link break-all">alice.namepass.eth</span>{" "}
								automatically resolves to the universal deposit address for{" "}
								<span className="box-decoration-clone rounded-md bg-surface-inset px-0.5 py-0.5 text-ink-link">alice.eth</span>.
							</p>
						</motion.div>
					</div>
				</div>
			</div>
		</section>
	);
}

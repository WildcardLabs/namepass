import { motion, AnimatePresence } from "motion/react";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { BadgePercent, TrendingUp } from "lucide-react";
import {
	ceilToCent,
	nextTierHint,
	oneYearCost,
	payableThresholds,
	rates,
	solve,
	YEAR_SECONDS,
} from "../lib/pricing";
import { GAS_ALLOWANCE } from "../lib/fees";
import { fmtDurationPrecise, fmtUsdc } from "../lib/format";
import Tooltip from "./Tooltip";
import PricingError from "./PricingError";

const LENGTHS = [
	{ len: 3, label: "3 characters", example: "ens.eth" },
	{ len: 4, label: "4 characters", example: "base.eth" },
	{ len: 5, label: "5+ characters", example: "vitalik.eth" },
];

/**
 * Every amount here is a *send* amount carrying the gas allowance, so the
 * figure on a button clears its discount tier from any supported chain.
 * Quoting the bare ENS threshold would land the payment a tier low once the
 * allowance came off, which is the failure this exists to prevent.
 */
const ALLOWANCE = GAS_ALLOWANCE;

/** Slider spans 0 → 1.6× the 6-year threshold, so every tier is reachable. */
function maxFor(len: number): bigint {
	return ((payableThresholds(len)[2].payable + ALLOWANCE) * 8n) / 5n;
}

function budgetFor(len: number, t: number): bigint {
	return (maxFor(len) * BigInt(Math.round(t * 10000))) / 10000n;
}

function tFor(len: number, budget: bigint): number {
	return Math.min(1, Math.max(0, Number(budget) / Number(maxFor(len))));
}

/**
 * The section, its copy, and the card it all sits in.
 *
 * Split from the body below so the heading and the card frame render on the
 * first paint, while only the two panels that quote a price wait on the oracle
 * read. `SimulatorBody` calls pricing functions in its very first render — a
 * `useState` initializer among them — so it must not mount before the rates
 * land; keeping it a separate component is what guarantees that.
 */
export default function Simulator({
	priced,
	problem,
	onRetry,
}: {
	priced: boolean;
	/** Set only when the oracle read failed, in which case there's no skeleton to show. */
	problem: string | null;
	onRetry: () => void;
}) {
	return (
		<section id="simulator" className="site-section bg-surface-canvas px-5 md:px-10 py-14 md:py-20">
			<div className="max-w-[1100px] mx-auto">
				<div className="max-w-2xl">
					<span className="site-eyebrow text-[11px] uppercase tracking-section text-ink-label">
						ENS v2 pricing
					</span>
					<h2 className="mt-3 text-[36px] md:text-[52px] font-normal text-ink-primary tracking-tight leading-[1.05]">
						Check ENS renewal prices.
					</h2>
					<p className="mt-3 text-[15px] md:text-[16px] text-ink-secondary leading-relaxed">
						Choose a name length and payment amount to see how much renewal time it can buy at current ENS prices.
					</p>
				</div>

				<div className="site-panel mt-8 bg-white overflow-hidden">
					{priced ? (
						<SimulatorBody />
					) : problem ? (
						<div className="p-6 md:p-10">
							<PricingError message={problem} onRetry={onRetry} />
						</div>
					) : (
						<SimulatorSkeleton />
					)}
				</div>
			</div>
		</section>
	);
}

/** Neutral placeholder in the shape of the real thing. Says nothing, on purpose. */
function Bar({ className = "" }: { className?: string }) {
	return (
		<div
			className={`rounded-full bg-[rgba(28,58,41,0.07)] motion-safe:animate-pulse ${className}`}
		/>
	);
}

function SimulatorSkeleton() {
	return (
		<>
			<div className="flex flex-col sm:flex-row border-b border-[rgba(28,58,41,0.08)]">
				{LENGTHS.map((l) => (
					<div
						key={l.len}
						className="flex-1 px-5 py-4 border-b sm:border-b-0 sm:border-r border-[rgba(28,58,41,0.08)] last:border-0"
					>
						{/* The labels are ours and known; only the rate beside them is ENS's. */}
						<div className="text-[15px] text-ink-secondary">{l.label}</div>
						<Bar className="mt-1.5 h-[10px] w-32" />
					</div>
				))}
			</div>

			<div className="p-6 md:p-10 grid md:grid-cols-2 gap-10 md:gap-16 items-start">
				<div>
					<div className="text-[11px] uppercase tracking-section text-ink-label">
						Payment received
					</div>
					<Bar className="mt-3 h-[44px] md:h-[52px] w-48 !rounded-2xl" />
					<Bar className="mt-3 h-[10px] w-44" />
					<Bar className="mt-6 h-[6px] w-full" />
					{/* Matches the tier cards' 55px so the section is the same height
					    loading as loaded — see the note on `Bar`. */}
					<div className="mt-7 grid grid-cols-3 gap-2.5">
						{[0, 1, 2].map((i) => (
							<Bar key={i} className="h-[55px] !rounded-2xl" />
						))}
					</div>
				</div>

				<div className="md:border-l md:border-[rgba(28,58,41,0.08)] md:pl-16">
					<div className="text-[11px] uppercase tracking-section text-ink-label">
						Renewal time bought
					</div>
					<Bar className="mt-3 h-[32px] md:h-[38px] w-40 !rounded-2xl" />
					<div className="mt-8 space-y-4">
						{[0, 1, 2, 3, 4, 5].map((i) => (
							<div key={i} className="flex justify-between gap-4">
								<Bar className="h-[12px] w-28" />
								<Bar className="h-[12px] w-16" />
							</div>
						))}
					</div>
				</div>
			</div>
		</>
	);
}

function SimulatorBody() {
	const pricing = rates();
	const [len, setLen] = useState(5);
	const [budget, setBudget] = useState<bigint>(
		() => ceilToCent(payableThresholds(5)[2].exact + ALLOWANCE),
	);
	const [draft, setDraft] = useState("");
	const [editing, setEditing] = useState(false);

	/* `budget` is what the sender puts in; `applied` is what survives the bridge
	   and reaches the registry. Every result below is solved from `applied` —
	   quoting a send amount against the time its pre-fee value would have bought
	   is the whole bug this guards against. */
	const applied = budget > ALLOWANCE ? budget - ALLOWANCE : 0n;

	const marks = useMemo(
		() =>
			payableThresholds(len).map((m) => ({
				...m,
				send: ceilToCent(m.exact + ALLOWANCE),
			})),
		[len, pricing],
	);
	const result = useMemo(() => solve(applied, len), [applied, len, pricing]);
	const hint = useMemo(() => nextTierHint(applied, len), [applied, len, pricing]);
	const years = Number(result.seconds) / Number(YEAR_SECONDS);

	/* Keep the amount sensible when switching name length. */
	useEffect(() => {
		setBudget((b) => {
			const max = maxFor(len);
			return b > max ? max : b;
		});
	}, [len]);

	function commitDraft() {
		const cleaned = draft.replace(/[^0-9.]/g, "");
		const value = Number.parseFloat(cleaned);
		setEditing(false);
		if (!Number.isFinite(value) || value < 0) return;
		const micro = BigInt(Math.round(value * 1e6));
		setBudget(micro > maxFor(len) ? maxFor(len) : micro);
	}

	return (
		<>
			<div className="flex flex-col sm:flex-row border-b border-[rgba(28,58,41,0.08)]">
				{LENGTHS.map((l) => {
							const on = l.len === len;
							return (
								<button
									key={l.len}
									onClick={() => setLen(l.len)}
									aria-pressed={on}
									className={`flex-1 px-5 py-4 text-left transition-colors border-b sm:border-b-0 sm:border-r border-[rgba(28,58,41,0.08)] last:border-0 ${
										on ? "bg-surface-selected" : ""
									}`}
								>
									<div
										className={`text-[15px] ${on ? "text-ink-primary" : "text-ink-secondary"}`}
									>
										{l.label}
									</div>
									<div className="mt-0.5 text-[12px] text-ink-secondary">
										{l.example} · {fmtUsdc(oneYearCost(l.len))}/year
									</div>
								</button>
							);
						})}
					</div>

					<div className="p-6 md:p-10 grid md:grid-cols-2 gap-10 md:gap-16 items-start">
						{/* input */}
						<div>
							<div className="text-[11px] uppercase tracking-section text-ink-label">
								Payment received
							</div>

							{editing ? (
								<div className="mt-1 flex items-baseline gap-1">
									<span className="site-amount text-[44px] md:text-[56px] text-ink-secondary leading-none">
										$
									</span>
									<input
										autoFocus
										value={draft}
										onChange={(e) => setDraft(e.target.value)}
										onBlur={commitDraft}
										onKeyDown={(e) => {
											if (e.key === "Enter") commitDraft();
											if (e.key === "Escape") setEditing(false);
										}}
										aria-label="Enter payment amount in USDC"
										inputMode="decimal"
										placeholder="0.00"
										className="w-full min-w-0 bg-transparent outline-none site-amount text-[44px] md:text-[56px] font-normal text-ink-primary tracking-tight leading-none tabular-nums border-b-2 border-[rgba(28,58,41,0.3)]"
									/>
								</div>
							) : (
								<button
									onClick={() => {
										setDraft((Number(budget) / 1e6).toFixed(2));
										setEditing(true);
									}}
									title="Click to type an amount"
									className="mt-1 block site-amount text-[44px] md:text-[56px] font-normal text-ink-primary tracking-tight leading-none tabular-nums border-b-2 border-transparent hover:border-[rgba(28,58,41,0.2)] transition-colors"
								>
									{fmtUsdc(budget)}
								</button>
							)}

							<div className="mt-1.5 text-[12px] text-ink-secondary">
								Tap or click the amount to type your own
							</div>

							<input
								type="range"
								min={0}
								max={1}
								step={0.0005}
								value={tFor(len, budget)}
								onChange={(e) => setBudget(budgetFor(len, Number(e.target.value)))}
								aria-label="Payment amount"
								aria-valuetext={`${fmtUsdc(budget)} USDC`}
								style={{ "--range-fill": `calc(11px + (100% - 22px) * ${tFor(len, budget)})` } as CSSProperties}
								className="amount-slider mt-2"
							/>

							{/* One card per discount tier: the period, and what it saves.
							    Deliberately no amount — the total each card sets is the
							    headline directly above it, and the per-year cost is a row
							    in the panel opposite, so putting either here duplicates a
							    figure a few inches away.

							    Highlighted is the tier the current amount actually lands
							    on, not every tier it has cleared. At $20 you've passed the
							    2-year threshold but you're buying at the 3-year rate, and
							    lighting up both said the opposite. */}
							<div className="mt-7 grid grid-cols-3 gap-2.5">
								{marks.map((m) => {
									const on = result.tierYears === m.years;
									return (
										<button
											key={m.years}
											onClick={() => setBudget(m.send)}
											aria-pressed={on}
											className={`relative rounded-[8px] border px-1.5 py-4 text-center transition-colors ${
												on
													? "border-transparent bg-surface-selected"
													: "border-[rgba(28,58,41,0.12)] hover:border-[rgba(28,58,41,0.3)] hover:bg-surface-inset"
											}`}
										>
											{/* Exact, not rounded to a whole percent. "−13%" for a
											    12.5% tier flatters the discount, and this sits two
											    inches from a panel that states the real figure. */}
											{m.off && (
												<span
													/* Fixed height + flex centring rather than vertical
													   padding: `leading-none` leaves the glyphs sitting
													   off-centre. A transparent border in the filled
													   state keeps the badge the same height.

													   `pb-px` is optical, not arithmetic: this font's
													   inline box is lopsided (ascent 11, descent 3 at
													   10px) while digits put almost no ink below the
													   baseline, so centring the *box* still leaves the
													   glyphs ~0.6px low. Measured, not guessed — the
													   first attempt at this centred the box and looked
													   no better. */
													className={`absolute -top-[9px] right-1 inline-flex h-[18px] items-center justify-center rounded-[4px] border px-1.5 pb-px text-[10px] leading-none tabular-nums transition-colors ${
														on
															? "border-transparent bg-savings text-ink-inverse"
															: "border-[rgba(28,58,41,0.12)] bg-white text-ink-secondary"
													}`}
												>
													−{m.off}
												</span>
											)}
											<div
												className={`text-[14px] ${on ? "text-ink-primary" : "text-ink-secondary"}`}
											>
												{m.years > 0 ? `${m.years} years` : "Bulk rate"}
											</div>
										</button>
									);
								})}
							</div>
							<div className="mt-5 flex items-start gap-2.5 text-[12px] leading-relaxed text-ink-secondary">
								<span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] bg-surface-selected text-ink-secondary">
									<BadgePercent aria-hidden="true" className="h-3.5 w-3.5" />
								</span>
								<p className="pt-0.5">
									Discounts follow{" "}
									<a
										href="https://docs.ens.domains/ensv2/eth-registrar/#multi-year-discounts"
										target="_blank"
										rel="noopener noreferrer"
										className="font-semibold text-ink-action hover:text-ink-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(28,58,41,0.6)]"
									>
										ENS's renewal tiers
									</a>
									; longer terms can unlock a higher discount.
								</p>
							</div>

						</div>

						{/* result */}
						<div className="md:border-l md:border-[rgba(28,58,41,0.08)] md:pl-16">
							<div className="text-[11px] uppercase tracking-section text-ink-label">
								Renewal time bought
							</div>
							<div className="mt-1 site-result text-[30px] md:text-[38px] font-normal text-ink-primary tracking-tight leading-[1.1]">
								{fmtDurationPrecise(result.seconds)}
							</div>

							{/* The boost hint — where the real money is saved */}
							<AnimatePresence>
								{hint && (
									<motion.div
										initial={{ opacity: 0, y: -4, height: 0 }}
										animate={{ opacity: 1, y: 0, height: "auto" }}
										exit={{ opacity: 0, height: 0 }}
										transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
										className="overflow-hidden"
									>
										<button
											onClick={() => setBudget(ceilToCent(hint.payable + ALLOWANCE))}
											className="inset-panel inset-action mt-4 w-full text-left group"
										>
											<div className="flex items-start gap-2.5">
												<TrendingUp className="w-4 h-4 mt-0.5 shrink-0 text-ink-secondary" />
												<div className="min-w-0">
													<div className="text-[13.5px] text-ink-primary leading-snug">
														Add {fmtUsdc(hint.delta)} to get{" "}
														<span className="whitespace-nowrap">
															{Math.round(Number(hint.gain) / 2629800)} more months
														</span>
													</div>
													<div className="mt-0.5 text-[12px] text-ink-secondary">
														Unlocks the {hint.years}-year rate · {hint.off} off
													</div>
												</div>
											</div>
										</button>
									</motion.div>
								)}
							</AnimatePresence>

							<dl className="mt-6 space-y-3 text-[14px]">
								{/* Same shape as a settled renewal in the Explorer: what went in,
								    what the bridge takes, what the registry actually sees. */}
								<div className="flex justify-between gap-4">
									<dt className="text-ink-secondary">Gas allowance</dt>
									<dd className="text-ink-secondary text-right tabular-nums">
										−{fmtUsdc(ALLOWANCE)}
									</dd>
								</div>
								<div className="flex justify-between gap-4 pb-3 border-b border-[rgba(28,58,41,0.08)]">
									<dt className="text-ink-secondary">Reaches renewal</dt>
									<dd className="text-ink-primary text-right tabular-nums">
										{fmtUsdc(applied)}
									</dd>
								</div>
								<div className="flex justify-between gap-4">
									<dt className="text-ink-secondary">Rate applied</dt>
									<dd className="text-ink-primary text-right">
										{result.off ? `${result.tierYears}-year bulk` : "Standard"}
									</dd>
								</div>
								<div className="flex justify-between gap-4">
									<dt className="text-ink-secondary">Discount</dt>
									<dd
										className={`text-right ${result.off ? "text-ink-primary" : "text-ink-secondary"}`}
									>
										{result.off ? `${result.off} off` : "None"}
									</dd>
								</div>
								<div className="flex justify-between gap-4">
									<dt className="text-ink-secondary">Effective cost</dt>
									<dd className="text-ink-primary text-right tabular-nums">
										{years > 0.01
											? `${fmtUsdc(BigInt(Math.round(Number(budget) / years)))}/year`
											: "-"}
									</dd>
								</div>
								<div className="flex justify-between gap-4 pt-3 border-t border-[rgba(28,58,41,0.08)]">
									<dt className="text-ink-secondary">Exact seconds</dt>
									<dd className="text-ink-secondary text-right tabular-nums text-[13px]">
										{result.seconds.toLocaleString("en-US")}
									</dd>
								</div>
							</dl>

							{/* The ENS math here is exact; the amount reaching it is a dime
							    less. Say so, but keep it to one line. */}
							<div className="mt-6 flex items-center gap-1.5 text-[12px] text-ink-secondary">
								<span>Amounts include a {fmtUsdc(ALLOWANCE)} gas allowance.</span>
								<Tooltip
									label="What the gas allowance covers"
									text="Goes toward network fees for moving the USDC and renewing on Ethereum. Same on every chain."
								/>
							</div>

						</div>
					</div>
		</>
	);
}

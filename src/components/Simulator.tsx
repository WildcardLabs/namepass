import { motion, AnimatePresence } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";
import {
	ceilToCent,
	nextTierHint,
	oneYearCost,
	payableThresholds,
	solve,
	YEAR_SECONDS,
} from "../lib/pricing";
import { GAS_ALLOWANCE } from "../lib/fees";
import { fmtUsdc } from "../lib/format";
import Tooltip from "./Tooltip";

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
 * Day-accurate duration. Days are shown at every scale, because "2 years"
 * and "2 years, 11 months, 20 days" are very different purchases.
 */
function humanDuration(seconds: bigint): string {
	const totalDays = Math.floor(Number(seconds) / 86400);
	if (totalDays <= 0) return "-";

	const years = Math.floor(totalDays / 365);
	const afterYears = totalDays - years * 365;
	const months = Math.floor(afterYears / 30);
	const days = afterYears - months * 30;

	const parts: string[] = [];
	if (years) parts.push(`${years} year${years === 1 ? "" : "s"}`);
	if (months) parts.push(`${months} month${months === 1 ? "" : "s"}`);
	if (days) parts.push(`${days} day${days === 1 ? "" : "s"}`);
	return parts.join(", ");
}

export default function Simulator() {
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
		[len],
	);
	const result = useMemo(() => solve(applied, len), [applied, len]);
	const hint = useMemo(() => nextTierHint(applied, len), [applied, len]);
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
		<section id="simulator" className="bg-[#f0f0f0] px-5 md:px-10 py-20 md:py-28">
			<div className="max-w-[1100px] mx-auto">
				<div className="max-w-2xl">
					<span className="text-[11px] uppercase tracking-wider text-[rgba(30,50,90,0.5)]">
						Cost simulator
					</span>
					<h2 className="mt-3 text-[36px] md:text-[52px] font-normal text-[rgba(30,50,90,0.95)] tracking-tight leading-[1.05]">
						See what any amount buys.
					</h2>
					<p className="mt-3 text-[15px] md:text-[16px] text-[rgba(30,50,90,0.6)] leading-relaxed">
						ENS offers better rates for longer renewals. Namepass always locks in the longest period your payment qualifies for, so you never leave a discount on the table.
					</p>
				</div>

				<div className="mt-10 bg-white rounded-[1.5rem] md:rounded-[2rem] border border-[rgba(30,50,90,0.08)] overflow-hidden">
					<div className="flex flex-col sm:flex-row border-b border-[rgba(30,50,90,0.08)]">
						{LENGTHS.map((l) => {
							const on = l.len === len;
							return (
								<button
									key={l.len}
									onClick={() => setLen(l.len)}
									className={`flex-1 px-5 py-4 text-left transition-colors border-b sm:border-b-0 sm:border-r border-[rgba(30,50,90,0.08)] last:border-0 ${
										on ? "bg-[rgba(30,50,90,0.05)]" : "hover:bg-[rgba(30,50,90,0.02)]"
									}`}
								>
									<div
										className={`text-[15px] ${on ? "text-[rgba(30,50,90,0.95)]" : "text-[rgba(30,50,90,0.6)]"}`}
									>
										{l.label}
									</div>
									<div className="mt-0.5 text-[12px] text-[rgba(30,50,90,0.45)]">
										{l.example} · {fmtUsdc(oneYearCost(l.len))}/year
									</div>
								</button>
							);
						})}
					</div>

					<div className="p-6 md:p-10 grid md:grid-cols-2 gap-10 md:gap-16 items-start">
						{/* input */}
						<div>
							<div className="text-[11px] uppercase tracking-wider text-[rgba(30,50,90,0.45)]">
								Payment received
							</div>

							{editing ? (
								<div className="mt-1 flex items-baseline gap-1">
									<span className="text-[44px] md:text-[56px] text-[rgba(30,50,90,0.5)] leading-none">
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
										inputMode="decimal"
										placeholder="0.00"
										className="w-full min-w-0 bg-transparent outline-none text-[44px] md:text-[56px] font-normal text-[rgba(30,50,90,0.95)] tracking-tight leading-none tabular-nums border-b-2 border-[rgba(30,50,90,0.3)]"
									/>
								</div>
							) : (
								<button
									onClick={() => {
										setDraft((Number(budget) / 1e6).toFixed(2));
										setEditing(true);
									}}
									title="Click to type an amount"
									className="mt-1 block text-[44px] md:text-[56px] font-normal text-[rgba(30,50,90,0.95)] tracking-tight leading-none tabular-nums border-b-2 border-transparent hover:border-[rgba(30,50,90,0.2)] transition-colors"
								>
									{fmtUsdc(budget)}
								</button>
							)}

							<div className="mt-1.5 text-[12px] text-[rgba(30,50,90,0.4)]">
								Click the amount to type your own
							</div>

							<input
								type="range"
								min={0}
								max={1}
								step={0.0005}
								value={tFor(len, budget)}
								onChange={(e) => setBudget(budgetFor(len, Number(e.target.value)))}
								aria-label="Payment amount"
								className="mt-5 w-full accent-[rgba(30,50,90,0.9)]"
							/>

							<div className="mt-5 flex flex-wrap gap-2">
								{marks.map((m) => {
									const reached = budget >= m.send;
									return (
										<button
											key={m.years}
											onClick={() => setBudget(m.send)}
											className={`px-3 py-1.5 rounded-full text-[12.5px] border transition-colors tabular-nums ${
												reached
													? "border-[rgba(30,50,90,0.35)] text-[rgba(30,50,90,0.9)] bg-[rgba(30,50,90,0.05)]"
													: "border-[rgba(30,50,90,0.12)] text-[rgba(30,50,90,0.5)] hover:border-[rgba(30,50,90,0.3)]"
											}`}
										>
											{fmtUsdc(m.send)} → {m.years}y
										</button>
									);
								})}
							</div>

						</div>

						{/* result */}
						<div className="md:border-l md:border-[rgba(30,50,90,0.08)] md:pl-16">
							<div className="text-[11px] uppercase tracking-wider text-[rgba(30,50,90,0.45)]">
								Renewal time bought
							</div>
							<AnimatePresence mode="popLayout">
								<motion.div
									key={result.seconds.toString()}
									initial={{ opacity: 0, y: 4 }}
									animate={{ opacity: 1, y: 0 }}
									transition={{ duration: 0.18 }}
									className="mt-1 text-[30px] md:text-[38px] font-normal text-[rgba(30,50,90,0.95)] tracking-tight leading-[1.1]"
								>
									{humanDuration(result.seconds)}
								</motion.div>
							</AnimatePresence>

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
											className="mt-4 w-full text-left rounded-2xl border border-[rgba(30,50,90,0.2)] bg-[rgba(30,50,90,0.04)] px-4 py-3 hover:bg-[rgba(30,50,90,0.07)] transition-colors group"
										>
											<div className="flex items-start gap-2.5">
												<TrendingUp className="w-4 h-4 mt-0.5 shrink-0 text-[rgba(30,50,90,0.7)]" />
												<div className="min-w-0">
													<div className="text-[13.5px] text-[rgba(30,50,90,0.95)] leading-snug">
														Add {fmtUsdc(hint.delta)} to get{" "}
														<span className="whitespace-nowrap">
															{Math.round(Number(hint.gain) / 2629800)} more months
														</span>
													</div>
													<div className="mt-0.5 text-[12px] text-[rgba(30,50,90,0.55)]">
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
									<dt className="text-[rgba(30,50,90,0.55)]">Gas allowance</dt>
									<dd className="text-[rgba(30,50,90,0.55)] text-right tabular-nums">
										−{fmtUsdc(ALLOWANCE)}
									</dd>
								</div>
								<div className="flex justify-between gap-4 pb-3 border-b border-[rgba(30,50,90,0.08)]">
									<dt className="text-[rgba(30,50,90,0.55)]">Reaches renewal</dt>
									<dd className="text-[rgba(30,50,90,0.95)] text-right tabular-nums">
										{fmtUsdc(applied)}
									</dd>
								</div>
								<div className="flex justify-between gap-4">
									<dt className="text-[rgba(30,50,90,0.55)]">Rate applied</dt>
									<dd className="text-[rgba(30,50,90,0.95)] text-right">
										{result.off ? `${result.tierYears}-year bulk` : "Standard"}
									</dd>
								</div>
								<div className="flex justify-between gap-4">
									<dt className="text-[rgba(30,50,90,0.55)]">Discount</dt>
									<dd
										className={`text-right ${result.off ? "text-[rgba(30,50,90,0.95)]" : "text-[rgba(30,50,90,0.4)]"}`}
									>
										{result.off ? `${result.off} off` : "None"}
									</dd>
								</div>
								<div className="flex justify-between gap-4">
									<dt className="text-[rgba(30,50,90,0.55)]">Effective cost</dt>
									<dd className="text-[rgba(30,50,90,0.95)] text-right tabular-nums">
										{years > 0.01
											? `${fmtUsdc(BigInt(Math.round(Number(budget) / years)))}/year`
											: "-"}
									</dd>
								</div>
								<div className="flex justify-between gap-4 pt-3 border-t border-[rgba(30,50,90,0.08)]">
									<dt className="text-[rgba(30,50,90,0.55)]">Exact seconds</dt>
									<dd className="text-[rgba(30,50,90,0.7)] text-right tabular-nums text-[13px]">
										{result.seconds.toLocaleString("en-US")}
									</dd>
								</div>
							</dl>

							{/* The ENS math here is exact; the amount reaching it is a dime
							    less. Say so, but keep it to one line. */}
							<div className="mt-6 flex items-center gap-1.5 text-[12px] text-[rgba(30,50,90,0.45)]">
								<span>Amounts include a {fmtUsdc(ALLOWANCE)} gas allowance.</span>
								<Tooltip
									label="What the gas allowance covers"
									text={`Namepass pays the network fees to move your USDC and submit the renewal on Ethereum. ${fmtUsdc(ALLOWANCE)} of each payment goes toward that, taken in the same transaction that renews, so what's shown as reaching the renewal is what the registry actually sees. It's the same on every chain, and it's a contribution rather than the full cost.`}
								/>
							</div>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}

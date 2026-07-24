import { motion, AnimatePresence } from "motion/react";
import { useMemo, useState } from "react";
import {
	oneYearCost,
	solve,
	thresholds,
	YEAR_SECONDS,
} from "../lib/pricing";
import { fmtUsdc } from "../lib/format";

const LENGTHS = [
	{ len: 3, label: "3 characters", example: "ens.eth" },
	{ len: 4, label: "4 characters", example: "base.eth" },
	{ len: 5, label: "5+ characters", example: "vitalik.eth" },
];

/** Slider maps 0–1 onto 0 → 1.6× the 6-year threshold, so every tier is reachable. */
function budgetFor(len: number, t: number): bigint {
	const max = thresholds(len)[2].cost * 8n / 5n;
	return (max * BigInt(Math.round(t * 10000))) / 10000n;
}

function tFor(len: number, budget: bigint): number {
	const max = thresholds(len)[2].cost * 8n / 5n;
	return Math.min(1, Number(budget) / Number(max));
}

function humanDuration(seconds: bigint): string {
	const totalDays = Number(seconds) / 86400;
	if (totalDays < 1) return "—";
	const years = Math.floor(totalDays / 365.25);
	const months = Math.floor((totalDays - years * 365.25) / 30.44);
	if (years === 0 && months === 0) return `${Math.floor(totalDays)} days`;
	if (years === 0) return `${months} month${months === 1 ? "" : "s"}`;
	if (months === 0) return `${years} year${years === 1 ? "" : "s"}`;
	return `${years}y ${months}mo`;
}

export default function Simulator() {
	const [len, setLen] = useState(5);
	const [t, setT] = useState(() => tFor(5, 27_000032n));

	const budget = useMemo(() => budgetFor(len, t), [len, t]);
	const result = useMemo(() => solve(budget, len), [budget, len]);
	const marks = useMemo(() => thresholds(len), [len]);
	const years = Number(result.seconds) / Number(YEAR_SECONDS);

	function jumpTo(cost: bigint) {
		setT(tFor(len, cost));
	}

	function switchLen(next: number) {
		/* Preserve relative position so the slider doesn't jump. */
		setLen(next);
		setT((prev) => prev);
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
						ENS charges by name length, and discounts longer renewals. Namepass
						always converts a payment into the longest duration it can buy.
					</p>
				</div>

				<div className="mt-10 bg-white rounded-[1.5rem] md:rounded-[2rem] border border-[rgba(30,50,90,0.08)] overflow-hidden">
					{/* length selector */}
					<div className="flex flex-col sm:flex-row border-b border-[rgba(30,50,90,0.08)]">
						{LENGTHS.map((l) => {
							const on = l.len === len;
							return (
								<button
									key={l.len}
									onClick={() => switchLen(l.len)}
									className={`flex-1 px-5 py-4 text-left transition-colors border-b sm:border-b-0 sm:border-r border-[rgba(30,50,90,0.08)] last:border-0 ${
										on
											? "bg-[rgba(30,50,90,0.05)]"
											: "hover:bg-[rgba(30,50,90,0.02)]"
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

					<div className="p-6 md:p-10 grid md:grid-cols-2 gap-10 md:gap-16 items-center">
						{/* left: input */}
						<div>
							<div className="text-[11px] uppercase tracking-wider text-[rgba(30,50,90,0.45)]">
								Payment received
							</div>
							<AnimatePresence mode="popLayout">
								<motion.div
									key={`${len}-${budget}`}
									initial={{ opacity: 0, y: 4 }}
									animate={{ opacity: 1, y: 0 }}
									transition={{ duration: 0.18 }}
									className="mt-1 text-[44px] md:text-[56px] font-normal text-[rgba(30,50,90,0.95)] tracking-tight leading-none tabular-nums"
								>
									{fmtUsdc(budget)}
								</motion.div>
							</AnimatePresence>

							<input
								type="range"
								min={0}
								max={1}
								step={0.001}
								value={t}
								onChange={(e) => setT(Number(e.target.value))}
								aria-label="Payment amount"
								className="mt-6 w-full accent-[rgba(30,50,90,0.9)]"
							/>

							<div className="mt-5 flex flex-wrap gap-2">
								{marks.map((m) => {
									const reached = budget >= m.cost;
									return (
										<button
											key={m.tier.years}
											onClick={() => jumpTo(m.cost)}
											className={`px-3 py-1.5 rounded-full text-[12.5px] border transition-colors ${
												reached
													? "border-[rgba(30,50,90,0.35)] text-[rgba(30,50,90,0.9)] bg-[rgba(30,50,90,0.05)]"
													: "border-[rgba(30,50,90,0.12)] text-[rgba(30,50,90,0.5)] hover:border-[rgba(30,50,90,0.3)]"
											}`}
										>
											{fmtUsdc(m.cost)} → {m.tier.years}y
										</button>
									);
								})}
							</div>
						</div>

						{/* right: result */}
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
									className="mt-1 text-[44px] md:text-[56px] font-normal text-[rgba(30,50,90,0.95)] tracking-tight leading-none"
								>
									{humanDuration(result.seconds)}
								</motion.div>
							</AnimatePresence>

							<dl className="mt-8 space-y-3 text-[14px]">
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
											: "—"}
									</dd>
								</div>
								<div className="flex justify-between gap-4 pt-3 border-t border-[rgba(30,50,90,0.08)]">
									<dt className="text-[rgba(30,50,90,0.55)]">Exact seconds</dt>
									<dd className="text-[rgba(30,50,90,0.7)] text-right tabular-nums text-[13px]">
										{result.seconds.toLocaleString("en-US")}
									</dd>
								</div>
							</dl>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}

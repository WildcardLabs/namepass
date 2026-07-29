import { motion, AnimatePresence } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, ChevronDown } from "lucide-react";
import { allNames, renewalCount, timeDelivered } from "../lib/registry";
import { fmtDelivered } from "../lib/format";
import NumberTicker from "./magicui/NumberTicker";
import DotPattern from "./magicui/DotPattern";
import ShineBorder from "./magicui/ShineBorder";
import AnimatedShinyText from "./magicui/AnimatedShinyText";
import NameAvatar from "./NameAvatar";
import PassCard from "./PassCard";

const PAGE_SIZE = 15;

type Mode = "renewals" | "time";

const OPTIONS: Array<{ key: Mode; label: string }> = [
	{ key: "renewals", label: "Renewals" },
	{ key: "time", label: "Time delivered" },
];

function Toggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
	return (
		<div className="inline-flex items-center gap-1 rounded-full bg-[rgba(30,50,90,0.05)] border border-[rgba(30,50,90,0.1)] p-1">
			{OPTIONS.map((o) => (
				<button
					key={o.key}
					onClick={() => onChange(o.key)}
					className="relative px-4 py-2 rounded-full text-[13.5px] transition-colors"
				>
					{mode === o.key && (
						<motion.span
							layoutId="leaderboard-toggle-pill"
							className="absolute inset-0"
							transition={{ type: "spring", stiffness: 420, damping: 32 }}
						>
							<ShineBorder borderRadius={999} borderWidth={2} duration={7} className="w-full h-full">
								<div className="w-full h-full rounded-full bg-white shadow-[0_2px_10px_-2px_rgba(30,50,90,0.3)]" />
							</ShineBorder>
						</motion.span>
					)}
					{mode === o.key ? (
						<AnimatedShinyText className="relative z-10 text-[13.5px]">
							{o.label}
						</AnimatedShinyText>
					) : (
						<span className="relative z-10 text-[rgba(30,50,90,0.5)]">{o.label}</span>
					)}
				</button>
			))}
		</div>
	);
}

function monthsDelivered(rec: Parameters<typeof timeDelivered>[0]): number {
	return timeDelivered(rec) * 12;
}

interface Props {
	onBack: () => void;
	/** Open this name on the home Explorer, so its activity can be read. */
	onViewName: (name: string) => void;
}

export default function Leaderboard({ onBack, onViewName }: Props) {
	const [mode, setMode] = useState<Mode>("renewals");
	const [expanded, setExpanded] = useState<string | null>(null);
	const [pageIndex, setPageIndex] = useState(0);

	const ranked = useMemo(() => {
		const metric = mode === "renewals" ? renewalCount : timeDelivered;
		return [...allNames()].sort((a, b) => metric(b) - metric(a));
	}, [mode]);

	const pageCount = Math.max(1, Math.ceil(ranked.length / PAGE_SIZE));
	const page = ranked.slice(pageIndex * PAGE_SIZE, pageIndex * PAGE_SIZE + PAGE_SIZE);

	useEffect(() => {
		setPageIndex(0);
	}, [mode]);

	return (
		<div className="relative w-full px-5 md:px-10 pt-4 pb-20 md:pb-28">
			<DotPattern
				className="text-[rgba(30,50,90,0.07)] h-[420px]"
				spacing={26}
				radius={1.1}
			/>

			<div className="relative max-w-[900px] mx-auto">
				<button
					onClick={onBack}
					className="flex items-center gap-2 text-[13px] text-[rgba(30,50,90,0.55)] hover:text-[rgba(30,50,90,0.9)] transition-colors"
				>
					<ArrowLeft className="w-4 h-4" />
					Back to Namepass
				</button>

				<div className="mt-8 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
					<div>
						<div className="flex items-center gap-2.5">
							<span className="relative flex w-2 h-2">
								<span className="absolute inline-flex w-full h-full rounded-full bg-[rgba(30,50,90,0.35)] animate-ping" />
								<span className="relative inline-flex w-2 h-2 rounded-full bg-[rgba(30,50,90,0.8)]" />
							</span>
							<span className="text-[11px] uppercase tracking-wider text-[rgba(30,50,90,0.5)]">
								Leaderboard · Live
							</span>
						</div>
						<h1 className="mt-3 text-[36px] md:text-[52px] font-normal text-[rgba(30,50,90,0.95)] tracking-tight leading-[1.05]">
							Ranked by impact.
						</h1>
						<p className="mt-3 text-[15px] md:text-[16px] text-[rgba(30,50,90,0.6)] max-w-xl leading-relaxed">
							Every Namepass, ranked by how much runway it's earned. Sort by total
							renewals or by years of registration delivered.
						</p>
					</div>
				</div>

				<div className="mt-8">
					<Toggle mode={mode} onChange={setMode} />
				</div>

				<div className="mt-6 border border-[rgba(30,50,90,0.1)] rounded-2xl overflow-hidden divide-y divide-[rgba(30,50,90,0.07)]">
					{page.map((r, i) => {
						const rank = pageIndex * PAGE_SIZE + i + 1;
						const isOpen = expanded === r.name;
						/* The ranked figure switches unit where the subtitle beneath it
						   does: days, then months, then years — so a 3-character name
						   measured in days doesn't rank as a flat zero. */
						const months = monthsDelivered(r);
						const unit = months < 1 ? "d" : months < 12 ? "mo" : "y";
						const timeValue =
							unit === "d" ? Math.round(months * 30.4) : unit === "mo" ? months : months / 12;
						const primary = mode === "renewals" ? renewalCount(r) : timeValue;
						const primaryDecimals = mode === "renewals" || unit !== "y" ? 0 : 1;
						const primarySuffix = mode === "renewals" ? "" : unit;

						return (
							<div key={r.name}>
								<button
									onClick={() => setExpanded(isOpen ? null : r.name)}
									className={`relative w-full flex items-center gap-3 md:gap-4 px-4 md:px-5 py-4 hover:bg-[rgba(30,50,90,0.02)] transition-colors text-left ${
										rank === 1 ? "bg-[rgba(30,50,90,0.035)]" : ""
									}`}
								>
									{rank === 1 && (
										<span className="absolute inset-y-0 left-0 w-[3px] bg-[rgba(30,50,90,0.9)]" />
									)}

									<NameAvatar
										name={r.name}
										className={`shrink-0 w-9 h-9 rounded-full bg-[rgba(30,50,90,0.05)] object-cover ${
											rank === 1
												? "border-2 border-[rgba(30,50,90,0.6)]"
												: "border border-[rgba(30,50,90,0.1)]"
										}`}
									/>

									<div className="min-w-0 flex-1">
										<div className="text-[15px] md:text-[14.5px] text-[rgba(30,50,90,0.95)] truncate">
											{r.name}
										</div>
										<div className="mt-0.5 text-[12.5px] text-[rgba(30,50,90,0.5)] tabular-nums">
											{renewalCount(r)} renewals · {fmtDelivered(timeDelivered(r))}{" "}
											delivered
										</div>
									</div>

									<div className="shrink-0 flex items-center gap-3">
										<div className="text-right">
											<NumberTicker
												value={primary}
												decimals={primaryDecimals}
												suffix={primarySuffix}
												className="block text-[17px] md:text-[19px] text-[rgba(30,50,90,0.95)] tracking-tight tabular-nums"
											/>
											<div className="text-[10px] uppercase tracking-wider text-[rgba(30,50,90,0.4)]">
												{mode === "renewals" ? "Renewals" : "Delivered"}
											</div>
										</div>
										<ChevronDown
											className={`w-4 h-4 text-[rgba(30,50,90,0.35)] transition-transform ${isOpen ? "rotate-180" : ""}`}
										/>
									</div>
								</button>

								<AnimatePresence initial={false}>
									{isOpen && (
										<motion.div
											initial={{ height: 0, opacity: 0 }}
											animate={{ height: "auto", opacity: 1 }}
											exit={{ height: 0, opacity: 0 }}
											transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
											className="overflow-hidden"
										>
											<div className="px-4 md:px-5 py-5 bg-[rgba(30,50,90,0.015)] border-t border-[rgba(30,50,90,0.06)]">
												<PassCard name={r.name} pass={r.pass} address={r.address} />
												{/* The address is here; the history isn't. Radius, border
												    and white surface match PassCard's own fields so this
												    reads as part of the card rather than sitting on the
												    grey panel behind it. */}
												<button
													onClick={() => onViewName(r.name)}
													className="mt-4 w-full flex items-center justify-center gap-2 rounded-[1.4rem] border border-[rgba(30,50,90,0.1)] bg-white py-3 text-[13.5px] text-[rgba(30,50,90,0.8)] hover:border-[rgba(30,50,90,0.25)] transition-colors"
												>
													View {r.name} activity
													<ArrowRight className="w-3.5 h-3.5" />
												</button>
											</div>
										</motion.div>
									)}
								</AnimatePresence>
							</div>
						);
					})}
				</div>

				{pageCount > 1 && (
					<div className="mt-6 flex items-center justify-between">
						<span className="text-[12.5px] text-[rgba(30,50,90,0.5)] tabular-nums">
							Page {pageIndex + 1} of {pageCount}
						</span>
						<div className="flex items-center gap-2">
							<button
								onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
								disabled={pageIndex === 0}
								className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[rgba(30,50,90,0.12)] text-[13px] text-[rgba(30,50,90,0.7)] hover:border-[rgba(30,50,90,0.3)] transition-colors disabled:opacity-35 disabled:pointer-events-none"
							>
								<ArrowLeft className="w-3.5 h-3.5" />
								Prev
							</button>
							<button
								onClick={() => setPageIndex((p) => Math.min(pageCount - 1, p + 1))}
								disabled={pageIndex >= pageCount - 1}
								className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[rgba(30,50,90,0.12)] text-[13px] text-[rgba(30,50,90,0.7)] hover:border-[rgba(30,50,90,0.3)] transition-colors disabled:opacity-35 disabled:pointer-events-none"
							>
								Next
								<ArrowRight className="w-3.5 h-3.5" />
							</button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

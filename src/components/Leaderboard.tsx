import { motion, AnimatePresence } from "motion/react";
import { useEffect, useMemo, useReducer, useState } from "react";
import { ArrowLeft, ArrowRight, ChevronDown, ExternalLink, Loader2 } from "lucide-react";
import { leaderboardNames, renewalCount, renewalEvent, syncLeaderboard, timeDelivered, type ActivityEvent, type NameRecord } from "../lib/readModel";
import { getLeaderboard, getNameActivity } from "../lib/publicApi";
import { explorerUrl, fmtDate, fmtDelivered, fmtDuration, fmtUsdc, fmtYears, truncTx } from "../lib/format";
import DotPattern from "./magicui/DotPattern";
import ShineBorder from "./magicui/ShineBorder";
import AnimatedShinyText from "./magicui/AnimatedShinyText";
import NameAvatar from "./NameAvatar";
import ChainTag from "./ChainTag";

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

function compareBigints(a: bigint, b: bigint): number {
	return a === b ? 0 : a > b ? -1 : 1;
}

interface Props {
	onBack: () => void;
	/** Open the full name profile on the home Explorer. */
	onViewName: (name: string) => void;
}

type RecentTransactions = {
	loading: boolean;
	error: string | null;
	events: ActivityEvent[];
};

function LatestTransactions({ state }: { state: RecentTransactions | undefined }) {
	if (!state || state.loading) {
		return (
			<div className="flex items-center gap-2 py-5 text-[13px] text-[rgba(30,50,90,0.55)]">
				<Loader2 className="w-4 h-4 animate-spin" />
				Loading latest transactions
			</div>
		);
	}
	if (state.error) {
		return <p role="alert" className="py-4 text-[13px] text-red-700">{state.error}</p>;
	}
	if (state.events.length === 0) {
		return <p className="py-4 text-[13px] text-[rgba(30,50,90,0.55)]">No completed renewal transactions yet.</p>;
	}
	return (
		<ol className="divide-y divide-[rgba(30,50,90,0.07)]">
			{state.events.map((event) => {
				const renewal = [...event.steps].reverse().find((step) => step.kind === "renewal");
				return (
					<li key={event.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 py-3.5 first:pt-2">
						<div className="min-w-0">
							<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
								<ChainTag chain={event.chain} />
								<span className="text-[rgba(30,50,90,0.45)] tabular-nums">{fmtDate(event.at)}</span>
							</div>
							{renewal && (
								<a
									href={explorerUrl(renewal.chain, renewal.tx)}
									target="_blank"
									rel="noopener noreferrer"
									className="mt-1.5 inline-flex items-center gap-1.5 font-mono text-[11.5px] text-[rgba(30,50,90,0.5)] hover:text-[rgba(30,50,90,0.9)] transition-colors"
								>
									{truncTx(renewal.tx)}
									<ExternalLink className="w-2.5 h-2.5" />
								</a>
							)}
						</div>
						<div className="text-right tabular-nums">
							<div className="text-[14px] text-[rgba(30,50,90,0.9)]">{fmtUsdc(event.amountDeposited)}</div>
							<div className="mt-0.5 text-[11.5px] text-[rgba(30,50,90,0.48)]">{fmtDuration(event.seconds)}</div>
						</div>
					</li>
				);
			})}
		</ol>
	);
}

export default function Leaderboard({ onBack, onViewName }: Props) {
	const [mode, setMode] = useState<Mode>("renewals");
	const [expanded, setExpanded] = useState<string | null>(null);
	const [pageIndex, setPageIndex] = useState(0);
	const [version, refresh] = useReducer((value: number) => value + 1, 0);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [loaded, setLoaded] = useState(false);
	const [recent, setRecent] = useState<Record<string, RecentTransactions>>({});

	const ranked = useMemo(() => {
		const metric = mode === "renewals" ? renewalCount : timeDelivered;
		return [...leaderboardNames()].sort((a, b) => compareBigints(metric(a), metric(b)));
	}, [mode, version]);

	useEffect(() => {
		let stopped = false;
		let timer = 0;
		let failures = 0;
		let loading = false;
		const schedule = (delay: number) => {
			window.clearTimeout(timer);
			timer = window.setTimeout(() => void load(), delay);
		};
		const load = async () => {
			if (stopped || loading) return;
			loading = true;
			try {
				syncLeaderboard(await getLeaderboard());
				failures = 0;
				setLoadError(null);
				refresh();
			} catch (cause) {
				failures += 1;
				setLoadError(cause instanceof Error ? cause.message : "Could not load the leaderboard.");
			} finally {
				loading = false;
				setLoaded(true);
				if (!stopped) schedule(Math.min(15_000 * 2 ** failures, 60_000));
			}
		};
		const focus = () => {
			window.clearTimeout(timer);
			void load();
		};
		void load();
		window.addEventListener("focus", focus);
		return () => {
			stopped = true;
			window.clearTimeout(timer);
			window.removeEventListener("focus", focus);
		};
	}, []);

	const pageCount = Math.max(1, Math.ceil(ranked.length / PAGE_SIZE));
	const page = ranked.slice(pageIndex * PAGE_SIZE, pageIndex * PAGE_SIZE + PAGE_SIZE);

	useEffect(() => {
		setPageIndex(0);
		setExpanded(null);
	}, [mode]);

	useEffect(() => {
		setPageIndex((current) => Math.min(current, pageCount - 1));
	}, [pageCount]);

	const loadRecent = async (record: NameRecord) => {
		setRecent((current) => ({
			...current,
			[record.name]: {
				loading: true,
				error: null,
				events: current[record.name]?.events ?? [],
			},
		}));
		try {
			const activity = await getNameActivity(record.name, undefined, 3);
			const events = activity.renewals
				.map((renewal) => renewalEvent(renewal, activity.name.label))
				.sort((a, b) => b.at - a.at);
			setRecent((current) => ({
				...current,
				[record.name]: { loading: false, error: null, events },
			}));
		} catch (cause) {
			setRecent((current) => ({
				...current,
				[record.name]: {
					loading: false,
					error: cause instanceof Error ? cause.message : "Could not load recent transactions.",
					events: current[record.name]?.events ?? [],
				},
			}));
		}
	};

	const toggleRow = (record: NameRecord) => {
		if (expanded === record.name) {
			setExpanded(null);
			return;
		}
		setExpanded(record.name);
		void loadRecent(record);
	};

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
							Names with completed renewals, ranked by how much runway they earned.
							Sort by total renewals or by years of registration delivered.
						</p>
					</div>
				</div>

				<div className="mt-8">
					<Toggle mode={mode} onChange={setMode} />
				</div>

				<div className="mt-6 border border-[rgba(30,50,90,0.1)] rounded-2xl overflow-hidden divide-y divide-[rgba(30,50,90,0.07)]">
					{loaded && !loadError && page.length === 0 && (
						<p role="status" className="px-5 py-10 text-center text-[13px] text-[rgba(30,50,90,0.55)]">
							No completed renewals yet.
						</p>
					)}
					{page.map((r, i) => {
						const rank = pageIndex * PAGE_SIZE + i + 1;
						const isOpen = expanded === r.name;
						/* The ranked figure switches unit where the subtitle beneath it
						   does: days, then months, then years — so a 3-character name
						   measured in days doesn't rank as a flat zero. */
						const primary = mode === "renewals"
							? renewalCount(r).toString()
							: `${fmtYears(timeDelivered(r))}y`;

						return (
							<div key={r.name}>
								<button
									onClick={() => toggleRow(r)}
									aria-expanded={isOpen}
									className={`relative w-full flex items-center gap-3 md:gap-4 px-4 md:px-5 py-4 hover:bg-[rgba(30,50,90,0.02)] transition-colors text-left ${
										rank === 1 ? "bg-[rgba(30,50,90,0.035)]" : ""
									}`}
								>
									{rank === 1 && (
										<span className="absolute inset-y-0 left-0 w-[3px] bg-[rgba(30,50,90,0.9)]" />
									)}

									<NameAvatar
										name={r.name}
										className={`shrink-0 w-9 h-9 rounded-[10px] bg-[rgba(30,50,90,0.05)] object-cover ${
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
											{renewalCount(r).toString()} renewals · {fmtDelivered(timeDelivered(r))}{" "}
											delivered
										</div>
									</div>

									<div className="shrink-0 flex items-center gap-3">
										<div className="text-right">
											<span className="block text-[17px] md:text-[19px] text-[rgba(30,50,90,0.95)] tracking-tight tabular-nums">
												{primary}
											</span>
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
												<div className="text-[10px] uppercase tracking-wider text-[rgba(30,50,90,0.45)]">
													Latest transactions
												</div>
												<LatestTransactions state={recent[r.name]} />
												<button
													onClick={() => onViewName(r.name)}
													className="mt-3 w-full flex items-center justify-center gap-2 rounded-[1.4rem] border border-[rgba(30,50,90,0.1)] bg-white py-3 text-[13.5px] text-[rgba(30,50,90,0.8)] hover:border-[rgba(30,50,90,0.25)] transition-colors"
												>
													View {r.name} profile
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
				{loadError && <p role="alert" className="mt-3 text-[12.5px] text-red-700">{loadError}</p>}

				{pageCount > 1 && (
					<div className="mt-6 flex items-center justify-between">
						<span className="text-[12.5px] text-[rgba(30,50,90,0.5)] tabular-nums">
							Page {pageIndex + 1} of {pageCount}
						</span>
						<div className="flex items-center gap-2">
							<button
								onClick={() => {
									setExpanded(null);
									setPageIndex((p) => Math.max(0, p - 1));
								}}
								disabled={pageIndex === 0}
								className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[rgba(30,50,90,0.12)] text-[13px] text-[rgba(30,50,90,0.7)] hover:border-[rgba(30,50,90,0.3)] transition-colors disabled:opacity-35 disabled:pointer-events-none"
							>
								<ArrowLeft className="w-3.5 h-3.5" />
								Prev
							</button>
							<button
								onClick={() => {
									setExpanded(null);
									setPageIndex((p) => Math.min(pageCount - 1, p + 1));
								}}
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

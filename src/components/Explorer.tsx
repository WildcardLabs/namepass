import { motion, AnimatePresence } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Search, ArrowLeft, Check, Copy, ArrowUpRight } from "lucide-react";
import {
	allNames,
	currentExpiry,
	findName,
	recentActivity,
	simulateRenewal,
	totalFunded,
	totalYears,
	type ActivityEvent,
	type NameRecord,
} from "../lib/registry";
import {
	fmtAgo,
	fmtDate,
	fmtDuration,
	fmtUsdc,
	truncAddress,
} from "../lib/format";

const CHAIN_DOT: Record<string, string> = {
	Base: "#0052FF",
	Arbitrum: "#12AAFF",
	Optimism: "#FF0420",
	Ethereum: "#627EEA",
	Polygon: "#8247E5",
};

function ChainTag({ chain }: { chain: string }) {
	return (
		<span className="inline-flex items-center gap-1.5 text-[rgba(30,50,90,0.6)]">
			<span
				className="w-1.5 h-1.5 rounded-full shrink-0"
				style={{ background: CHAIN_DOT[chain] ?? "#8899aa" }}
			/>
			{chain}
		</span>
	);
}

/* ------------------------------------------------------------------ */
/* Live feed                                                           */
/* ------------------------------------------------------------------ */

function LiveFeed({ onSelect }: { onSelect: (n: string) => void }) {
	const [rows, setRows] = useState<Array<ActivityEvent & { name: string }>>(
		() => recentActivity(12),
	);

	useEffect(() => {
		const id = setInterval(() => {
			const ev = simulateRenewal();
			setRows((prev) => [ev, ...prev].slice(0, 12));
		}, 4200);
		return () => clearInterval(id);
	}, []);

	return (
		<div className="divide-y divide-[rgba(30,50,90,0.07)]">
			<AnimatePresence initial={false}>
				{rows.map((r) => (
					<motion.button
						key={r.id}
						layout
						initial={{ opacity: 0, y: -8 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
						onClick={() => onSelect(r.name)}
						className="w-full text-left py-3.5 grid grid-cols-[1fr_auto] md:grid-cols-[minmax(0,1.4fr)_1fr_1fr_auto] gap-x-4 gap-y-1 items-baseline hover:bg-[rgba(30,50,90,0.02)] transition-colors group"
					>
						<span className="text-[15px] text-[rgba(30,50,90,0.95)] truncate group-hover:text-[rgba(30,50,90,1)]">
							{r.name}
						</span>

						<span className="hidden md:block text-[13px]">
							<ChainTag chain={r.chain} />
						</span>

						<span className="hidden md:flex items-baseline gap-2 text-[13px] text-[rgba(30,50,90,0.6)]">
							{fmtUsdc(r.amount)}
							{r.off && (
								<span className="text-[11px] text-[rgba(30,50,90,0.4)]">
									{r.off}
								</span>
							)}
						</span>

						<span className="text-right text-[14px] text-[rgba(30,50,90,0.9)] tabular-nums">
							{fmtDuration(r.seconds)}
							<span className="block md:inline md:ml-3 text-[11px] text-[rgba(30,50,90,0.4)]">
								{fmtAgo(r.at)}
							</span>
						</span>

						<span className="md:hidden text-[12px] text-[rgba(30,50,90,0.5)] col-span-2 flex items-center gap-3">
							<ChainTag chain={r.chain} />
							<span>{fmtUsdc(r.amount)}</span>
							{r.off && <span className="opacity-70">{r.off}</span>}
						</span>
					</motion.button>
				))}
			</AnimatePresence>
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* Name detail                                                         */
/* ------------------------------------------------------------------ */

function NameDetail({
	record,
	onBack,
}: {
	record: NameRecord;
	onBack: () => void;
}) {
	const [copied, setCopied] = useState<string | null>(null);
	const events = [...record.events].reverse();

	function copy(text: string, key: string) {
		const done = () => {
			setCopied(key);
			setTimeout(() => setCopied(null), 1600);
		};
		if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, done);
		else done();
	}

	return (
		<motion.div
			initial={{ opacity: 0, y: 12 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
		>
			<button
				onClick={onBack}
				className="flex items-center gap-2 text-[13px] text-[rgba(30,50,90,0.55)] hover:text-[rgba(30,50,90,0.9)] transition-colors"
			>
				<ArrowLeft className="w-4 h-4" />
				All activity
			</button>

			<div className="mt-6 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
				<div>
					<h3 className="text-[32px] md:text-[44px] font-normal text-[rgba(30,50,90,0.95)] tracking-tight leading-none">
						{record.name}
					</h3>
					<button
						onClick={() => copy(record.pass, "pass")}
						className="mt-2 flex items-center gap-2 text-[14px] text-[rgba(30,50,90,0.55)] hover:text-[rgba(30,50,90,0.85)] transition-colors group"
					>
						{record.pass}
						{copied === "pass" ? (
							<Check className="w-3.5 h-3.5" />
						) : (
							<Copy className="w-3.5 h-3.5 opacity-40 group-hover:opacity-100 transition-opacity" />
						)}
					</button>
				</div>

				<button
					onClick={() => copy(record.address, "addr")}
					className="self-start md:self-auto flex items-center gap-2 text-[13px] text-[rgba(30,50,90,0.55)] hover:text-[rgba(30,50,90,0.85)] bg-[rgba(30,50,90,0.04)] border border-[rgba(30,50,90,0.1)] rounded-full px-4 py-2 transition-colors"
				>
					{truncAddress(record.address)}
					{copied === "addr" ? (
						<Check className="w-3.5 h-3.5" />
					) : (
						<Copy className="w-3.5 h-3.5 opacity-50" />
					)}
				</button>
			</div>

			<div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-px bg-[rgba(30,50,90,0.08)] border border-[rgba(30,50,90,0.08)] rounded-2xl overflow-hidden">
				{[
					{ k: "Renewed until", v: fmtDate(currentExpiry(record)) },
					{ k: "Time dispensed", v: `${totalYears(record).toFixed(1)}y` },
					{ k: "Total funded", v: `$${totalFunded(record).toFixed(0)}` },
					{ k: "Activated", v: fmtDate(record.activatedAt) },
				].map((s) => (
					<div key={s.k} className="bg-white px-4 py-4">
						<div className="text-[10px] uppercase tracking-wider text-[rgba(30,50,90,0.45)]">
							{s.k}
						</div>
						<div className="mt-1.5 text-[18px] md:text-[20px] text-[rgba(30,50,90,0.95)] tracking-tight">
							{s.v}
						</div>
					</div>
				))}
			</div>

			<div className="mt-10">
				<div className="text-[11px] uppercase tracking-wider text-[rgba(30,50,90,0.45)]">
					Activity
				</div>

				<div className="mt-4 relative">
					{/* timeline rule */}
					<div className="absolute left-[5px] top-2 bottom-2 w-px bg-[rgba(30,50,90,0.1)]" />

					{events.map((e) => (
						<div key={e.id} className="relative pl-7 py-3.5">
							<span
								className={`absolute left-0 top-[19px] w-[11px] h-[11px] rounded-full border-2 border-white ${
									e.kind === "activated"
										? "bg-[rgba(30,50,90,0.85)]"
										: "bg-[rgba(30,50,90,0.3)]"
								}`}
							/>

							<div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
								<div className="flex items-baseline gap-3 min-w-0">
									<span className="text-[15px] text-[rgba(30,50,90,0.95)]">
										{e.kind === "activated"
											? "Namepass activated"
											: `Renewal from ${e.funder}`}
									</span>
									{e.kind === "renewal" && (
										<span className="text-[13px]">
											<ChainTag chain={e.chain} />
										</span>
									)}
								</div>

								<div className="flex items-baseline gap-4 shrink-0">
									{e.kind === "renewal" && (
										<>
											<span className="text-[13px] text-[rgba(30,50,90,0.6)]">
												{fmtUsdc(e.amount)}
												{e.off && (
													<span className="ml-2 text-[11px] text-[rgba(30,50,90,0.4)]">
														{e.off}
													</span>
												)}
											</span>
											<span className="text-[15px] text-[rgba(30,50,90,0.95)] tabular-nums">
												{fmtDuration(e.seconds)}
											</span>
										</>
									)}
									<span className="text-[12px] text-[rgba(30,50,90,0.4)] tabular-nums w-[74px] text-right">
										{fmtDate(e.at)}
									</span>
								</div>
							</div>

							<div className="mt-1 text-[12px] text-[rgba(30,50,90,0.45)]">
								{e.kind === "activated"
									? `Expiring ${fmtDate(e.expiryAfter)}`
									: `Now expires ${fmtDate(e.expiryAfter)}`}
							</div>
						</div>
					))}
				</div>
			</div>
		</motion.div>
	);
}

/* ------------------------------------------------------------------ */
/* Explorer                                                            */
/* ------------------------------------------------------------------ */

interface Props {
	selected: string | null;
	onSelect: (name: string | null) => void;
}

export default function Explorer({ selected, onSelect }: Props) {
	const [query, setQuery] = useState("");
	const [notFound, setNotFound] = useState(false);

	const record = useMemo(
		() => (selected ? findName(selected) : undefined),
		[selected],
	);

	const suggestions = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return [];
		return allNames()
			.filter((r) => r.name.includes(q))
			.slice(0, 5);
	}, [query]);

	function submit() {
		const hit = findName(query);
		if (hit) {
			onSelect(hit.name);
			setQuery("");
			setNotFound(false);
		} else {
			setNotFound(true);
		}
	}

	return (
		<section id="explorer" className="bg-white px-5 md:px-10 py-20 md:py-28">
			<div className="max-w-[1100px] mx-auto">
				<div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
					<div>
						<div className="flex items-center gap-2.5">
							<span className="relative flex w-2 h-2">
								<span className="absolute inline-flex w-full h-full rounded-full bg-[rgba(30,50,90,0.4)] animate-ping" />
								<span className="relative inline-flex w-2 h-2 rounded-full bg-[rgba(30,50,90,0.8)]" />
							</span>
							<span className="text-[11px] uppercase tracking-wider text-[rgba(30,50,90,0.5)]">
								Explorer · Live
							</span>
						</div>
						<h2 className="mt-3 text-[36px] md:text-[52px] font-normal text-[rgba(30,50,90,0.95)] tracking-tight leading-[1.05]">
							Every name, every renewal.
						</h2>
						<p className="mt-3 text-[15px] md:text-[16px] text-[rgba(30,50,90,0.6)] max-w-xl leading-relaxed">
							Namepass activity is public by default. Watch names being extended in
							real time, or look up any name to see its full history.
						</p>
					</div>

					<div className="w-full md:w-[300px] shrink-0">
						<div className="flex items-center bg-[rgba(30,50,90,0.04)] border border-[rgba(30,50,90,0.1)] rounded-full pl-4 pr-2 py-2 focus-within:border-[rgba(30,50,90,0.3)] transition-colors">
							<Search className="w-4 h-4 text-[rgba(30,50,90,0.4)] shrink-0" />
							<input
								value={query}
								onChange={(e) => {
									setQuery(e.target.value);
									setNotFound(false);
								}}
								onKeyDown={(e) => e.key === "Enter" && submit()}
								placeholder="Search a name…"
								className="flex-1 min-w-0 bg-transparent outline-none px-3 text-[14px] text-[rgba(30,50,90,0.95)] placeholder:text-[rgba(30,50,90,0.35)]"
							/>
						</div>

						{suggestions.length > 0 && (
							<div className="mt-2 border border-[rgba(30,50,90,0.1)] rounded-2xl overflow-hidden">
								{suggestions.map((s) => (
									<button
										key={s.name}
										onClick={() => {
											onSelect(s.name);
											setQuery("");
										}}
										className="w-full text-left px-4 py-2.5 text-[14px] text-[rgba(30,50,90,0.85)] hover:bg-[rgba(30,50,90,0.04)] transition-colors flex items-center justify-between gap-3"
									>
										{s.name}
										<ArrowUpRight className="w-3.5 h-3.5 opacity-40" />
									</button>
								))}
							</div>
						)}

						{notFound && (
							<p className="mt-2 text-[13px] text-[rgba(30,50,90,0.5)] px-1">
								No Namepass found for that name.
							</p>
						)}
					</div>
				</div>

				<div className="mt-12 md:mt-16">
					{record ? (
						<NameDetail record={record} onBack={() => onSelect(null)} />
					) : (
						<>
							<div className="hidden md:grid grid-cols-[minmax(0,1.4fr)_1fr_1fr_auto] gap-x-4 pb-3 border-b border-[rgba(30,50,90,0.12)] text-[10px] uppercase tracking-wider text-[rgba(30,50,90,0.45)]">
								<span>Name</span>
								<span>Chain</span>
								<span>Amount</span>
								<span className="text-right">Time added</span>
							</div>
							<LiveFeed onSelect={(n) => onSelect(n)} />
						</>
					)}
				</div>
			</div>
		</section>
	);
}

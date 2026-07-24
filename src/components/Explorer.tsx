import { motion, AnimatePresence } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Search, ArrowLeft, Clock } from "lucide-react";
import {
	allNames,
	findName,
	nameExpiry,
	recentActivity,
	renewalCount,
	simulateRenewal,
	timeDelivered,
	totalReceived,
	type ActivityEvent,
	type NameRecord,
} from "../lib/registry";
import { fmtAgo, fmtDate, fmtDuration, fmtUsdc } from "../lib/format";
import PassCard from "./PassCard";

const CHAIN_DOT: Record<string, string> = {
	Base: "#0052FF",
	Arbitrum: "#12AAFF",
	Optimism: "#FF0420",
	Ethereum: "#627EEA",
	Polygon: "#8247E5",
};

function ChainTag({ chain }: { chain: string }) {
	return (
		<span className="inline-flex items-center gap-1.5 text-[rgba(30,50,90,0.7)] whitespace-nowrap">
			<span
				className="w-1.5 h-1.5 rounded-full shrink-0"
				style={{ background: CHAIN_DOT[chain] ?? "#8899aa" }}
			/>
			{chain}
		</span>
	);
}

function DiscountTag({ off }: { off: string }) {
	if (!off) {
		return <span className="text-[rgba(30,50,90,0.35)]">—</span>;
	}
	return (
		<span className="inline-flex items-center rounded-md bg-[rgba(30,50,90,0.06)] border border-[rgba(30,50,90,0.1)] px-2 py-0.5 text-[12px] text-[rgba(30,50,90,0.8)] whitespace-nowrap">
			{off} off
		</span>
	);
}

/* ------------------------------------------------------------------ */
/* Live feed — Etherscan-style table                                   */
/* ------------------------------------------------------------------ */

function LiveFeed({ onSelect }: { onSelect: (n: string) => void }) {
	const [rows, setRows] = useState<Array<ActivityEvent & { name: string }>>(() =>
		recentActivity(14),
	);

	useEffect(() => {
		const id = setInterval(() => {
			const ev = simulateRenewal();
			setRows((prev) => [ev, ...prev].slice(0, 14));
		}, 4200);
		return () => clearInterval(id);
	}, []);

	return (
		<div className="border border-[rgba(30,50,90,0.1)] rounded-2xl overflow-hidden">
			<div className="hidden md:grid grid-cols-[1.3fr_0.9fr_0.8fr_0.9fr_0.9fr_0.8fr] gap-4 px-5 py-3 bg-[rgba(30,50,90,0.03)] border-b border-[rgba(30,50,90,0.1)] text-[11px] uppercase tracking-wider text-[rgba(30,50,90,0.5)]">
				<span>ENS name</span>
				<span>Chain</span>
				<span className="text-right">Received</span>
				<span className="text-center">Discount</span>
				<span className="text-right">Time added</span>
				<span className="text-right">Age</span>
			</div>

			<div className="divide-y divide-[rgba(30,50,90,0.07)]">
				<AnimatePresence initial={false}>
					{rows.map((r) => (
						<motion.button
							key={r.id}
							layout
							initial={{ opacity: 0, backgroundColor: "rgba(30,50,90,0.05)" }}
							animate={{ opacity: 1, backgroundColor: "rgba(30,50,90,0)" }}
							transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
							onClick={() => onSelect(r.name)}
							className="w-full text-left px-5 py-3.5 grid grid-cols-2 md:grid-cols-[1.3fr_0.9fr_0.8fr_0.9fr_0.9fr_0.8fr] gap-x-4 gap-y-1.5 items-center hover:bg-[rgba(30,50,90,0.025)] transition-colors"
						>
							<span className="text-[14.5px] text-[rgba(30,50,90,0.95)] truncate">
								{r.name}
							</span>

							<span className="hidden md:block text-[13.5px]">
								<ChainTag chain={r.chain} />
							</span>

							<span className="hidden md:block text-[13.5px] text-[rgba(30,50,90,0.75)] text-right tabular-nums">
								{fmtUsdc(r.amount)}
							</span>

							<span className="hidden md:flex justify-center text-[13px]">
								<DiscountTag off={r.off} />
							</span>

							<span className="text-[14px] text-[rgba(30,50,90,0.95)] text-right tabular-nums">
								{fmtDuration(r.seconds)}
							</span>

							<span className="hidden md:block text-[12.5px] text-[rgba(30,50,90,0.45)] text-right tabular-nums">
								{fmtAgo(r.at)}
							</span>

							{/* mobile secondary row */}
							<span className="md:hidden col-span-2 flex items-center gap-3 text-[12.5px] text-[rgba(30,50,90,0.5)]">
								<ChainTag chain={r.chain} />
								<span className="tabular-nums">{fmtUsdc(r.amount)}</span>
								{r.off && <DiscountTag off={r.off} />}
								<span className="ml-auto">{fmtAgo(r.at)}</span>
							</span>
						</motion.button>
					))}
				</AnimatePresence>
			</div>
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* Name detail                                                         */
/* ------------------------------------------------------------------ */

function NameDetail({ record, onBack }: { record: NameRecord; onBack: () => void }) {
	const events = [...record.events].reverse();
	const expiry = nameExpiry(record);
	const daysLeft = Math.round((expiry - Date.now()) / 86_400_000);

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

			<h3 className="mt-6 text-[32px] md:text-[44px] font-normal text-[rgba(30,50,90,0.95)] tracking-tight leading-none">
				{record.name}
			</h3>

			{/* The two-panel model: what expires vs. what is permanent */}
			<div className="mt-8 grid md:grid-cols-2 gap-4">
				<div className="rounded-2xl border border-[rgba(30,50,90,0.12)] bg-white p-5">
					<div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-[rgba(30,50,90,0.5)]">
						<Clock className="w-3.5 h-3.5" />
						The ENS name · expires
					</div>
					<div className="mt-3 text-[26px] md:text-[30px] text-[rgba(30,50,90,0.95)] tracking-tight leading-none">
						{fmtDate(expiry)}
					</div>
					<div className="mt-2 text-[13px] text-[rgba(30,50,90,0.55)]">
						{daysLeft > 0
							? `${daysLeft.toLocaleString("en-US")} days of registration remaining`
							: "Expired — needs renewal"}
					</div>
					<div className="mt-4 pt-4 border-t border-[rgba(30,50,90,0.08)] flex justify-between text-[13px]">
						<span className="text-[rgba(30,50,90,0.55)]">
							Expiry when Namepass was activated
						</span>
						<span className="text-[rgba(30,50,90,0.8)]">
							{fmtDate(record.expiryAtActivation)}
						</span>
					</div>
				</div>

				<PassCard
					name={record.name}
					pass={record.pass}
					address={record.address}
				/>
			</div>

			{/* Aggregates */}
			<div className="mt-4 grid grid-cols-3 gap-px bg-[rgba(30,50,90,0.1)] border border-[rgba(30,50,90,0.1)] rounded-2xl overflow-hidden">
				{[
					{ k: "Time delivered", v: `${timeDelivered(record).toFixed(1)} years` },
					{ k: "Total received", v: fmtUsdc(BigInt(Math.round(totalReceived(record) * 1e6))) },
					{ k: "Renewals", v: String(renewalCount(record)) },
				].map((s) => (
					<div key={s.k} className="bg-white px-4 py-4">
						<div className="text-[10px] uppercase tracking-wider text-[rgba(30,50,90,0.45)]">
							{s.k}
						</div>
						<div className="mt-1.5 text-[19px] text-[rgba(30,50,90,0.95)] tracking-tight tabular-nums">
							{s.v}
						</div>
					</div>
				))}
			</div>

			{/* Activity table */}
			<div className="mt-10">
				<div className="text-[11px] uppercase tracking-wider text-[rgba(30,50,90,0.5)] mb-4">
					Activity
				</div>

				<div className="border border-[rgba(30,50,90,0.1)] rounded-2xl overflow-hidden">
					<div className="hidden md:grid grid-cols-[0.8fr_1fr_0.8fr_0.7fr_0.8fr_0.8fr_1fr] gap-4 px-5 py-3 bg-[rgba(30,50,90,0.03)] border-b border-[rgba(30,50,90,0.1)] text-[11px] uppercase tracking-wider text-[rgba(30,50,90,0.5)]">
						<span>Date</span>
						<span>Event</span>
						<span>Chain</span>
						<span className="text-right">Amount</span>
						<span className="text-center">Discount</span>
						<span className="text-right">Time added</span>
						<span className="text-right">Name expires</span>
					</div>

					<div className="divide-y divide-[rgba(30,50,90,0.07)]">
						{events.map((e) => (
							<div
								key={e.id}
								className="px-5 py-3.5 grid grid-cols-2 md:grid-cols-[0.8fr_1fr_0.8fr_0.7fr_0.8fr_0.8fr_1fr] gap-x-4 gap-y-1.5 items-center"
							>
								<span className="text-[13px] text-[rgba(30,50,90,0.6)] tabular-nums">
									{fmtDate(e.at)}
								</span>

								<span className="text-[14px] text-[rgba(30,50,90,0.95)] truncate">
									{e.kind === "activated"
										? "Namepass activated"
										: `Renewal · ${e.funder}`}
								</span>

								<span className="hidden md:block text-[13.5px]">
									{e.kind === "renewal" ? (
										<ChainTag chain={e.chain} />
									) : (
										<span className="text-[rgba(30,50,90,0.35)]">—</span>
									)}
								</span>

								<span className="hidden md:block text-[13.5px] text-[rgba(30,50,90,0.75)] text-right tabular-nums">
									{e.kind === "renewal" ? fmtUsdc(e.amount) : "—"}
								</span>

								<span className="hidden md:flex justify-center">
									{e.kind === "renewal" ? (
										<DiscountTag off={e.off} />
									) : (
										<span className="text-[rgba(30,50,90,0.35)]">—</span>
									)}
								</span>

								<span className="text-[14px] text-[rgba(30,50,90,0.95)] text-right tabular-nums">
									{e.kind === "renewal" ? fmtDuration(e.seconds) : "—"}
								</span>

								<span className="hidden md:block text-[13px] text-[rgba(30,50,90,0.7)] text-right tabular-nums">
									{fmtDate(e.nameExpiryAfter)}
								</span>

								{/* mobile secondary */}
								<span className="md:hidden col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-[rgba(30,50,90,0.5)]">
									{e.kind === "renewal" && (
										<>
											<ChainTag chain={e.chain} />
											<span className="tabular-nums">{fmtUsdc(e.amount)}</span>
											{e.off && <DiscountTag off={e.off} />}
										</>
									)}
									<span className="ml-auto">
										expires {fmtDate(e.nameExpiryAfter)}
									</span>
								</span>
							</div>
						))}
					</div>
				</div>
			</div>
		</motion.div>
	);
}

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
			.slice(0, 6);
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
								<span className="absolute inline-flex w-full h-full rounded-full bg-[rgba(30,50,90,0.35)] animate-ping" />
								<span className="relative inline-flex w-2 h-2 rounded-full bg-[rgba(30,50,90,0.8)]" />
							</span>
							<span className="text-[11px] uppercase tracking-wider text-[rgba(30,50,90,0.5)]">
								Explorer · Live
							</span>
						</div>
						<h2 className="mt-3 text-[36px] md:text-[52px] font-normal text-[rgba(30,50,90,0.95)] tracking-tight leading-[1.05]">
							Every renewal, on the record.
						</h2>
						<p className="mt-3 text-[15px] md:text-[16px] text-[rgba(30,50,90,0.6)] max-w-xl leading-relaxed">
							Namepass activity is public. Watch payments arrive and extend names in
							real time, or look up any name to see its full history.
						</p>
					</div>

					<div className="w-full md:w-[300px] shrink-0">
						<div className="flex items-center bg-white border border-[rgba(30,50,90,0.15)] rounded-full pl-4 pr-2 py-2 focus-within:border-[rgba(30,50,90,0.4)] transition-colors">
							<Search className="w-4 h-4 text-[rgba(30,50,90,0.4)] shrink-0" />
							<input
								value={query}
								onChange={(e) => {
									setQuery(e.target.value);
									setNotFound(false);
								}}
								onKeyDown={(e) => e.key === "Enter" && submit()}
								placeholder="Search an ENS name…"
								className="flex-1 min-w-0 bg-transparent outline-none px-3 text-[14px] text-[rgba(30,50,90,0.95)] placeholder:text-[rgba(30,50,90,0.35)]"
							/>
						</div>

						{suggestions.length > 0 && (
							<div className="mt-2 border border-[rgba(30,50,90,0.12)] rounded-2xl overflow-hidden bg-white">
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
										<span className="text-[11px] text-[rgba(30,50,90,0.4)]">
											{fmtDate(nameExpiry(s))}
										</span>
									</button>
								))}
							</div>
						)}

						{notFound && (
							<p className="mt-2 text-[13px] text-[rgba(30,50,90,0.5)] px-1">
								No Namepass activated for that name yet.
							</p>
						)}
					</div>
				</div>

				<div className="mt-12 md:mt-16">
					{record ? (
						<NameDetail record={record} onBack={() => onSelect(null)} />
					) : (
						<LiveFeed onSelect={(n) => onSelect(n)} />
					)}
				</div>
			</div>
		</section>
	);
}

import { motion, AnimatePresence } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import {
	Search,
	ArrowLeft,
	Clock,
	Globe,
	Link as LinkIcon,
	AtSign,
	Github,
	Send,
	MapPin,
	Mail,
	Zap,
} from "lucide-react";
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
import { fmtAgo, fmtDate, fmtDuration, fmtUsdc, truncAddress } from "../lib/format";
import PassCard from "./PassCard";
import { fetchProfile, type EnsProfile } from "../lib/ens";

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
			{/* Desktop column headers — hidden on mobile, where rows become cards */}
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
							className="w-full text-left px-4 md:px-5 py-4 md:py-3.5 hover:bg-[rgba(30,50,90,0.025)] transition-colors block md:grid md:grid-cols-[1.3fr_0.9fr_0.8fr_0.9fr_0.9fr_0.8fr] md:gap-4 md:items-center"
						>
							{/* Mobile: name + headline result on one line */}
							<div className="flex items-baseline justify-between gap-3 md:contents">
								<span className="text-[15px] md:text-[14.5px] text-[rgba(30,50,90,0.95)] truncate">
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

								<span className="text-[15px] md:text-[14px] text-[rgba(30,50,90,0.95)] md:text-right tabular-nums shrink-0">
									{fmtDuration(r.seconds)}
								</span>

								<span className="hidden md:block text-[12.5px] text-[rgba(30,50,90,0.45)] text-right tabular-nums">
									{fmtAgo(r.at)}
								</span>
							</div>

							{/* Mobile: labelled detail pairs */}
							<dl className="md:hidden mt-2.5 grid grid-cols-3 gap-3">
								<div>
									<dt className="text-[10px] uppercase tracking-wider text-[rgba(30,50,90,0.4)]">
										From
									</dt>
									<dd className="mt-0.5 text-[12.5px]">
										<ChainTag chain={r.chain} />
									</dd>
								</div>
								<div>
									<dt className="text-[10px] uppercase tracking-wider text-[rgba(30,50,90,0.4)]">
										Received
									</dt>
									<dd className="mt-0.5 text-[12.5px] text-[rgba(30,50,90,0.75)] tabular-nums">
										{fmtUsdc(r.amount)}
									</dd>
								</div>
								<div>
									<dt className="text-[10px] uppercase tracking-wider text-[rgba(30,50,90,0.4)]">
										Rate
									</dt>
									<dd className="mt-0.5 text-[12.5px]">
										{r.off ? (
											<span className="text-[rgba(30,50,90,0.75)]">{r.off} off</span>
										) : (
											<span className="text-[rgba(30,50,90,0.4)]">Standard</span>
										)}
									</dd>
								</div>
							</dl>
							<div className="md:hidden mt-2 text-[11.5px] text-[rgba(30,50,90,0.4)]">
								{fmtAgo(r.at)}
							</div>
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
	/* Share of total runway that existed before Namepass was activated. */
	const span = expiry - record.activatedAt;
	const basePct = Math.max(
		4,
		Math.min(96, ((record.expiryAtActivation - record.activatedAt) / span) * 100),
	);
	const [profile, setProfile] = useState<EnsProfile | null>(null);
	const [profileLoading, setProfileLoading] = useState(true);

	useEffect(() => {
		const controller = new AbortController();
		setProfileLoading(true);
		setProfile(null);
		fetchProfile(record.name, controller.signal)
			.then((p) => {
				if (!controller.signal.aborted) setProfile(p);
			})
			.finally(() => {
				if (!controller.signal.aborted) setProfileLoading(false);
			});
		return () => controller.abort();
	}, [record.name]);

	const t = profile?.text ?? {};
	const links = (
		[
			{ key: "url", value: t.url, Icon: LinkIcon },
			{ key: "com.twitter", value: t["com.twitter"] && `@${t["com.twitter"]}`, Icon: AtSign },
			{ key: "com.github", value: t["com.github"], Icon: Github },
			{ key: "org.telegram", value: t["org.telegram"] && `@${t["org.telegram"]}`, Icon: Send },
			{ key: "location", value: t.location, Icon: MapPin },
			{ key: "email", value: t.email, Icon: Mail },
		] as const
	).filter((l): l is typeof l & { value: string } => Boolean(l.value));

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
				<div className="rounded-2xl border border-[rgba(30,50,90,0.12)] bg-white p-5 flex flex-col">
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

					{/* Runway: how far Namepass has pushed the expiry out */}
					<div className="mt-5">
						<div className="flex justify-between text-[11px] text-[rgba(30,50,90,0.5)] mb-2">
							<span>At activation</span>
							<span>Now</span>
						</div>
						<div className="relative h-1.5 rounded-full bg-[rgba(30,50,90,0.08)] overflow-hidden">
							<motion.div
								initial={{ width: 0 }}
								animate={{ width: `${basePct}%` }}
								transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
								className="absolute inset-y-0 left-0 bg-[rgba(30,50,90,0.25)]"
							/>
							<motion.div
								initial={{ width: 0 }}
								animate={{ width: `${100 - basePct}%` }}
								transition={{ duration: 0.7, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
								className="absolute inset-y-0 bg-[rgba(30,50,90,0.75)]"
								style={{ left: `${basePct}%` }}
							/>
						</div>
						<div className="mt-2 flex justify-between text-[12px]">
							<span className="text-[rgba(30,50,90,0.55)]">
								{fmtDate(record.expiryAtActivation)}
							</span>
							<span className="text-[rgba(30,50,90,0.9)]">
								+{timeDelivered(record).toFixed(1)} years added
							</span>
						</div>
					</div>

					{/* ENS records — identity, not payment history */}
					<div className="mt-5 pt-5 border-t border-[rgba(30,50,90,0.08)] flex-1">
						<div className="flex items-center justify-between">
							<span className="text-[10px] uppercase tracking-wider text-[rgba(30,50,90,0.45)]">
								Profile
							</span>
							{profile?.contenthash && (
								<span className="inline-flex items-center gap-1.5 text-[11px] text-[rgba(30,50,90,0.55)]">
									<Globe className="w-3 h-3" />
									Serves a site
								</span>
							)}
						</div>

						{/* Avatar + description */}
						<div className="mt-3 flex items-start gap-3">
							<div className="w-11 h-11 shrink-0 rounded-full bg-[rgba(30,50,90,0.07)] border border-[rgba(30,50,90,0.1)] overflow-hidden flex items-center justify-center">
								{profile?.avatar ? (
									<img
										src={profile.avatar}
										alt=""
										className="w-full h-full object-cover"
										onError={(e) => {
											(e.currentTarget as HTMLImageElement).style.display = "none";
										}}
									/>
								) : (
									<span className="text-[13px] text-[rgba(30,50,90,0.45)]">
										{record.name.slice(0, 2)}
									</span>
								)}
							</div>
							<div className="min-w-0 flex-1">
								{profileLoading ? (
									<div className="space-y-1.5 pt-1">
										<div className="h-3 w-3/4 rounded bg-[rgba(30,50,90,0.08)] animate-pulse" />
										<div className="h-3 w-1/2 rounded bg-[rgba(30,50,90,0.06)] animate-pulse" />
									</div>
								) : profile?.text.description ? (
									<p className="text-[13px] text-[rgba(30,50,90,0.8)] leading-snug">
										{profile.text.description}
									</p>
								) : (
									<p className="text-[13px] text-[rgba(30,50,90,0.45)]">
										No description set.
									</p>
								)}
								{profile?.addr && (
									<div className="mt-1.5 text-[12px] text-[rgba(30,50,90,0.55)] font-mono truncate">
										{truncAddress(profile.addr)}
									</div>
								)}
							</div>
						</div>

						{/* Links */}
						{links.length > 0 && (
							<div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
								{links.map((l) => (
									<span
										key={l.key}
										className="inline-flex items-center gap-1.5 text-[12.5px] text-[rgba(30,50,90,0.7)] min-w-0"
									>
										<l.Icon className="w-3.5 h-3.5 shrink-0 text-[rgba(30,50,90,0.45)]" />
										<span className="truncate">{l.value}</span>
									</span>
								))}
							</div>
						)}
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
				<div className="flex items-baseline justify-between mb-4">
					<span className="text-[11px] uppercase tracking-wider text-[rgba(30,50,90,0.5)]">
						Activity
					</span>
					{renewalCount(record) === 0 && (
						<span className="text-[12px] text-[rgba(30,50,90,0.5)]">
							Waiting for the first payment
						</span>
					)}
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
								className="px-4 md:px-5 py-4 md:py-3.5 block md:grid md:grid-cols-[0.8fr_1fr_0.8fr_0.7fr_0.8fr_0.8fr_1fr] md:gap-4 md:items-center"
							>
								{/* Headline row */}
								<div className="flex items-baseline justify-between gap-3 md:contents">
									<span className="hidden md:block text-[13px] text-[rgba(30,50,90,0.6)] tabular-nums">
										{fmtDate(e.at)}
									</span>

									<span className="text-[15px] md:text-[14px] text-[rgba(30,50,90,0.95)] truncate">
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

									<span className="text-[15px] md:text-[14px] text-[rgba(30,50,90,0.95)] md:text-right tabular-nums shrink-0">
										{e.kind === "renewal" ? fmtDuration(e.seconds) : "—"}
									</span>

									<span className="hidden md:block text-[13px] text-[rgba(30,50,90,0.7)] text-right tabular-nums">
										{fmtDate(e.nameExpiryAfter)}
									</span>
								</div>

								{/* Mobile detail pairs */}
								{e.kind === "renewal" && (
									<dl className="md:hidden mt-2.5 grid grid-cols-3 gap-3">
										<div>
											<dt className="text-[10px] uppercase tracking-wider text-[rgba(30,50,90,0.4)]">
												From
											</dt>
											<dd className="mt-0.5 text-[12.5px]">
												<ChainTag chain={e.chain} />
											</dd>
										</div>
										<div>
											<dt className="text-[10px] uppercase tracking-wider text-[rgba(30,50,90,0.4)]">
												Amount
											</dt>
											<dd className="mt-0.5 text-[12.5px] text-[rgba(30,50,90,0.75)] tabular-nums">
												{fmtUsdc(e.amount)}
											</dd>
										</div>
										<div>
											<dt className="text-[10px] uppercase tracking-wider text-[rgba(30,50,90,0.4)]">
												Rate
											</dt>
											<dd className="mt-0.5 text-[12.5px]">
												{e.off ? (
													<span className="text-[rgba(30,50,90,0.75)]">
														{e.off} off
													</span>
												) : (
													<span className="text-[rgba(30,50,90,0.4)]">Standard</span>
												)}
											</dd>
										</div>
									</dl>
								)}

								<div className="md:hidden mt-2 flex items-center justify-between text-[11.5px] text-[rgba(30,50,90,0.45)]">
									<span>{fmtDate(e.at)}</span>
									<span>expires {fmtDate(e.nameExpiryAfter)}</span>
								</div>
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
	onActivate: (name: string) => void;
}

export default function Explorer({ selected, onSelect, onActivate }: Props) {
	const [query, setQuery] = useState("");
	const [notFound, setNotFound] = useState<string | null>(null);

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

	function submit(raw = query) {
		const value = raw.trim().toLowerCase();
		if (!value) return;
		const hit = findName(value);
		if (hit) {
			onSelect(hit.name);
			setQuery("");
			setNotFound(null);
		} else {
			setNotFound(value.endsWith(".eth") ? value : `${value}.eth`);
		}
	}

	/* Auto-search once a complete .eth name has been typed — no Enter needed. */
	useEffect(() => {
		const value = query.trim().toLowerCase();
		if (!/^[a-z0-9-]{3,}\.eth$/.test(value)) return;
		const timer = setTimeout(() => submit(value), 350);
		return () => clearTimeout(timer);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [query]);

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
									setNotFound(null);
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
							<motion.div
								initial={{ opacity: 0, y: -4 }}
								animate={{ opacity: 1, y: 0 }}
								transition={{ duration: 0.25 }}
								className="mt-2 rounded-2xl border border-[rgba(30,50,90,0.15)] bg-[rgba(30,50,90,0.03)] p-4"
							>
								<div className="text-[13.5px] text-[rgba(30,50,90,0.9)]">
									<span className="font-medium">{notFound}</span> has no Namepass
									yet.
								</div>
								<p className="mt-1 text-[12.5px] text-[rgba(30,50,90,0.55)] leading-relaxed">
									Anyone can activate one — you don't have to own the name.
								</p>
								<button
									onClick={() => {
										onActivate(notFound);
										setQuery("");
										setNotFound(null);
									}}
									className="mt-3 w-full flex items-center justify-center gap-2 bg-[rgba(30,50,90,0.9)] text-white rounded-full py-2.5 hover:bg-[rgba(30,50,90,1)] transition-colors"
								>
									<Zap className="w-3.5 h-3.5" />
									<span className="text-[13.5px]">Activate now</span>
								</button>
							</motion.div>
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

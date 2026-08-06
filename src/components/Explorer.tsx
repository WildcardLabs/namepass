import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import {
	useEffect,
	useLayoutEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
	type ReactNode,
} from "react";
import {
	Search,
	ArrowLeft,
	Clock,
	Globe,
	Link as LinkIcon,
	Github,
	Send,
	MapPin,
	Mail,
	Zap,
	Loader2,
	ExternalLink,
	ChevronDown,
} from "lucide-react";
import {
	activeFlows,
	allNames,
	claimName,
	findName,
	nameExpiry,
	recentActivity,
	renewalCount,
	tickSimulation,
	timeDelivered,
	totalReceived,
	type ActivityEvent,
	type FlowStatus,
	type FlowStep,
	type NameRecord,
} from "../lib/registry";
import {
	explorerUrl,
	fmtAgo,
	fmtDate,
	fmtDuration,
	fmtUsdc,
	fmtUsdcExact,
	truncAddress,
	truncTx,
} from "../lib/format";
import PassCard from "./PassCard";
import PendingBalance from "./PendingBalance";
import ChainTag from "./ChainTag";
import { YEAR_SECONDS } from "../lib/pricing";
import { GAS_ALLOWANCE } from "../lib/fees";
import { fetchProfile, type EnsProfile } from "../lib/ens";
import { XIcon } from "./icons";
import NumberTicker from "./magicui/NumberTicker";

/**
 * "Received" is what the funder sent; the rate and time next to it were bought
 * with what was left after the gas allowance. Showing only the first makes the
 * other two look like bad arithmetic — $16.60 at 31.25% off reads as +3.0y
 * only once you know a dime came off — so the applied amount rides along
 * whenever an allowance was taken.
 */
function AmountCell({
	deposited,
	applied,
	showApplied,
	dense,
}: {
	deposited: bigint;
	applied: bigint;
	showApplied: boolean;
	dense?: boolean;
}) {
	return (
		<>
			<span
				className={`block ${dense ? "text-[12.5px]" : "text-[13.5px]"} text-[rgba(30,50,90,0.75)] tabular-nums`}
			>
				{fmtUsdc(deposited)}
			</span>
			{showApplied && (
				<span className="block text-[11px] text-[rgba(30,50,90,0.4)] tabular-nums">
					{fmtUsdc(applied)} applied
				</span>
			)}
		</>
	);
}

function DiscountTag({ off }: { off: string }) {
	if (!off) {
		return <span className="text-[rgba(30,50,90,0.35)]">-</span>;
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

/* One word each. The feed is a dense table and a long phrase widens its column
   at the expense of every other one; the name's own card carries the full
   "Waiting for Circle attestation" where there's room for it. */
const FLOW_STAGE: Record<FlowStatus, string> = {
	signing: "Preparing",
	burning: "Burning",
	attesting: "Attesting",
	claiming: "Renewing",
};

/* One shared motion language for the feed.

   Entering rows grow from zero height and leaving rows collapse to it, so the
   rows below are pushed by real document flow rather than teleported. That is
   the whole trick: nothing here uses `layout`/FLIP, because FLIP and an
   animating height fight each other and the result is the jitter this
   replaced.

   Enter and exit share one curve on purpose, and it matters more than it
   looks. A settling transfer removes its in-flight row and adds its renewal in
   the same frame, so a row further down is pushed by the arrival and pulled by
   the departure at once. Give those different durations and the two no longer
   cancel: the row overshoots and drifts back, which is the bounce this
   replaced. Matched curves make the swap read as one motion. */
const ROW_MOTION = { duration: 0.45, ease: [0.4, 0, 0.2, 1] as const };

/**
 * A feed row's outer shell: owns the push-down, nothing else.
 *
 * `overflow-hidden` clips the content while the height animates, and the
 * divider lives on the inner element so a collapsing row takes its own border
 * with it. Left on the wrapper it would linger as a stray 1px line for the
 * length of the exit.
 */
function FeedRow({ children, reduced }: { children: ReactNode; reduced: boolean }) {
	return (
		<motion.div
			initial={reduced ? false : { height: 0, opacity: 0 }}
			animate={{ height: "auto", opacity: 1 }}
			exit={
				reduced
					? { opacity: 0, transition: { duration: 0.12 } }
					: { height: 0, opacity: 0, transition: ROW_MOTION }
			}
			transition={reduced ? { duration: 0.15 } : ROW_MOTION}
			className="overflow-hidden"
		>
			{children}
		</motion.div>
	);
}

/**
 * One row, whether the payment is still bridging or already applied.
 *
 * Deliberately a single component rather than one per state. A payment that
 * finishes keeps its identity (`flowKey`), so React keeps the same element and
 * only re-renders it. Two components would swap the whole subtree instead, and
 * with different markup on each side that reads as the row blinking out and a
 * new one taking its place. Here the only things that change on settlement are
 * the tint, the `~` becoming a `+`, and the status cell.
 *
 * The applied sub-line therefore renders in both states. It is a projection
 * while bridging, which is the same promise `~6.0y` already makes, and it
 * keeps the row exactly the same height before and after.
 */
function FeedRowContent({
	row,
	reduced,
	onSelect,
}: {
	row: FeedItem;
	reduced: boolean;
	onSelect: (n: string) => void;
}) {
	const pending = row.pending;
	return (
		<motion.div
			animate={{
				backgroundColor: pending ? "rgba(30,50,90,0.028)" : "rgba(30,50,90,0)",
			}}
			transition={reduced ? { duration: 0 } : { duration: 0.55, ease: "easeOut" }}
			className="border-b border-[rgba(30,50,90,0.07)]"
		>
			<button
				onClick={() => onSelect(row.name)}
				className="w-full text-left px-4 md:px-5 py-4 md:py-3.5 hover:bg-[rgba(30,50,90,0.025)] transition-colors block md:grid md:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.8fr)] md:gap-4 md:items-center"
			>
				{/* Mobile: name + headline result on one line */}
				<div className="flex items-baseline justify-between gap-3 md:contents">
					<span className="min-w-0 text-[15px] md:text-[14.5px] text-[rgba(30,50,90,0.95)] truncate">
						{row.name}
					</span>

					<span className="hidden md:block text-[13.5px]">
						<ChainTag chain={row.chain} />
					</span>

					<span className="hidden md:block text-right">
						<AmountCell
							deposited={row.amountDeposited}
							applied={row.amountApplied}
							showApplied={row.gasAllowance > 0n}
						/>
					</span>

					<span className="hidden md:flex justify-center text-[13px]">
						<DiscountTag off={row.off} />
					</span>

					{/* "~6.0y" while bridging, not "+6.0y": nothing has been added yet,
					    and if the claim reverts nothing will be. Same cell, same width,
					    so settling swaps one character. */}
					<span
						className={`hidden md:block text-[13.5px] text-right tabular-nums transition-colors duration-500 ${
							pending ? "text-[rgba(30,50,90,0.5)]" : "text-[rgba(30,50,90,0.95)]"
						}`}
					>
						{pending
							? fmtDuration(row.seconds).replace("+", "~")
							: fmtDuration(row.seconds)}
					</span>

					<span className="hidden md:flex min-w-0 items-center justify-end gap-1.5 text-[12px]">
						<StatusCell row={row} reduced={reduced} />
					</span>
				</div>

				{/* Mobile: labelled detail pairs */}
				<dl className="md:hidden mt-2.5 grid grid-cols-[minmax(5.25rem,auto)_minmax(4rem,auto)_minmax(4.75rem,auto)_auto] justify-between gap-x-2 gap-y-1 items-baseline">
					<div>
						<dt className="text-[10px] uppercase tracking-wider text-[rgba(30,50,90,0.4)]">
							From
						</dt>
						<dd className="mt-0.5 text-[12.5px]">
							<ChainTag chain={row.chain} />
						</dd>
					</div>
					<div>
						<dt className="text-[10px] uppercase tracking-wider text-[rgba(30,50,90,0.4)]">
							Received
						</dt>
						<dd className="mt-0.5">
							<AmountCell
								deposited={row.amountDeposited}
								applied={row.amountApplied}
								showApplied={row.gasAllowance > 0n}
								dense
							/>
						</dd>
					</div>
					<div>
						<dt className="text-[10px] uppercase tracking-wider text-[rgba(30,50,90,0.4)]">
							Rate
						</dt>
						<dd className="mt-0.5 text-[12.5px] text-[rgba(30,50,90,0.75)]">
							{row.off ? `${row.off} off` : "Standard"}
						</dd>
					</div>
					<div className="text-right">
						<dt className="text-[10px] uppercase tracking-wider text-[rgba(30,50,90,0.4)]">
							Time
						</dt>
						<dd className="mt-0.5 text-[12.5px] text-[rgba(30,50,90,0.95)] tabular-nums">
							{pending
								? fmtDuration(row.seconds).replace("+", "~")
								: fmtDuration(row.seconds)}
						</dd>
					</div>
				</dl>
				<div className="md:hidden mt-2 text-[11.5px] text-[rgba(30,50,90,0.4)]">
					<StatusCell row={row} reduced={reduced} />
				</div>
			</button>
		</motion.div>
	);
}

/**
 * The one cell that genuinely differs between the two states.
 *
 * Both labels are always mounted and stacked in the same grid cell, so the
 * cell is as wide as the wider of them and crossfading changes no geometry at
 * all. The obvious version, an `AnimatePresence` swap, flickers: whichever
 * mode you pick either pops the outgoing label out of flow and lets the cell
 * collapse for a frame (`popLayout`), or leaves a gap while it waits
 * (`mode="wait"`). Nothing here mounts or unmounts, so there is nothing to
 * reflow.
 */
function StatusCell({ row, reduced }: { row: FeedItem; reduced: boolean }) {
	const fade = reduced ? { duration: 0 } : { duration: 0.3, ease: "easeInOut" as const };
	return (
		<span className="grid justify-items-end [&>*]:col-start-1 [&>*]:row-start-1">
			<motion.span
				animate={{ opacity: row.pending ? 1 : 0 }}
				transition={fade}
				aria-hidden={!row.pending}
				className="inline-flex items-center gap-1.5 whitespace-nowrap text-[rgba(30,50,90,0.55)]"
			>
				<Loader2 className="w-3 h-3 animate-spin shrink-0" />
				{FLOW_STAGE[row.status]}
			</motion.span>

			<motion.span
				animate={{ opacity: row.pending ? 0 : 1 }}
				transition={fade}
				aria-hidden={row.pending}
				className="whitespace-nowrap text-[rgba(30,50,90,0.45)] tabular-nums"
			>
				{fmtAgo(row.at)}
			</motion.span>
		</span>
	);
}

/**
 * Rows on screen at once, in-flight and settled together.
 *
 * Constant so the feed never changes height, which is the only reason the rest
 * of the page stays still while it updates. An arrival at the top is paid for
 * by a departure at the bottom in the same frame, and the two cancel.
 */
const FEED_ROWS = 14;

/** In-flight rows are capped so a busy moment can't crowd out all the history. */
const MAX_IN_FLIGHT = 6;

/**
 * Rows the viewport shows. The rest of `FEED_ROWS` sits below the fade as
 * slack, which is what makes the height genuinely fixed rather than nearly
 * fixed: arrivals push the surplus under the edge and departures happen out of
 * sight, so no row count or row height can move the container.
 *
 * Fractional on purpose. Landing exactly on a row boundary makes the last one
 * look cut off by accident; half a row under a fade reads as more to come.
 */
const VISIBLE_ROWS = 11.5;

/** Height of the fade at the bottom edge, in px. */
const FADE_PX = 64;

/** What the feed renders, flattened so both states share one shape. */
type FeedItem = {
	key: string;
	name: string;
	chain: string;
	amountDeposited: bigint;
	gasAllowance: bigint;
	amountApplied: bigint;
	seconds: bigint;
	off: string;
} & (
	| { pending: true; status: FlowStatus; at: number }
	| { pending: false; status: FlowStatus; at: number }
);

function LiveFeed({ onSelect }: { onSelect: (n: string) => void }) {
	const [, tick] = useReducer((n: number) => n + 1, 0);
	const reduced = useReducedMotion() ?? false;
	const listRef = useRef<HTMLDivElement>(null);
	const [rowHeight, setRowHeight] = useState<number | null>(null);

	/* Measured rather than hardcoded, because a row is a single line on desktop
	   and a stacked card on mobile, and a fixed pixel height would be wrong on
	   one of them. Averaged over the rendered rows so a row without an applied
	   sub-line can't skew the unit. Re-measured on resize, which is the only
	   thing that changes it. */
	useLayoutEffect(() => {
		const measure = () => {
			const el = listRef.current;
			if (!el || el.children.length === 0) return;
			const h = el.getBoundingClientRect().height / el.children.length;
			if (h > 0) setRowHeight(h);
		};
		measure();
		window.addEventListener("resize", measure);
		return () => window.removeEventListener("resize", measure);
	}, []);

	useEffect(() => {
		const id = setInterval(() => {
			tickSimulation();
			tick();
		}, 2600);
		return () => clearInterval(id);
	}, []);

	const inFlight = activeFlows().slice(0, MAX_IN_FLIGHT);
	/* Backfilled so the total is fixed. This only works because a settling
	   payment keeps its row: it crosses from the in-flight group into the
	   settled one as the same element, and the settled limit grows by exactly
	   the one slot the in-flight group gave up. Nothing enters, nothing
	   leaves, nothing moves. Back when the two sides had different keys this
	   same arithmetic shifted three rows at once. */
	const settled = recentActivity(FEED_ROWS - inFlight.length);

	/* One list, and the key is the payment rather than the row. A settling
	   transfer keeps its key, so React moves and re-renders the element it
	   already has instead of unmounting one row and mounting another. */
	const items: FeedItem[] = [
		...inFlight.map((f) => ({
			key: f.id,
			name: f.name,
			chain: f.chain,
			amountDeposited: f.amount,
			gasAllowance: GAS_ALLOWANCE,
			amountApplied: f.amount > GAS_ALLOWANCE ? f.amount - GAS_ALLOWANCE : 0n,
			seconds: f.seconds,
			off: f.off,
			pending: true as const,
			status: f.status,
			at: f.startedAt,
		})),
		...settled.map((e) => ({
			key: e.flowKey ?? e.id,
			name: e.name,
			chain: e.chain,
			amountDeposited: e.amountDeposited,
			gasAllowance: e.gasAllowance,
			amountApplied: e.amountApplied,
			seconds: e.seconds,
			off: e.off,
			pending: false as const,
			status: "claiming" as FlowStatus,
			at: e.at,
		})),
	];

	return (
		<div className="border border-[rgba(30,50,90,0.1)] rounded-2xl overflow-hidden">
			{/* Desktop column headers, hidden on mobile where rows become cards */}
			<div className="hidden md:grid grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.8fr)] gap-4 px-5 py-3 bg-[rgba(30,50,90,0.03)] border-b border-[rgba(30,50,90,0.1)] text-[11px] uppercase tracking-wider text-[rgba(30,50,90,0.5)]">
				<span>ENS name</span>
				<span>Chain</span>
				<span className="text-right">Received</span>
				<span className="text-center">Discount</span>
				<span className="text-right">Time added</span>
				<span className="text-right">Status</span>
			</div>

			{/* Fixed height, so nothing the feed does can move the page. The
			    surplus rows live below the fade and absorb every arrival and
			    departure. `overflowAnchor` off so the browser doesn't
			    counter-scroll against rows arriving above the viewport. */}
			<div
				className="overflow-hidden"
				style={{
					height: rowHeight ? rowHeight * VISIBLE_ROWS : undefined,
					overflowAnchor: "none",
					maskImage: `linear-gradient(to bottom, black calc(100% - ${FADE_PX}px), transparent 100%)`,
					WebkitMaskImage: `linear-gradient(to bottom, black calc(100% - ${FADE_PX}px), transparent 100%)`,
				}}
			>
				<div ref={listRef}>
					<AnimatePresence initial={false}>
						{items.map((row) => (
							<FeedRow key={row.key} reduced={reduced}>
								<FeedRowContent row={row} reduced={reduced} onSelect={onSelect} />
							</FeedRow>
						))}
					</AnimatePresence>
				</div>
			</div>
		</div>
	);
}

/**
 * The final mainnet step mints only when something was burned to get there.
 * A payment that was already on Ethereum just renews, so calling it a mint
 * would describe a transfer that never happened.
 */
function stepLabel(step: FlowStep, bridged: boolean): string {
	if (step.kind === "deposit") return "Payment received";
	if (step.kind === "burn") return "Burned for transfer";
	return bridged ? "Minted and renewed" : "Renewed";
}

/**
 * What one renewal actually cost and which transactions carried it. The three
 * amounts are separate because the gas allowance comes off on mainnet, so what
 * bought renewal time is less than what the funder sent. One allowance per
 * renewal, however many deposits accumulated into it.
 */
function RenewalBreakdown({ event }: { event: ActivityEvent }) {
	const bridged = event.steps.some((s) => s.kind === "burn");
	const years = Number(event.seconds) / Number(YEAR_SECONDS);
	return (
		<div className="px-4 md:px-5 py-5 bg-[rgba(30,50,90,0.015)] border-t border-[rgba(30,50,90,0.06)] grid gap-6 md:grid-cols-2">
			<div>
				<div className="text-[10px] uppercase tracking-wider text-[rgba(30,50,90,0.45)]">
					Amount
				</div>
				{/* Exact amounts here, not rounded ones. This is the panel someone opens
			    to check the arithmetic, and a tier threshold can turn on a
			    micro-unit — "$27" would be true of both $27.000071 (six years at
			    43.75% off) and $27.00 (four years eleven months at 31.25%). */}
				<dl className="mt-2.5 space-y-1.5 text-[13px]">
					<div className="flex justify-between gap-4">
						<dt className="text-[rgba(30,50,90,0.6)]">Received</dt>
						<dd className="text-[rgba(30,50,90,0.9)] tabular-nums">
							{fmtUsdcExact(event.amountDeposited)}
						</dd>
					</div>
					{event.gasAllowance > 0n && (
						<div className="flex justify-between gap-4">
							<dt className="text-[rgba(30,50,90,0.6)]">Gas allowance</dt>
							<dd className="text-[rgba(30,50,90,0.55)] tabular-nums">
								−{fmtUsdcExact(event.gasAllowance)}
							</dd>
						</div>
					)}
					<div className="flex justify-between gap-4 pt-1.5 border-t border-[rgba(30,50,90,0.08)]">
						<dt className="text-[rgba(30,50,90,0.6)]">Applied to renewal</dt>
						<dd className="text-[rgba(30,50,90,0.95)] tabular-nums">
							{fmtUsdcExact(event.amountApplied)}
						</dd>
					</div>
					{/* Without this the panel says where the money went but not what it
					    bought it at, so "$27 · 6 years" looks like bad arithmetic until
					    you notice the bulk rate is $4.50, not the headline $8. */}
					{years > 0.01 && (
						<div className="flex justify-between gap-4">
							<dt className="text-[rgba(30,50,90,0.6)]">Effective rate</dt>
							<dd className="text-[rgba(30,50,90,0.7)] tabular-nums">
								{fmtUsdc(BigInt(Math.round(Number(event.amountApplied) / years)))}/year
							</dd>
						</div>
					)}
				</dl>
				</div>

			<div>
				<div className="text-[10px] uppercase tracking-wider text-[rgba(30,50,90,0.45)]">
					Transactions
				</div>
				<ol className="mt-2.5 space-y-2.5">
					{event.steps.map((s, i) => (
						<li key={s.tx} className="flex items-baseline gap-2.5">
							<span className="shrink-0 w-3 text-[11px] text-[rgba(30,50,90,0.35)] tabular-nums">
								{i + 1}
							</span>
							<div className="min-w-0 flex-1">
								<div className="text-[12.5px] text-[rgba(30,50,90,0.8)]">
									{stepLabel(s, bridged)}
								</div>
								<a
									href={explorerUrl(s.chain, s.tx)}
									target="_blank"
									rel="noopener noreferrer"
									className="mt-0.5 inline-flex items-center gap-1.5 font-mono text-[12px] text-[rgba(30,50,90,0.5)] hover:text-[rgba(30,50,90,0.9)] transition-colors"
								>
									{truncTx(s.tx)}
									<ExternalLink className="w-2.5 h-2.5 shrink-0" />
								</a>
							</div>
							<span className="shrink-0 text-[11.5px] text-[rgba(30,50,90,0.45)]">
								{s.chain}
							</span>
						</li>
					))}
				</ol>
			</div>
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* Name detail                                                         */
/* ------------------------------------------------------------------ */

function NameDetail({
	record,
	onBack,
	onSupportedTokens,
}: {
	record: NameRecord;
	onBack: () => void;
	onSupportedTokens: () => void;
}) {
	/* A settling flow appends a renewal to the record in place, so the expiry,
	   aggregates and activity table all need a nudge to re-read it. */
	const [, refresh] = useReducer((n: number) => n + 1, 0);
	/* Which renewal has its transaction breakdown open. One at a time. */
	const [openEvent, setOpenEvent] = useState<string | null>(null);
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

	/* Ignore a late result rather than cancel the request — `fetchProfile`
	   dedupes, so the promise is shared and cancelling it would blank the
	   avatar rendering the same name elsewhere. See lib/ens.ts. */
	useEffect(() => {
		let cancelled = false;
		setProfileLoading(true);
		setProfile(null);
		fetchProfile(record.name)
			.then((p) => {
				if (!cancelled) setProfile(p);
			})
			.finally(() => {
				if (!cancelled) setProfileLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [record.name]);

	const t = profile?.text ?? {};
	const links = (
		[
			{ key: "url", value: t.url, Icon: LinkIcon },
			{ key: "com.twitter", value: t["com.twitter"] && `@${t["com.twitter"]}`, Icon: XIcon },
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
							: "Expired, needs renewal"}
					</div>

					{/* Runway: how far Namepass has pushed the expiry out.
					    Attributed explicitly — the expiry above is the name's real one
					    and the owner may well have renewed elsewhere too, so an
					    unqualified "+27 years added" would claim credit for it. */}
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
								+{timeDelivered(record).toFixed(1)} years via Namepass
							</span>
						</div>
					</div>

					{/* Money that has arrived but isn't renewal time yet — sits above
					    the profile because it's the actionable half of the card. */}
					{/* Keyed so switching names resets the card — otherwise an open
					    tooltip and a running flow timer carry over to the next one. */}
					<PendingBalance key={record.name} record={record} onSettled={refresh} />

					{/* ENS records — identity, not payment history */}
					<div className="mt-5 pt-5 border-t border-[rgba(30,50,90,0.08)] flex-1">
						<div className="flex items-center justify-between">
							<span className="text-[10px] uppercase tracking-wider text-[rgba(30,50,90,0.45)]">
								Profile
							</span>
							{profile?.contenthash && (
								<a
									href={`https://${record.name}.limo`}
									target="_blank"
									rel="noopener noreferrer"
									className="inline-flex items-center gap-1.5 text-[11px] text-[rgba(30,50,90,0.55)] hover:text-[rgba(30,50,90,0.9)] transition-colors"
								>
									<Globe className="w-3 h-3" />
									Serves a site
									<ExternalLink className="w-2.5 h-2.5" />
								</a>
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
									<div className="mt-1.5 min-w-0 text-[12px] text-[rgba(30,50,90,0.55)] font-mono truncate">
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
					onSupportedTokens={onSupportedTokens}
				/>
			</div>

			{/* Aggregates */}
			<div className="mt-4 grid grid-cols-3 gap-px bg-[rgba(30,50,90,0.1)] border border-[rgba(30,50,90,0.1)] rounded-2xl overflow-hidden">
				{[
					/* "y" not " years" — at three-up on a phone the long form wraps and
					   drops this value below the other two. Matches fmtDuration anyway. */
					{ k: "Time delivered", value: timeDelivered(record), decimals: 1, suffix: "y" },
					{
						k: "Total received",
						value: totalReceived(record),
						decimals: Number.isInteger(totalReceived(record)) ? 0 : 2,
						prefix: "$",
					},
					{ k: "Renewals", value: renewalCount(record), decimals: 0 },
				].map((s) => (
					/* Labels wrap to two lines at narrow widths ("Renewals" doesn't), so
					   the label absorbs the slack and the values stay on one line. */
					<div key={s.k} className="bg-white px-3 md:px-4 py-4 flex flex-col">
						<div className="flex-1 text-[10px] uppercase tracking-wider text-[rgba(30,50,90,0.45)]">
							{s.k}
						</div>
						<NumberTicker
							value={s.value}
							decimals={s.decimals}
							prefix={s.prefix}
							suffix={s.suffix}
							className="mt-1.5 block text-[19px] text-[rgba(30,50,90,0.95)] tracking-tight tabular-nums whitespace-nowrap"
						/>
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
					<div className="hidden md:grid grid-cols-[0.8fr_1.2fr_0.8fr_0.8fr_0.9fr_0.8fr_auto] gap-4 px-5 py-3 bg-[rgba(30,50,90,0.03)] border-b border-[rgba(30,50,90,0.1)] text-[11px] uppercase tracking-wider text-[rgba(30,50,90,0.5)]">
						<span>Date</span>
						<span>Event</span>
						<span>Chain</span>
						<span className="text-right">Received</span>
						<span className="text-center">Discount</span>
						<span className="text-right">Time added</span>
						<span className="w-4" />
					</div>

					<div className="divide-y divide-[rgba(30,50,90,0.07)]">
						{events.map((e) => {
							/* Activation has no transactions behind it, so nothing to open. */
							const expandable = e.steps.length > 0;
							const isOpen = openEvent === e.id;
							return (
							<div key={e.id}>
							<button
								type="button"
								disabled={!expandable}
								onClick={() => setOpenEvent(isOpen ? null : e.id)}
								className={`w-full text-left px-4 md:px-5 py-4 md:py-3.5 block md:grid md:grid-cols-[0.8fr_1.2fr_0.8fr_0.8fr_0.9fr_0.8fr_auto] md:gap-4 md:items-center ${
									expandable
										? "hover:bg-[rgba(30,50,90,0.025)] transition-colors"
										: "cursor-default"
								}`}
							>
								{/* Headline row */}
								<div className="flex items-baseline justify-between gap-3 md:contents">
									<span className="hidden md:block text-[13px] text-[rgba(30,50,90,0.6)] tabular-nums">
										{fmtDate(e.at)}
									</span>

									<span className="min-w-0 text-[15px] md:text-[14.5px] text-[rgba(30,50,90,0.95)] truncate">
										{e.kind === "activated" ? "Namepass activated" : "Renewal"}
									</span>

									<span className="hidden md:block text-[13.5px]">
										{e.kind === "renewal" ? (
											<ChainTag chain={e.chain} />
										) : (
											<span className="text-[rgba(30,50,90,0.35)]">-</span>
										)}
									</span>

									<span className="hidden md:block text-[13.5px] text-[rgba(30,50,90,0.75)] text-right tabular-nums">
										{e.kind === "renewal" ? (
											<AmountCell
												deposited={e.amountDeposited}
												applied={e.amountApplied}
												showApplied={e.gasAllowance > 0n}
											/>
										) : (
											"-"
										)}
									</span>

									<span className="hidden md:flex justify-center">
										{e.kind === "renewal" ? (
											<DiscountTag off={e.off} />
										) : (
											<span className="text-[rgba(30,50,90,0.35)]">-</span>
										)}
									</span>

									<span className="hidden md:block text-[13.5px] text-[rgba(30,50,90,0.95)] text-right tabular-nums">
										{e.kind === "renewal" ? fmtDuration(e.seconds) : "-"}
									</span>

									<span className="hidden md:flex justify-end">
										{expandable && (
											<ChevronDown
												className={`w-4 h-4 text-[rgba(30,50,90,0.35)] transition-transform ${isOpen ? "rotate-180" : ""}`}
											/>
										)}
									</span>

								</div>

								{/* Mobile detail pairs */}
								{e.kind === "renewal" && (
									<dl className="md:hidden mt-2.5 grid grid-cols-[minmax(5.25rem,auto)_minmax(4rem,auto)_minmax(4.75rem,auto)_auto] justify-between gap-x-2 gap-y-1 items-baseline">
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
												Received
											</dt>
											<dd className="mt-0.5">
												<AmountCell
													deposited={e.amountDeposited}
													applied={e.amountApplied}
													showApplied={e.gasAllowance > 0n}
													dense
												/>
											</dd>
										</div>
										<div>
											<dt className="text-[10px] uppercase tracking-wider text-[rgba(30,50,90,0.4)]">
												Rate
											</dt>
											<dd className="mt-0.5 text-[12.5px] text-[rgba(30,50,90,0.75)]">
												{e.off ? `${e.off} off` : "Standard"}
											</dd>
										</div>
										<div className="text-right">
											<dt className="text-[10px] uppercase tracking-wider text-[rgba(30,50,90,0.4)]">
												Time
											</dt>
											<dd className="mt-0.5 text-[12.5px] text-[rgba(30,50,90,0.95)] tabular-nums">
												{fmtDuration(e.seconds)}
											</dd>
										</div>
									</dl>
								)}

								<div className="md:hidden mt-2 flex items-center justify-between gap-3 text-[11.5px] text-[rgba(30,50,90,0.45)]">
									<span>{fmtDate(e.at)}</span>
									{expandable && (
										<ChevronDown
											className={`w-4 h-4 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
										/>
									)}
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
										<RenewalBreakdown event={e} />
									</motion.div>
								)}
							</AnimatePresence>
							</div>
							);
						})}
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
	/** Fired once a Namepass exists, so the page can reveal its profile. */
	onActivated: (name: string) => void;
	/** Navigate to the supported-tokens page. */
	onSupportedTokens: () => void;
}

export default function Explorer({ selected, onSelect, onActivated, onSupportedTokens }: Props) {
	const [query, setQuery] = useState("");
	const [notFound, setNotFound] = useState<string | null>(null);
	const [activating, setActivating] = useState(false);

	/** ENS v2 prices nothing below three characters, so it can't be renewed. */
	const tooShort = notFound !== null && notFound.replace(/\.eth$/, "").length < 3;

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
						<div className="flex items-center bg-white border border-[rgba(30,50,90,0.15)] rounded-[0.9rem] pl-4 pr-2 py-2.5 focus-within:border-[rgba(30,50,90,0.4)] transition-colors">
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
							<div className="mt-2 border border-[rgba(30,50,90,0.12)] rounded-[0.9rem] overflow-hidden bg-white">
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

						{notFound && tooShort && (
							<motion.div
								initial={{ opacity: 0, y: -4 }}
								animate={{ opacity: 1, y: 0 }}
								transition={{ duration: 0.25 }}
								className="mt-2 rounded-[0.9rem] border border-[rgba(30,50,90,0.15)] bg-[rgba(30,50,90,0.03)] p-4"
							>
								<div className="text-[13.5px] text-[rgba(30,50,90,0.9)]">
									<span className="font-medium">{notFound}</span> can't be registered.
								</div>
								{/* ENS v2 has no rate below three characters, so a Namepass for one
								    could never buy any time — better to say so than to let someone
								    activate an address that can never work. */}
								<p className="mt-1 text-[12.5px] text-[rgba(30,50,90,0.55)] leading-relaxed">
									ENS names need at least three characters.
								</p>
							</motion.div>
						)}

						{notFound && !tooShort && (
							<motion.div
								initial={{ opacity: 0, y: -4 }}
								animate={{ opacity: 1, y: 0 }}
								transition={{ duration: 0.25 }}
								className="mt-2 rounded-[0.9rem] border border-[rgba(30,50,90,0.15)] bg-[rgba(30,50,90,0.03)] p-4"
							>
								<div className="text-[13.5px] text-[rgba(30,50,90,0.9)]">
									<span className="font-medium">{notFound}</span> has no Namepass
									yet.
								</div>
								<p className="mt-1 text-[12.5px] text-[rgba(30,50,90,0.55)] leading-relaxed">
									Anyone can activate one. You don't have to own the name.
								</p>
								<button
									onClick={() => {
										if (activating) return;
										setActivating(true);
										const target = notFound;
										setTimeout(() => {
											const created = claimName(target);
											setActivating(false);
											setQuery("");
											setNotFound(null);
											onActivated(created.name);
										}, 1100);
									}}
									disabled={activating}
									className="mt-3 w-full flex items-center justify-center gap-2 bg-[rgba(30,50,90,0.9)] text-white rounded-full py-2.5 hover:bg-[rgba(30,50,90,1)] transition-colors disabled:opacity-70"
								>
									{activating ? (
										<>
											<Loader2 className="w-3.5 h-3.5 animate-spin" />
											<span className="text-[14px]">Activating…</span>
										</>
									) : (
										<>
											<Zap className="w-3.5 h-3.5" />
											<span className="text-[14px]">Activate now</span>
										</>
									)}
								</button>
							</motion.div>
						)}
					</div>
				</div>

				<div className="mt-12 md:mt-16">
					{record ? (
						<NameDetail
							record={record}
							onBack={() => onSelect(null)}
							onSupportedTokens={onSupportedTokens}
						/>
					) : (
						<LiveFeed onSelect={(n) => onSelect(n)} />
					)}
				</div>
			</div>
		</section>
	);
}

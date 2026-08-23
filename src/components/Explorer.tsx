import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import {
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
	type ReactNode,
} from "react";
import {
	Search,
	ArrowLeft,
	ArrowRight,
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
	findName,
	flowAmount,
	hasActiveFlow,
	minTrigger,
	nameExpiry,
	renewalEvent,
	renewalCount,
	timeDelivered,
	totalReceived,
	type ActivityEvent,
	type FlowStatus,
	type FlowStep,
	type NameRecord,
	syncFeed,
	syncName,
	setPublicConfig,
} from "../lib/readModel";
import { flowPresentation } from "../lib/flowPresentation";
import {
	explorerUrl,
	fmtAgo,
	fmtDate,
	fmtDuration,
	fmtUsdc,
	fmtUsdcExact,
	fmtYears,
	truncAddress,
	truncTx,
} from "../lib/format";
import PassCard from "./PassCard";
import PendingBalance from "./PendingBalance";
import ChainTag from "./ChainTag";
import { ceilToCent, costOf, YEAR_SECONDS } from "../lib/pricing";
import { LABEL_PROBLEM_TEXT, labelProblem, normalizeLabel } from "../lib/namepass";
import { GAS_ALLOWANCE } from "../lib/fees";
import { fetchProfile, type EnsProfile } from "../lib/ens";
import { XIcon } from "./icons";
import { activateName, getActivity, getName, getNameActivity, getPublicConfig, safeInteger, triggerFlow, type ActivityRead, type NameActivityRead, type PublicFlow } from "../lib/publicApi";
import { chainById, HUB_CHAIN } from "../lib/chains";

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
	const pendingLabel = row.pending
		? flowPresentation(row.status, row.originChainId).feed
		: "Renewing";
	return (
		<span className="grid justify-items-end [&>*]:col-start-1 [&>*]:row-start-1">
			<motion.span
				animate={{ opacity: row.pending ? 1 : 0 }}
				transition={fade}
				aria-hidden={!row.pending}
				className="inline-flex items-center gap-1.5 whitespace-nowrap text-[rgba(30,50,90,0.55)]"
			>
				<Loader2 className="w-3 h-3 animate-spin shrink-0" />
				{pendingLabel}
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

/** In-flight rows are capped so a busy moment can't crowd out all the history. */
const MAX_IN_FLIGHT = 6;
const ACTIVITY_PAGE_SIZE = 10;

function ActivityPagination({
	page,
	hasPrevious,
	hasNext,
	loadingNext,
	onPrevious,
	onNext,
}: {
	page: number;
	hasPrevious: boolean;
	hasNext: boolean;
	loadingNext: boolean;
	onPrevious: () => void;
	onNext: () => void;
}) {
	if (!hasPrevious && !hasNext) return null;
	return (
		<div className="mt-6 flex items-center justify-between">
			<span className="text-[12.5px] text-[rgba(30,50,90,0.5)] tabular-nums">
				Page {page + 1}
			</span>
			<div className="flex items-center gap-2">
				<button type="button" onClick={onPrevious} disabled={!hasPrevious} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[rgba(30,50,90,0.12)] text-[13px] text-[rgba(30,50,90,0.7)] hover:border-[rgba(30,50,90,0.3)] transition-colors disabled:opacity-35 disabled:pointer-events-none">
					<ArrowLeft className="w-3.5 h-3.5" />
					Previous
				</button>
				<button type="button" onClick={onNext} disabled={!hasNext || loadingNext} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[rgba(30,50,90,0.12)] text-[13px] text-[rgba(30,50,90,0.7)] hover:border-[rgba(30,50,90,0.3)] transition-colors disabled:opacity-35 disabled:pointer-events-none">
					{loadingNext && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
					Next
					{!loadingNext && <ArrowRight className="w-3.5 h-3.5" />}
				</button>
			</div>
		</div>
	);
}

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
	| { pending: true; status: FlowStatus; originChainId: string; at: number }
	| { pending: false; at: number }
);

function LiveFeed({ onSelect }: { onSelect: (n: string) => void }) {
	const [, tick] = useReducer((n: number) => n + 1, 0);
	const reduced = useReducedMotion() ?? false;
	const history = useRef<ActivityRead["items"]>([]);
	const cursor = useRef<string | null>(null);
	const cursorInitialized = useRef(false);
	const loading = useRef(false);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [loadingOlder, setLoadingOlder] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [pageIndex, setPageIndex] = useState(0);
	const tableRef = useRef<HTMLDivElement>(null);

	const mergeHistory = (items: ActivityRead["items"]) => {
		const merged = new Map(history.current.map((item) => [item.renewal.eventId, item]));
		for (const item of items) merged.set(item.renewal.eventId, item);
		history.current = [...merged.values()].sort(
			(a, b) => new Date(b.renewal.blockTime).getTime() - new Date(a.renewal.blockTime).getTime(),
		);
	};

	useEffect(() => {
		let stopped = false;
		let timer = 0;
		let failures = 0;
		const schedule = (delay: number) => {
			window.clearTimeout(timer);
			if (document.hidden) return;
			timer = window.setTimeout(() => void load(), delay);
		};
		const load = async () => {
			if (stopped || document.hidden || loading.current) return;
			loading.current = true;
			try {
				const feed = await getActivity(undefined, ACTIVITY_PAGE_SIZE);
				mergeHistory(feed.items);
				if (!cursorInitialized.current) {
					cursorInitialized.current = true;
					cursor.current = feed.nextCursor;
					setNextCursor(feed.nextCursor);
				}
				syncFeed({ ...feed, items: history.current, nextCursor: cursor.current });
				failures = 0;
				setLoadError(null);
				tick();
			} catch (cause) {
				failures += 1;
				setLoadError(cause instanceof Error ? cause.message : "Could not load activity.");
			} finally {
				loading.current = false;
				if (!stopped) schedule(Math.min(12_000 * 2 ** failures, 60_000));
			}
		};
		const focus = () => {
			window.clearTimeout(timer);
			if (!document.hidden) void load();
		};
		const visibility = () => {
			window.clearTimeout(timer);
			if (!document.hidden) void load();
		};
		void load();
		window.addEventListener("focus", focus);
		document.addEventListener("visibilitychange", visibility);
		return () => {
			stopped = true;
			window.clearTimeout(timer);
			window.removeEventListener("focus", focus);
			document.removeEventListener("visibilitychange", visibility);
		};
	}, []);

	const loadOlder = async (): Promise<boolean> => {
		if (!cursor.current || loading.current) return false;
		loading.current = true;
		setLoadingOlder(true);
		const previousLength = history.current.length;
		try {
			const feed = await getActivity(cursor.current, ACTIVITY_PAGE_SIZE);
			mergeHistory(feed.items);
			cursor.current = feed.nextCursor;
			setNextCursor(feed.nextCursor);
			syncFeed({ ...feed, items: history.current });
			setLoadError(null);
			tick();
			return history.current.length > previousLength;
		} catch (cause) {
			setLoadError(cause instanceof Error ? cause.message : "Could not load older activity.");
			return false;
		} finally {
			loading.current = false;
			setLoadingOlder(false);
		}
	};

	const inFlight = activeFlows().slice(0, MAX_IN_FLIGHT);
	const settled = history.current.map(({ name, renewal }) => ({
		...renewalEvent(renewal, name.label),
		name: name.displayName,
	}));
	const pageStart = pageIndex * ACTIVITY_PAGE_SIZE;
	const settledPage = settled.slice(pageStart, pageStart + ACTIVITY_PAGE_SIZE);
	const nextPageStart = pageStart + ACTIVITY_PAGE_SIZE;
	const hasCachedNextPage = settled.length > nextPageStart;
	const hasNext = hasCachedNextPage || nextCursor !== null;
	const goToPage = (next: number) => {
		setPageIndex(next);
		tableRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
	};
	const nextPage = async () => {
		const cachedNextPage = settled.length > nextPageStart;
		if (cursor.current && settled.length < nextPageStart + ACTIVITY_PAGE_SIZE) {
			const loaded = await loadOlder();
			if (cachedNextPage || loaded) goToPage(pageIndex + 1);
			return;
		}
		if (cachedNextPage) goToPage(pageIndex + 1);
	};

	/* One list, and the key is the payment rather than the row. A settling
	   transfer keeps its key, so React moves and re-renders the element it
	   already has instead of unmounting one row and mounting another. */
	const items: FeedItem[] = [
		...(pageIndex === 0 ? inFlight : []).map((f) => ({
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
			originChainId: f.originChainId,
			at: f.startedAt,
		})),
		...settledPage.map((e) => ({
			key: e.id,
			name: e.name,
			chain: e.chain,
			amountDeposited: e.amountDeposited,
			gasAllowance: e.gasAllowance,
			amountApplied: e.amountApplied,
			seconds: e.seconds,
			off: e.off,
			pending: false as const,
			at: e.at,
		})),
	];

	return (
		<>
			{loadError && <p role="alert" className="mb-3 text-[12.5px] text-red-700">{loadError}</p>}
			<div ref={tableRef} className="scroll-mt-6 border border-[rgba(30,50,90,0.1)] rounded-2xl overflow-hidden">
			{/* Desktop column headers, hidden on mobile where rows become cards */}
			<div className="hidden md:grid grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.8fr)] gap-4 px-5 py-3 bg-[rgba(30,50,90,0.03)] border-b border-[rgba(30,50,90,0.1)] text-[11px] uppercase tracking-wider text-[rgba(30,50,90,0.5)]">
				<span>ENS name</span>
				<span>Chain</span>
				<span className="text-right">Received</span>
				<span className="text-center">Discount</span>
				<span className="text-right">Time added</span>
				<span className="text-right">Status</span>
			</div>

			<div>
					<AnimatePresence initial={false}>
						{items.map((row) => (
							<FeedRow key={row.key} reduced={reduced}>
								<FeedRowContent row={row} reduced={reduced} onSelect={onSelect} />
							</FeedRow>
						))}
					</AnimatePresence>
					{items.length === 0 && !loadError && (
						<p className="px-5 py-8 text-center text-[13px] text-[rgba(30,50,90,0.5)]">No renewal activity yet.</p>
					)}
			</div>
			</div>
			<ActivityPagination
				page={pageIndex}
				hasPrevious={pageIndex > 0}
				hasNext={hasNext}
				loadingNext={loadingOlder}
				onPrevious={() => goToPage(Math.max(0, pageIndex - 1))}
				onNext={() => void nextPage()}
			/>
		</>
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
	const hasMeaningfulDuration = event.seconds > YEAR_SECONDS / 100n;
	const effectiveRate = event.seconds > 0n
		? (event.amountApplied * YEAR_SECONDS + event.seconds / 2n) / event.seconds
		: 0n;
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
					{hasMeaningfulDuration && (
						<div className="flex justify-between gap-4">
							<dt className="text-[rgba(30,50,90,0.6)]">Effective rate</dt>
							<dd className="text-[rgba(30,50,90,0.7)] tabular-nums">
								{fmtUsdc(effectiveRate)}/year
							</dd>
						</div>
					)}
				</dl>
				<dl className="mt-4 space-y-1.5 border-t border-[rgba(30,50,90,0.08)] pt-3 text-[12px]">
					<div>
						<dt className="text-[rgba(30,50,90,0.5)]">Funded by</dt>
						<dd className="mt-0.5 break-all font-mono text-[rgba(30,50,90,0.8)]">
							{event.funder}
						</dd>
					</div>
					<div>
						<dt className="text-[rgba(30,50,90,0.5)]">Processed by</dt>
						<dd className="mt-0.5 break-all text-[rgba(30,50,90,0.8)]">
							{event.executorIsRelayer ? "Namepass · " : ""}
							<span className="font-mono">{event.executor}</span>
						</dd>
					</div>
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

function UnclaimedFlowCard({ label, flow, renewable, onRetry }: { label: string; flow: PublicFlow; renewable: boolean; onRetry: () => void }) {
	const [retrying, setRetrying] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const chain = chainById(safeInteger(flow.originChainId) ?? -1);
	const evidence = flow.evidence;
	const retry = async () => {
		setRetrying(true);
		setError(null);
		try {
			await triggerFlow(label, flow.originChainId);
			onRetry();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Retry failed.");
		} finally {
			setRetrying(false);
		}
	};
	return (
		<div className="mt-5 rounded-2xl border border-[rgba(30,50,90,0.18)] bg-[rgba(30,50,90,0.035)] p-4">
			<h4 className="text-[15px] text-[rgba(30,50,90,0.95)]">Waiting to renew</h4>
			<p className="mt-1.5 text-[13px] leading-relaxed text-[rgba(30,50,90,0.65)]">The USDC left {chain?.name ?? "the origin chain"} and is secured in a Circle message. This name cannot be renewed now. Namepass will retry when renewal is possible.</p>
			<dl className="mt-3 space-y-1 text-[12px] text-[rgba(30,50,90,0.6)]">
				<div className="flex justify-between gap-4"><dt>Amount</dt><dd>{fmtUsdcExact(flowAmount(flow))}</dd></div>
				<div className="flex justify-between gap-4"><dt>Origin chain</dt><dd>{chain?.name ?? flow.originChainId}</dd></div>
				<div className="flex justify-between gap-4"><dt>Circle nonce</dt><dd className="font-mono truncate">{flow.cctpNonce ?? "Not available"}</dd></div>
				<div className="flex justify-between gap-4"><dt>Latest retry</dt><dd>{flow.nextActionAt ? fmtDate(new Date(flow.nextActionAt).getTime()) : "Not scheduled"}</dd></div>
			</dl>
			{evidence?.originTxHash && chain && <a href={explorerUrl(chain.name, evidence.originTxHash)} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1.5 font-mono text-[12px] text-[rgba(30,50,90,0.65)] hover:text-[rgba(30,50,90,0.95)]">Origin transaction {truncTx(evidence.originTxHash)} <ExternalLink className="w-3 h-3" /></a>}
			<p className="mt-3 text-[12px] leading-relaxed text-[rgba(30,50,90,0.5)]">This transfer cannot return to {chain?.name ?? "the origin chain"}. A retry uses the same Circle message.</p>
			{renewable && <button type="button" onClick={() => void retry()} disabled={retrying} className="mt-3 inline-flex items-center gap-2 rounded-full border border-[rgba(30,50,90,0.25)] px-3 py-1.5 text-[12px] text-[rgba(30,50,90,0.8)] hover:bg-white disabled:opacity-50">{retrying && <Loader2 className="w-3 h-3 animate-spin" />}Retry renewal</button>}
			{error && <p role="alert" className="mt-2 text-[12px] text-red-700">{error}</p>}
		</div>
	);
}

function FailedCctpFlowCard({ flow }: { flow: PublicFlow }) {
	const chain = chainById(safeInteger(flow.originChainId) ?? -1);
	const originTxHash = flow.evidence?.originTxHash;
	return (
		<div className="mt-5 rounded-2xl border border-red-900/20 bg-red-950/[0.025] p-4">
			<h4 className="text-[15px] text-[rgba(30,50,90,0.95)]">Renewal needs attention</h4>
			<p className="mt-1.5 text-[13px] leading-relaxed text-[rgba(30,50,90,0.65)]">
				The USDC left {chain?.name ?? "the origin chain"} through Circle, but the Ethereum renewal did not complete. This flow needs repair by Namepass. The funds are not waiting at the deposit address.
			</p>
			<dl className="mt-3 space-y-1 text-[12px] text-[rgba(30,50,90,0.6)]">
				<div className="flex justify-between gap-4"><dt>Amount</dt><dd>{fmtUsdcExact(flowAmount(flow))}</dd></div>
				<div className="flex justify-between gap-4"><dt>Origin chain</dt><dd>{chain?.name ?? flow.originChainId}</dd></div>
			</dl>
			{originTxHash && chain && (
				<a href={explorerUrl(chain.name, originTxHash)} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1.5 font-mono text-[12px] text-[rgba(30,50,90,0.65)] hover:text-[rgba(30,50,90,0.95)]">
					Origin transaction {truncTx(originTxHash)} <ExternalLink className="w-3 h-3" />
				</a>
			)}
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
	onRefresh,
	activityPage,
	hasPreviousActivity,
	hasNextActivity,
	loadingNextActivity,
	onPreviousActivity,
	onNextActivity,
}: {
	record: NameRecord;
	onBack: () => void;
	onSupportedTokens: () => void;
	onRefresh: () => void;
	activityPage: number;
	hasPreviousActivity: boolean;
	hasNextActivity: boolean;
	loadingNextActivity: boolean;
	onPreviousActivity: () => void;
	onNextActivity: () => void;
}) {
	/* Which renewal has its transaction breakdown open. One at a time. */
	const [openEvent, setOpenEvent] = useState<string | null>(null);
	const allEvents = [...record.events].reverse();
	const renewalEvents = allEvents.filter((event) => event.kind === "renewal");
	const activationEvent = allEvents.find((event) => event.kind === "activated");
	const activityStart = activityPage * ACTIVITY_PAGE_SIZE;
	const events = renewalEvents.slice(activityStart, activityStart + ACTIVITY_PAGE_SIZE);
	if (!hasNextActivity && activationEvent) events.push(activationEvent);
	const activityRef = useRef<HTMLDivElement>(null);
	const previousActivityPage = useRef(activityPage);
	const expiry = nameExpiry(record);
	const daysLeft = Math.round((expiry - Date.now()) / 86_400_000);
	const [profile, setProfile] = useState<EnsProfile | null>(null);
	const [profileLoading, setProfileLoading] = useState(true);

	useEffect(() => {
		if (previousActivityPage.current === activityPage) return;
		previousActivityPage.current = activityPage;
		setOpenEvent(null);
		activityRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
	}, [activityPage]);

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

	const onchain = record.onchain;

	/**
	 * The least USDC worth sending to a name in its grace period, and which
	 * constraint set it.
	 *
	 * Two independent floors, and quoting the wrong one misleads:
	 *
	 * - **catch-up** — a renewal extends from the *current* expiry, not from
	 *   today, so it has to buy back everything the name has already lapsed
	 *   before it is live again. Priced at full rate, since the discount tiers
	 *   all need years and this is days.
	 * - **trigger** — below `minTrigger()` a payment doesn't move at all; it
	 *   parks at the address as `below_threshold`. For a 5+ character name this
	 *   is usually the binding one, because days of runway cost cents.
	 *
	 * Both carry the gas allowance, like every other amount the app quotes.
	 */
	const graceMinimum = useMemo(() => {
		if (onchain?.lapsedFor == null) return null;
		/* +1s: buying back exactly what has lapsed lands on the expiry, not past it. */
		const owed = BigInt(Math.ceil(onchain.lapsedFor / 1000)) + 1n;
		const catchUp = ceilToCent(costOf(owed, record.labelLength) + GAS_ALLOWANCE);
		const floor = minTrigger(String(HUB_CHAIN.chainId));
		if (floor === undefined) return null;
		return catchUp >= floor
			? { amount: catchUp, bound: "catch-up" as const }
			: { amount: floor, bound: "trigger" as const };
	}, [onchain?.lapsedFor, record.labelLength]);

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

					{/* Three states, and the middle two must not look alike: not read
					    yet, read and unregistered, read and registered. Rendering
					    "not registered" while the call is still in flight tells
					    someone their name doesn't exist because an RPC was slow. */}
					{!onchain ? (
						<>
							<div className="mt-3 h-[30px] w-40 rounded-lg bg-[rgba(30,50,90,0.07)] motion-safe:animate-pulse" />
							<div className="mt-3 h-[13px] w-56 rounded-full bg-[rgba(30,50,90,0.06)] motion-safe:animate-pulse" />
						</>
					) : onchain.expiry === null ? (
						<>
							<div className="mt-3 text-[26px] md:text-[30px] text-[rgba(30,50,90,0.5)] tracking-tight leading-none">
								Not registered
							</div>
							<div className="mt-2 text-[13px] text-[rgba(30,50,90,0.55)]">
								Nobody holds this name on Ethereum yet.
							</div>
						</>
					) : (
						<>
							<div className="mt-3 text-[26px] md:text-[30px] text-[rgba(30,50,90,0.95)] tracking-tight leading-none">
								{fmtDate(expiry)}
							</div>
							<div className="mt-2 text-[13px] text-[rgba(30,50,90,0.55)]">
								{daysLeft > 0
									? `${daysLeft.toLocaleString("en-US")} days of registration remaining`
									: `Expired ${Math.floor((onchain.lapsedFor ?? 0) / 86_400_000).toLocaleString("en-US")} days ago`}
							</div>
						</>
					)}

					{/* In its grace period: expired, still renewable, and on a deadline.
					    All three matter to someone deciding whether to send, and the
					    amount is the actionable part — see `graceMinimum`. */}
					{onchain?.graceRemaining != null && (
						<div className="mt-3 flex items-start gap-2 rounded-xl border border-[rgba(30,50,90,0.15)] bg-[rgba(30,50,90,0.03)] px-3 py-2.5">
							<Clock className="w-3.5 h-3.5 mt-[2px] shrink-0 text-[rgba(30,50,90,0.5)]" />
							<p className="text-[12.5px] text-[rgba(30,50,90,0.7)] leading-relaxed">
								<span className="text-[rgba(30,50,90,0.95)]">
									In its grace period.
								</span>{" "}
								ENS will still renew it for{" "}
								{Math.floor(onchain.graceRemaining / 86_400_000).toLocaleString(
									"en-US",
								)}{" "}
								more days, then the name is released.{" "}
								{graceMinimum !== null && (
									<>
										It takes at least{" "}
										<span className="text-[rgba(30,50,90,0.95)] tabular-nums">
											{fmtUsdc(graceMinimum.amount)}
										</span>{" "}
										{graceMinimum.bound === "catch-up"
											? "to buy back the time it has already lapsed — less than that renews it but leaves it expired."
											: "for a payment to trigger a renewal at all, which is more than enough to clear the expiry."}
									</>
								)}
							</p>
						</div>
					)}

					{/* ENS decides this, not us — and it decides what happens to money
					    sent here, so it's worth saying before someone sends any
					    rather than explaining it afterwards next to a stuck balance. */}
					{onchain && !onchain.renewable && (
						<div className="mt-3 flex items-start gap-2 rounded-xl border border-[rgba(30,50,90,0.15)] bg-[rgba(30,50,90,0.03)] px-3 py-2.5">
							<Clock className="w-3.5 h-3.5 mt-[2px] shrink-0 text-[rgba(30,50,90,0.5)]" />
							<p className="text-[12.5px] text-[rgba(30,50,90,0.7)] leading-relaxed">
								ENS won't renew this name right now. The address still works —
								anything sent waits at it until the name can be renewed again.
							</p>
						</div>
					)}

					{/* Money that has arrived but isn't renewal time yet — sits above
					    the profile because it's the actionable half of the card. */}
					{/* Keyed so switching names resets the card — otherwise an open
					    tooltip and a running flow timer carry over to the next one. */}
					<PendingBalance key={record.name} record={record} onSettled={onRefresh} />

					{record.flows
						.filter((flow) => flow.status === "unclaimed")
						.map((flow) => (
							<UnclaimedFlowCard
								key={flow.id}
								label={record.name.replace(/\.eth$/, "")}
								flow={flow}
								renewable={Boolean(onchain?.renewable)}
								onRetry={onRefresh}
							/>
						))}

					{record.flows
						.filter((flow) =>
							flow.status === "failed"
							&& flow.originChainId !== String(HUB_CHAIN.chainId)
							&& flow.amountProcessed !== null,
						)
						.map((flow) => <FailedCctpFlowCard key={flow.id} flow={flow} />)}

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
							<div className="w-11 h-11 shrink-0 rounded-xl bg-[rgba(30,50,90,0.07)] border border-[rgba(30,50,90,0.1)] overflow-hidden flex items-center justify-center">
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
					address={record.address}
					onSupportedTokens={onSupportedTokens}
				/>
			</div>

			{/* Aggregates */}
			<div className="mt-4 grid grid-cols-3 gap-px bg-[rgba(30,50,90,0.1)] border border-[rgba(30,50,90,0.1)] rounded-2xl overflow-hidden">
				{[
					/* "y" not " years" — at three-up on a phone the long form wraps and
					   drops this value below the other two. Matches fmtDuration anyway. */
						{ k: "Time delivered", value: `${fmtYears(timeDelivered(record))}y` },
						{
							k: "Total received",
							value: fmtUsdc(totalReceived(record)),
						},
						{ k: "Renewals", value: renewalCount(record).toString() },
				].map((s) => (
					/* Labels wrap to two lines at narrow widths ("Renewals" doesn't), so
					   the label absorbs the slack and the values stay on one line. */
					<div key={s.k} className="bg-white px-3 md:px-4 py-4 flex flex-col">
						<div className="flex-1 text-[10px] uppercase tracking-wider text-[rgba(30,50,90,0.45)]">
							{s.k}
						</div>
							<span className="mt-1.5 block text-[19px] text-[rgba(30,50,90,0.95)] tracking-tight tabular-nums whitespace-nowrap">
								{s.value}
							</span>
					</div>
				))}
			</div>

			{/* Activity table */}
			<div ref={activityRef} className="mt-10 scroll-mt-6">
				<div className="flex items-baseline justify-between mb-4">
					<span className="text-[11px] uppercase tracking-wider text-[rgba(30,50,90,0.5)]">
						Activity
					</span>
					{allEvents.length <= 1 && (
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
							const expandable = e.kind === "renewal" && e.steps.length > 0;
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
										{e.kind === "activated" ? "Namepass activated" : e.kind === "deposit" ? "Payment received" : "Renewal"}
									</span>

									<span className="hidden md:block text-[13.5px]">
										{e.kind !== "activated" ? (
											<ChainTag chain={e.chain} />
										) : (
											<span className="text-[rgba(30,50,90,0.35)]">-</span>
										)}
									</span>

									<span className="hidden md:block text-[13.5px] text-[rgba(30,50,90,0.75)] text-right tabular-nums">
										{e.kind !== "activated" ? (
											<AmountCell
												deposited={e.amountDeposited}
												applied={e.amountApplied}
												showApplied={e.kind === "renewal" && e.gasAllowance > 0n}
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
								{e.kind !== "activated" && (
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
												showApplied={e.kind === "renewal" && e.gasAllowance > 0n}
													dense
												/>
											</dd>
										</div>
										<div>
											<dt className="text-[10px] uppercase tracking-wider text-[rgba(30,50,90,0.4)]">
												Rate
											</dt>
											<dd className="mt-0.5 text-[12.5px] text-[rgba(30,50,90,0.75)]">
											{e.kind === "renewal" ? (e.off ? `${e.off} off` : "Standard") : "-"}
											</dd>
										</div>
										<div className="text-right">
											<dt className="text-[10px] uppercase tracking-wider text-[rgba(30,50,90,0.4)]">
												Time
											</dt>
											<dd className="mt-0.5 text-[12.5px] text-[rgba(30,50,90,0.95)] tabular-nums">
											{e.kind === "renewal" ? fmtDuration(e.seconds) : "-"}
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
							{e.kind === "deposit" && (
								<p className="px-4 pb-3 text-[12px] text-[rgba(30,50,90,0.6)] md:px-5" aria-label={`Funded by ${e.funder}`}>
									Funded by <span className="font-mono">{e.funder}</span>
								</p>
							)}

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
				<ActivityPagination
					page={activityPage}
					hasPrevious={hasPreviousActivity}
					hasNext={hasNextActivity}
					loadingNext={loadingNextActivity}
					onPrevious={onPreviousActivity}
					onNext={onNextActivity}
				/>
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
	const [version, refresh] = useReducer((value: number) => value + 1, 0);
	const [, reload] = useReducer((value: number) => value + 1, 0);
	const [requestError, setRequestError] = useState<string | null>(null);
	const [configVersion, refreshConfig] = useReducer((value: number) => value + 1, 0);
	const nameHistory = useRef<NameActivityRead["renewals"]>([]);
	const nameCursor = useRef<string | null>(null);
	const nameCursorInitialized = useRef(false);
	const [nameNextCursor, setNameNextCursor] = useState<string | null>(null);
	const [loadingOlderName, setLoadingOlderName] = useState(false);
	const [namePageIndex, setNamePageIndex] = useState(0);

	const mergeNameHistory = (renewals: NameActivityRead["renewals"]) => {
		const merged = new Map(nameHistory.current.map((renewal) => [renewal.eventId, renewal]));
		for (const renewal of renewals) merged.set(renewal.eventId, renewal);
		nameHistory.current = [...merged.values()].sort(
			(a, b) => new Date(b.blockTime).getTime() - new Date(a.blockTime).getTime(),
		);
	};

	useEffect(() => {
		nameHistory.current = [];
		nameCursor.current = null;
		nameCursorInitialized.current = false;
		setNameNextCursor(null);
		setNamePageIndex(0);
	}, [selected]);

	useEffect(() => {
		let stopped = false;
		void getPublicConfig()
			.then((config) => {
				if (stopped) return;
				setPublicConfig(config);
				refreshConfig();
			})
			.catch((cause: unknown) => {
				if (!stopped) setRequestError(cause instanceof Error ? cause.message : "Could not load the public chain configuration.");
			});
		return () => { stopped = true; };
	}, []);

	/**
	 * Why this name can't have a Namepass, if it can't. Asked of the same
	 * function that derives the deposit address, so the search box can never
	 * offer to activate a name the derivation would refuse — the sub-three-
	 * character case this used to check by hand is one of its answers.
	 */
	const problem = notFound === null ? null : labelProblem(notFound);

	const record = useMemo(
		() => (selected ? findName(selected) : undefined),
		[selected, version],
	);

	useEffect(() => {
		if (!selected) return;
		let stopped = false;
		let timer = 0;
		let failures = 0;
		let loading = false;
		const schedule = (delay: number) => {
			window.clearTimeout(timer);
			if (document.hidden) return;
			timer = window.setTimeout(() => void load(), delay);
		};
		const load = async () => {
			if (stopped || document.hidden || loading) return;
			loading = true;
			try {
				const activity = await getNameActivity(selected, undefined, ACTIVITY_PAGE_SIZE);
				if (!stopped) {
					mergeNameHistory(activity.renewals);
					if (!nameCursorInitialized.current) {
						nameCursorInitialized.current = true;
						nameCursor.current = activity.nextCursor;
						setNameNextCursor(activity.nextCursor);
					}
					syncName({ ...activity, renewals: nameHistory.current, nextCursor: nameCursor.current });
					setRequestError(null);
					failures = 0;
					refresh();
				}
			} catch (cause) {
				if (!stopped) setRequestError(cause instanceof Error ? cause.message : "Could not load this name.");
				failures += 1;
			}
			finally {
				loading = false;
				const current = findName(selected);
				const delay = current && hasActiveFlow(current) ? 4_000 : 15_000;
				if (!stopped) schedule(Math.min(delay * 2 ** failures, 60_000));
			}
		};
		const focus = () => {
			window.clearTimeout(timer);
			if (!document.hidden) void load();
		};
		const visibility = () => {
			window.clearTimeout(timer);
			if (!document.hidden) void load();
		};
		void load();
		window.addEventListener("focus", focus);
		document.addEventListener("visibilitychange", visibility);
		return () => {
			stopped = true;
			window.clearTimeout(timer);
			window.removeEventListener("focus", focus);
			document.removeEventListener("visibilitychange", visibility);
		};
	}, [selected, reload, configVersion]);

	const loadOlderName = async (): Promise<boolean> => {
		if (!selected || !nameCursor.current || loadingOlderName) return false;
		setLoadingOlderName(true);
		const previousLength = nameHistory.current.length;
		try {
			const activity = await getNameActivity(selected, nameCursor.current, ACTIVITY_PAGE_SIZE);
			mergeNameHistory(activity.renewals);
			nameCursor.current = activity.nextCursor;
			setNameNextCursor(activity.nextCursor);
			syncName({ ...activity, renewals: nameHistory.current });
			setRequestError(null);
			refresh();
			return nameHistory.current.length > previousLength;
		} catch (cause) {
			setRequestError(cause instanceof Error ? cause.message : "Could not load older activity.");
			return false;
		} finally {
			setLoadingOlderName(false);
		}
	};

	const suggestions = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return [];
		return allNames()
			.filter((r) => r.name.includes(q))
			.slice(0, 6);
	}, [query]);

	const loadedNameRenewals = record?.events.filter((event) => event.kind === "renewal").length ?? 0;
	const hasActivationEvent = record?.events.some((event) => event.kind === "activated") ?? false;
	const loadedNameActivity = loadedNameRenewals + (nameNextCursor === null && hasActivationEvent ? 1 : 0);
	const nextNamePageStart = (namePageIndex + 1) * ACTIVITY_PAGE_SIZE;
	const hasCachedNextNamePage = loadedNameActivity > nextNamePageStart;
	const hasNextNamePage = hasCachedNextNamePage || nameNextCursor !== null;
	const nextNamePage = async () => {
		const cachedNextPage = loadedNameActivity > nextNamePageStart;
		if (nameCursor.current && loadedNameActivity < nextNamePageStart + ACTIVITY_PAGE_SIZE) {
			const loaded = await loadOlderName();
			if (cachedNextPage || loaded) setNamePageIndex((page) => page + 1);
			return;
		}
		if (cachedNextPage) setNamePageIndex((page) => page + 1);
	};

	async function submit(raw = query) {
		const value = raw.trim();
		if (!value) return;
		if (labelProblem(value)) {
			setNotFound(value.endsWith(".eth") ? value : `${value}.eth`);
			return;
		}
		try {
			const label = normalizeLabel(value);
			await getName(label);
			onSelect(`${label}.eth`);
			setQuery("");
			setNotFound(null);
			setRequestError(null);
		} catch (cause) {
			const status = cause && typeof cause === "object" && "status" in cause
				? (cause as { status?: number }).status
				: undefined;
			if (status === 404) setNotFound(`${normalizeLabel(value)}.eth`);
			else setRequestError(cause instanceof Error ? cause.message : "Search failed.");
		}
	}

	/* Auto-search once a complete .eth name has been typed — no Enter needed. */
	useEffect(() => {
		const value = query.trim().toLowerCase();
		/* Any complete single-label `.eth`, not just ASCII — `labelProblem` is
		   what judges it, and this only decides when to stop waiting for Enter. */
		if (!/^[^\s.]{3,}\.eth$/.test(value)) return;
		const timer = setTimeout(() => void submit(value), 350);
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
									aria-label="Search an ENS name"
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

						{notFound && problem && (
							<motion.div
								initial={{ opacity: 0, y: -4 }}
								animate={{ opacity: 1, y: 0 }}
								transition={{ duration: 0.25 }}
								className="mt-2 rounded-[0.9rem] border border-[rgba(30,50,90,0.15)] bg-[rgba(30,50,90,0.03)] p-4"
							>
								<div className="text-[13.5px] text-[rgba(30,50,90,0.9)]">
									<span className="font-medium">{notFound}</span> can't be registered.
								</div>
								{/* A name ENS can't hold — too short to be priced, or not a name
								    ENSIP-15 admits — could never buy any time, so say so rather
								    than letting someone activate an address that can never work. */}
								<p className="mt-1 text-[12.5px] text-[rgba(30,50,90,0.55)] leading-relaxed">
									{LABEL_PROBLEM_TEXT[problem]}
								</p>
							</motion.div>
						)}

						{notFound && !problem && (
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
										void activateName(notFound)
											.then((created) => {
											syncName({ name: created.name, renewals: [], flows: [], balances: [], nextCursor: null });
												setQuery("");
												setNotFound(null);
												onActivated(created.name.displayName);
											})
											.catch((cause: unknown) => setRequestError(cause instanceof Error ? cause.message : "Activation failed."))
											.finally(() => setActivating(false));
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
				{requestError && <p role="alert" className="mt-3 text-[12.5px] text-red-700">{requestError}</p>}

				<div className="mt-12 md:mt-16">
					{record ? (
						<NameDetail
							record={record}
							onBack={() => onSelect(null)}
							onSupportedTokens={onSupportedTokens}
							onRefresh={reload}
							activityPage={namePageIndex}
							hasPreviousActivity={namePageIndex > 0}
							hasNextActivity={hasNextNamePage}
							loadingNextActivity={loadingOlderName}
							onPreviousActivity={() => setNamePageIndex((page) => Math.max(0, page - 1))}
							onNextActivity={() => void nextNamePage()}
						/>
					) : (
						<LiveFeed onSelect={(n) => onSelect(n)} />
					)}
				</div>
			</div>
		</section>
	);
}

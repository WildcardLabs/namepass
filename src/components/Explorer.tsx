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
	ArrowUpRight,
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
	Copy,
	Check,
	CheckCircle2,
} from "lucide-react";
import { BackButton, ICON_BUTTON_BASE_CLASS, QUIET_ICON_BUTTON_CLASS } from "./BackButton";
import {
	activeFlows,
	activityEmptyState,
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
import { completedFlowTransactions } from "../lib/flowTransactions";
import PassCard from "./PassCard";
import PendingBalance from "./PendingBalance";
import ChainTag from "./ChainTag";
import { ceilToCent, costOf, PricingNotLoadedError, rates, YEAR_SECONDS } from "../lib/pricing";
import { LABEL_PROBLEM_TEXT, labelProblem, normalizeLabel } from "../lib/namepass";
import { GAS_ALLOWANCE } from "../lib/fees";
import { fetchProfile, profileRecordHref, profileRecordLabel, type EnsProfile } from "../lib/ens";
import { XIcon } from "./icons";
import { activateName, getActivity, getName, getNameActivity, getPublicConfig, safeInteger, triggerFlow, type ActivityRead, type PublicFlow } from "../lib/publicApi";
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
				className={`block ${dense ? "text-[12.5px]" : "text-[13.5px]"} text-ink-primary tabular-nums`}
			>
				{fmtUsdc(deposited)}
			</span>
			{showApplied && (
				<span className="block text-[11px] text-ink-secondary tabular-nums">
					{fmtUsdc(applied)} applied
				</span>
			)}
		</>
	);
}

function DiscountTag({ off }: { off: string | null }) {
	if (off === null) {
		return <span className="text-ink-secondary">—</span>;
	}
	if (!off) {
		return <span className="text-ink-secondary">-</span>;
	}
	return (
		<span className="inline-flex items-center rounded-md bg-[rgba(28,58,41,0.06)] px-2 py-0.5 text-[12px] text-ink-primary whitespace-nowrap">
			{off} off
		</span>
	);
}

/* ------------------------------------------------------------------ */
/* Live feed — Etherscan-style table                                   */
/* ------------------------------------------------------------------ */

const LIVE_FEED_COLUMNS = "lg:grid-cols-[minmax(9rem,1.45fr)_minmax(5.75rem,0.8fr)_minmax(6rem,0.9fr)_minmax(5.5rem,0.85fr)_minmax(5rem,0.7fr)_minmax(6.5rem,1fr)_7rem]";
const NAME_ACTIVITY_COLUMNS = "lg:grid-cols-[minmax(5.5rem,0.8fr)_minmax(9rem,1.2fr)_minmax(5rem,0.8fr)_minmax(6rem,0.85fr)_minmax(5.5rem,0.8fr)_minmax(5rem,0.7fr)_7rem]";
const SEARCH_ICON_BUTTON_CLASS = `${ICON_BUTTON_BASE_CLASS} bg-[rgba(28,58,41,0.95)] text-ink-inverse hover:bg-[rgba(28,58,41,1)]`;

/** The exact shared mobile layout for activity rows in both Explorer views. */
function MobileFlowSummary({
	title,
	chain,
	received,
	rate,
	time,
	footer,
	expandable,
	expanded,
	controlsId,
	onToggle,
	showDetails = true,
}: {
	title: ReactNode;
	chain: ReactNode;
	received: ReactNode;
	rate: ReactNode;
	time: ReactNode;
	footer: ReactNode;
	expandable: boolean;
	expanded: boolean;
	controlsId: string;
	onToggle: () => void;
	showDetails?: boolean;
}) {
	return (
		<div className={`lg:hidden px-4 md:px-5 py-4 md:py-3.5 ${expandable ? "hover:bg-[rgba(28,58,41,0.025)] transition-colors" : ""}`}>
			<div className="flex items-center justify-between gap-2">
				{title}
				{expandable && (
					<button
						type="button"
						onClick={onToggle}
						aria-expanded={expanded}
						aria-controls={controlsId}
						aria-label={expanded ? "Hide flow details" : "Show flow details"}
						className={`${QUIET_ICON_BUTTON_CLASS} ${expanded ? "border-transparent bg-[rgba(28,58,41,0.06)]" : "border-[rgba(28,58,41,0.16)] bg-white"}`}
					>
						<span className="sr-only">{expanded ? "Hide flow details" : "Show flow details"}</span>
						<ChevronDown aria-hidden="true" className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
					</button>
				)}
			</div>

			{showDetails && <dl className="mt-2.5 grid grid-cols-2 gap-x-6 gap-y-2">
				<div>
					<dt className="text-[10px] uppercase tracking-wider text-ink-label">From</dt>
					<dd className="mt-0.5 text-[12.5px]">{chain}</dd>
				</div>
				<div>
					<dt className="text-[10px] uppercase tracking-wider text-ink-label">Received</dt>
					<dd className="mt-0.5">{received}</dd>
				</div>
				<div>
					<dt className="text-[10px] uppercase tracking-wider text-ink-label">Rate</dt>
					<dd className="mt-0.5 text-[12.5px] text-ink-secondary">{rate}</dd>
				</div>
				<div>
					<dt className="text-[10px] uppercase tracking-wider text-ink-label">Time</dt>
					<dd className="mt-0.5 text-[12.5px] text-ink-primary tabular-nums">{time}</dd>
				</div>
			</dl>}
			<div className="mt-2 flex justify-end text-[11.5px] text-ink-secondary">{footer}</div>
		</div>
	);
}

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
	const [expanded, setExpanded] = useState(false);
	const transactions = row.pending && row.flow ? completedFlowTransactions(row.flow) : [];
	const toggleExpanded = () => setExpanded((open) => !open);
	const nameTitle = (
		<button type="button" onClick={() => onSelect(row.name)} aria-label={`Open ${row.name}`} className="group inline-flex min-w-0 flex-1 items-center gap-1 text-left text-[15px] lg:text-[14.5px] text-ink-primary transition-colors hover:text-ink-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(28,58,41,0.6)]">
			<img src={`${import.meta.env.BASE_URL}logos/ens-mark-dark-blue.svg`} alt="" aria-hidden="true" className="relative top-px h-3 w-3 shrink-0 object-contain grayscale opacity-40" />
			<span className="truncate">{row.name}</span>
			<ArrowUpRight className="-ml-1 h-3.5 w-3.5 shrink-0 translate-y-px transition-transform group-hover:translate-x-px group-hover:translate-y-0" />
		</button>
	);
	const timeAdded = row.seconds === null
		? "—"
		: pending
			? fmtDuration(row.seconds).replace("+", "~")
			: fmtDuration(row.seconds);
	return (
		<motion.div
			animate={{
				backgroundColor: pending ? "rgba(28,58,41,0.028)" : "rgba(28,58,41,0)",
			}}
			transition={reduced ? { duration: 0 } : { duration: 0.55, ease: "easeOut" }}
			className="border-b border-[rgba(28,58,41,0.07)]"
		>
			<MobileFlowSummary
				title={nameTitle}
				chain={<ChainTag chain={row.chain} />}
				received={<AmountCell deposited={row.amountDeposited} applied={row.amountApplied} showApplied={row.gasAllowance > 0n} dense />}
				rate={row.off === null ? "—" : row.off ? `${row.off} off` : "Standard"}
				time={timeAdded}
				footer={<StatusCell row={row} reduced={reduced} />}
				expandable
				expanded={expanded}
				controlsId={`flow-details-${row.key}`}
				onToggle={toggleExpanded}
			/>
			<div className={`hidden lg:grid px-4 md:px-5 py-3.5 ${LIVE_FEED_COLUMNS} gap-4 items-center hover:bg-[rgba(28,58,41,0.025)] transition-colors`}>
				{nameTitle}
				<span className="text-[13.5px]"><ChainTag chain={row.chain} /></span>
				<span className="text-right"><AmountCell deposited={row.amountDeposited} applied={row.amountApplied} showApplied={row.gasAllowance > 0n} /></span>
				<span className="flex justify-center text-[13px]"><DiscountTag off={row.off} /></span>
				{/* Pending time uses ~ because it has not been added yet. */}
				<span className={`text-[13.5px] text-right tabular-nums transition-colors duration-500 ${pending ? "text-ink-secondary" : "text-ink-primary"}`}>
					{timeAdded}
				</span>
				<span className="flex min-w-0 items-center justify-end gap-1.5 text-[12px]"><StatusCell row={row} reduced={reduced} /></span>
				<button
					type="button"
					onClick={toggleExpanded}
					aria-expanded={expanded}
					aria-controls={`flow-details-${row.key}`}
					className="inline-flex h-7 shrink-0 items-center justify-center justify-self-end gap-1 rounded-md border border-[rgba(28,58,41,0.14)] px-2 text-[11px] text-ink-action hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(28,58,41,0.6)]"
				>
					{expanded ? "Hide details" : "Flow details"}
					<ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
				</button>
			</div>
			<AnimatePresence initial={false}>
				{expanded && (
					<motion.div
						id={`flow-details-${row.key}`}
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
						className="overflow-hidden"
					>
						{row.pending ? (
							<div className="px-4 md:px-5 py-4 border-t border-[rgba(28,58,41,0.06)] bg-[rgba(28,58,41,0.015)]">
								<p className="text-[13px] text-ink-action">{flowPresentation(row.status, row.originChainId).detail}</p>
								{transactions.length > 0 && (
									<div className="mt-4">
										<div className="text-[10px] uppercase tracking-wider text-ink-label">Transactions</div>
										<ol className="mt-2 grid gap-2 sm:grid-cols-2">
											{transactions.map((transaction, index) => (
												<li key={transaction.tx} className="flex min-w-0 items-center gap-2.5 rounded-lg bg-white/80 px-3 py-2">
													<span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[rgba(28,58,41,0.06)] text-[10px] tabular-nums text-ink-secondary">{index + 1}</span>
													<div className="min-w-0 flex-1">
														<div className="flex items-center justify-between gap-2 text-[12px]">
															<span className="text-ink-action">{transaction.label}</span>
															<span className="shrink-0 text-[11px] text-ink-secondary">{transaction.chain}</span>
														</div>
														<a href={explorerUrl(transaction.chain, transaction.tx)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 font-mono text-[11.5px] text-ink-action transition-colors hover:text-ink-primary">
															{truncTx(transaction.tx)} <ExternalLink className="h-3 w-3" />
														</a>
													</div>
												</li>
											))}
										</ol>
									</div>
								)}
							</div>
						) : <RenewalBreakdown event={row.event} />}
					</motion.div>
				)}
			</AnimatePresence>
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
				className="inline-flex items-center gap-1.5 whitespace-nowrap text-ink-secondary"
			>
				<Loader2 className={`w-3 h-3 shrink-0 ${row.pending ? "motion-safe:animate-spin" : ""}`} />
				{pendingLabel}
			</motion.span>

			<motion.span
				animate={{ opacity: row.pending ? 0 : 1 }}
				transition={fade}
				aria-hidden={row.pending}
				className="inline-flex flex-col items-end gap-0.5 whitespace-nowrap tabular-nums"
			>
				<span className="inline-flex items-center gap-1 text-ink-action">
					<CheckCircle2 aria-hidden="true" className="h-3 w-3" />
					Renewed
				</span>
				<span className="text-[11px] text-ink-secondary">{fmtAgo(row.at)}</span>
			</motion.span>
		</span>
	);
}

/** In-flight rows are capped so a busy moment can't crowd out all the history. */
const MAX_IN_FLIGHT = 6;
const ACTIVITY_PAGE_SIZE = 10;

function ActivityPagination({
	page,
	totalPages,
	loading,
	onPage,
}: {
	page: number;
	totalPages: number;
	loading: boolean;
	onPage: (page: number) => void;
}) {
	if (totalPages <= 1) return null;
	const previous = page > 0;
	const next = page + 1 < totalPages;
	const buttonClass = "flex h-10 items-center justify-center rounded-xl border border-[rgba(28,58,41,0.12)] px-3 text-[13px] text-ink-action transition-colors hover:border-[rgba(28,58,41,0.3)] disabled:pointer-events-none disabled:opacity-35";
	return (
		<div className="mt-6 flex items-center justify-center gap-2">
			<button type="button" onClick={() => onPage(0)} disabled={!previous || loading} className={buttonClass}>First</button>
			<button type="button" aria-label="Previous page" onClick={() => onPage(page - 1)} disabled={!previous || loading} className={buttonClass}>
				<ArrowLeft className="h-4 w-4" />
			</button>
			<span className="flex h-10 items-center rounded-xl border border-[rgba(28,58,41,0.12)] px-4 text-[13px] text-ink-secondary tabular-nums">
				{loading && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
				Page {page + 1} of {totalPages}
			</span>
			<button type="button" aria-label="Next page" onClick={() => onPage(page + 1)} disabled={!next || loading} className={buttonClass}>
				<ArrowRight className="h-4 w-4" />
			</button>
			<button type="button" onClick={() => onPage(totalPages - 1)} disabled={!next || loading} className={buttonClass}>Last</button>
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
	seconds: bigint | null;
	off: string | null;
} & (
	| { pending: true; status: FlowStatus; originChainId: string; at: number; flow?: PublicFlow }
	| { pending: false; at: number; event: ActivityEvent }
);

function LiveFeed({ onSelect, feed, setFeed, pageIndex, setPageIndex }: {
	onSelect: (n: string) => void;
	feed: ActivityRead | null;
	setFeed: (feed: ActivityRead) => void;
	pageIndex: number;
	setPageIndex: (page: number) => void;
}) {
	const [, tick] = useReducer((n: number) => n + 1, 0);
	const reduced = useReducedMotion() ?? false;
	const [loadingPage, setLoadingPage] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);
	const tableRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		let loading = false;
		let stopped = false;
		let timer = 0;
		let failures = 0;
		const schedule = (delay: number) => {
			window.clearTimeout(timer);
			if (document.hidden) return;
			timer = window.setTimeout(() => void load(), delay);
		};
		const load = async () => {
			if (stopped || document.hidden || loading) return;
			loading = true;
			setLoadingPage(true);
			try {
				const nextFeed = await getActivity(pageIndex + 1, ACTIVITY_PAGE_SIZE);
				if (stopped) return;
				setFeed(nextFeed);
				syncFeed(nextFeed);
				failures = 0;
				setLoadError(null);
				tick();
			} catch (cause) {
				if (stopped) return;
				failures += 1;
				setLoadError(cause instanceof Error ? cause.message : "Could not load activity.");
			} finally {
				loading = false;
				if (!stopped) setLoadingPage(false);
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
	}, [pageIndex, setFeed]);

	const inFlight = activeFlows().slice(0, MAX_IN_FLIGHT);
	const settled = (feed?.items ?? []).map(({ name, renewal }) => ({
		...renewalEvent(renewal, name.label),
		name: name.displayName,
	}));
	const totalPages = feed?.totalPages ?? 1;
	const goToPage = (next: number) => {
		setPageIndex(next);
		tableRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
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
			flow: feed?.flows.find(({ flow }) => flow.id === f.id)?.flow,
			at: f.startedAt,
		})),
		...settled.map((e) => ({
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
			event: e,
		})),
	];

	return (
		<>
			{loadError && <p role="alert" className="mb-3 text-[12.5px] text-red-700">{loadError}</p>}
			<div ref={tableRef} className="scroll-mt-6 border border-[rgba(28,58,41,0.1)] rounded-2xl overflow-hidden">
			{/* Desktop column headers, hidden on mobile where rows become cards */}
			<div className={`hidden lg:grid ${LIVE_FEED_COLUMNS} gap-4 px-5 py-3 bg-[rgba(28,58,41,0.03)] border-b border-[rgba(28,58,41,0.1)] text-[11px] uppercase tracking-wider text-ink-label`}>
				<span>ENS name</span>
				<span>Chain</span>
				<span className="text-right">Received</span>
				<span className="text-center">Discount</span>
				<span className="text-right">Time added</span>
				<span className="text-right">Status</span>
				<span className="text-right">Details</span>
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
						<p className="px-5 py-8 text-center text-[13px] text-ink-secondary">No renewal activity yet.</p>
					)}
			</div>
			</div>
			<ActivityPagination
				page={pageIndex}
				totalPages={totalPages}
				loading={loadingPage}
				onPage={goToPage}
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

function CopyableAddress({ address, label }: { address: string; label: string }) {
	const [copied, setCopied] = useState(false);
	const copyable = /^0x[a-f\d]{40}$/i.test(address);

	const copyAddress = async () => {
		try {
			await navigator.clipboard.writeText(address);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1200);
		} catch {
			setCopied(false);
		}
	};

	return (
		<>
			<span className="min-w-0 flex-1 break-all font-mono">{address}</span>
			{copyable && (
				<button
					type="button"
					onClick={() => void copyAddress()}
					aria-label={copied ? `${label} address copied` : `Copy ${label} address`}
					title={copied ? "Copied" : `Copy ${label} address`}
					className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-[rgba(28,58,41,0.06)] hover:text-ink-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(28,58,41,0.6)]"
				>
					{copied ? <Check aria-hidden="true" className="h-3.5 w-3.5" /> : <Copy aria-hidden="true" className="h-3.5 w-3.5" />}
				</button>
			)}
		</>
	);
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
		<div className="mx-4 md:mx-5 my-3 rounded-xl bg-white p-4 md:p-5 grid gap-5 md:grid-cols-2">
			<div className="min-w-0">
				<div className="text-[10px] uppercase tracking-wider text-ink-label">
					Amount
				</div>
				{/* Exact amounts here, not rounded ones. This is the panel someone opens
			    to check the arithmetic, and a tier threshold can turn on a
			    micro-unit — "$27" would be true of both $27.000071 (six years at
			    43.75% off) and $27.00 (four years eleven months at 31.25%). */}
				<dl className="mt-2.5 space-y-1.5 text-[13px]">
					<div className="flex justify-between gap-4">
						<dt className="text-ink-secondary">Received</dt>
						<dd className="text-ink-action tabular-nums">
							{fmtUsdcExact(event.amountDeposited)}
						</dd>
					</div>
					{event.gasAllowance > 0n && (
						<div className="flex justify-between gap-4">
							<dt className="text-ink-secondary">Gas allowance</dt>
							<dd className="text-ink-secondary tabular-nums">
								−{fmtUsdcExact(event.gasAllowance)}
							</dd>
						</div>
					)}
					<div className="flex justify-between gap-4 pt-1.5 border-t border-[rgba(28,58,41,0.08)]">
						<dt className="text-ink-secondary">Applied to renewal</dt>
						<dd className="text-ink-primary tabular-nums">
							{fmtUsdcExact(event.amountApplied)}
						</dd>
					</div>
					{/* Without this the panel says where the money went but not what it
					    bought it at, so "$27 · 6 years" looks like bad arithmetic until
					    you notice the bulk rate is $4.50, not the headline $8. */}
					{hasMeaningfulDuration && (
						<div className="flex justify-between gap-4">
							<dt className="text-ink-secondary">Effective rate</dt>
							<dd className="text-ink-secondary tabular-nums">
								{fmtUsdc(effectiveRate)}/year
							</dd>
						</div>
					)}
				</dl>
				<dl className="mt-4 space-y-1.5 border-t border-[rgba(28,58,41,0.08)] pt-3 text-[12px]">
					<div>
						<dt className="text-ink-secondary">Funded by</dt>
						<dd className="mt-0.5 flex min-w-0 items-start gap-1.5 text-ink-action">
							<CopyableAddress address={event.funder} label="funded by" />
						</dd>
					</div>
					<div>
						<dt className="text-ink-secondary">Processed by</dt>
						<dd className="mt-0.5 flex min-w-0 items-start gap-1.5 text-ink-action">
							{event.executorIsRelayer && <span className="shrink-0">Namepass ·</span>}
							<CopyableAddress address={event.executor} label="processed by" />
						</dd>
					</div>
				</dl>
				</div>

			<div className="min-w-0 md:border-l md:border-[rgba(28,58,41,0.08)] md:pl-5">
				<div className="text-[10px] uppercase tracking-wider text-ink-label">
					Transactions
				</div>
				<ol className="mt-3 space-y-2">
					{event.steps.map((s, i) => (
						<li key={s.tx} className="flex min-w-0 items-center gap-2.5 rounded-lg bg-[rgba(28,58,41,0.015)] px-3 py-2.5">
							<span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[rgba(28,58,41,0.06)] text-[10px] text-ink-secondary tabular-nums">
								{i + 1}
							</span>
							<div className="min-w-0 flex-1">
								<div className="flex items-center justify-between gap-2 text-[12.5px]">
									<span>{stepLabel(s, bridged)}</span>
									<span className="shrink-0 text-[11px] text-ink-secondary">{s.chain}</span>
								</div>
								<a
									href={explorerUrl(s.chain, s.tx)}
									target="_blank"
									rel="noopener noreferrer"
									className="mt-1 inline-flex items-center gap-1.5 font-mono text-[12px] text-ink-action hover:text-ink-primary transition-colors"
								>
									{truncTx(s.tx)}
									<ExternalLink className="w-2.5 h-2.5 shrink-0" />
								</a>
							</div>
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
		<div className="mt-5 rounded-2xl bg-[rgba(28,58,41,0.035)] p-4">
			<h4 className="text-[15px] text-ink-primary">Waiting to renew</h4>
			<p className="mt-1.5 text-[13px] leading-relaxed text-ink-secondary">The USDC left {chain?.name ?? "the origin chain"} and is secured in a Circle message. This name cannot be renewed now. Namepass will retry when renewal is possible.</p>
			<dl className="mt-3 space-y-1 text-[12px] text-ink-secondary">
				<div className="flex justify-between gap-4"><dt>Amount</dt><dd>{fmtUsdcExact(flowAmount(flow))}</dd></div>
				<div className="flex justify-between gap-4"><dt>Origin chain</dt><dd>{chain?.name ?? flow.originChainId}</dd></div>
				<div className="flex justify-between gap-4"><dt>Circle nonce</dt><dd className="font-mono truncate">{flow.cctpNonce ?? "Not available"}</dd></div>
				<div className="flex justify-between gap-4"><dt>Latest retry</dt><dd>{flow.nextActionAt ? fmtDate(new Date(flow.nextActionAt).getTime()) : "Not scheduled"}</dd></div>
			</dl>
			{evidence?.originTxHash && chain && <a href={explorerUrl(chain.name, evidence.originTxHash)} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1.5 font-mono text-[12px] text-ink-action hover:text-ink-primary">Origin transaction {truncTx(evidence.originTxHash)} <ExternalLink className="w-3 h-3" /></a>}
			<p className="mt-3 text-[12px] leading-relaxed text-ink-secondary">This transfer cannot return to {chain?.name ?? "the origin chain"}. A retry uses the same Circle message.</p>
			{renewable && <button type="button" onClick={() => void retry()} disabled={retrying} className="mt-3 inline-flex items-center gap-2 rounded-[10px] border border-[rgba(28,58,41,0.25)] px-3 py-1.5 text-[12px] text-ink-action hover:border-transparent hover:bg-white disabled:opacity-50">{retrying && <Loader2 className="w-3 h-3 animate-spin" />}Retry renewal</button>}
			{error && <p role="alert" className="mt-2 text-[12px] text-red-700">{error}</p>}
		</div>
	);
}

function FailedCctpFlowCard({ flow }: { flow: PublicFlow }) {
	const chain = chainById(safeInteger(flow.originChainId) ?? -1);
	const originTxHash = flow.evidence?.originTxHash;
	return (
		<div className="mt-5 rounded-2xl bg-red-950/[0.025] p-4">
			<h4 className="text-[15px] text-ink-primary">Renewal needs attention</h4>
			<p className="mt-1.5 text-[13px] leading-relaxed text-ink-secondary">
				The USDC left {chain?.name ?? "the origin chain"} through Circle, but the Ethereum renewal did not complete. This flow needs repair by Namepass. The funds are not waiting at the deposit address.
			</p>
			<dl className="mt-3 space-y-1 text-[12px] text-ink-secondary">
				<div className="flex justify-between gap-4"><dt>Amount</dt><dd>{fmtUsdcExact(flowAmount(flow))}</dd></div>
				<div className="flex justify-between gap-4"><dt>Origin chain</dt><dd>{chain?.name ?? flow.originChainId}</dd></div>
			</dl>
			{originTxHash && chain && (
				<a href={explorerUrl(chain.name, originTxHash)} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1.5 font-mono text-[12px] text-ink-action hover:text-ink-primary">
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
	activityTotalPages,
	activityLoading,
	onActivityPage,
}: {
	record: NameRecord;
	onBack: () => void;
	onSupportedTokens: () => void;
	onRefresh: () => void;
	activityPage: number;
	activityTotalPages: number;
	activityLoading: boolean;
	onActivityPage: (page: number) => void;
}) {
	/* Which renewal has its transaction breakdown open. One at a time. */
	const [openEvent, setOpenEvent] = useState<string | null>(null);
	const reducedMotion = useReducedMotion() ?? false;
	const allEvents = [...record.events].reverse();
	const renewalEvents = allEvents.filter((event) => event.kind === "renewal");
	const activationEvent = allEvents.find((event) => event.kind === "activated");
	const emptyActivity = activityEmptyState(record);
	const events = [...renewalEvents];
	if (activityPage + 1 >= activityTotalPages && activationEvent) events.push(activationEvent);
	const activityRef = useRef<HTMLDivElement>(null);
	const previousActivityPage = useRef(activityPage);
	const expiry = nameExpiry(record);
	const daysLeft = Math.round((expiry - Date.now()) / 86_400_000);
	const [profile, setProfile] = useState<EnsProfile | null>(null);
	const [profileLoading, setProfileLoading] = useState(true);
	const fallbackAvatar = `https://api.dicebear.com/10.x/waves/svg?tags=animation&seed=${encodeURIComponent(record.name)}`;

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
	let pricing: ReturnType<typeof rates> | null;
	try {
		pricing = rates();
	} catch (error) {
		if (!(error instanceof PricingNotLoadedError)) throw error;
		pricing = null;
	}

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
		if (!pricing || onchain?.lapsedFor == null) return null;
		/* +1s: buying back exactly what has lapsed lands on the expiry, not past it. */
		const owed = BigInt(Math.ceil(onchain.lapsedFor / 1000)) + 1n;
		const catchUp = ceilToCent(costOf(owed, record.labelLength) + GAS_ALLOWANCE);
		const floor = minTrigger(String(HUB_CHAIN.chainId));
		if (floor === undefined) return null;
		return catchUp >= floor
			? { amount: catchUp, bound: "catch-up" as const }
			: { amount: floor, bound: "trigger" as const };
	}, [onchain?.lapsedFor, record.labelLength, pricing]);

	const t = profile?.text ?? {};
	const links = (
		[
			{ key: "url", value: t.url, Icon: LinkIcon },
			{ key: "com.twitter", value: t["com.twitter"], Icon: XIcon },
			{ key: "com.github", value: t["com.github"], Icon: Github },
			{ key: "org.telegram", value: t["org.telegram"], Icon: Send },
			{ key: "location", value: t.location, Icon: MapPin },
			{ key: "email", value: t.email, Icon: Mail },
		] as const
	).filter((l): l is typeof l & { value: string } => Boolean(l.value));

	return (
		<motion.div
			initial={reducedMotion ? false : { opacity: 0, y: 12 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: reducedMotion ? 0 : 0.4, ease: [0.16, 1, 0.3, 1] }}
		>
			<div className="flex min-w-0 items-start gap-2.5">
				<BackButton
					onClick={onBack}
					label="Back to Explorer"
					className="relative -top-0.5 md:top-1"
				/>

				<h3 className="min-w-0 break-words text-[32px] md:text-[44px] font-normal text-ink-primary tracking-tight leading-none">
					{record.name}
				</h3>
			</div>

			{/* The two-panel model: what expires vs. what is permanent */}
			<div className="mt-8 grid md:grid-cols-2 gap-4">
				<div className="rounded-2xl border border-[rgba(28,58,41,0.12)] bg-white p-5 flex flex-col">
					<div className="flex items-center gap-2 text-[11px] uppercase tracking-section text-ink-label">
						<Clock className="w-3.5 h-3.5" />
						The ENS name · expires
					</div>

					{/* Three states, and the middle two must not look alike: not read
					    yet, read and unregistered, read and registered. Rendering
					    "not registered" while the call is still in flight tells
					    someone their name doesn't exist because an RPC was slow. */}
					{!onchain ? (
						<>
							<div className="mt-3 h-[30px] w-40 rounded-lg bg-[rgba(28,58,41,0.07)] motion-safe:animate-pulse" />
							<div className="mt-3 h-[13px] w-56 rounded-full bg-[rgba(28,58,41,0.06)] motion-safe:animate-pulse" />
						</>
					) : onchain.expiry === null ? (
						<>
							<div className="mt-3 text-[26px] md:text-[30px] text-ink-secondary tracking-tight leading-none">
								Not registered
							</div>
							<div className="mt-2 text-[13px] text-ink-secondary">
								Nobody holds this name on Ethereum yet.
							</div>
						</>
					) : (
						<>
							<div className="mt-3 text-[26px] md:text-[30px] text-ink-primary tracking-tight leading-none">
								{fmtDate(expiry)}
							</div>
							<div className="mt-2 text-[13px] text-ink-secondary">
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
						<div className="mt-3 flex items-start gap-2 rounded-xl bg-[rgba(28,58,41,0.03)] px-3 py-2.5">
							<Clock className="w-3.5 h-3.5 mt-[2px] shrink-0 text-ink-secondary" />
							<p className="text-[12.5px] text-ink-secondary leading-relaxed">
								<span className="text-ink-primary">
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
										<span className="text-ink-primary tabular-nums">
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
						<div className="mt-3 flex items-start gap-2 rounded-xl bg-[rgba(28,58,41,0.03)] px-3 py-2.5">
							<Clock className="w-3.5 h-3.5 mt-[2px] shrink-0 text-ink-secondary" />
							<p className="text-[12.5px] text-ink-secondary leading-relaxed">
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
					<div className="mt-5 pt-5 border-t border-[rgba(28,58,41,0.08)] flex-1">
						<div className="flex items-center justify-between">
							<span className="text-[10px] uppercase tracking-wider text-ink-label">
								Profile
							</span>
							{profile?.contenthash && (
								<a
									href={`https://${record.name}.limo`}
									target="_blank"
									rel="noopener noreferrer"
									className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-action hover:text-ink-primary transition-colors"
								>
									<Globe className="w-3.5 h-3.5" />
									Serves a site
									<ExternalLink className="w-3.5 h-3.5" />
								</a>
							)}
						</div>

						{/* Avatar + description */}
						<div className="mt-3 flex items-start gap-3">
							<div className="relative w-11 h-11 shrink-0 rounded-xl bg-[rgba(28,58,41,0.07)] overflow-hidden flex items-center justify-center">
								<span aria-hidden="true" className="text-[13px] text-ink-secondary">
									{record.name.slice(0, 2)}
								</span>
								<img
									src={profile?.avatar || fallbackAvatar}
									alt=""
									className="absolute inset-0 w-full h-full object-cover"
									onLoad={(e) => { e.currentTarget.style.display = "block"; }}
									onError={(e) => {
										const image = e.currentTarget;
										if (image.getAttribute("src") !== fallbackAvatar) image.src = fallbackAvatar;
										else image.style.display = "none";
									}}
								/>
							</div>
							<div className="min-w-0 flex-1">
								{profileLoading ? (
									<div className="space-y-1.5 pt-1">
										<div className="h-3 w-3/4 rounded bg-[rgba(28,58,41,0.08)] animate-pulse" />
										<div className="h-3 w-1/2 rounded bg-[rgba(28,58,41,0.06)] animate-pulse" />
									</div>
								) : profile?.text.description ? (
									<p className="text-[13px] text-ink-action leading-snug">
										{profile.text.description}
									</p>
								) : (
									<p className="text-[13px] text-ink-secondary">
										No description set.
									</p>
								)}
								{profile?.addr && (
									<div className="mt-1.5 min-w-0 text-[12px] text-ink-secondary font-mono truncate">
										{truncAddress(profile.addr)}
									</div>
								)}
							</div>
						</div>

						{/* Links */}
						{links.length > 0 && (
							<div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
								{links.map((l) => {
									const href = profileRecordHref(l.key, l.value);
									const label = profileRecordLabel(l.key, l.value);
									return (
										<span
											key={l.key}
											className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-secondary min-w-0"
										>
											<l.Icon className="w-3.5 h-3.5 shrink-0 text-ink-secondary" />
											{href ? (
												<a
													href={href}
													target="_blank"
														rel="noopener noreferrer"
													className="truncate hover:text-ink-primary hover:font-semibold transition-colors"
												>
													{label}
													</a>
												) : (
													<span className="truncate">{label}</span>
												)}
										</span>
									);
								})}
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
			<div className="mt-4 grid grid-cols-3 gap-px bg-[rgba(28,58,41,0.1)] rounded-2xl overflow-hidden">
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
						<div className="flex-1 text-[10px] uppercase tracking-wider text-ink-label">
							{s.k}
						</div>
							<span className="mt-1.5 block text-[19px] text-ink-primary tracking-tight tabular-nums whitespace-nowrap">
								{s.value}
							</span>
					</div>
				))}
			</div>

			{/* Activity table */}
			<div ref={activityRef} className="mt-10 scroll-mt-6">
				<div className="flex items-baseline justify-between mb-4">
					<span className="text-[11px] uppercase tracking-section text-ink-label">
						Activity
					</span>
					{emptyActivity && (
						<span className="text-[12px] text-ink-secondary">
							{emptyActivity === "no_completed_renewals" ? "No completed renewals yet" : "Waiting for the first payment"}
						</span>
					)}
				</div>

				<div className="border border-[rgba(28,58,41,0.1)] rounded-2xl overflow-hidden">
					<div className={`hidden lg:grid ${NAME_ACTIVITY_COLUMNS} gap-4 px-5 py-3 bg-[rgba(28,58,41,0.03)] border-b border-[rgba(28,58,41,0.1)] text-[11px] uppercase tracking-wider text-ink-label`}>
						<span>Date</span>
						<span>Event</span>
						<span>Chain</span>
						<span className="text-right">Received</span>
						<span className="text-center">Discount</span>
						<span className="text-right">Time added</span>
						<span className="text-right">Details</span>
					</div>

					<div className="divide-y divide-[rgba(28,58,41,0.07)]">
						{events.map((e) => {
							/* Activation has no transactions behind it, so nothing to open. */
							const expandable = e.kind === "renewal" && e.steps.length > 0;
							const isOpen = openEvent === e.id;
							const eventTitle = e.kind === "activated" ? "Namepass activated" : e.kind === "deposit" ? "Payment received" : "Renewal";
							const eventRate = e.kind === "renewal" ? (e.off === null ? "—" : e.off ? `${e.off} off` : "Standard") : "-";
							const eventTime = e.kind === "renewal" ? fmtDuration(e.seconds) : "-";
							const toggleEvent = () => setOpenEvent(isOpen ? null : e.id);
							return (
							<div key={e.id}>
								<MobileFlowSummary
									title={<span className="min-w-0 flex-1 truncate text-[15px] text-ink-primary">{eventTitle}</span>}
									chain={e.kind === "activated" ? "-" : <ChainTag chain={e.chain} />}
									received={e.kind === "activated" ? "-" : <AmountCell deposited={e.amountDeposited} applied={e.amountApplied} showApplied={e.kind === "renewal" && e.gasAllowance > 0n} dense />}
									rate={eventRate}
									time={eventTime}
									footer={fmtDate(e.at)}
									expandable={expandable}
									expanded={isOpen}
									controlsId={`renewal-details-${e.id}`}
									onToggle={toggleEvent}
									showDetails={e.kind !== "activated"}
								/>
								<button
									type="button"
									disabled={!expandable}
									aria-expanded={expandable ? isOpen : undefined}
									aria-controls={expandable ? `renewal-details-${e.id}` : undefined}
									onClick={toggleEvent}
									className={`hidden lg:grid w-full text-left px-5 py-3.5 ${NAME_ACTIVITY_COLUMNS} gap-4 items-center ${expandable ? "hover:bg-[rgba(28,58,41,0.025)] transition-colors" : "cursor-default"}`}
								>
									<span className="text-[13px] text-ink-secondary tabular-nums">{fmtDate(e.at)}</span>
									<span className="text-[14.5px] text-ink-primary">{eventTitle}</span>
									<span className="text-[13.5px]">{e.kind !== "activated" ? <ChainTag chain={e.chain} /> : <span className="text-ink-secondary">-</span>}</span>
									<span className="text-[13.5px] text-ink-secondary text-right tabular-nums">{e.kind !== "activated" ? <AmountCell deposited={e.amountDeposited} applied={e.amountApplied} showApplied={e.kind === "renewal" && e.gasAllowance > 0n} /> : "-"}</span>
									<span className="flex justify-center">{e.kind === "renewal" ? <DiscountTag off={e.off} /> : <span className="text-ink-secondary">-</span>}</span>
									<span className="text-[13.5px] text-ink-primary text-right tabular-nums">{eventTime}</span>
									<span className="flex justify-end">{expandable && <span className="inline-flex min-h-9 w-full items-center justify-end gap-1.5 rounded-lg border border-[rgba(28,58,41,0.14)] px-2.5 text-[11px] text-ink-secondary">{isOpen ? "Hide details" : "Flow details"}<ChevronDown className={`w-4 h-4 text-ink-secondary transition-transform ${isOpen ? "rotate-180" : ""}`} /></span>}</span>
								</button>
							{e.kind === "deposit" && (
								<p className="px-4 pb-3 text-[12px] text-ink-secondary md:px-5" aria-label={`Funded by ${e.funder}`}>
									Funded by <span className="font-mono">{e.funder}</span>
								</p>
							)}

							<AnimatePresence initial={false}>
								{isOpen && (
									<motion.div
										id={`renewal-details-${e.id}`}
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
					totalPages={activityTotalPages}
					loading={activityLoading}
					onPage={onActivityPage}
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
	/* Keep the last feed page when its view unmounts for a name detail. */
	const [feed, setFeed] = useState<ActivityRead | null>(null);
	const [feedPageIndex, setFeedPageIndex] = useState(0);
	const [query, setQuery] = useState("");
	const [notFound, setNotFound] = useState<string | null>(null);
	const [activating, setActivating] = useState(false);
	const [version, refresh] = useReducer((value: number) => value + 1, 0);
	const [reloadVersion, reload] = useReducer((value: number) => value + 1, 0);
	const [requestError, setRequestError] = useState<string | null>(null);
	const [configVersion, refreshConfig] = useReducer((value: number) => value + 1, 0);
	const ensFreshLabel = useRef<string | null>(null);
	const [nameTotalPages, setNameTotalPages] = useState(1);
	const [loadingNamePage, setLoadingNamePage] = useState(false);
	const [namePageIndex, setNamePageIndex] = useState(0);

	useEffect(() => {
		setNameTotalPages(1);
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
		const load = async (refreshEns = false) => {
			if (stopped || document.hidden || loading) return;
			loading = true;
			setLoadingNamePage(true);
			try {
				const label = normalizeLabel(selected);
				if (refreshEns || ensFreshLabel.current !== label) {
					await getName(label);
					ensFreshLabel.current = label;
				}
				if (stopped) return;
				const activity = await getNameActivity(selected, namePageIndex + 1, ACTIVITY_PAGE_SIZE);
				if (!stopped) {
					syncName(activity);
					setNameTotalPages(activity.totalPages ?? 1);
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
				if (!stopped) setLoadingNamePage(false);
				const current = findName(selected);
				const delay = current && hasActiveFlow(current) ? 4_000 : 15_000;
				if (!stopped) schedule(Math.min(delay * 2 ** failures, 60_000));
			}
		};
		const focus = () => {
			window.clearTimeout(timer);
			if (!document.hidden) void load(true);
		};
		const visibility = () => {
			window.clearTimeout(timer);
			if (!document.hidden) void load(true);
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
	}, [selected, reloadVersion, configVersion, namePageIndex]);

	const suggestions = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return [];
		return allNames()
			.filter((r) => r.name.includes(q))
			.slice(0, 6);
	}, [query]);

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
			ensFreshLabel.current = label;
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
		<section id="explorer" className="bg-[#f0f0f0] px-5 md:px-10 py-14 md:py-20">
			<div className="max-w-[1100px] mx-auto">
				<div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
					<div>
						<div className="flex items-center gap-2.5">
							<span className="relative flex w-2 h-2">
								<span className="absolute inline-flex w-full h-full rounded-full bg-[rgba(28,58,41,0.35)] animate-ping" />
								<span className="relative inline-flex w-2 h-2 rounded-full bg-[rgba(28,58,41,0.8)]" />
							</span>
							<span className="text-[11px] uppercase tracking-section text-ink-label">
								Explorer · Live
							</span>
						</div>
						<h2 className="mt-3 text-[36px] md:text-[52px] font-normal text-ink-primary tracking-tight leading-[1.05]">
							ENS renewal activity.
						</h2>
						<p className="mt-3 text-[15px] md:text-[16px] text-ink-secondary max-w-xl leading-relaxed">
							Search a name to inspect its deterministic deposit wallet, balances, and renewal history.
							Recent public deposits and flows appear below.
						</p>
					</div>

					<div className="w-full md:w-[340px] shrink-0">
						<div className="flex items-center gap-2 bg-white rounded-[12px] pl-4 pr-1.5 py-1.5 shadow-[0_3px_10px_rgba(28,58,41,0.08)] focus-within:shadow-[0_4px_14px_rgba(28,58,41,0.14)] transition-shadow">
							<input
								aria-label="Search an ENS name"
								value={query}
								onChange={(e) => {
									setQuery(e.target.value);
									setNotFound(null);
								}}
								onKeyDown={(e) => e.key === "Enter" && submit()}
								placeholder="Search a name, e.g. vitalik.eth"
								className="flex-1 min-w-0 bg-transparent outline-none text-[14px] text-ink-primary placeholder:text-ink-secondary"
							/>
							<button
								type="button"
								onClick={() => void submit()}
								aria-label="Search"
								className={SEARCH_ICON_BUTTON_CLASS}
							>
								<Search className="w-4 h-4" />
							</button>
						</div>

						{suggestions.length > 0 && (
							<div className="mt-2 rounded-[0.9rem] overflow-hidden bg-white shadow-[0_3px_10px_rgba(28,58,41,0.08)]">
								{suggestions.map((s) => (
									<button
										key={s.name}
										onClick={() => {
											void submit(s.name);
										}}
										className="w-full text-left px-4 py-2.5 text-[14px] text-ink-action hover:bg-[rgba(28,58,41,0.04)] transition-colors flex items-center justify-between gap-3"
									>
										{s.name}
										<span className="text-[11px] text-ink-secondary">
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
								className="mt-2 rounded-[0.9rem] bg-[rgba(28,58,41,0.03)] p-4"
							>
								<div className="text-[13.5px] text-ink-action">
									<span className="font-medium">{notFound}</span> can't be registered.
								</div>
								{/* A name ENS can't hold — too short to be priced, or not a name
								    ENSIP-15 admits — could never buy any time, so say so rather
								    than letting someone activate an address that can never work. */}
								<p className="mt-1 text-[12.5px] text-ink-secondary leading-relaxed">
									{LABEL_PROBLEM_TEXT[problem]}
								</p>
							</motion.div>
						)}

						{notFound && !problem && (
							<motion.div
								initial={{ opacity: 0, y: -4 }}
								animate={{ opacity: 1, y: 0 }}
								transition={{ duration: 0.25 }}
								className="mt-2 rounded-[0.9rem] bg-[rgba(28,58,41,0.03)] p-4"
							>
								<div className="text-[13.5px] text-ink-action">
									<span className="font-medium">{notFound}</span> is not monitored by
									Namepass yet.
								</div>
								<p className="mt-1 text-[12.5px] text-ink-secondary leading-relaxed">
									Start tracking it to see its deposit address, balances, and renewal activity.
									You do not have to own the name.
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
									className="mt-3 w-full flex items-center justify-center gap-2 bg-[rgba(28,58,41,0.9)] text-ink-inverse rounded-[10px] py-2.5 hover:bg-[rgba(28,58,41,1)] transition-colors disabled:opacity-70"
								>
									{activating ? (
										<>
											<Loader2 className="w-3.5 h-3.5 animate-spin" />
											<span className="text-[14px]">Activating…</span>
										</>
									) : (
										<>
											<Zap className="w-3.5 h-3.5" />
											<span className="text-[14px]">Enable monitoring</span>
										</>
									)}
								</button>
							</motion.div>
						)}
					</div>
				</div>
				{requestError && <p role="alert" className="mt-3 text-[12.5px] text-red-700">{requestError}</p>}

				<div className="mt-8 md:mt-10 bg-white rounded-2xl p-4 md:p-6">
					{record ? (
						<NameDetail
							record={record}
							onBack={() => onSelect(null)}
							onSupportedTokens={onSupportedTokens}
							onRefresh={reload}
							activityPage={namePageIndex}
							activityTotalPages={nameTotalPages}
							activityLoading={loadingNamePage}
							onActivityPage={setNamePageIndex}
						/>
					) : (
						<LiveFeed onSelect={onSelect} feed={feed} setFeed={setFeed} pageIndex={feedPageIndex} setPageIndex={setFeedPageIndex} />
					)}
				</div>
			</div>
		</section>
	);
}

import { motion, AnimatePresence } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, ExternalLink, Loader2, Wallet } from "lucide-react";
import { canRecheckName, canTrigger, minTrigger, totalHeld, totalInFlight, type ChainBalance, type ChainFlow, type HoldReason, type NameRecord } from "../lib/readModel";
import { flowFailurePresentation, flowPresentation } from "../lib/flowPresentation";
import { completedFlowTransactions } from "../lib/flowTransactions";
import { DETECTION_GRACE_MS, isDetectionPending, updateDetectionObservations, type DetectionObservations } from "../lib/detectionGrace";
import { triggerFlow } from "../lib/publicApi";
import { chainByName } from "../lib/chains";
import { explorerUrl, fmtUsdc, truncTx } from "../lib/format";
import Tooltip from "./Tooltip";
import ChainTag from "./ChainTag";

/* Each reason gets its own sentence. "We tried and it failed" must never read
   the same as "waiting for the name to become renewable" — they need
   different things from whoever is looking at them. */
function holdCopy(reason: HoldReason, minimum: bigint | undefined, chainId: string, errorCode?: string | null): string {
	const floor = minimum === undefined ? "The chain minimum is not available yet." : `A renewal needs at least ${fmtUsdc(minimum)} on one chain. Balances on different chains can't be combined, so this one goes out as soon as more arrives on the same chain.`;
	return {
	flow_in_progress:
		"A renewal is already running on this chain. These funds are queued and go out with the next one.",
	scan_pending:
		"Namepass recorded new activity on this chain. The recovery scan will check the current balance before it starts another renewal.",
	name_inactive:
		"This name isn't currently registered. It may have expired, be in its premium auction, or never have been registered. The funds stay here until it can be renewed again.",
	below_threshold: floor,
	not_detected:
		"This payment wasn't picked up automatically, which shouldn't happen. Normally a renewal starts the moment funds arrive. Anyone can push it through.",
	flow_failed: flowFailurePresentation(chainId, errorCode).detail,
	unknown:
		"The current balance or chain minimum is not available. It is not treated as zero and will be checked again.",
	}[reason];
}

/* Scannable version of the same fact — the sentence lives in the tooltip. */
function holdLabel(reason: HoldReason, minimum: bigint | undefined, chainId: string, errorCode?: string | null): string {
	return {
	flow_in_progress: "Queued behind the current renewal",
	scan_pending: "Queued for balance scan",
	name_inactive: "Name isn't registered right now",
	/* States the number — "too small" alone leaves nobody able to act on it. */
	below_threshold: minimum === undefined ? "Chain minimum unavailable" : `Under the ${fmtUsdc(minimum)} minimum on this chain`,
	not_detected: "Wasn't picked up automatically",
	flow_failed: flowFailurePresentation(chainId, errorCode).label,
	unknown: "Balance or minimum unavailable",
	}[reason];
}

interface Props {
	record: NameRecord;
	/** Fired when a flow settles, so the page can pick up the new renewal. */
	onSettled: () => void;
}

export default function PendingBalance({ record, onSettled }: Props) {
	const [open, setOpen] = useState(false);
	const [triggering, setTriggering] = useState<string | null>(null);
	const [triggerError, setTriggerError] = useState<string | null>(null);
	const [detectionObservations, setDetectionObservations] = useState<DetectionObservations>({});
	const [, setGraceClock] = useState(() => Date.now());
	const lastObservedRecord = useRef<NameRecord | null>(null);
	const p = record.pending;
	const now = Date.now();

	useEffect(() => {
		if (lastObservedRecord.current === record) return;
		lastObservedRecord.current = record;
		const unmatched = p.balances
			.filter((balance) => balance.holdReason === "not_detected" && canTrigger(p, balance))
			.map((balance) => balance.chainId);
		setDetectionObservations((current) => updateDetectionObservations(current, unmatched, Date.now()));
	}, [p, record]);

	useEffect(() => {
		const currentTime = Date.now();
		const nextExpiry = Object.values(detectionObservations)
			.filter((observation) => observation.reads >= 2)
			.map((observation) => observation.firstSeenAt + DETECTION_GRACE_MS)
			.filter((expiry) => expiry > currentTime)
			.sort((a, b) => a - b)[0];
		if (nextExpiry === undefined) return;
		const timer = window.setTimeout(() => setGraceClock(Date.now()), nextExpiry - currentTime);
		return () => window.clearTimeout(timer);
	}, [detectionObservations]);

	const held = totalHeld(p);
	const inFlight = totalInFlight(p);
	const unknown = p.balances.filter((balance) => balance.amount === null);
	if (held === 0n && inFlight === 0n && unknown.length === 0) return null;

	/* Chains with anything on them, flows first so a chain that is both
	   renewing and holding shows its motion above its queue. */
	const chains = [
		...new Set([...p.flows.map((f) => f.chain), ...p.balances.map((b) => b.chain)]),
	];

	/* Only what a person can actually clear right now. A newly visible balance
	   gets time to acquire its automatic flow before it becomes retryable. */
	const detecting = p.balances.filter((balance) => isDetectionPending(
		balance.holdReason,
		canTrigger(p, balance),
		detectionObservations[balance.chainId],
		now,
	));
	const detectingChainIds = new Set(detecting.map((balance) => balance.chainId));
	const stuck = p.balances.filter((balance) => canTrigger(p, balance) && !detectingChainIds.has(balance.chainId));

	/* Collapsed line surfaces the most urgent thing: something a person could
	   fix, then something moving, then something merely waiting. */
	let summary: React.ReactNode;
	if (stuck.length > 0) {
		summary = (
			<>
				{fmtUsdc(stuck.reduce((s, b) => s + (b.amount ?? 0n), 0n))} on{" "}
				{stuck.map((b) => b.chain).join(" and ")} needs a retry
			</>
		);
	} else if (p.flows.length > 0) {
		/* Name the waiting balance too. Reporting only the flow made money look
		   like it vanished when one started and reappeared when it settled —
		   these are different chains' funds and both are still sitting there. */
		summary = (
			<>
				{p.flows.length} renewal{p.flows.length === 1 ? "" : "s"} in progress ·{" "}
				{held > 0n ? `${fmtUsdc(held)} also waiting` : fmtUsdc(inFlight)}
			</>
		);
	} else if (detecting.length > 0) {
		summary = (
			<>
				{fmtUsdc(detecting.reduce((sum, balance) => sum + (balance.amount ?? 0n), 0n))} detected on{" "}
				{detecting.map((balance) => balance.chain).join(" and ")} · preparing renewal
			</>
		);
	} else {
		const onlyBalance = p.balances.length === 1 ? p.balances[0] : undefined;
		summary = onlyBalance && onlyBalance.amount !== null
			? <>{fmtUsdc(onlyBalance.amount)} · {holdLabel(onlyBalance.holdReason, minTrigger(onlyBalance.chainId), onlyBalance.chainId)}</>
			: (
				<>
					{held > 0n ? `${fmtUsdc(held)} waiting` : "Balance unavailable"} on {chains.length} chain
					{chains.length === 1 ? "" : "s"}
				</>
			);
	}

	return (
		<div className="mt-5 pt-5 border-t border-[rgba(28,58,41,0.08)]">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				aria-expanded={open}
				aria-controls="pending-renewal-details"
				className="w-full text-left group focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(28,58,41,0.6)]"
			>
				<span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[rgba(28,58,41,0.45)]">
					<Wallet className="w-3 h-3" />
					Pending renewal
				</span>
				<span className="mt-2 flex items-center justify-between gap-3">
					<span className="flex items-center gap-2 text-[15px] text-[rgba(28,58,41,0.95)]">
						{(p.flows.length > 0 || detecting.length > 0) && stuck.length === 0 && (
							<Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-[rgba(28,58,41,0.5)]" />
						)}
						{summary}
					</span>
					<span className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border border-[rgba(28,58,41,0.14)] px-2.5 text-[11.5px] text-[rgba(28,58,41,0.72)] group-hover:bg-white">
						{open ? "Hide details" : p.flows.length > 0 ? "Flow details" : "Balance details"}
						<ChevronDown
							className={`w-3.5 h-3.5 text-[rgba(28,58,41,0.55)] transition-all ${open ? "rotate-180" : ""}`}
						/>
					</span>
				</span>
			</button>

			<AnimatePresence initial={false}>
				{open && (
					<motion.div
						id="pending-renewal-details"
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
						className="overflow-hidden"
					>
						<div className="mt-4 space-y-3.5">
							{chains.map((chain) => {
								const flows = p.flows.filter((f) => f.chain === chain);
								const balance = p.balances.find((b) => b.chain === chain);
								const recheckName = balance ? canRecheckName(balance) : false;
								return (
									<ChainRow
										key={chain}
										chain={chain}
										flows={flows}
										balance={balance}
										detecting={balance ? detectingChainIds.has(balance.chainId) : false}
										triggerable={balance ? (canTrigger(p, balance) && !detectingChainIds.has(balance.chainId)) || recheckName : false}
										actionLabel={recheckName ? "Check registration" : "Renew now"}
										onTrigger={() => {
											const entry = chainByName(chain);
											if (!entry || triggering) return;
											setTriggering(chain);
											setTriggerError(null);
											void triggerFlow(record.name, String(entry.chainId))
												.then(onSettled)
												.catch((cause: unknown) => setTriggerError(cause instanceof Error ? cause.message : "Could not start the renewal."))
												.finally(() => setTriggering(null));
										}}
									/>
								);
							})}
						</div>
						{triggerError && <p role="alert" className="mt-3 text-[12px] text-red-700">{triggerError}</p>}

						{/* The thing a single balance figure hides. */}
						{chains.length > 1 && (
							<p className="mt-4 text-[11.5px] text-[rgba(28,58,41,0.4)] leading-relaxed">
								Balances on different chains can't be combined. Each one renews on
								its own.
							</p>
						)}
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}

function ChainRow({
	chain,
	flows,
	balance,
	detecting,
	triggerable,
	actionLabel,
	onTrigger,
}: {
	chain: string;
	flows: ChainFlow[];
	balance?: ChainBalance;
	detecting: boolean;
	triggerable: boolean;
	actionLabel: "Check registration" | "Renew now";
	onTrigger: () => void;
}) {
	const minimum = balance ? minTrigger(balance.chainId) : undefined;
	const balanceLabel = balance
		? detecting ? "Payment detected · preparing renewal" : holdLabel(balance.holdReason, minimum, balance.chainId, balance.flowErrorCode)
		: "";
	return (
		<div className="flex items-start justify-between gap-3">
			<div className="min-w-0 flex-1">
				<div className="text-[13px]">
					<ChainTag chain={chain} />
				</div>

				{flows.map((flow) => {
					const transactions = completedFlowTransactions(flow.api);
					return (
					<div key={flow.id} className="mt-1">
						<div className="mt-1 flex items-center gap-1.5 text-[12.5px] text-[rgba(28,58,41,0.65)]">
							<Loader2 className="w-3 h-3 animate-spin shrink-0" />
							{fmtUsdc(flow.amount)} · {flowPresentation(flow.status, flow.originChainId).detail}
						</div>
						{transactions.length > 0 && (
							<ol className="mt-2 space-y-1.5">
								{transactions.map((transaction) => (
									<li key={`${transaction.label}:${transaction.tx}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px]">
										<span className="inline-flex items-center gap-1.5 text-[rgba(28,58,41,0.55)]">
											<CheckCircle2 className="w-3 h-3 shrink-0 text-emerald-600" />
											{transaction.label}
										</span>
										<a
											href={explorerUrl(transaction.chain, transaction.tx)}
											target="_blank"
											rel="noopener noreferrer"
											className="inline-flex items-center gap-1 font-mono text-[rgba(28,58,41,0.5)] hover:text-[rgba(28,58,41,0.9)] transition-colors"
										>
											{truncTx(transaction.tx)}
											<ExternalLink className="w-2.5 h-2.5 shrink-0" />
										</a>
									</li>
								))}
							</ol>
						)}
					</div>
					);
				})}

				{balance && (
					<div className="mt-1 flex items-center gap-1.5 text-[12.5px] text-[rgba(28,58,41,0.55)]">
						<span>
							{balance.amount === null ? balanceLabel : `${fmtUsdc(balance.amount)} · ${balanceLabel}`}
						</span>
						<Tooltip
							text={detecting
								? "The payment balance arrived before its automatic renewal appeared. Namepass is checking for the flow."
								: holdCopy(balance.holdReason, minimum, balance.chainId, balance.flowErrorCode)}
							label={`Why are these funds on ${chain} here?`}
						/>
					</div>
				)}
			</div>

			{/* Manual push, for when the origin transaction did not succeed.
			    Normal accumulation happens on its own, so this stays out of the
			    way unless this chain is actually stuck. */}
			{triggerable && (
				<button
					type="button"
					onClick={onTrigger}
					className="shrink-0 rounded-[10px] border border-[rgba(28,58,41,0.25)] px-3 py-1 text-[12px] text-[rgba(28,58,41,0.8)] hover:bg-[rgba(28,58,41,0.05)] transition-colors"
				>
					{actionLabel}
				</button>
			)}
		</div>
	);
}

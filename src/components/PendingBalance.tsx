import { motion, AnimatePresence } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, Wallet } from "lucide-react";
import { canTrigger, minTrigger, totalHeld, totalInFlight, type ChainBalance, type FlowStatus, type HoldReason, type NameRecord } from "../lib/readModel";
import { flowFailurePresentation, flowPresentation } from "../lib/flowPresentation";
import { DETECTION_GRACE_MS, isDetectionPending, updateDetectionObservations, type DetectionObservations } from "../lib/detectionGrace";
import { triggerFlow } from "../lib/publicApi";
import { chainByName } from "../lib/chains";
import { fmtUsdc } from "../lib/format";
import Tooltip from "./Tooltip";
import ChainTag from "./ChainTag";

/* Each reason gets its own sentence. "We tried and it failed" must never read
   the same as "waiting for the name to become renewable" — they need
   different things from whoever is looking at them. */
function holdCopy(reason: HoldReason, minimum: bigint | undefined, chainId: string): string {
	const floor = minimum === undefined ? "The chain minimum is not available yet." : `A renewal needs at least ${fmtUsdc(minimum)} on one chain. Balances on different chains can't be combined, so this one goes out as soon as more arrives on the same chain.`;
	return {
	flow_in_progress:
		"A renewal is already running on this chain. These funds are queued and go out with the next one.",
	name_inactive:
		"This name isn't currently registered. It may have expired, be in its premium auction, or never have been registered. The funds stay here until it can be renewed again.",
	below_threshold: floor,
	not_detected:
		"This payment wasn't picked up automatically, which shouldn't happen. Normally a renewal starts the moment funds arrive. Anyone can push it through.",
	flow_failed: flowFailurePresentation(chainId).detail,
	unknown:
		"The current balance or chain minimum is not available. It is not treated as zero and will be checked again.",
	}[reason];
}

/* Scannable version of the same fact — the sentence lives in the tooltip. */
function holdLabel(reason: HoldReason, minimum: bigint | undefined, chainId: string): string {
	return {
	flow_in_progress: "Queued behind the current renewal",
	name_inactive: "Name isn't registered right now",
	/* States the number — "too small" alone leaves nobody able to act on it. */
	below_threshold: minimum === undefined ? "Chain minimum unavailable" : `Under the ${fmtUsdc(minimum)} minimum on this chain`,
	not_detected: "Wasn't picked up automatically",
	flow_failed: flowFailurePresentation(chainId).label,
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
		summary = (
			<>
				{held > 0n ? `${fmtUsdc(held)} waiting` : "Balance unavailable"} on {chains.length} chain
				{chains.length === 1 ? "" : "s"}
			</>
		);
	}

	return (
		<div className="mt-5 pt-5 border-t border-[rgba(30,50,90,0.08)]">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="w-full text-left group"
			>
				<span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[rgba(30,50,90,0.45)]">
					<Wallet className="w-3 h-3" />
					Pending renewal
				</span>
				<span className="mt-2 flex items-center justify-between gap-3">
					<span className="flex items-center gap-2 text-[15px] text-[rgba(30,50,90,0.95)]">
						{(p.flows.length > 0 || detecting.length > 0) && stuck.length === 0 && (
							<Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-[rgba(30,50,90,0.5)]" />
						)}
						{summary}
					</span>
					<ChevronDown
						className={`w-4 h-4 shrink-0 text-[rgba(30,50,90,0.35)] group-hover:text-[rgba(30,50,90,0.7)] transition-all ${open ? "rotate-180" : ""}`}
					/>
				</span>
			</button>

			<AnimatePresence initial={false}>
				{open && (
					<motion.div
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
						className="overflow-hidden"
					>
						<div className="mt-4 space-y-3.5">
							{chains.map((chain) => {
								const flow = p.flows.find((f) => f.chain === chain);
								const balance = p.balances.find((b) => b.chain === chain);
								return (
									<ChainRow
										key={chain}
										chain={chain}
										flow={flow}
										balance={balance}
										detecting={balance ? detectingChainIds.has(balance.chainId) : false}
										triggerable={balance ? canTrigger(p, balance) && !detectingChainIds.has(balance.chainId) : false}
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
							<p className="mt-4 text-[11.5px] text-[rgba(30,50,90,0.4)] leading-relaxed">
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
	flow,
	balance,
	detecting,
	triggerable,
	onTrigger,
}: {
	chain: string;
	flow?: { amount: bigint; status: FlowStatus; originChainId: string };
	balance?: ChainBalance;
	detecting: boolean;
	triggerable: boolean;
	onTrigger: () => void;
}) {
	const minimum = balance ? minTrigger(balance.chainId) : undefined;
	const balanceLabel = balance
		? detecting ? "Payment detected · preparing renewal" : holdLabel(balance.holdReason, minimum, balance.chainId)
		: "";
	return (
		<div className="flex items-start justify-between gap-3">
			<div className="min-w-0 flex-1">
				<div className="text-[13px]">
					<ChainTag chain={chain} />
				</div>

				{flow && (
					<div className="mt-1 flex items-center gap-1.5 text-[12.5px] text-[rgba(30,50,90,0.65)]">
						<Loader2 className="w-3 h-3 animate-spin shrink-0" />
						{fmtUsdc(flow.amount)} · {flowPresentation(flow.status, flow.originChainId).detail}
					</div>
				)}

				{balance && (
					<div className="mt-1 flex items-center gap-1.5 text-[12.5px] text-[rgba(30,50,90,0.55)]">
						<span>
							{balance.amount === null ? balanceLabel : `${fmtUsdc(balance.amount)} · ${balanceLabel}`}
						</span>
						<Tooltip
							text={detecting
								? "The payment balance arrived before its automatic renewal appeared. Namepass is checking for the flow."
								: holdCopy(balance.holdReason, minimum, balance.chainId)}
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
					className="shrink-0 rounded-full border border-[rgba(30,50,90,0.25)] px-3 py-1 text-[12px] text-[rgba(30,50,90,0.8)] hover:bg-[rgba(30,50,90,0.05)] transition-colors"
				>
					Renew now
				</button>
			)}
		</div>
	);
}

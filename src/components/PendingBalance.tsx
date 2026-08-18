import { motion, AnimatePresence } from "motion/react";
import { useState } from "react";
import { ChevronDown, Loader2, Wallet } from "lucide-react";
import { canTrigger, minTrigger, totalHeld, totalInFlight, type ChainBalance, type FlowStatus, type HoldReason, type NameRecord } from "../lib/readModel";
import { triggerFlow } from "../lib/publicApi";
import { chainByName } from "../lib/chains";
import { fmtUsdc } from "../lib/format";
import Tooltip from "./Tooltip";
import ChainTag from "./ChainTag";

/* Each reason gets its own sentence. "We tried and it failed" must never read
   the same as "waiting for the name to become renewable" — they need
   different things from whoever is looking at them. */
function holdCopy(reason: HoldReason, minimum: bigint | undefined): string {
	const floor = minimum === undefined ? "The chain minimum is not available yet." : `A renewal needs at least ${fmtUsdc(minimum)} on one chain. Balances on different chains can't be combined, so this one goes out as soon as more arrives on the same chain.`;
	return {
	flow_in_progress:
		"A renewal is already running on this chain. These funds are queued and go out with the next one.",
	name_inactive:
		"This name isn't currently registered. It may have expired, be in its premium auction, or never have been registered. The funds stay here until it can be renewed again.",
	below_threshold: floor,
	not_detected:
		"This payment wasn't picked up automatically, which shouldn't happen. Normally a renewal starts the moment funds arrive. Anyone can push it through.",
	flow_failed:
		"A renewal was started for these funds and the transfer didn't go out. The money never left this address. Anyone can retry it.",
	unknown:
		"The current balance or chain minimum is not available. It is not treated as zero and will be checked again.",
	}[reason];
}

/* Scannable version of the same fact — the sentence lives in the tooltip. */
function holdLabel(reason: HoldReason, minimum: bigint | undefined): string {
	return {
	flow_in_progress: "Queued behind the current renewal",
	name_inactive: "Name isn't registered right now",
	/* States the number — "too small" alone leaves nobody able to act on it. */
	below_threshold: minimum === undefined ? "Chain minimum unavailable" : `Under the ${fmtUsdc(minimum)} minimum on this chain`,
	not_detected: "Wasn't picked up automatically",
	flow_failed: "Transfer didn't go out",
	unknown: "Balance or minimum unavailable",
	}[reason];
}

const FLOW_COPY: Record<FlowStatus, string> = {
	confirming: "Confirming the deposit",
	signing: "Preparing the transfer",
	burning: "Burning for transfer",
	/* Names the wait explicitly: Circle's attestation is the slow step, and
	   someone watching a spinner for a quarter of an hour deserves to know
	   what it's waiting on. */
	attesting: "Waiting for Circle attestation",
	claiming: "Renewing on Ethereum",
};

interface Props {
	record: NameRecord;
	/** Fired when a flow settles, so the page can pick up the new renewal. */
	onSettled: () => void;
}

export default function PendingBalance({ record, onSettled }: Props) {
	const [open, setOpen] = useState(false);
	const [triggering, setTriggering] = useState<string | null>(null);
	const [triggerError, setTriggerError] = useState<string | null>(null);
	const p = record.pending;

	const held = totalHeld(p);
	const inFlight = totalInFlight(p);
	const unknown = p.balances.filter((balance) => balance.amount === null);
	if (held === 0n && inFlight === 0n && unknown.length === 0) return null;

	/* Chains with anything on them, flows first so a chain that is both
	   renewing and holding shows its motion above its queue. */
	const chains = [
		...new Set([...p.flows.map((f) => f.chain), ...p.balances.map((b) => b.chain)]),
	];

	/* Only what a person can actually clear right now. Filtering on the reason
	   alone promised "needs a retry" for balances whose name can't be renewed,
	   where no button ever appears — so it asks canTrigger, same as the rows. */
	const stuck = p.balances.filter((b) => canTrigger(p, b));

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
						{p.flows.length > 0 && stuck.length === 0 && (
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
										triggerable={balance ? canTrigger(p, balance) : false}
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
	triggerable,
	onTrigger,
}: {
	chain: string;
	flow?: { amount: bigint; status: FlowStatus };
	balance?: ChainBalance;
	triggerable: boolean;
	onTrigger: () => void;
}) {
	return (
		<div className="flex items-start justify-between gap-3">
			<div className="min-w-0 flex-1">
				<div className="text-[13px]">
					<ChainTag chain={chain} />
				</div>

				{flow && (
					<div className="mt-1 flex items-center gap-1.5 text-[12.5px] text-[rgba(30,50,90,0.65)]">
						<Loader2 className="w-3 h-3 animate-spin shrink-0" />
						{fmtUsdc(flow.amount)} · {FLOW_COPY[flow.status]}
					</div>
				)}

				{balance && (
					<div className="mt-1 flex items-center gap-1.5 text-[12.5px] text-[rgba(30,50,90,0.55)]">
						<span>
							{balance.amount === null ? holdLabel(balance.holdReason, minTrigger(balance.chainId)) : `${fmtUsdc(balance.amount)} · ${holdLabel(balance.holdReason, minTrigger(balance.chainId))}`}
						</span>
						<Tooltip
							text={holdCopy(balance.holdReason, minTrigger(balance.chainId))}
							label={`Why are these funds on ${chain} here?`}
						/>
					</div>
				)}
			</div>

			{/* Manual push, for when the delivery or the burn didn't happen.
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

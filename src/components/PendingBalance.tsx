import { motion, AnimatePresence } from "motion/react";
import { useEffect, useReducer, useState } from "react";
import { ChevronDown, Loader2, Wallet } from "lucide-react";
import {
	advanceFlow,
	canTrigger,
	minTrigger,
	settleRenewal,
	totalHeld,
	totalInFlight,
	triggerRenewal,
	type ChainBalance,
	type FlowStatus,
	type HoldReason,
	type NameRecord,
} from "../lib/registry";
import { fmtUsdc } from "../lib/format";
import Tooltip from "./Tooltip";
import ChainTag from "./ChainTag";

/* Each reason gets its own sentence. "We tried and it failed" must never read
   the same as "waiting for the name to become renewable" — they need
   different things from whoever is looking at them. */
const HOLD_COPY: Record<HoldReason, string> = {
	flow_in_progress:
		"A renewal is already running on this chain. These funds are queued and go out with the next one.",
	name_inactive:
		"This name isn't currently registered — it may have expired, be in its premium auction, or never have been registered. The funds stay here until it can be renewed again.",
	below_threshold: `A renewal needs at least ${fmtUsdc(minTrigger())} on one chain. Balances on different chains can't be combined, so this one goes out as soon as more arrives on the same chain.`,
	not_detected:
		"This payment wasn't picked up automatically, which shouldn't happen — normally a renewal starts the moment funds arrive. Anyone can push it through.",
	flow_failed:
		"A renewal was started for these funds and the transfer didn't go out. The money never left this address. Anyone can retry it.",
};

/* Scannable version of the same fact — the sentence lives in the tooltip. */
const HOLD_LABEL: Record<HoldReason, string> = {
	flow_in_progress: "Queued behind the current renewal",
	name_inactive: "Name isn't registered right now",
	/* States the number — "too small" alone leaves nobody able to act on it. */
	below_threshold: `Under the ${fmtUsdc(minTrigger())} minimum on this chain`,
	not_detected: "Wasn't picked up automatically",
	flow_failed: "Transfer didn't go out",
};

const FLOW_COPY: Record<FlowStatus, string> = {
	signing: "Preparing the transfer",
	burning: "Burning for transfer",
	/* Names the wait explicitly: Circle's attestation is the slow step, and
	   someone watching a spinner for a quarter of an hour deserves to know
	   what it's waiting on. */
	attesting: "Waiting for Circle attestation",
	claiming: "Renewing on Ethereum",
};

/** Time on each stage of the simulated flow. */
const STAGE_MS = 2000;

interface Props {
	record: NameRecord;
	/** Fired when a flow settles, so the page can pick up the new renewal. */
	onSettled: () => void;
}

export default function PendingBalance({ record, onSettled }: Props) {
	const [version, bump] = useReducer((n: number) => n + 1, 0);
	const [open, setOpen] = useState(false);
	const p = record.pending;

	/* Drives every active flow forward — whether it started here or was already
	   running when the page loaded. Re-runs on each bump, schedules one step,
	   and stops on its own once nothing is in flight. */
	useEffect(() => {
		if (record.pending.flows.length === 0) return;
		const id = window.setTimeout(() => {
			for (const flow of [...record.pending.flows]) {
				if (!advanceFlow(record, flow.chain)) {
					settleRenewal(record, flow.chain);
					onSettled();
				}
			}
			bump();
		}, STAGE_MS);
		return () => window.clearTimeout(id);
	}, [record, version, onSettled]);

	const held = totalHeld(p);
	const inFlight = totalInFlight(p);
	if (held === 0n && inFlight === 0n) return null;

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
				{fmtUsdc(stuck.reduce((s, b) => s + b.amount, 0n))} on{" "}
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
				{fmtUsdc(held)} waiting on {chains.length} chain
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
											if (triggerRenewal(record, chain)) bump();
										}}
									/>
								);
							})}
						</div>

						{/* The thing a single balance figure hides. */}
						{chains.length > 1 && (
							<p className="mt-4 text-[11.5px] text-[rgba(30,50,90,0.4)] leading-relaxed">
								Balances on different chains can't be combined — each one renews on
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
							{fmtUsdc(balance.amount)} · {HOLD_LABEL[balance.holdReason]}
						</span>
						<Tooltip
							text={HOLD_COPY[balance.holdReason]}
							label={`Why are these funds on ${chain} here?`}
						/>
					</div>
				)}
			</div>

			{/* Manual push, for when the webhook or the burn didn't fire. Normal
			    accumulation happens on its own, so this stays out of the way
			    unless this chain is actually stuck. */}
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

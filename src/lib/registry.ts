import { solve, YEAR_SECONDS } from "./pricing";
import { GAS_ALLOWANCE } from "./fees";

/**
 * MODEL
 *
 *   A Namepass is permanent. It never expires. It is a routing address.
 *   The ENS NAME behind it has an expiry, and that is what payments extend.
 *
 *   Namepass  ── permanent ──>  receives USDC from any chain
 *        │
 *        └── extends ──> ENS name's expiry
 */

export type EventKind = "activated" | "renewal";

/* ------------------------------------------------------------------ */
/* Pending balance — funds at the address that aren't renewal time yet */
/* ------------------------------------------------------------------ */

/**
 * Visible stages of an in-flight renewal, following the CCTP path: burn on the
 * origin chain, wait for Circle's attestation, then one mainnet transaction
 * that mints and renews together. An Ethereum-origin flow skips the middle two.
 */
export type FlowStatus = "signing" | "burning" | "attesting" | "claiming";

/**
 * Why a chain's balance hasn't become renewal time yet.
 *
 * Every resting balance has one. A deposit address is a pass-through, not a
 * wallet — money sitting in one is always either blocked by something or a
 * failure, and showing an unexplained balance tells people the automation
 * isn't working and needs them.
 */
export type HoldReason =
	| "flow_in_progress"
	| "below_threshold"
	/**
	 * Expired, in its premium auction, or never registered — one state, because
	 * the distinction makes no difference here. All three mean the name can't
	 * be renewed right now and the funds wait; splitting them would be three
	 * ways of saying the same thing to the funder.
	 */
	| "name_inactive"
	/* The two anomalies — a person can clear these, everything else resolves
	   itself. `not_detected` is a webhook that never fired; `flow_failed` is a
	   burn that was attempted and didn't go out.
	 *
	 * There is deliberately no "awaiting confirmation" state: webhooks fire on
	 * finalized deposits only, so there is no moment where the app knows money
	 * is coming but not yet arrived. */
	| "not_detected"
	| "flow_failed";

/** Hold reasons the trigger button can actually clear. */
export const RECOVERABLE: HoldReason[] = ["not_detected", "flow_failed"];

/**
 * A name's unclaimed balance **on one chain**.
 *
 * The deposit address is the same on every chain — that's what CREATE2 buys —
 * but the balances are separate pots and can never be combined. $5 on Base
 * plus $8 on Arbitrum is not $13; it's two payments that each have to clear
 * the threshold on their own, and each bridges independently.
 */
export interface ChainBalance {
	chain: string;
	/** Unclaimed USDC at this address on this chain, 6dp micro-units. */
	amount: bigint;
	/** Why it's sitting there. Never absent — see `HoldReason`. */
	holdReason: HoldReason;
}

/** A renewal in flight from one chain. At most one per chain, per name. */
export interface ChainFlow {
	chain: string;
	/** USDC this flow claimed when it started, 6dp micro-units. */
	amount: bigint;
	status: FlowStatus;
}

/**
 * Funds at a name's address that aren't renewal time yet.
 *
 * Whether money is claimable or already moving is decided by which list it's
 * in, not by a status flag — a balance and a flow can't describe the same
 * dollars. Chains are independent: a stuck transfer on Base doesn't block a
 * fresh payment on Ethereum, which is why the backend's uniqueness constraint
 * is on `(name, chain)` rather than on the name alone.
 */
export interface PendingState {
	balances: ChainBalance[];
	flows: ChainFlow[];
	/** Whether the ENS name can be renewed at this moment. */
	renewable: boolean;
	/** Gas allowance each flow carries, 6dp micro-units. Flat, per flow. */
	gasAllowance: bigint;
}

/**
 * Auto-trigger only fires when the gas allowance is at most this share of the
 * balance, which with a flat $0.10 allowance puts the floor around $0.67 —
 * **per chain**, since the pots don't merge. 50c on Base and 50c on Polygon
 * means neither goes anywhere.
 *
 * Kept as a ratio rather than swapped for a hard minimum because no minimum
 * has been decided. The real floor is a business question — Namepass fronts
 * dollars of mainnet gas per flow and rebates cents — not an arithmetic one.
 */
export const MAX_FEE_BPS = 1500n;

export function totalHeld(p: PendingState): bigint {
	return p.balances.reduce((sum, b) => sum + b.amount, 0n);
}

export function totalInFlight(p: PendingState): bigint {
	return p.flows.reduce((sum, f) => sum + f.amount, 0n);
}

/** Whether an amount is worth spending a renewal transaction on. */
export function clearsFloor(amount: bigint, allowance: bigint): boolean {
	return allowance * 10000n <= amount * MAX_FEE_BPS;
}

/**
 * Smallest balance on a single chain that will go out on its own, 6dp
 * micro-units — currently $0.67. Exported because the UI has to *state* it:
 * "too small" without a number leaves the funder unable to act on it.
 */
export function minTrigger(allowance: bigint = GAS_ALLOWANCE): bigint {
	return (allowance * 10000n + MAX_FEE_BPS - 1n) / MAX_FEE_BPS;
}

/**
 * Whether anyone can push this chain's balance into a renewal right now.
 *
 * Only the anomalies qualify. Everything else the system resolves on its own —
 * a payment that clears the floor auto-triggers the moment the webhook sees
 * it, so offering a button for those cases would imply the automation needs
 * supervision. This is the escape hatch for when it genuinely didn't fire.
 */
export function canTrigger(p: PendingState, balance: ChainBalance): boolean {
	if (!RECOVERABLE.includes(balance.holdReason)) return false;
	if (!p.renewable) return false;
	/* One flow per chain, so a balance queues behind its own chain's flow. */
	if (p.flows.some((f) => f.chain === balance.chain)) return false;
	return clearsFloor(balance.amount, p.gasAllowance);
}

/**
 * A factory, not a shared constant. Spreading one literal (`{ ...NO_PENDING }`)
 * copies the *array references*, so every name ends up pushing balances and
 * flows into the same two arrays and each one's money shows up on all the
 * others until something happens to reassign them.
 */
function emptyPending(): PendingState {
	return {
		balances: [],
		flows: [],
		renewable: true,
		gasAllowance: GAS_ALLOWANCE,
	};
}

/**
 * One on-chain transaction in a renewal. A payment from an L2 takes three —
 * the deposit, the CCTP burn, then the mainnet transaction that mints and
 * renews together via the CCTP hook. A payment already on Ethereum has
 * nothing to bridge and takes two.
 */
export interface FlowStep {
	kind: "deposit" | "burn" | "renewal";
	chain: string;
	tx: string;
}

export interface ActivityEvent {
	id: string;
	kind: EventKind;
	/** Unix ms when the event occurred. */
	at: number;
	/** Origin chain of the inbound payment. */
	chain: string;
	/** What the funder sent, 6dp micro-units. Zero for activation. */
	amountDeposited: bigint;
	/** Flat allowance toward gas, taken on mainnet at settlement. */
	gasAllowance: bigint;
	/** What actually bought renewal time — deposited minus the allowance. */
	amountApplied: bigint;
	/** Seconds of renewal time bought. Zero for activation. */
	seconds: bigint;
	/** Discount label, e.g. "43.75%". Empty at full price. */
	off: string;
	/** The ENS NAME's expiry after this event was applied. */
	nameExpiryAfter: number;
	/** Who funded it — owner, community, treasury, agent. */
	funder: string;
	/** The transactions behind this renewal. Empty for activation. */
	steps: FlowStep[];
}

export interface NameRecord {
	/** ENS name, e.g. "vitalik.eth" — this is the thing that expires. */
	name: string;
	/** Character count, drives which price tier applies. */
	labelLength: number;
	/** Namepass subdomain — permanent. */
	pass: string;
	/** Namepass deposit address — permanent, receives on every chain. */
	address: string;
	/** Unix ms the Namepass was activated. Permanent from here on. */
	activatedAt: number;
	/** The ENS name's expiry at the moment the Namepass was activated. */
	expiryAtActivation: number;
	events: ActivityEvent[];
	/** Funds sitting at the address that haven't become renewal time yet. */
	pending: PendingState;
}

const CHAINS = ["Base", "Arbitrum", "Ethereum", "Polygon"];
const FUNDERS = ["owner", "community", "treasury", "agent", "anon", "contributor"];

/**
 * Seeded amounts are what gets *applied*, with the gas allowance added on top
 * to reach the deposit. That mirrors how the Simulator quotes: a funder aiming
 * at the 3-year rate sends enough that the allowance doesn't drop them a tier.
 * Do it the other way and every demo row lands just short of its discount.
 */
const AMOUNTS = [
	8_000010n,
	14_000017n,
	16_500020n,
	27_000032n,
	5_000000n,
	40_000000n,
];

function mulberry32(seed: number) {
	return () => {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function hex(rand: () => number, len: number) {
	const H = "0123456789abcdef";
	let out = "";
	for (let i = 0; i < len; i++) out += H[Math.floor(rand() * 16)];
	return out;
}

const DAY = 86_400_000;

function buildSteps(rand: () => number, chain: string): FlowStep[] {
	const steps: FlowStep[] = [{ kind: "deposit", chain, tx: `0x${hex(rand, 62)}` }];
	if (chain !== "Ethereum") {
		steps.push({ kind: "burn", chain, tx: `0x${hex(rand, 62)}` });
	}
	/* Mint and renewal are one transaction — the renewal rides the CCTP hook,
	   so it either lands with the mint or reverts with it, leaving the message
	   attested and replayable rather than the funds stranded. */
	steps.push({ kind: "renewal", chain: "Ethereum", tx: `0x${hex(rand, 62)}` });
	return steps;
}

function buildName(
	name: string,
	seed: number,
	eventCount: number,
	now: number,
): NameRecord {
	const rand = mulberry32(seed);
	const label = name.replace(/\.eth$/, "");
	const activatedAt = now - Math.floor(180 + rand() * 500) * DAY;
	const expiryAtActivation = now + Math.floor(60 + rand() * 300) * DAY;

	const events: ActivityEvent[] = [
		{
			id: `${name}-0`,
			kind: "activated",
			at: activatedAt,
			chain: "Ethereum",
			amountDeposited: 0n,
			gasAllowance: 0n,
			amountApplied: 0n,
			seconds: 0n,
			off: "",
			nameExpiryAfter: expiryAtActivation,
			funder: "owner",
			steps: [],
		},
	];

	let expiry = expiryAtActivation;
	let at = activatedAt;
	for (let i = 1; i <= eventCount; i++) {
		at += Math.floor(10 + rand() * 90) * DAY;
		if (at > now) break;
		const chain = CHAINS[Math.floor(rand() * CHAINS.length)];
		const applied = AMOUNTS[Math.floor(rand() * AMOUNTS.length)];
		const { seconds, off } = solve(applied, label.length);
		expiry += Number(seconds) * 1000;
		events.push({
			id: `${name}-${i}`,
			kind: "renewal",
			at,
			chain,
			amountDeposited: applied + GAS_ALLOWANCE,
			gasAllowance: GAS_ALLOWANCE,
			amountApplied: applied,
			seconds,
			off,
			nameExpiryAfter: expiry,
			funder: FUNDERS[Math.floor(rand() * FUNDERS.length)],
			steps: buildSteps(rand, chain),
		});
	}

	return {
		name,
		labelLength: label.length,
		pass: `${label}.namepass.eth`,
		address: `0x${hex(rand, 40)}`,
		activatedAt,
		expiryAtActivation,
		events,
		pending: emptyPending(),
	};
}

/**
 * Pending states assigned per name rather than randomised, so every state the
 * card can render is reachable in the demo and stays put across reloads.
 */
/**
 * Every address starts empty, and pending states only ever arise from the
 * simulation below.
 *
 * Seeding balances directly produced ones with nothing wrong — money resting
 * at an address for no stated reason, which reads as "the automation stalled
 * and needs you". Growing them from payments instead means each one arrives
 * with the reason that parked it, and the happy path (payment lands, clears
 * the floor, goes straight out) is the common case rather than an absence.
 *
 * Only `renewable` is seeded, since that's a property of the ENS name rather
 * than of any money.
 */
const NOT_RENEWABLE = new Set(["ens.eth"]);

/**
 * Mix of 3, 4 and 5+ character names so tier differences are visible.
 *
 * **Three characters is the floor.** ENS v2 has no rate below that
 * (`rateFor()` returns 0), so a shorter name isn't registerable and any
 * payment to it buys zero time — which surfaced as a seeded `op.eth` sitting
 * in the leaderboard claiming "4 renewals · 0 months delivered".
 */
const SEED_NAMES: Array<[string, number, number]> = [
	["vitalik.eth", 101, 7],
	["nick.eth", 202, 5],
	["ens.eth", 303, 9],
	["brantly.eth", 404, 4],
	["coinbase.eth", 505, 6],
	["uniswap.eth", 606, 5],
	["nouns.eth", 707, 4],
	["base.eth", 808, 6],
	["defi.eth", 909, 3],
	["lens.eth", 111, 5],
	["farcaster.eth", 222, 6],
	["dao.eth", 333, 4],
];

/** The demo's own names. Anything a visitor activates is left alone. */
const SEEDED = new Set(SEED_NAMES.map(([n]) => n));

const NOW = Date.now();
const registry: NameRecord[] = SEED_NAMES.map(([n, s, c]) => {
	const rec = buildName(n, s, c, NOW);
	if (NOT_RENEWABLE.has(n)) {
		rec.pending.renewable = false;
		/* A name that can't be renewed has to read as expired, or the panel above
		   the card says "376 days remaining" next to "it's in its premium
		   auction".
		 *
		 * Shift the *whole* runway back rather than just overwriting the final
		 * expiry: this name has renewals in its history that genuinely added
		 * time, so moving only the end produced "at activation: 2027 → now:
		 * expired", which reads as time running backwards. Sliding the timeline
		 * keeps the arithmetic intact — it was already near expiry when the pass
		 * was activated, renewals pushed it out, and it lapsed anyway. */
		const shift = rec.events[rec.events.length - 1].nameExpiryAfter - (NOW - 12 * DAY);
		rec.expiryAtActivation -= shift;
		for (const e of rec.events) e.nameExpiryAfter -= shift;
	}
	return rec;
});

export function allNames(): NameRecord[] {
	return registry;
}

export function findName(query: string): NameRecord | undefined {
	const q = query.trim().toLowerCase();
	const withTld = q.endsWith(".eth") ? q : `${q}.eth`;
	return registry.find((r) => r.name === withTld);
}

/** The ENS name's current expiry — from the most recent event. */
export function nameExpiry(rec: NameRecord): number {
	return rec.events[rec.events.length - 1].nameExpiryAfter;
}

/** Renewal time this Namepass has delivered, in years. */
export function timeDelivered(rec: NameRecord): number {
	const secs = rec.events.reduce((sum, e) => sum + e.seconds, 0n);
	return Number(secs) / Number(YEAR_SECONDS);
}

/** Total USDC this Namepass has received, whole dollars. What funders sent,
    before the gas allowance — not what reached the renewal. */
export function totalReceived(rec: NameRecord): number {
	const micro = rec.events.reduce((sum, e) => sum + e.amountDeposited, 0n);
	return Number(micro) / 1e6;
}

export function renewalCount(rec: NameRecord): number {
	return rec.events.filter((e) => e.kind === "renewal").length;
}

/** Every renewal across every name, newest first. */
export function recentActivity(limit = 40): Array<ActivityEvent & { name: string }> {
	const rows: Array<ActivityEvent & { name: string }> = [];
	for (const rec of registry) {
		for (const e of rec.events) {
			if (e.kind === "renewal") rows.push({ ...e, name: rec.name });
		}
	}
	rows.sort((a, b) => b.at - a.at);
	return rows.slice(0, limit);
}

/** Activate a Namepass for a name. Idempotent. */
export function claimName(input: string): NameRecord {
	const label = input.trim().toLowerCase().replace(/\.eth$/, "");
	const name = `${label}.eth`;
	const existing = registry.find((r) => r.name === name);
	if (existing) return existing;

	const rand = mulberry32(label.length * 7919 + label.charCodeAt(0) * 31);
	const now = Date.now();
	const expiryAtActivation = now + Math.floor(120 + rand() * 240) * DAY;
	const rec: NameRecord = {
		name,
		labelLength: label.length,
		pass: `${label}.namepass.eth`,
		address: `0x${hex(rand, 40)}`,
		activatedAt: now,
		expiryAtActivation,
		events: [
			{
				id: `${name}-0`,
				kind: "activated",
				at: now,
				chain: "Ethereum",
				amountDeposited: 0n,
				gasAllowance: 0n,
				amountApplied: 0n,
				seconds: 0n,
				off: "",
				nameExpiryAfter: expiryAtActivation,
				funder: "owner",
				steps: [],
			},
		],
		pending: emptyPending(),
	};
	registry.unshift(rec);
	return rec;
}

/**
 * Claim one chain's balance for a renewal. The money moves out of `balances`
 * into `flows` in the same step, so it can never be triggered twice — the real
 * backend does this with a unique partial index on `(name, chain)`.
 */
export function triggerRenewal(rec: NameRecord, chain: string): boolean {
	const p = rec.pending;
	const balance = p.balances.find((b) => b.chain === chain);
	if (!balance || !canTrigger(p, balance)) return false;
	p.flows.push({ chain, amount: balance.amount, status: "signing" });
	p.balances = p.balances.filter((b) => b.chain !== chain);
	return true;
}

/**
 * Advance one chain's flow a stage. False once it's ready to settle. An
 * Ethereum-origin payment has nothing to burn and nothing to wait on, so it
 * goes straight to claiming.
 */
export function advanceFlow(rec: NameRecord, chain: string): boolean {
	const flow = rec.pending.flows.find((f) => f.chain === chain);
	if (!flow) return false;
	if (flow.status === "signing") {
		flow.status = chain === "Ethereum" ? "claiming" : "burning";
		return true;
	}
	if (flow.status === "burning") {
		flow.status = "attesting";
		return true;
	}
	if (flow.status === "attesting") {
		flow.status = "claiming";
		return true;
	}
	return false;
}

/**
 * Settle one chain's flow. The gas allowance is taken by the mainnet contract
 * in the same transaction that renews, so the renewal is bought with slightly
 * less than the depositor sent — the gap is real and the UI shows it rather
 * than rounding it away. One allowance per flow, however many deposits
 * accumulated into it.
 */
export function settleRenewal(rec: NameRecord, chain: string): ActivityEvent | null {
	const p = rec.pending;
	const flow = p.flows.find((f) => f.chain === chain);
	if (!flow) return null;
	const allowance = p.gasAllowance;
	const applied = flow.amount > allowance ? flow.amount - allowance : 0n;
	const { seconds, off } = solve(applied, rec.labelLength);
	const event: ActivityEvent = {
		id: `${rec.name}-${chain}-${Date.now()}`,
		kind: "renewal",
		at: Date.now(),
		chain,
		amountDeposited: flow.amount,
		gasAllowance: allowance,
		amountApplied: applied,
		seconds,
		off,
		nameExpiryAfter: nameExpiry(rec) + Number(seconds) * 1000,
		funder: FUNDERS[Math.floor(Math.random() * FUNDERS.length)],
		steps: buildSteps(mulberry32(Date.now() % 100000), chain),
	};
	rec.events.push(event);
	p.flows = p.flows.filter((f) => f.chain !== chain);

	/* Whatever queued behind this chain's flow goes out now, immediately —
	   the backend starts the next one rather than leaving money resting with
	   nothing wrong with it. Balances on other chains were never blocked by
	   this flow in the first place. */
	const queued = p.balances.find((b) => b.chain === chain);
	if (queued) {
		p.balances = p.balances.filter((b) => b.chain !== chain);
		if (p.renewable && clearsFloor(queued.amount, p.gasAllowance)) {
			p.flows.push({ chain, amount: queued.amount, status: "signing" });
		} else {
			park(p, chain, queued.amount, p.renewable ? "below_threshold" : "name_inactive");
		}
	}
	return event;
}

/** A renewal in flight, with the name it belongs to and what it will buy. */
export interface ActiveFlow {
	id: string;
	name: string;
	chain: string;
	amount: bigint;
	status: FlowStatus;
	seconds: bigint;
	off: string;
}

/** Every renewal currently in flight, across every name. */
export function activeFlows(): ActiveFlow[] {
	const out: ActiveFlow[] = [];
	for (const rec of registry) {
		for (const f of rec.pending.flows) {
			const applied =
				f.amount > rec.pending.gasAllowance ? f.amount - rec.pending.gasAllowance : 0n;
			const { seconds, off } = solve(applied, rec.labelLength);
			out.push({
				id: `${rec.name}-${f.chain}`,
				name: rec.name,
				chain: f.chain,
				amount: f.amount,
				status: f.status,
				seconds,
				off,
			});
		}
	}
	return out;
}

/** Add to a chain's balance, or start it, with the reason it's parked. */
function park(p: PendingState, chain: string, amount: bigint, reason: HoldReason): void {
	const existing = p.balances.find((b) => b.chain === chain);
	if (existing) {
		existing.amount += amount;
		existing.holdReason = reason;
	} else {
		p.balances.push({ chain, amount, holdReason: reason });
	}
}

/**
 * A payment lands on some chain.
 *
 * Only ever on one of the demo's own names. A Namepass the visitor just
 * activated has genuinely had nothing happen to it, and inventing strangers'
 * payments for it would overwrite the one true thing the page can say —
 * "waiting for the first payment".
 */
function paymentArrives(): void {
	const pool = registry.filter((r) => SEEDED.has(r.name));
	const rec = pool[Math.floor(Math.random() * pool.length)];
	const p = rec.pending;

	/* Prefer topping up a chain that's already stuck under the threshold. That's
	   how a stalled balance actually gets unstuck, and picking chains purely at
	   random made the accumulation path (two small payments combining to clear
	   the floor) so rare you'd never see it happen. */
	const stalled = p.balances.filter((b) => b.holdReason === "below_threshold");
	const chain =
		stalled.length > 0 && Math.random() < 0.6
			? stalled[Math.floor(Math.random() * stalled.length)].chain
			: CHAINS[Math.floor(Math.random() * CHAINS.length)];

	/* Mostly amounts aimed at a tier; sometimes someone sends loose change. */
	const dust = Math.random() < 0.25;
	const amount = dust
		? 150000n + BigInt(Math.floor(Math.random() * 450000))
		: AMOUNTS[Math.floor(Math.random() * AMOUNTS.length)] + GAS_ALLOWANCE;

	applyPayment(rec, chain, amount);
}

/**
 * What the webhook handler does with a deposit: judge the chain's whole
 * *balance* — not just the amount that arrived — and either send it or record
 * why it can't go.
 *
 * Accumulation falls out of this for free: a second small payment tops up the
 * first and the pair is re-judged together, so two amounts that were each too
 * small go out the moment they add up. There's no confirmation step, because
 * we only ever hear about deposits that are already final.
 */
function applyPayment(rec: NameRecord, chain: string, amount: bigint): void {
	const p = rec.pending;
	const existing = p.balances.find((b) => b.chain === chain);
	const total = (existing?.amount ?? 0n) + amount;

	const reason: HoldReason | null = !p.renewable
		? "name_inactive"
		: p.flows.some((f) => f.chain === chain)
			? "flow_in_progress"
			: !clearsFloor(total, p.gasAllowance)
				? "below_threshold"
				: /* Rare: the webhook never fired, so nothing picked this up. */
					Math.random() < 0.04
					? "not_detected"
					: null;

	if (reason) {
		if (existing) {
			existing.amount = total;
			existing.holdReason = reason;
		} else {
			p.balances.push({ chain, amount: total, holdReason: reason });
		}
		return;
	}

	/* Clears everything — goes straight out, taking anything already waiting on
	   this chain with it. This is the ordinary path, and why a healthy address
	   shows no balance at all. */
	p.balances = p.balances.filter((b) => b.chain !== chain);
	p.flows.push({ chain, amount: total, status: "signing" });
}

/** A burn that didn't go out. The money never left, so it's recoverable. */
function failFlow(rec: NameRecord, chain: string): void {
	const p = rec.pending;
	const flow = p.flows.find((f) => f.chain === chain);
	if (!flow) return;
	p.flows = p.flows.filter((f) => f.chain !== chain);
	park(p, chain, flow.amount, "flow_failed");
}

/**
 * Drive the demo one step: advance every flow in progress, settle the ones
 * that finish, and now and then start a new one.
 *
 * The feed used to append finished renewals out of nowhere, which was fine
 * when a transfer took seconds. Standard CCTP takes a quarter of an hour, so
 * in-flight is the state worth watching and rows now appear at the burn and
 * update until they land.
 */
export function tickSimulation(): void {
	for (const rec of registry) {
		for (const flow of [...rec.pending.flows]) {
			if (advanceFlow(rec, flow.chain)) continue;
			/* Occasionally the burn doesn't go out, which is the case the manual
			   trigger exists for. Rare enough that a healthy feed stays healthy. */
			if (Math.random() < 0.06) failFlow(rec, flow.chain);
			else settleRenewal(rec, flow.chain);
		}
	}
	if (Math.random() < 0.55) paymentArrives();
}

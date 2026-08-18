import { labelLength, solve, YEAR_SECONDS } from "./pricing";
import { GAS_ALLOWANCE } from "./fees";
import { depositAddress, normalizeLabel } from "./namepass";
import { ACTIVE_CHAINS, HUB_CHAIN } from "./chains";

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
	   itself. `not_detected` is a deposit the pipeline never delivered;
	   `flow_failed` is a burn that was attempted and didn't go out.
	 *
	 * There is deliberately no balance-level "awaiting confirmation" state.
	 * Once the backend detects a deposit, it represents confirmation as a flow
	 * stage instead of a reason that funds remain unclaimed. */
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
	/**
	 * Unix ms the flow began. Only reason it exists: the live feed orders
	 * in-flight rows newest first, and without it they came out in registry
	 * order, so a payment that had just started could appear below one that
	 * had been bridging for a quarter of an hour.
	 */
	startedAt: number;
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
 * Smallest balance that will go out on its own, 6dp micro-units — $0.50,
 * **per chain**, since the pots don't merge. 30c on Base and 30c on Arc means
 * neither goes anywhere, despite 60c sitting at the address.
 *
 * A flat figure, not a ratio. It used to be `MAX_FEE_BPS = 1500n` — "the
 * allowance may be at most 15% of the balance" — which produced ~$0.67 and was
 * explicitly a placeholder for a business decision nobody had made. The
 * decision is made: $0.50. Deriving it from the allowance again would let the
 * published minimum move if the allowance ever did.
 *
 * The relationship is still worth knowing: at a $0.10 allowance this floor is
 * exactly 20%, so a funder sending the minimum spends a fifth of it on gas and
 * buys ~18 days on a 5+ character name.
 */
export const MIN_TRIGGER = 500_000n;

export function totalHeld(p: PendingState): bigint {
	return p.balances.reduce((sum, b) => sum + b.amount, 0n);
}

export function totalInFlight(p: PendingState): bigint {
	return p.flows.reduce((sum, f) => sum + f.amount, 0n);
}

/** Whether an amount is worth spending a renewal transaction on. */
export function clearsFloor(amount: bigint): boolean {
	return amount >= MIN_TRIGGER;
}

/**
 * Smallest balance on a single chain that will go out on its own, 6dp
 * micro-units. A function rather than the bare constant because the UI has to
 * *state* it — "too small" without a number leaves the funder unable to act on
 * it — and every call site should read the same way.
 */
export function minTrigger(): bigint {
	return MIN_TRIGGER;
}

/**
 * Whether anyone can push this chain's balance into a renewal right now.
 *
 * Only the anomalies qualify. Everything else the system resolves on its own —
 * a payment that clears the floor auto-triggers the moment the pipeline
 * delivers it, so offering a button for those cases would imply the automation
 * needs supervision. This is the escape hatch for when it genuinely didn't.
 */
export function canTrigger(p: PendingState, balance: ChainBalance): boolean {
	if (!RECOVERABLE.includes(balance.holdReason)) return false;
	if (!p.renewable) return false;
	/* One flow per chain, so a balance queues behind its own chain's flow. */
	if (p.flows.some((f) => f.chain === balance.chain)) return false;
	return clearsFloor(balance.amount);
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
	/**
	 * The in-flight row this renewal used to be, when it came from one.
	 *
	 * Exists so the live feed can keep one DOM element across settlement
	 * instead of destroying the pending row and building a settled one. Same
	 * key in, same element out, so finishing is a content change rather than a
	 * remount. Absent on seeded history, which was never in flight.
	 */
	flowKey?: string;
}

export interface NameRecord {
	/** ENS name, e.g. "vitalik.eth" — this is the thing that expires. */
	name: string;
	/** Character count, drives which price tier applies. */
	labelLength: number;
	/** Namepass subdomain — permanent. */
	pass: string;
	/**
	 * Namepass deposit address — permanent, receives on every chain.
	 *
	 * **Not simulated.** Unlike everything else on this record, this is derived
	 * from the deployed factory by `namepass.ts` and is the real address the
	 * contracts would route. Don't fabricate one alongside the mock activity.
	 */
	address: string;
	/**
	 * What the chain says about the ENS name, once read.
	 *
	 * `null` means "not looked up yet" — distinct from `{ expiry: null }`,
	 * which is the chain saying the name isn't registered. The UI must not
	 * render the second as the first.
	 */
	onchain: {
		expiry: number | null;
		renewable: boolean;
		graceRemaining: number | null;
		lapsedFor: number | null;
	} | null;
	/** Unix ms the Namepass was activated. Permanent from here on. */
	activatedAt: number;
	/** The ENS name's expiry at the moment the Namepass was activated. */
	expiryAtActivation: number;
	events: ActivityEvent[];
	/** Funds sitting at the address that haven't become renewal time yet. */
	pending: PendingState;
}

const CHAINS = ACTIVE_CHAINS.map((chain) => chain.name);
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
	if (chain !== HUB_CHAIN.name) {
		steps.push({ kind: "burn", chain, tx: `0x${hex(rand, 62)}` });
	}
	/* Mint and renewal are one transaction — the renewal rides the CCTP hook,
	   so it either lands with the mint or reverts with it, leaving the message
	   attested and replayable rather than the funds stranded. */
	steps.push({ kind: "renewal", chain: HUB_CHAIN.name, tx: `0x${hex(rand, 62)}` });
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
			chain: HUB_CHAIN.name,
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
		const { seconds, off } = solve(applied, labelLength(label));
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
		labelLength: labelLength(label),
		pass: `${label}.namepass.eth`,
		address: depositAddress(label),
		onchain: null,
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
 * `renewable` isn't seeded either — it's a property of the ENS name, so it
 * comes off the chain via `applyNameState` below. It used to be a hardcoded
 * set containing `ens.eth`.
 */

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

/**
 * Built by `initRegistry()`, not at import.
 *
 * The seeded history is priced with `solve()`, and prices now come off the
 * chain — so there is a moment, before that read lands, when there is no such
 * thing as a renewal that bought 4.9 years. Building at import would have to
 * invent one. `App.tsx` calls `initRegistry` once the rates are in, and every
 * reader below sees an empty registry until then rather than a plausible
 * fiction.
 */
const registry: NameRecord[] = [];

const NOW = Date.now();

let seeded = false;

/**
 * Build the demo's seeded names. Idempotent; safe under StrictMode.
 *
 * Guarded by its own flag rather than by `registry.length`, because the
 * registry can already be non-empty: a visitor can activate a Namepass from
 * the navbar's claim modal, which isn't behind the pricing gate, before this
 * ever runs. Keyed on length, that activation would have silently cancelled
 * the entire seed.
 */
export function initRegistry(): void {
	if (seeded) return;
	seeded = true;
	registry.push(...SEED_NAMES.map(([n, s, c]) => seedName(n, s, c)));
}

function seedName(n: string, s: number, c: number): NameRecord {
	return buildName(n, s, c, NOW);
}

/**
 * Anchor a record to what the chain says about its ENS name.
 *
 * Two things change, and the second is the subtle one:
 *
 * 1. `renewable` becomes ENS's answer rather than a guess, which feeds
 *    `canTrigger()` and the `name_inactive` hold reason already.
 * 2. The **whole simulated timeline slides** so its final expiry lands on the
 *    real one. Overwriting just the end would leave "at activation: 2027 →
 *    now: 2045" against a history that only added ten years, i.e. arithmetic
 *    that doesn't add up, or time running backwards for a lapsed name.
 *    Sliding keeps the seeded renewals internally consistent while making the
 *    figure on the card — the one a funder actually reads — the real one.
 *
 * Idempotent: re-applying the same state is a no-op, since the shift is
 * computed against the current end each time.
 */
export function applyNameState(
	rec: NameRecord,
	state: NonNullable<NameRecord["onchain"]>,
): void {
	rec.onchain = state;
	rec.pending.renewable = state.renewable;

	/* A name the chain has never heard of has no expiry to anchor to. The UI
	   says "not registered" rather than drawing a runway to a made-up date. */
	if (state.expiry === null) return;

	const last = rec.events[rec.events.length - 1];
	const shift = last.nameExpiryAfter - state.expiry;
	if (shift === 0) return;

	rec.expiryAtActivation -= shift;
	for (const e of rec.events) e.nameExpiryAfter -= shift;
}

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

/**
 * Activate a Namepass for a name. Idempotent.
 *
 * Throws `InvalidLabelError` for anything ENS couldn't hold — the deposit
 * address is derived from the label, so a name that can't be normalized has no
 * address to show. Callers gate on `labelProblem()` before offering to
 * activate; this throw is the backstop, not the UI's error path.
 */
export function claimName(input: string): NameRecord {
	const label = normalizeLabel(input);
	const name = `${label}.eth`;
	const existing = registry.find((r) => r.name === name);
	if (existing) return existing;

	const rand = mulberry32(label.length * 7919 + label.charCodeAt(0) * 31);
	const now = Date.now();
	const expiryAtActivation = now + Math.floor(120 + rand() * 240) * DAY;
	const rec: NameRecord = {
		name,
		labelLength: labelLength(label),
		pass: `${label}.namepass.eth`,
		address: depositAddress(label),
		onchain: null,
		activatedAt: now,
		expiryAtActivation,
		events: [
			{
				id: `${name}-0`,
				kind: "activated",
				at: now,
				chain: HUB_CHAIN.name,
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
	p.flows.push({ chain, amount: balance.amount, status: "signing", startedAt: Date.now() });
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
		flow.status = chain === HUB_CHAIN.name ? "claiming" : "burning";
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
		flowKey: flowKeyOf(rec.name, chain, flow.startedAt),
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
		if (p.renewable && clearsFloor(queued.amount)) {
			p.flows.push({ chain, amount: queued.amount, status: "signing", startedAt: Date.now() });
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
	/** Unix ms the flow began. The feed sorts on this. */
	startedAt: number;
}

/** Every renewal currently in flight, across every name. */
/**
 * Identity of one payment as it moves from in-flight to settled.
 *
 * `startedAt` is in it so a later payment on the same name and chain cannot
 * collide with a settled row still on screen.
 */
export function flowKeyOf(name: string, chain: string, startedAt: number): string {
	return `${name}-${chain}-${startedAt}`;
}

export function activeFlows(): ActiveFlow[] {
	const out: ActiveFlow[] = [];
	for (const rec of registry) {
		for (const f of rec.pending.flows) {
			const applied =
				f.amount > rec.pending.gasAllowance ? f.amount - rec.pending.gasAllowance : 0n;
			const { seconds, off } = solve(applied, rec.labelLength);
			out.push({
				id: flowKeyOf(rec.name, f.chain, f.startedAt),
				name: rec.name,
				chain: f.chain,
				amount: f.amount,
				status: f.status,
				seconds,
				off,
				startedAt: f.startedAt,
			});
		}
	}
	/* Newest first. Registry order is seed order, so without this a payment
	   that started seconds ago could render below one that had been bridging
	   for a quarter of an hour. */
	out.sort((a, b) => b.startedAt - a.startedAt);
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
 * What the ingestion handler does with a deposit: judge the chain's whole
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
			: !clearsFloor(total)
				? "below_threshold"
				: /* Rare: the pipeline never delivered it, so nothing picked it up. */
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
	p.flows.push({ chain, amount: total, status: "signing", startedAt: Date.now() });
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

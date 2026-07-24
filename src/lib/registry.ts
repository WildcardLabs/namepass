import { solve, YEAR_SECONDS } from "./pricing";

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

export interface ActivityEvent {
	id: string;
	kind: EventKind;
	/** Unix ms when the event occurred. */
	at: number;
	/** Origin chain of the inbound payment. */
	chain: string;
	/** Exact USDC received, 6dp micro-units. Zero for activation. */
	amount: bigint;
	/** Seconds of renewal time bought. Zero for activation. */
	seconds: bigint;
	/** Discount label, e.g. "43.75%". Empty at full price. */
	off: string;
	/** The ENS NAME's expiry after this event was applied. */
	nameExpiryAfter: number;
	/** Who funded it — owner, community, treasury, agent. */
	funder: string;
	/** Fake tx hash for the explorer. */
	tx: string;
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
}

const CHAINS = ["Base", "Arbitrum", "Optimism", "Ethereum", "Polygon"];
const FUNDERS = ["owner", "community", "treasury", "agent", "anon", "contributor"];

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
			amount: 0n,
			seconds: 0n,
			off: "",
			nameExpiryAfter: expiryAtActivation,
			funder: "owner",
			tx: `0x${hex(rand, 62)}`,
		},
	];

	let expiry = expiryAtActivation;
	let at = activatedAt;
	for (let i = 1; i <= eventCount; i++) {
		at += Math.floor(10 + rand() * 90) * DAY;
		if (at > now) break;
		const amount = AMOUNTS[Math.floor(rand() * AMOUNTS.length)];
		const { seconds, off } = solve(amount, label.length);
		expiry += Number(seconds) * 1000;
		events.push({
			id: `${name}-${i}`,
			kind: "renewal",
			at,
			chain: CHAINS[Math.floor(rand() * CHAINS.length)],
			amount,
			seconds,
			off,
			nameExpiryAfter: expiry,
			funder: FUNDERS[Math.floor(rand() * FUNDERS.length)],
			tx: `0x${hex(rand, 62)}`,
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
	};
}

/* Mix of 3, 4 and 5+ character names so tier differences are visible. */
const SEED_NAMES: Array<[string, number, number]> = [
	["vitalik.eth", 101, 7],
	["nick.eth", 202, 5],
	["ens.eth", 303, 9],
	["brantly.eth", 404, 4],
	["coinbase.eth", 505, 6],
	["uniswap.eth", 606, 5],
	["op.eth", 707, 4],
	["base.eth", 808, 6],
	["defi.eth", 909, 3],
	["lens.eth", 111, 5],
	["farcaster.eth", 222, 6],
	["dao.eth", 333, 4],
];

const NOW = Date.now();
const registry: NameRecord[] = SEED_NAMES.map(([n, s, c]) => buildName(n, s, c, NOW));

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

/** Total USDC this Namepass has received, whole dollars. */
export function totalReceived(rec: NameRecord): number {
	const micro = rec.events.reduce((sum, e) => sum + e.amount, 0n);
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
				amount: 0n,
				seconds: 0n,
				off: "",
				nameExpiryAfter: expiryAtActivation,
				funder: "owner",
				tx: `0x${hex(rand, 62)}`,
			},
		],
	};
	registry.unshift(rec);
	return rec;
}

/** Append a live renewal to a random name. */
export function simulateRenewal(): ActivityEvent & { name: string } {
	const rec = registry[Math.floor(Math.random() * registry.length)];
	const amount = AMOUNTS[Math.floor(Math.random() * AMOUNTS.length)];
	const { seconds, off } = solve(amount, rec.labelLength);
	const rand = mulberry32(Date.now() % 100000);
	const event: ActivityEvent = {
		id: `${rec.name}-live-${Date.now()}`,
		kind: "renewal",
		at: Date.now(),
		chain: CHAINS[Math.floor(Math.random() * CHAINS.length)],
		amount,
		seconds,
		off,
		nameExpiryAfter: nameExpiry(rec) + Number(seconds) * 1000,
		funder: FUNDERS[Math.floor(Math.random() * FUNDERS.length)],
		tx: `0x${hex(rand, 62)}`,
	};
	rec.events.push(event);
	return { ...event, name: rec.name };
}

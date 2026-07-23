import { solve, YEAR_SECONDS } from "./pricing";

export type EventKind = "activated" | "renewal";

export interface ActivityEvent {
	id: string;
	kind: EventKind;
	/** Unix ms when the event occurred. */
	at: number;
	/** Origin chain of the inbound payment. */
	chain: string;
	/** Exact USDC charged, 6dp micro-units. Zero for activation. */
	amount: bigint;
	/** Seconds of renewal time bought. Zero for activation. */
	seconds: bigint;
	/** Discount label, e.g. "43.75% off". Empty at full price. */
	off: string;
	/** Expiry after this event was applied. */
	expiryAfter: number;
	/** Funder label — owner, a community handle, a treasury, an agent. */
	funder: string;
}

export interface NameRecord {
	/** ENS name, e.g. "vitalik.eth" */
	name: string;
	/** Namepass subdomain, e.g. "vitalik.namepass.eth" */
	pass: string;
	/** Deterministic deposit address. */
	address: string;
	/** Unix ms of Namepass activation. */
	activatedAt: number;
	/** Expiry before any Namepass renewals. */
	baseExpiry: number;
	events: ActivityEvent[];
}

const CHAINS = ["Base", "Arbitrum", "Optimism", "Ethereum", "Polygon"];
const FUNDERS = [
	"owner",
	"community",
	"treasury",
	"agent",
	"anon",
	"contributor",
];

/** Amounts that land exactly on real tier boundaries, plus some in between. */
const AMOUNTS = [
	8_000010n, // 1y, full price
	14_000017n, // 2y, 12.5% off
	16_500020n, // 3y, 31.25% off
	27_000032n, // 6y, 43.75% off
	5_000000n, // partial, full price
	40_000000n, // 6y+ change, 43.75% off
];

/* Deterministic pseudo-random so the seeded registry is stable across reloads. */
function mulberry32(seed: number) {
	return () => {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function fakeAddress(rand: () => number) {
	const hex = "0123456789abcdef";
	let out = "0x";
	for (let i = 0; i < 40; i++) out += hex[Math.floor(rand() * 16)];
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
	const activatedAt = now - Math.floor(180 + rand() * 500) * DAY;
	const baseExpiry = now + Math.floor(60 + rand() * 300) * DAY;

	const events: ActivityEvent[] = [
		{
			id: `${name}-0`,
			kind: "activated",
			at: activatedAt,
			chain: "Ethereum",
			amount: 0n,
			seconds: 0n,
			off: "",
			expiryAfter: baseExpiry,
			funder: "owner",
		},
	];

	let expiry = baseExpiry;
	let at = activatedAt;
	for (let i = 1; i <= eventCount; i++) {
		at += Math.floor(10 + rand() * 90) * DAY;
		if (at > now) break;
		const amount = AMOUNTS[Math.floor(rand() * AMOUNTS.length)];
		const { seconds, off } = solve(amount);
		expiry += Number(seconds) * 1000;
		events.push({
			id: `${name}-${i}`,
			kind: "renewal",
			at,
			chain: CHAINS[Math.floor(rand() * CHAINS.length)],
			amount,
			seconds,
			off,
			expiryAfter: expiry,
			funder: FUNDERS[Math.floor(rand() * FUNDERS.length)],
		});
	}

	return {
		name,
		pass: `${name.replace(/\.eth$/, "")}.namepass.eth`,
		address: fakeAddress(rand),
		activatedAt,
		baseExpiry,
		events,
	};
}

const SEED_NAMES: Array<[string, number, number]> = [
	["vitalik.eth", 101, 7],
	["nick.eth", 202, 5],
	["ens.eth", 303, 9],
	["brantly.eth", 404, 4],
	["coinbase.eth", 505, 6],
	["uniswap.eth", 606, 5],
	["optimism.eth", 707, 4],
	["base.eth", 808, 6],
	["arbitrum.eth", 909, 3],
	["lens.eth", 111, 5],
	["farcaster.eth", 222, 6],
	["gitcoin.eth", 333, 4],
];

const NOW = Date.now();

const registry: NameRecord[] = SEED_NAMES.map(([n, s, c]) =>
	buildName(n, s, c, NOW),
);

export function allNames(): NameRecord[] {
	return registry;
}

export function findName(query: string): NameRecord | undefined {
	const q = query.trim().toLowerCase();
	const withTld = q.endsWith(".eth") ? q : `${q}.eth`;
	return registry.find((r) => r.name === withTld);
}

/** Current expiry = the expiry recorded on the most recent event. */
export function currentExpiry(rec: NameRecord): number {
	return rec.events[rec.events.length - 1].expiryAfter;
}

/** Total renewal time ever dispensed to a name, in years. */
export function totalYears(rec: NameRecord): number {
	const secs = rec.events.reduce((sum, e) => sum + e.seconds, 0n);
	return Number(secs) / Number(YEAR_SECONDS);
}

/** Total USDC ever received by a name, in whole-dollar float. */
export function totalFunded(rec: NameRecord): number {
	const micro = rec.events.reduce((sum, e) => sum + e.amount, 0n);
	return Number(micro) / 1e6;
}

/** Every renewal across every name, newest first — the Explorer's live feed. */
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

/** Activate a Namepass for a new name. Returns the created record. */
export function claimName(input: string): NameRecord {
	const raw = input.trim().toLowerCase().replace(/\.eth$/, "");
	const name = `${raw}.eth`;
	const existing = registry.find((r) => r.name === name);
	if (existing) return existing;

	const rand = mulberry32(raw.length * 7919 + raw.charCodeAt(0) * 31);
	const now = Date.now();
	const baseExpiry = now + Math.floor(120 + rand() * 240) * DAY;
	const rec: NameRecord = {
		name,
		pass: `${raw}.namepass.eth`,
		address: fakeAddress(rand),
		activatedAt: now,
		baseExpiry,
		events: [
			{
				id: `${name}-0`,
				kind: "activated",
				at: now,
				chain: "Ethereum",
				amount: 0n,
				seconds: 0n,
				off: "",
				expiryAfter: baseExpiry,
				funder: "owner",
			},
		],
	};
	registry.unshift(rec);
	return rec;
}

/** Append a live renewal to a random name — drives the Explorer's ticker. */
export function simulateRenewal(): ActivityEvent & { name: string } {
	const rec = registry[Math.floor(Math.random() * registry.length)];
	const amount = AMOUNTS[Math.floor(Math.random() * AMOUNTS.length)];
	const { seconds, off } = solve(amount);
	const prev = currentExpiry(rec);
	const event: ActivityEvent = {
		id: `${rec.name}-live-${Date.now()}`,
		kind: "renewal",
		at: Date.now(),
		chain: CHAINS[Math.floor(Math.random() * CHAINS.length)],
		amount,
		seconds,
		off,
		expiryAfter: prev + Number(seconds) * 1000,
		funder: FUNDERS[Math.floor(Math.random() * FUNDERS.length)],
	};
	rec.events.push(event);
	return { ...event, name: rec.name };
}

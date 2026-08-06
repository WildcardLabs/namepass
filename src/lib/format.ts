import { YEAR_SECONDS } from "./pricing";

export function fmtDate(ms: number): string {
	return new Date(ms).toLocaleDateString("en-GB", {
		day: "numeric",
		month: "short",
		year: "numeric",
	});
}

export function fmtMonthYear(ms: number): string {
	return new Date(ms).toLocaleDateString("en-GB", {
		month: "short",
		year: "numeric",
	});
}

/** "2h ago", "3d ago", "5mo ago" */
export function fmtAgo(ms: number): string {
	const s = Math.max(1, Math.floor((Date.now() - ms) / 1000));
	if (s < 60) return `${s}s ago`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	const d = Math.floor(h / 24);
	if (d < 30) return `${d}d ago`;
	const mo = Math.floor(d / 30);
	if (mo < 12) return `${mo}mo ago`;
	return `${Math.floor(mo / 12)}y ago`;
}

/** Whole-dollar when exact, else 2dp. Amounts are 6dp micro-units. */
export function fmtUsdc(micro: bigint): string {
	const v = Number(micro) / 1e6;
	return `$${Math.abs(v - Math.round(v)) < 0.005 ? Math.round(v) : v.toFixed(2)}`;
}

/**
 * Every micro-unit, for the places where the exact amount decides something.
 *
 * Tier thresholds are not round numbers: $27.000032 buys six years at 43.75%
 * off, and $27.00 buys four years and eleven months at 31.25%. `fmtUsdc`
 * renders both as "$27", which is fine in a dense row and actively misleading
 * in a panel where someone is checking the arithmetic.
 */
export function fmtUsdcExact(micro: bigint): string {
	const whole = micro / 1000000n;
	const frac = (micro % 1000000n).toString().padStart(6, "0").replace(/0+$/, "");
	return `$${whole}.${frac.padEnd(2, "0")}`;
}

/**
 * Renewal time delivered, in words. Adaptive because neither unit works alone:
 * most names sit under a year, where "0.4 years" reads as nothing, and the
 * heavily-funded ones reach decades, where "264 months" is arithmetic homework.
 *
 * "9 days" · "8 months" · "1 year 3 months" · "22 years"
 */
export function fmtDelivered(years: number): string {
	const months = Math.round(years * 12);
	/* A three-character name's renewals are measured in days, and rounding those
	   to months just prints "0 months delivered". */
	if (months < 1) {
		const days = Math.round(years * 365);
		return `${days} day${days === 1 ? "" : "s"}`;
	}
	if (months < 12) return `${months} month${months === 1 ? "" : "s"}`;
	const y = Math.floor(months / 12);
	const m = months % 12;
	const yPart = `${y} year${y === 1 ? "" : "s"}`;
	return m > 0 ? `${yPart} ${m} month${m === 1 ? "" : "s"}` : yPart;
}

/** "+6.0y" or "+228d" for sub-year durations. */
export function fmtDuration(seconds: bigint): string {
	const years = Number(seconds) / Number(YEAR_SECONDS);
	if (years >= 1) return `+${years.toFixed(1)}y`;
	return `+${Math.floor(Number(seconds) / 86400)}d`;
}

export function truncAddress(addr: string): string {
	return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function truncTx(tx: string): string {
	return `${tx.slice(0, 10)}…${tx.slice(-6)}`;
}

const EXPLORER: Record<string, string> = {
	/* Testnet explorers — the app is a testnet deployment. Swap these and
	   `lib/tokens.ts` together if it ever goes to mainnet. */
	Ethereum: "https://sepolia.etherscan.io/tx/",
	Base: "https://sepolia.basescan.org/tx/",
	Arbitrum: "https://sepolia.arbiscan.io/tx/",
	Arc: "https://testnet.arcscan.app/tx/",
};

/** Block explorer link for a transaction. Empty when the chain is unknown. */
export function explorerUrl(chain: string, tx: string): string {
	const base = EXPLORER[chain];
	return base ? `${base}${tx}` : "";
}

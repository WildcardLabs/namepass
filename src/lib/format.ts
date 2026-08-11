import { YEAR_SECONDS } from "./pricing";
import { chainByName } from "./chains";

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
	const negative = micro < 0n;
	const value = negative ? -micro : micro;
	const cents = (value + 5_000n) / 10_000n;
	const whole = cents / 100n;
	const fraction = (cents % 100n).toString().padStart(2, "0");
	return `${negative ? "-$" : "$"}${whole}${fraction === "00" ? "" : `.${fraction}`}`;
}

/**
 * Every micro-unit, for the places where the exact amount decides something.
 *
 * Tier thresholds are not round numbers: $27.000071 buys six years at 43.75%
 * off, and $27.00 buys four years and eleven months at 31.25%. `fmtUsdc`
 * renders both as "$27", which is fine in a dense row and actively misleading
 * in a panel where someone is checking the arithmetic.
 */
export function fmtUsdcExact(micro: bigint): string {
	const negative = micro < 0n;
	const value = negative ? -micro : micro;
	const whole = value / 1000000n;
	const frac = (value % 1000000n).toString().padStart(6, "0").replace(/0+$/, "");
	return `${negative ? "-$" : "$"}${whole}.${frac.padEnd(2, "0")}`;
}

/**
 * Renewal time delivered, in words. Adaptive because neither unit works alone:
 * most names sit under a year, where "0.4 years" reads as nothing, and the
 * heavily-funded ones reach decades, where "264 months" is arithmetic homework.
 *
 * "9 days" · "8 months" · "1 year 3 months" · "22 years"
 */
export function fmtDelivered(seconds: bigint): string {
	const months = (seconds * 12n + YEAR_SECONDS / 2n) / YEAR_SECONDS;
	/* A three-character name's renewals are measured in days, and rounding those
	   to months just prints "0 months delivered". */
	if (months < 1n) {
		const days = (seconds + 43_200n) / 86_400n;
		return `${days} day${days === 1n ? "" : "s"}`;
	}
	if (months < 12n) return `${months} month${months === 1n ? "" : "s"}`;
	const y = months / 12n;
	const m = months % 12n;
	const yPart = `${y} year${y === 1n ? "" : "s"}`;
	return m > 0n ? `${yPart} ${m} month${m === 1n ? "" : "s"}` : yPart;
}

/** "+6.0y" or "+228d" for sub-year durations. */
export function fmtDuration(seconds: bigint): string {
	const tenths = (seconds * 10n + YEAR_SECONDS / 2n) / YEAR_SECONDS;
	if (tenths >= 10n) return `+${tenths / 10n}.${tenths % 10n}y`;
	return `+${seconds / 86_400n}d`;
}

/** One decimal year value without the prefix/suffix used by compact duration labels. */
export function fmtYears(seconds: bigint): string {
	const tenths = (seconds * 10n + YEAR_SECONDS / 2n) / YEAR_SECONDS;
	return `${tenths / 10n}.${tenths % 10n}`;
}

export function truncAddress(addr: string): string {
	return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function truncTx(tx: string): string {
	return `${tx.slice(0, 10)}…${tx.slice(-6)}`;
}

/** Block explorer link for a transaction. Empty when the chain is unknown. */
export function explorerUrl(chain: string, tx: string): string {
	const entry = chainByName(chain);
	return entry ? `${entry.explorerUrl}/tx/${tx}` : "";
}

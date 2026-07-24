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

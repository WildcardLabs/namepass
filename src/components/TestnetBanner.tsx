import { useEffect, useRef, useState } from "react";
import { FlaskConical } from "lucide-react";
import { IS_TESTNET, TOKEN_CHAINS } from "../lib/chains";
import { getActivity } from "../lib/publicApi";
import { fmtDurationPrecise } from "../lib/format";

/**
 * A slim marquee above the page card, on every route.
 *
 * It scrolls the latest real renewals ("steve.eth extended by 6 months"), read
 * from the public activity API — never invented. Until that returns something
 * (no backend, or no renewals yet), it falls back to the testnet notices, so
 * the strip is never empty and never implies activity that did not happen.
 *
 * Why a strip rather than a dismissible banner: "this is a testnet" is not a
 * notice someone should be able to close and forget while looking at a deposit
 * address. It stays, and it costs ~28px. It lives *outside* `PageShell` because
 * it is a statement about the deployment, not a feature of any one page.
 *
 * The marquee is CSS-only and duplicated once so the loop is seamless. It is
 * paused for anyone who asks for reduced motion — see `index.css`.
 */

/**
 * Desktop fills the viewport below the strip. Mobile keeps enough height for
 * the copy and both floating panels without leaving a large empty cover.
 */
export const VIEWPORT_BELOW_BANNER = IS_TESTNET
	? "h-[700px] md:h-[calc(100vh-2.25rem)]"
	: "h-[700px] md:h-screen";

const NOTICES = [
	"Testnet preview",
	`Addresses are on ${TOKEN_CHAINS.map((chain) => chain.network)
		.join(", ")
		.replace(/, ([^,]*)$/, " and $1")}`,
	"Testnet USDC only",
	"Public activity needs the testnet backend",
];

export default function TestnetBanner() {
	const [renewals, setRenewals] = useState<string[] | null>(null);
	const trackRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!IS_TESTNET) return;
		let alive = true;
		let loading = false;
		const load = async () => {
			if (!alive || document.hidden || loading) return;
			loading = true;
			try {
				const res = await getActivity(1, 12);
				if (!alive) return;
				const lines = res.items
					.filter((it) => it.renewal?.durationSeconds)
					.map((it) => {
						const seconds = BigInt(it.renewal.durationSeconds.split(".")[0] || "0");
						return `${it.name.displayName} extended by ${fmtDurationPrecise(seconds)}`;
					});
				setRenewals(lines.length ? lines : null);
			} catch {
				/* No backend / no activity — the notices fallback stands. */
			} finally {
				loading = false;
			}
		};
		void load();
		const timer = window.setInterval(() => void load(), 5_000);
		const focus = () => void load();
		const visibility = () => { if (!document.hidden) void load(); };
		window.addEventListener("focus", focus);
		document.addEventListener("visibilitychange", visibility);
		return () => {
			alive = false;
			window.clearInterval(timer);
			window.removeEventListener("focus", focus);
			document.removeEventListener("visibilitychange", visibility);
		};
	}, []);

	/* Keep the scroll speed constant however much text is in the track. The
	   track holds two copies, so one loop travels half its width; set the
	   duration for a fixed pixels-per-second. Without this, a longer renewals
	   list scrolls noticeably faster than the short notices. */
	useEffect(() => {
		const el = trackRef.current;
		if (!el) return;
		const distance = el.scrollWidth / 2;
		const SPEED = 20; // px per second — slow enough to read comfortably
		el.style.animationDuration = `${Math.max(30, distance / SPEED)}s`;
	}, [renewals]);

	if (!IS_TESTNET) return null;

	const live = Boolean(renewals?.length);
	const items = live ? (renewals as string[]) : NOTICES;

	/* Rendered twice; the track translates by exactly -50% so the second copy
	   lands where the first began. */
	const track = [...items, ...items];

	return (
		<div
			className="w-full bg-[#1c3a29] text-white/90 overflow-hidden select-none"
			role="status"
			aria-label={
				live
					? "Latest renewals on the testnet deployment."
					: "This is a testnet deployment. Testnet USDC only."
			}
		>
			<div className="flex items-center gap-2 h-8 md:h-9">
				{/* Label: a live pulse when showing renewals, the flask otherwise. */}
				<div className="flex items-center gap-1.5 shrink-0 pl-4 md:pl-6 text-[11px] uppercase tracking-wider text-white">
					{live ? (
						<span className="relative flex h-1.5 w-1.5">
							<span className="absolute inline-flex h-full w-full rounded-full bg-white/70 motion-safe:animate-ping" />
							<span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
						</span>
					) : (
						<FlaskConical className="w-3.5 h-3.5" />
					)}
					<span>{live ? "Latest renewals" : "Testnet"}</span>
				</div>

				{/* Fades the scrolling text in at the left edge, so it doesn't read
				    as sliding out from underneath the label. */}
				<div
					className="relative flex-1 overflow-hidden"
					style={{
						maskImage:
							"linear-gradient(to right, transparent 0, black 24px, black calc(100% - 24px), transparent 100%)",
						WebkitMaskImage:
							"linear-gradient(to right, transparent 0, black 24px, black calc(100% - 24px), transparent 100%)",
					}}
					aria-hidden="true"
				>
					<div ref={trackRef} className="marquee-track flex items-center whitespace-nowrap">
						{track.map((text, i) => (
							<span
								key={i}
								className="flex items-center text-[11.5px] md:text-[12px] text-white/75"
							>
								{text}
								<span className="mx-4 md:mx-6 text-white/30">·</span>
							</span>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}

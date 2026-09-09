import { FlaskConical } from "lucide-react";
import { IS_TESTNET, TOKEN_CHAINS } from "../lib/chains";

/**
 * A slim marquee above the page card, on every route.
 *
 * Why a strip rather than a dismissible banner: "this is a testnet" is not a
 * notice someone should be able to close and then forget while looking at a
 * deposit address. It stays, and it costs ~28px.
 *
 * Why it lives *outside* `PageShell` rather than inside it: the shell is the
 * app, and this is a statement about the deployment. Putting it inside would
 * make it look like a feature of the page it happens to be on.
 *
 * The marquee is CSS-only and duplicated once so the loop is seamless. It is
 * paused for anyone who asks for reduced motion — see `index.css` — because a
 * permanent moving element is exactly what that setting is for.
 */
/**
 * Height for a section that should fill the viewport *below* the strip.
 *
 * Lives here rather than in `App` so it cannot drift from the strip's own
 * height: `h-8` is 2rem and `md:h-9` is 2.25rem, and if those change this must
 * change with them. Falls back to a plain `h-screen` when the strip is off.
 */
export const VIEWPORT_BELOW_BANNER = IS_TESTNET
	? "h-[calc(100vh-2rem)] md:h-[calc(100vh-2.25rem)]"
	: "h-screen";

export default function TestnetBanner() {
	if (!IS_TESTNET) return null;

	const items = [
		"Testnet preview",
		`Addresses are on ${TOKEN_CHAINS.map((chain) => chain.network)
			.join(", ")
			.replace(/, ([^,]*)$/, " and $1")}`,
		"Testnet USDC only",
		"Public activity needs the testnet backend",
	];

	/* Rendered twice; the track translates by exactly -50% so the second copy
	   lands where the first began. */
	const track = [...items, ...items];

	return (
		<div
			className="w-full bg-[rgba(28,58,41,0.95)] text-white/90 overflow-hidden select-none"
			role="status"
			aria-label="This is a testnet deployment. Testnet USDC only."
		>
			<div className="flex items-center gap-2 h-8 md:h-9">
				{/* Kept visible at every width — the icon alone doesn't say
				    "testnet" to anyone who hasn't already been told. */}
				<div className="flex items-center gap-1.5 shrink-0 pl-4 md:pl-6 text-[11px] uppercase tracking-wider text-white">
					<FlaskConical className="w-3.5 h-3.5" />
					<span>Testnet</span>
				</div>

				{/* Fades the scrolling text in at the left edge, so it doesn't
				    read as sliding out from underneath the label. */}
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
					<div className="marquee-track flex items-center whitespace-nowrap">
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

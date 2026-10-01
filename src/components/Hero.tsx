import { motion } from "motion/react";
import HeroBadge from "./HeroBadge";
import BottomLeftCard from "./BottomLeftCard";
import BottomRightCorner from "./BottomRightCorner";
import PageShell from "./PageShell";

interface Props {
	video: string;
	onExplore: () => void;
	onLeaderboard: () => void;
	/**
	 * Whether ENS's rates have been read yet. Only the renewal ticker needs
	 * them — the rest of the hero is copy over video and must never wait on a
	 * network call, since it's the whole of the first paint.
	 */
	priced: boolean;
}

/** The existing landscape is a contained illustration beneath the public copy. */
export default function Hero({ video, onExplore, onLeaderboard, priced }: Props) {
	return (
		<section className="home-hero">
			<div className="home-hero-copy">
				<HeroBadge />

				<h1 className="text-ink-primary">
					Give a name more time
				</h1>

				<motion.p
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					transition={{ duration: 0.7, delay: 0.15, ease: "easeOut" }}
					className="text-ink-secondary"
				>
					Send USDC to an ENS name’s deposit address. Watch it turn into renewal time.
				</motion.p>
			</div>

			<PageShell video={video} outerClassName="home-landscape-shell" cardClassName="home-landscape">
				<div className="home-landscape-panels">
					{/* Only the illustrative ticker waits for validated ENS rates. */}
					{priced && <BottomLeftCard onLeaderboard={onLeaderboard} />}
					<BottomRightCorner onOpen={onExplore} />
				</div>
			</PageShell>
		</section>
	);
}

import { motion } from "motion/react";
import HeroBadge from "./HeroBadge";
import BottomLeftCard from "./BottomLeftCard";
import BottomRightCorner from "./BottomRightCorner";

interface Props {
	onExplore: () => void;
	onLeaderboard: () => void;
	/**
	 * Whether ENS's rates have been read yet. Only the renewal ticker needs
	 * them — the rest of the hero is copy over video and must never wait on a
	 * network call, since it's the whole of the first paint.
	 */
	priced: boolean;
}

/** Home's hero content, rendered inside PageShell's video card, below Navbar. */
export default function Hero({ onExplore, onLeaderboard, priced }: Props) {
	return (
		<>
			<div className="w-full flex flex-col items-center pt-12 md:pt-16 px-6 text-center max-w-4xl">
				<HeroBadge />

				<h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-[70px] font-normal text-[#1c3a29f2] mb-2 tracking-tight leading-[1.05]">
					Give a name more time
				</h1>

				<motion.p
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					transition={{ duration: 0.7, delay: 0.15, ease: "easeOut" }}
					className="text-sm sm:text-base md:text-lg text-[rgba(28,58,41,0.6)] leading-relaxed max-w-xl font-normal"
				>
					Send USDC to an ENS name’s deposit address. Namepass turns it into renewal time.
				</motion.p>
			</div>

			{/* The ticker needs ENS rates, while the headline renders immediately. */}
			{priced && <BottomLeftCard onLeaderboard={onLeaderboard} />}
			<BottomRightCorner onOpen={onExplore} />
		</>
	);
}

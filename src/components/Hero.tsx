import { motion } from "motion/react";
import HeroBadge from "./HeroBadge";
import BottomLeftCard from "./BottomLeftCard";
import BottomRightCorner from "./BottomRightCorner";
import { TextAnimate } from "./magicui/TextAnimate";

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

				<h1
					className="text-4xl sm:text-5xl md:text-6xl lg:text-[80px] font-normal text-[#5E6470] mb-2 tracking-tight leading-[1.05]"
				>
					<TextAnimate as="span" by="character" duration={0.55} delay={0.15}>
						Keep your name
					</TextAnimate>{" "}
					<TextAnimate as="span" by="character" duration={0.55} delay={1.35} className="text-[#1c3a29]">
						alive
					</TextAnimate>
				</h1>

				<motion.p
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					transition={{ duration: 3, delay: 2.05, ease: "easeOut" }}
					className="text-sm sm:text-base md:text-lg text-[#5E6470] opacity-80 leading-relaxed max-w-xl font-normal"
				>
					Send USDC to an ENS name's deterministic address. Any executor can
					process eligible deposits into renewal time.
				</motion.p>
			</div>

			{/* The ticker resolves real payments into renewal time, so it's the one
			    piece of the hero that can't render before the oracle read lands.
			    It already slides in on a 0.2s delay, so arriving ~150ms later than
			    the headline just extends the stagger it was designed with — where
			    holding the *whole* hero back was a white flash on every reload. */}
			{priced && <BottomLeftCard onLeaderboard={onLeaderboard} />}
			<BottomRightCorner onOpen={onExplore} />
		</>
	);
}

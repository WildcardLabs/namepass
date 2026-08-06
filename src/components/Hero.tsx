import { motion } from "motion/react";
import HeroBadge from "./HeroBadge";
import BottomLeftCard from "./BottomLeftCard";
import BottomRightCorner from "./BottomRightCorner";

interface Props {
	onExplore: () => void;
	onLeaderboard: () => void;
}

/** Home's hero content, rendered inside PageShell's video card, below Navbar. */
export default function Hero({ onExplore, onLeaderboard }: Props) {
	return (
		<>
			<div className="w-full flex flex-col items-center pt-12 md:pt-16 px-6 text-center max-w-4xl">
				<HeroBadge />

				<motion.h1
					initial={{ opacity: 0, scale: 0.98 }}
					animate={{ opacity: 1, scale: 1 }}
					transition={{ duration: 0.8, delay: 0.2 }}
					className="text-4xl sm:text-5xl md:text-6xl lg:text-[80px] font-normal text-[rgba(30,50,90,0.95)] mb-2 tracking-tight leading-[1.05]"
				>
					Keep your name alive
				</motion.h1>

				<motion.p
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					transition={{ duration: 0.8, delay: 0.4 }}
					className="text-sm sm:text-base md:text-lg text-[rgba(30,50,90,0.7)] leading-relaxed max-w-xl font-normal"
				>
					Your name gets its own address. Any USDC that arrives automatically extends your registration for as long as the funds will cover.
				</motion.p>
			</div>

			<BottomLeftCard onLeaderboard={onLeaderboard} />
			<BottomRightCorner onOpen={onExplore} />
		</>
	);
}

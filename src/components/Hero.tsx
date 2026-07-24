import { motion } from "motion/react";
import Navbar from "./Navbar";
import HeroBadge from "./HeroBadge";
import BottomLeftCard from "./BottomLeftCard";
import BottomRightCorner from "./BottomRightCorner";

const VIDEO_URL = `${import.meta.env.BASE_URL}assets/cinematic.mp4`;

interface Props {
	onClaim: () => void;
	onExplore: () => void;
	onSimulate: () => void;
	onSearch: () => void;
}

export default function Hero({ onClaim, onExplore, onSimulate, onSearch }: Props) {
	return (
		<div className="w-full h-screen flex items-center justify-center p-3 md:p-5 bg-[#f0f0f0]">
			<section className="relative w-full max-w-[1536px] h-full rounded-[1.5rem] md:rounded-[3rem] overflow-hidden shadow-none flex flex-col items-center bg-white/10 group">
				<video
					autoPlay
					muted
					loop
					playsInline
					src={VIDEO_URL}
					className="absolute inset-0 w-full h-full object-cover object-[65%] lg:object-center z-0"
				/>

				<div className="relative z-10 w-full h-full flex flex-col items-center">
					<Navbar
						onClaim={onClaim}
						onExplore={onExplore}
						onSimulate={onSimulate}
						onSearch={onSearch}
					/>

					<div className="w-full flex flex-col items-center pt-8 px-6 text-center max-w-4xl">
						<HeroBadge />

						<motion.h1
							initial={{ opacity: 0, scale: 0.98 }}
							animate={{ opacity: 1, scale: 1 }}
							transition={{ duration: 0.8, delay: 0.2 }}
							className="text-4xl sm:text-5xl md:text-6xl lg:text-[80px] font-normal text-[#5E6470] mb-2 tracking-tight leading-[1.05]"
						>
							Renewal Infrastructure
						</motion.h1>

						<motion.p
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							transition={{ duration: 0.8, delay: 0.4 }}
							className="text-sm sm:text-base md:text-lg text-[#5E6470] opacity-80 leading-relaxed max-w-xl font-normal"
						>
							A permanent address for every ENS name. Stablecoins in from any
							chain, renewal time out, always at the best available rate.
						</motion.p>
					</div>

					<BottomLeftCard onClaim={onClaim} />
					<BottomRightCorner onOpen={onExplore} />
				</div>
			</section>
		</div>
	);
}

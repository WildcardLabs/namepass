import { motion } from "motion/react";
import { ShieldCheck } from "lucide-react";
import ShineBorder from "./magicui/ShineBorder";
import AnimatedShinyText from "./magicui/AnimatedShinyText";

export default function HeroBadge() {
	return (
		<motion.div
			initial={{ opacity: 0, y: 20 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.6, ease: "easeOut" }}
			className="mx-auto mb-3 w-fit"
		>
			<ShineBorder borderRadius={999} borderWidth={2} duration={7}>
				<div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/70 backdrop-blur-md border border-white/40 shadow-[0_1px_2px_rgba(30,50,90,0.06)]">
					<ShieldCheck className="w-4 h-4 text-[rgba(30,50,90,0.8)] shrink-0" />
					<AnimatedShinyText className="text-[14px] font-normal whitespace-nowrap">
						Launching with ENS v2
					</AnimatedShinyText>
				</div>
			</ShineBorder>
		</motion.div>
	);
}

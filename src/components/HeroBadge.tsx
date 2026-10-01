import { motion } from "motion/react";

/** The existing announcement uses the shared public control treatment. */
export default function HeroBadge() {
	return (
		<motion.div
			initial={{ opacity: 0, y: 20 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.6, ease: "easeOut" }}
			className="mx-auto mb-4 w-fit"
		>
			<button className="hero-badge transition-colors">
				<span className="text-[16px] leading-none">
					🌳
				</span>
				<span className="text-[13px] text-ink-primary whitespace-nowrap">
					Built for ENS v2
				</span>
			</button>
		</motion.div>
	);
}

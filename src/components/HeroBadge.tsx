import { motion } from "motion/react";

/**
 * Announcement badge in the Framer convention: a small solid chip + label +
 * trailing arrow, squared corners. Deliberately no shine/sparkle/animated-
 * gradient — that treatment read as a generic AI template.
 */
export default function HeroBadge() {
	return (
		<motion.div
			initial={{ opacity: 0, y: 20 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.6, ease: "easeOut" }}
			className="mx-auto mb-4 w-fit"
		>
			<button className="group inline-flex items-center gap-2 rounded-[10px] bg-white/70 backdrop-blur-md pl-1.5 pr-2.5 py-1.5 shadow-[0_1px_2px_rgba(28,58,41,0.05)] hover:bg-white/85 transition-colors">
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

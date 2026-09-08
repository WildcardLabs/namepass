import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";

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
			<button className="group inline-flex items-center gap-2 rounded-[10px] bg-white/70 backdrop-blur-md border border-[rgba(18,36,26,0.1)] pl-1.5 pr-2.5 py-1.5 shadow-[0_1px_2px_rgba(18,36,26,0.05)] hover:bg-white/85 transition-colors">
				<span className="rounded-[6px] bg-[rgba(18,36,26,0.9)] text-white text-[11px] font-medium px-1.5 py-0.5 leading-none">
					New
				</span>
				<span className="text-[13px] text-[#5E6470] whitespace-nowrap">
					Launching with ENS v2
				</span>
				<ArrowRight className="w-3.5 h-3.5 text-[rgba(18,36,26,0.45)] transition-transform group-hover:translate-x-0.5" />
			</button>
		</motion.div>
	);
}

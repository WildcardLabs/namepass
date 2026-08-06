import { Activity, ChevronRight } from "lucide-react";

/**
 * Rendered immediately, with no entrance animation.
 *
 * It used to slide up after a 0.4s delay, which meant the first second of the
 * page showed the video running straight through this corner before the panel
 * dropped in. The card reads as one shape, so a piece of it arriving late looks
 * like a load glitch rather than a flourish.
 *
 * The `y` transform it animated on was also a problem in its own right: a
 * transform makes this panel its own compositing layer for the duration, so its
 * edges antialias against the video instead of being painted with it, and a
 * line appeared along the top edge that vanished the moment the transform was
 * released. Nothing here transforms now.
 */
export default function BottomRightCorner({ onOpen }: { onOpen: () => void }) {
	return (
		<div
			className="absolute bottom-0 right-0 p-3 pt-5 pl-8 sm:p-4 sm:pt-6 sm:pl-10 md:p-6 md:pt-8 md:pl-14 bg-[#f0f0f0] rounded-tl-[1.5rem] sm:rounded-tl-[2rem] md:rounded-tl-[3.5rem] flex items-center gap-3 sm:gap-4 md:gap-6"
		>
			{/* Top intersection mask */}
			<div className="absolute -top-[1.5rem] sm:-top-[2rem] md:-top-[3.5rem] right-0 w-[1.5rem] sm:w-[2rem] md:w-[3.5rem] h-[1.5rem] sm:h-[2rem] md:h-[3.5rem] pointer-events-none">
				<svg
					width="100%"
					height="100%"
					viewBox="0 0 56 56"
					fill="none"
					xmlns="http://www.w3.org/2000/svg"
				>
					<path d="M56 56V0C56 30.9279 30.9279 56 0 56H56Z" fill="#f0f0f0" />
				</svg>
			</div>

			{/* Left intersection mask */}
			<div className="absolute bottom-0 -left-[1.5rem] sm:-left-[2rem] md:-left-[3.5rem] w-[1.5rem] sm:w-[2rem] md:w-[3.5rem] h-[1.5rem] sm:h-[2rem] md:h-[3.5rem] pointer-events-none">
				<svg
					width="100%"
					height="100%"
					viewBox="0 0 56 56"
					fill="none"
					xmlns="http://www.w3.org/2000/svg"
				>
					<path d="M56 56H0C30.9279 56 56 30.9279 56 0V56Z" fill="#f0f0f0" />
				</svg>
			</div>

			<button
				onClick={onOpen}
				aria-label="Open Explorer"
				className="bg-[rgba(30,50,90,0.05)] w-10 h-10 md:w-14 md:h-14 rounded-full flex items-center justify-center border border-[rgba(30,50,90,0.1)] hover:bg-[rgba(30,50,90,0.1)] transition-colors"
			>
				<Activity className="w-5 h-5 md:w-6 md:h-6 text-[rgba(30,50,90,0.8)]" />
			</button>

			<div className="flex flex-col">
				<span className="text-[16px] md:text-[20px] font-normal text-[rgba(30,50,90,0.95)]">
					Explorer
				</span>
				<button
					onClick={onOpen}
					className="flex items-center gap-1 text-[rgba(30,50,90,0.6)] cursor-pointer hover:text-[rgba(30,50,90,0.8)] transition-colors"
				>
					<span className="text-[10px] md:text-[11px] font-normal">
						Live renewals
					</span>
					<ChevronRight className="w-3 h-3 md:w-4 md:h-4" />
				</button>
			</div>
		</div>
	);
}

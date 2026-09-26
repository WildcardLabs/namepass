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
			className="absolute bottom-0 right-0 p-3 pt-5 pl-7 sm:p-4 sm:pt-6 sm:pl-8 md:p-6 md:pt-7 md:pl-10 bg-surface-canvas rounded-tl-[1rem] sm:rounded-tl-[1.25rem] md:rounded-tl-[1.5rem] flex items-center gap-3 sm:gap-4 md:gap-6"
		>
			{/* Top intersection mask */}
			<div className="absolute -top-[1rem] sm:-top-[1.25rem] md:-top-[1.5rem] right-0 w-[1rem] sm:w-[1.25rem] md:w-[1.5rem] h-[1rem] sm:h-[1.25rem] md:h-[1.5rem] pointer-events-none">
				<svg
					width="100%"
					height="100%"
					viewBox="0 0 56 56"
					fill="none"
					xmlns="http://www.w3.org/2000/svg"
				>
					<path d="M56 56V0C56 30.9279 30.9279 56 0 56H56Z" fill="var(--color-surface-canvas)" />
				</svg>
			</div>

			{/* Left intersection mask */}
			<div className="absolute bottom-0 -left-[1rem] sm:-left-[1.25rem] md:-left-[1.5rem] w-[1rem] sm:w-[1.25rem] md:w-[1.5rem] h-[1rem] sm:h-[1.25rem] md:h-[1.5rem] pointer-events-none">
				<svg
					width="100%"
					height="100%"
					viewBox="0 0 56 56"
					fill="none"
					xmlns="http://www.w3.org/2000/svg"
				>
					<path d="M56 56H0C30.9279 56 56 30.9279 56 0V56Z" fill="var(--color-surface-canvas)" />
				</svg>
			</div>

			<button
				onClick={onOpen}
				aria-label="Open Explorer"
				className="bg-[rgba(28,58,41,0.05)] w-10 h-10 md:w-14 md:h-14 rounded-[14px] flex items-center justify-center hover:bg-[rgba(28,58,41,0.1)] transition-colors"
			>
				<Activity className="w-5 h-5 md:w-6 md:h-6 text-ink-action" />
			</button>

			<div className="flex flex-col">
				<span className="text-[16px] md:text-[20px] font-normal text-ink-primary">
					Explorer
				</span>
				<button
					onClick={onOpen}
					className="flex items-center gap-1 text-ink-secondary cursor-pointer hover:text-ink-primary transition-colors"
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

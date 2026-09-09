import type { ReactNode } from "react";

interface Props {
	children: ReactNode;
	className?: string;
	duration?: number;
}

/**
 * A soft highlight streak that sweeps across text on a loop.
 * Ported from Magic UI's AnimatedShinyText, tuned to a subtle
 * navy-on-navy shimmer instead of the default light/dark contrast version.
 */
export default function AnimatedShinyText({ children, className = "", duration = 3.5 }: Props) {
	return (
		<span
			className={`bg-clip-text text-transparent bg-[length:250%_100%] [background-image:linear-gradient(90deg,rgba(28,58,41,0.82)_0%,rgba(28,58,41,0.82)_35%,rgba(120,150,200,0.95)_50%,rgba(28,58,41,0.82)_65%,rgba(28,58,41,0.82)_100%)] animate-shine-text ${className}`}
			style={{ animationDuration: `${duration}s` }}
		>
			{children}
		</span>
	);
}

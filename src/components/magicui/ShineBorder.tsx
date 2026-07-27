import type { CSSProperties, ReactNode } from "react";

interface Props {
	children: ReactNode;
	className?: string;
	borderRadius?: number;
	borderWidth?: number;
	duration?: number;
	color?: string;
}

/**
 * A thin animated gradient ring that sweeps around the element's border.
 * Ported from Magic UI's ShineBorder, restyled to the brand navy so it
 * reads as "premium/verified" rather than a colorful accent.
 *
 * Implemented as a padded gradient box rather than the usual mask-composite
 * cutout — the child's own (near-)opaque background covers the center,
 * leaving only the padding ring showing the animated gradient. This avoids
 * the cross-browser fragility of combining an inline `mask` shorthand with
 * a separately-set `mask-composite`, where the shorthand silently resets it.
 */
export default function ShineBorder({
	children,
	className = "",
	borderRadius = 999,
	borderWidth = 2,
	duration = 9,
	color = "rgba(30,50,90,0.55)",
}: Props) {
	return (
		<div
			className={className}
			style={
				{
					borderRadius,
					padding: borderWidth,
					backgroundColor: "rgba(30,50,90,0.08)",
					backgroundImage: `conic-gradient(from var(--shine-angle, 0deg), transparent 0%, ${color} 18%, transparent 40%)`,
					animation: `shine-rotate ${duration}s linear infinite`,
				} as CSSProperties
			}
		>
			{children}
		</div>
	);
}

import { useEffect, useRef } from "react";
import { useInView, useMotionValue, useSpring } from "motion/react";

interface Props {
	value: number;
	decimals?: number;
	prefix?: string;
	suffix?: string;
	className?: string;
}

/**
 * Animates a number counting up to its target once it scrolls into view.
 * Ported from Magic UI's NumberTicker, using the project's existing
 * `motion` dependency instead of pulling in framer-motion directly.
 */
export default function NumberTicker({
	value,
	decimals = 0,
	prefix = "",
	suffix = "",
	className = "",
}: Props) {
	const ref = useRef<HTMLSpanElement>(null);
	const motionValue = useMotionValue(0);
	const springValue = useSpring(motionValue, { damping: 32, stiffness: 90 });
	const isInView = useInView(ref, { once: true, margin: "-40px" });

	useEffect(() => {
		if (isInView) motionValue.set(value);
	}, [isInView, motionValue, value]);

	useEffect(() => {
		return springValue.on("change", (latest) => {
			if (ref.current) {
				ref.current.textContent = `${prefix}${latest.toFixed(decimals)}${suffix}`;
			}
		});
	}, [springValue, decimals, prefix, suffix]);

	return (
		<span ref={ref} className={className}>
			{`${prefix}${(0).toFixed(decimals)}${suffix}`}
		</span>
	);
}

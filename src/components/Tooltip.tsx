import { motion, AnimatePresence } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

interface Props {
	/** The full explanation, shown on hover or focus. */
	text: string;
	/** Accessible name for the trigger — say what it explains. */
	label: string;
}

const WIDTH = 248;
const GAP = 8;
/** Below this much room overhead, open downwards instead. */
const FLIP_AT = 130;

type Pos = { left: number; top?: number; bottom?: number; below: boolean };

/**
 * An info affordance that keeps a scannable line short. Used wherever the
 * one-line version of a fact is what belongs on screen and the sentence behind
 * it is worth having but not worth the space.
 *
 * Rendered through a portal rather than positioned inside its parent: these
 * sit in accordions and cards that need `overflow-hidden` for their height
 * animations, which would otherwise clip the bubble.
 */
export default function Tooltip({ text, label }: Props) {
	const ref = useRef<HTMLButtonElement>(null);
	const [pos, setPos] = useState<Pos | null>(null);

	function show() {
		const el = ref.current;
		if (!el) return;
		const r = el.getBoundingClientRect();
		/* Right-align to the trigger, then keep it inside the viewport. */
		const left = Math.min(Math.max(8, r.right - WIDTH), window.innerWidth - WIDTH - 8);
		const below = r.top < FLIP_AT;
		setPos(
			below
				? { left, top: r.bottom + GAP, below }
				: /* Anchor the bubble's bottom edge so its height doesn't need measuring. */
					{ left, bottom: window.innerHeight - r.top + GAP, below },
		);
	}

	const hide = () => setPos(null);

	/* A fixed bubble would drift away from its trigger on scroll. */
	useEffect(() => {
		if (!pos) return;
		window.addEventListener("scroll", hide, true);
		window.addEventListener("resize", hide);
		return () => {
			window.removeEventListener("scroll", hide, true);
			window.removeEventListener("resize", hide);
		};
	}, [pos]);

	return (
		<>
			<button
				ref={ref}
				type="button"
				aria-label={label}
				onMouseEnter={show}
				onMouseLeave={hide}
				onFocus={show}
				onBlur={hide}
				className="inline-flex text-[rgba(18,36,26,0.35)] hover:text-[rgba(18,36,26,0.75)] focus:text-[rgba(18,36,26,0.75)] transition-colors outline-none"
			>
				<Info className="w-3.5 h-3.5" />
			</button>

			{createPortal(
				<AnimatePresence>
					{pos && (
						<motion.span
							key="tip"
							role="tooltip"
							initial={{ opacity: 0, y: pos.below ? -4 : 4 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0 }}
							transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
							style={{
								position: "fixed",
								left: pos.left,
								top: pos.top,
								bottom: pos.bottom,
								width: WIDTH,
							}}
							className="z-50 block rounded-xl bg-[rgba(18,36,26,0.96)] px-3.5 py-2.5 text-[12px] leading-relaxed text-white/90 shadow-lg pointer-events-none"
						>
							{text}
						</motion.span>
					)}
				</AnimatePresence>,
				document.body,
			)}
		</>
	);
}

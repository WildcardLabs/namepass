import { useRef, type ReactNode } from "react";

interface Props {
	children: ReactNode;
	animation?: string;
	/** Extra classes for the outer full-bleed gutter (e.g. a fixed hero height). */
	outerClassName?: string;
	/** Extra classes for the inner rounded card (e.g. min-height). */
	cardClassName?: string;
}

/**
 * The rounded, margined card every page sits inside — Navbar included, so
 * the header always reads as the top of the current page's content rather
 * than a separate strip bolted above it. Home passes an animation for the
 * hero background; other pages get a plain white card.
 */
export default function PageShell({ children, animation, outerClassName = "", cardClassName = "" }: Props) {
	const animationRef = useRef<HTMLIFrameElement>(null);
	return (
		<div className={`w-full flex items-center justify-center p-3 md:p-5 bg-surface-canvas ${outerClassName}`}>
			<section
				className={`relative isolate w-full max-w-[1536px] rounded-[1.5rem] md:rounded-[3rem] overflow-hidden flex flex-col items-center ${animation ? "bg-surface-canvas" : "bg-white"} ${cardClassName}`}
				onPointerMove={(event) => {
					if (!animation) return;
					const bounds = event.currentTarget.getBoundingClientRect();
					animationRef.current?.contentWindow?.postMessage({
						type: "namepass:pointer",
						x: ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
						y: ((event.clientY - bounds.top) / bounds.height) * 2 - 1,
					}, "*");
				}}
			>
				{/* The overhang and pulled-back lower corner prevent a compositor
				    seam where the separately rendered background meets the card clip. */}
				{animation && (
					<iframe
						ref={animationRef}
						src={animation}
						title="Animated liquid spacetime background"
						aria-hidden="true"
						tabIndex={-1}
						sandbox="allow-scripts"
						loading="eager"
						className="hero-animation absolute -inset-1 max-w-none w-[calc(100%_+_0.5rem)] h-[calc(100%_+_0.5rem)] rounded-br-[4rem] md:rounded-br-[6rem] z-0"
					/>
				)}
				<div className="relative z-10 w-full h-full flex flex-col items-center">{children}</div>
			</section>
		</div>
	);
}

import { useEffect, useRef, type ReactNode } from "react";

interface Props {
	children: ReactNode;
	video?: string;
	/** Extra classes for the outer full-bleed gutter (e.g. a fixed hero height). */
	outerClassName?: string;
	/** Extra classes for the inner rounded card (e.g. min-height). */
	cardClassName?: string;
}

/**
 * The rounded, margined card every page sits inside — Navbar included, so
 * the header always reads as the top of the current page's content rather
 * than a separate strip bolted above it. Home passes a video for the hero
 * background; other pages get a plain white card.
 */
export default function PageShell({ children, video, outerClassName = "", cardClassName = "" }: Props) {
	const videoRef = useRef<HTMLVideoElement>(null);
	useEffect(() => {
		const element = videoRef.current;
		if (!element) return;
		let visible = false;
		const update = () => {
			if (visible && !document.hidden) void element.play().catch(() => {});
			else element.pause();
		};
		const observer = new IntersectionObserver(([entry]) => {
			visible = entry.isIntersecting;
			update();
		});
		observer.observe(element);
		document.addEventListener("visibilitychange", update);
		return () => {
			observer.disconnect();
			document.removeEventListener("visibilitychange", update);
			element.pause();
		};
	}, [video]);
	return (
		<div className={`w-full flex items-center justify-center p-3 md:p-5 bg-surface-canvas ${outerClassName}`}>
			<section
				className={`relative w-full max-w-[1536px] rounded-[1.5rem] md:rounded-[3rem] overflow-hidden flex flex-col items-center ${video ? "" : "bg-white"} ${cardClassName}`}
			>
				{/* Deliberately size rather than use `scale`: a transform makes
				    the video a compositing layer whose rounded clip is computed
				    then scaled, so its corner arc no longer lands on the painted
				    content's, and the difference shows as a hairline.

				    `rounded-br-*` pulls the video back from the card's
				    bottom-right corner, and it is load-bearing. The card's
				    rounded clip is applied twice there, once to the video (a
				    compositor layer of its own) and once to the Explorer panel
				    painted above it. At a pixel with coverage a, the result is
				    `P + (V - P)(a - a^2)`, and `a - a^2` peaks at 0.25 — so a
				    quarter of the video bleeds through however opaque the panel
				    is. Only curves have fractional coverage, which is why the
				    seam was a single arc at that corner and nowhere else, and
				    only the bottom of this video is dark enough to show it.
				    More coverage cannot fix that; removing the video from
				    behind the curve can.

				    **These radii are not free to shrink, and "bigger than the
				    card's radius" is not the test.** `-inset-1` puts the video's
				    corner 4px outside the card's, so its arc centre sits 4px
				    diagonally out from the card's — the two arcs are not
				    concentric and not similar figures. Clearance is therefore
				    tightest at the *ends* of the card's arc (0deg and 90deg),
				    not the 45deg midpoint that the eye checks. With card radius
				    r and overhang 4, the pull-back must satisfy
				    `(R-4)^2 + (R-r-4)^2 > R^2`: r=24 needs R > 46.97 and r=48
				    needs R > 76.40. The old 2.5rem/5rem pair cleared the
				    midpoint but left the base breakpoint 2.05px short at the
				    ends, which is why the seam survived at narrow widths and
				    vanished at md — where 5rem happened to clear, by 0.99px.
				    4rem/6rem clear by ~6px at every angle. Both still land well
				    inside the panel (37.7px and 64.6px of reach against a panel
				    72px and 112px tall), so nothing changes visually. */}
				{video && (
					<video
						ref={videoRef}
						muted
						loop
						playsInline
						src={video}
						className="absolute -inset-1 max-w-none w-[calc(100%_+_0.5rem)] h-[calc(100%_+_0.5rem)] object-cover object-[65%] lg:object-center rounded-br-[4rem] md:rounded-br-[6rem] z-0"
					/>
				)}
				<div className="relative z-10 w-full h-full flex flex-col items-center">{children}</div>
			</section>
		</div>
	);
}

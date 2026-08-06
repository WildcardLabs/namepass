import type { ReactNode } from "react";

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
	return (
		<div className={`w-full flex items-center justify-center p-3 md:p-5 bg-[#f0f0f0] ${outerClassName}`}>
			<section
				className={`relative w-full max-w-[1536px] rounded-[1.5rem] md:rounded-[3rem] overflow-hidden flex flex-col items-center ${video ? "" : "bg-white"} ${cardClassName}`}
			>
				{/* `-inset-1` below is a crop, not spacing.
				    `cinematic2.mp4` has a black 1px column baked into its right
				    edge and a half-dark one beside it, which show as a hard line
				    whenever this card is proportionally wider than the video's
				    16:9 (any laptop-height viewport at full width). Growing the
				    box 4px on every side pushes them outside the clip.

				    Deliberately sizing rather than `scale`: a transform makes
				    the video a compositing layer whose rounded clip is computed
				    then scaled, so its corner arc no longer lands on the painted
				    content's, and the difference shows as a hairline.
				    Drop this if the asset is ever re-encoded clean.

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
				    behind the curve can. The radius here is larger than the
				    card's, so the pull-back sits entirely under the opaque
				    panel and nothing changes visually. */}
				{video && (
					<video
						autoPlay
						muted
						loop
						playsInline
						src={video}
						className="absolute -inset-1 max-w-none w-[calc(100%_+_0.5rem)] h-[calc(100%_+_0.5rem)] object-cover object-[65%] lg:object-center rounded-br-[2.5rem] md:rounded-br-[5rem] z-0"
					/>
				)}
				<div className="relative z-10 w-full h-full flex flex-col items-center">{children}</div>
			</section>
		</div>
	);
}

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
				{video && (
					<video
						autoPlay
						muted
						loop
						playsInline
						src={video}
						className="absolute inset-0 w-full h-full object-cover object-[65%] lg:object-center z-0"
					/>
				)}
				<div className="relative z-10 w-full h-full flex flex-col items-center">{children}</div>
			</section>
		</div>
	);
}

import { motion } from "motion/react";
import type { ElementType } from "react";

interface Props {
	children: string;
	className?: string;
	segmentClassName?: string;
	as?: ElementType;
	by?: "word" | "character";
	delay?: number;
	duration?: number;
	onComplete?: () => void;
}

/** Small local version of Magic UI's TextAnimate, using the project's Motion install. */
export function TextAnimate({
	children,
	className,
	segmentClassName,
	as: Tag = "span",
	by = "word",
	delay = 0,
	duration = 0.5,
	onComplete,
}: Props) {
	const segments = children.split(/(\s+)/);
	const stagger = by === "character" ? 0.055 : 0.12;
	const lastCharacter = Array.from(children).filter((character) => !/\s/.test(character)).length - 1;
	let characterIndex = 0;
	return (
		<Tag className={className}>
			{segments.map((segment, index) =>
				/^\s+$/.test(segment) ? (
					segment
				) : by === "character" ? (
					<span key={`${segment}-${index}`} className="inline-block whitespace-nowrap">
						{Array.from(segment).map((character, position) => {
							const order = characterIndex++;
							return (
								<motion.span
									key={`${character}-${position}`}
									className={`inline-block ${segmentClassName ?? ""}`}
									initial={{ opacity: 0, y: 8 }}
									animate={{ opacity: 1, y: 0 }}
									transition={{ duration, delay: delay + order * stagger, ease: [0.22, 1, 0.36, 1] }}
									onAnimationComplete={order === lastCharacter ? onComplete : undefined}
								>
									{character}
								</motion.span>
							);
						})}
					</span>
				) : (
					<motion.span
						key={`${segment}-${index}`}
						className={`inline-block ${segmentClassName ?? ""}`}
						initial={{ opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ duration, delay: delay + index * stagger, ease: [0.22, 1, 0.36, 1] }}
						onAnimationComplete={index === segments.length - 1 ? onComplete : undefined}
					>
						{segment}
					</motion.span>
				)
			)}
		</Tag>
	);
}

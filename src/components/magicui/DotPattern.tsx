import { useId } from "react";

interface Props {
	className?: string;
	spacing?: number;
	radius?: number;
}

/**
 * A faint tiling dot grid for background texture — the "infra/blueprint"
 * touch used sparingly behind section headers. Ported from Magic UI's
 * DotPattern; fill color is inherited via `currentColor` so callers set
 * it with a text-[rgba(...)] utility.
 */
export default function DotPattern({ className = "", spacing = 22, radius = 1.1 }: Props) {
	const id = useId();
	return (
		<svg
			aria-hidden
			className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
			style={{
				maskImage: "radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 85%)",
				WebkitMaskImage:
					"radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 85%)",
			}}
		>
			<defs>
				<pattern id={id} width={spacing} height={spacing} patternUnits="userSpaceOnUse">
					<circle cx={radius} cy={radius} r={radius} fill="currentColor" />
				</pattern>
			</defs>
			<rect width="100%" height="100%" fill={`url(#${id})`} />
		</svg>
	);
}

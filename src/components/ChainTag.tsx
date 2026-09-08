import { chainByName } from "../lib/chains";

/** A chain name with its brand-coloured live dot. */
export default function ChainTag({ chain }: { chain: string }) {
	const entry = chainByName(chain);
	const color = entry?.tagColor ?? "#8899aa";
	return (
		<span className="inline-flex items-baseline gap-1.5 text-[rgba(18,36,26,0.7)] whitespace-nowrap">
			<span className="relative flex w-1.5 h-1.5 shrink-0 self-center">
				<span
					className="absolute inline-flex w-full h-full rounded-full opacity-70 animate-ping"
					style={{
						background: color,
						animationDelay: `${entry?.tagPingDelayMs ?? 0}ms`,
						animationDuration: "2.4s",
					}}
				/>
				<span
					className="relative inline-flex w-1.5 h-1.5 rounded-full"
					style={{ background: color }}
				/>
			</span>
			{chain}
		</span>
	);
}

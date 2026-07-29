const CHAIN_DOT: Record<string, string> = {
	Base: "#0052FF",
	Arbitrum: "#12AAFF",
	Ethereum: "#627EEA",
	Polygon: "#8247E5",
};

/* Staggered so the row reads as several independent live signals rather than
   one synchronised blink. */
const PING_DELAY: Record<string, string> = {
	Base: "0ms",
	Arbitrum: "300ms",
	Ethereum: "900ms",
	Polygon: "1200ms",
};

/** A chain name with its brand-coloured live dot. */
export default function ChainTag({ chain }: { chain: string }) {
	const color = CHAIN_DOT[chain] ?? "#8899aa";
	return (
		<span className="inline-flex items-baseline gap-1.5 text-[rgba(30,50,90,0.7)] whitespace-nowrap">
			<span className="relative flex w-1.5 h-1.5 shrink-0 self-center">
				<span
					className="absolute inline-flex w-full h-full rounded-full opacity-70 animate-ping"
					style={{
						background: color,
						animationDelay: PING_DELAY[chain] ?? "0ms",
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

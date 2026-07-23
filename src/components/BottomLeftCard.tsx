import { motion, AnimatePresence } from "motion/react";
import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { solve, YEAR_SECONDS } from "../lib/pricing";

/* Inbound payments, cycled to show money resolving into renewal time.
   `label` is the display string; `amount` is the exact USDC charged (6dp). */
const INBOUND = [
	{ chain: "Base", label: "$8", amount: 8_000010n },
	{ chain: "Arbitrum", label: "$27", amount: 27_000032n },
	{ chain: "Optimism", label: "$14", amount: 14_000017n },
];

const START_EXPIRY = Date.UTC(2029, 2, 18);
const CYCLE_MS = 3600;

function formatExpiry(ms: number) {
	return new Date(ms).toLocaleDateString("en-GB", {
		month: "short",
		year: "numeric",
	});
}

export default function BottomLeftCard() {
	const [index, setIndex] = useState(0);
	const [expiry, setExpiry] = useState(() => {
		const { seconds } = solve(INBOUND[0].amount);
		return START_EXPIRY + Number(seconds) * 1000;
	});

	useEffect(() => {
		const id = setInterval(() => {
			setIndex((i) => {
				const next = (i + 1) % INBOUND.length;
				const { seconds } = solve(INBOUND[next].amount);
				/* Restart the run on wrap so the date never drifts out of plausibility. */
				setExpiry((prev) =>
					(next === 0 ? START_EXPIRY : prev) + Number(seconds) * 1000,
				);
				return next;
			});
		}, CYCLE_MS);
		return () => clearInterval(id);
	}, []);

	const current = INBOUND[index];
	const { seconds } = solve(current.amount);
	const years = Number(seconds) / Number(YEAR_SECONDS);

	return (
		<motion.div
			initial={{ x: -20, opacity: 0 }}
			animate={{ x: 0, opacity: 1 }}
			transition={{ duration: 0.8, delay: 0.2 }}
			className="absolute bottom-28 right-4 left-auto md:left-6 md:right-auto md:bottom-6 lg:bottom-10 lg:left-10 p-3 md:p-4 lg:p-5 rounded-[1.2rem] md:rounded-[1.5rem] lg:rounded-[2.2rem] bg-white/30 backdrop-blur-xl flex flex-col gap-2 lg:gap-3 min-w-[140px] md:min-w-[150px] lg:min-w-[180px] w-fit"
		>
			<div className="flex flex-col">
				<AnimatePresence mode="wait">
					<motion.span
						key={expiry}
						initial={{ opacity: 0, y: 6 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -6 }}
						transition={{ duration: 0.35, ease: "easeOut" }}
						className="text-2xl md:text-3xl font-normal text-[rgba(30,50,90,0.9)] tracking-tight"
					>
						{formatExpiry(expiry)}
					</motion.span>
				</AnimatePresence>
				<span className="text-[10px] md:text-[12px] font-normal text-[rgba(30,50,90,0.6)] uppercase tracking-wider">
					Renewed Until
				</span>
			</div>

			<AnimatePresence mode="wait">
				<motion.div
					key={current.chain}
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					transition={{ duration: 0.3 }}
					className="flex items-baseline gap-1.5 text-[rgba(30,50,90,0.75)]"
				>
					<span className="text-[13px] md:text-[14px] font-normal">
						+{current.label}
					</span>
					<span className="text-[10px] md:text-[11px] font-normal text-[rgba(30,50,90,0.5)]">
						{current.chain}
					</span>
					<span className="text-[13px] md:text-[14px] font-normal ml-auto">
						+{years.toFixed(1)}y
					</span>
				</motion.div>
			</AnimatePresence>

			<motion.button
				whileHover={{ scale: 1.02 }}
				whileTap={{ scale: 0.98 }}
				className="flex items-center bg-white rounded-full pl-1.5 pr-5 py-1.5 gap-2 hover:bg-white/90 transition-colors self-start group"
			>
				<div className="bg-[rgba(30,50,90,0.1)] p-1 rounded-full flex items-center justify-center">
					<ArrowUpRight className="w-4 h-4 text-[rgba(30,50,90,0.9)]" />
				</div>
				<span className="text-[14px] font-normal text-[rgba(30,50,90,0.9)]">
					Claim address
				</span>
			</motion.button>
		</motion.div>
	);
}

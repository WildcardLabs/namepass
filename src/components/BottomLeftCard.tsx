import { motion, AnimatePresence } from "motion/react";
import { memo, useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { solve, YEAR_SECONDS } from "../lib/pricing";
import { fmtMonthYear } from "../lib/format";
import { chainByKey } from "../lib/chains";

/* Inbound payments, cycled to show money resolving into renewal time.
   `label` is the display string; `amount` is the exact USDC charged (6dp). */
const INBOUND = [
	{ chain: chainByKey("base").name, label: "$8", amount: 8_000010n },
	{ chain: chainByKey("arbitrum").name, label: "$27", amount: 27_000032n },
	{ chain: chainByKey("arc").name, label: "$14", amount: 14_000017n },
];

const START_EXPIRY = Date.UTC(2029, 2, 18);
const CYCLE_MS = 3600;

/* The Leaderboard action remains separate from the illustrative ticker values. */
const LeaderboardButton = memo(function LeaderboardButton({
	onLeaderboard,
}: {
	onLeaderboard: () => void;
}) {
	return (
		<motion.button
			whileHover={{ scale: 1.02 }}
			whileTap={{ scale: 0.98 }}
			onClick={onLeaderboard}
			className="home-leaderboard-button transition-colors self-start w-fit"
		>
			<div className="bg-[rgba(28,58,41,0.1)] p-1 rounded-md flex items-center justify-center">
				<Trophy className="w-4 h-4 text-ink-action" />
			</div>
			<span className="text-[14px] font-normal text-ink-action">
				Leaderboard
			</span>
		</motion.button>
	);
});

export default function BottomLeftCard({ onLeaderboard }: { onLeaderboard: () => void }) {
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
			className="home-example"
		>
			<span className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-label">
				Illustrative example
			</span>
			<div className="flex flex-col">
				<AnimatePresence mode="wait">
					<motion.span
						key={expiry}
						initial={{ opacity: 0, y: 6 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -6 }}
						transition={{ duration: 0.35, ease: "easeOut" }}
						className="home-example-date"
					>
						{fmtMonthYear(expiry)}
					</motion.span>
				</AnimatePresence>
				<span className="text-[10px] md:text-[12px] font-normal text-ink-secondary uppercase tracking-wider">
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
					className="flex items-baseline gap-1.5 text-ink-primary"
				>
					<span className="text-[13px] md:text-[14px] font-normal">
						+{current.label}
					</span>
					<span className="text-[10px] md:text-[11px] font-normal text-ink-secondary">
						{current.chain}
					</span>
					<span className="text-[13px] md:text-[14px] font-normal ml-auto">
						+{years.toFixed(1)}y
					</span>
				</motion.div>
			</AnimatePresence>

			<LeaderboardButton onLeaderboard={onLeaderboard} />
		</motion.div>
	);
}

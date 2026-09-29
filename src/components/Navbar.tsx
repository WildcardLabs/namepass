import { motion } from "motion/react";
import { ArrowUpRight } from "lucide-react";

interface Props {
	onProtocol: () => void;
	onSimulate: () => void;
	onSearch: () => void;
	onHome: () => void;
	onDocs?: () => void;
	showMenu?: boolean;
}

/**
 * Header in the original RIVR-template design this project was built on: brand
 * mark left, plain centred text links, one action right. The button is squared
 * (10px), not a pill, and has no circled-arrow chrome.
 */
export default function Navbar({
	onProtocol,
	onSimulate,
	onSearch,
	onHome,
	onDocs,
	showMenu = true,
}: Props) {
	const items = [
		{ label: "Protocol", action: onProtocol },
		{ label: "Rates", action: onSimulate },
		...(onDocs ? [{label:"Docs",action:onDocs}] : []),
	];

	return (
		<nav className="flex items-center justify-between flex-wrap gap-y-5 py-6 px-6 md:px-10 w-full relative z-10">
			<a
				href={import.meta.env.BASE_URL}
				aria-label="Namepass home"
				onClick={(e) => {
					e.preventDefault();
					onHome();
				}}
				className="flex-1 flex items-center gap-2.5 min-w-0"
			>
				<img
					src={`${import.meta.env.BASE_URL}namepass-logo.png`}
					alt="Namepass"
					className="h-4 md:h-[18px] w-auto shrink-0"
				/>
			</a>

			{showMenu && (
				<ul className="hidden md:flex items-center gap-8 text-ink-primary font-medium text-[15px]">
					{items.map((item) => (
						<li key={item.label}>
							<button
								onClick={item.action}
								className="cursor-pointer hover:text-ink-primary transition-colors"
							>
								{item.label}
							</button>
						</li>
					))}
				</ul>
			)}

			<div className="flex-1 flex justify-end">
				<motion.button
					whileHover={{ scale: 1.02 }}
					whileTap={{ scale: 0.98 }}
					onClick={onSearch}
					className="flex items-center gap-2 primary-action rounded-[10px] px-4 md:px-5 py-2 md:py-2.5 transition-colors"
				>
					<span className="text-[14px] font-normal">Get Started</span>
					<ArrowUpRight className="w-4 h-4 md:w-[18px] md:h-[18px]" />
				</motion.button>
			</div>
		</nav>
	);
}

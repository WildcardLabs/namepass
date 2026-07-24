import { motion } from "motion/react";
import { ArrowUpRight, Activity, Search, Calculator } from "lucide-react";

interface Props {
	onClaim: () => void;
	onExplore: () => void;
	onSimulate: () => void;
	onSearch: () => void;
}

export default function Navbar({ onClaim, onExplore, onSimulate, onSearch }: Props) {
	const items = [
		{ label: "Explorer", action: onExplore, Icon: Activity },
		{ label: "Search", action: onSearch, Icon: Search },
		{ label: "Cost simulator", action: onSimulate, Icon: Calculator },
	];

	return (
		<nav className="flex items-center justify-between py-6 px-6 md:px-10 w-full relative z-10">
			<a
				href="#"
				aria-label="Namepass — home"
				className="flex-1 flex items-center gap-2.5 min-w-0"
			>
				<img
					src={`${import.meta.env.BASE_URL}logo.svg`}
					alt=""
					className="h-7 md:h-8 w-auto shrink-0"
				/>
				<span className="hidden lg:block text-[21px] tracking-tight text-[rgba(30,50,90,0.9)]">
					namepass
				</span>
			</a>

			<ul className="hidden md:flex items-center gap-8 text-[rgb(45,45,45)] font-normal text-sm">
				{items.map((item) => (
					<li
						key={item.label}
						onClick={item.action}
						className="cursor-pointer hover:opacity-70 transition-opacity flex items-center gap-2"
					>
						<item.Icon className="w-4 h-4 opacity-60" />
						{item.label}
					</li>
				))}
			</ul>

			<div className="flex-1 flex justify-end">
				<motion.button
					whileHover={{ scale: 1.02 }}
					whileTap={{ scale: 0.98 }}
					onClick={onClaim}
					className="flex items-center bg-[rgba(30,50,90,0.8)] text-white rounded-full pl-2 pr-4 md:pr-6 py-1.5 md:py-2 gap-2 md:gap-3 hover:bg-[rgba(30,50,90,1)] transition-colors group"
				>
					<div className="bg-white/20 p-1 md:p-1.5 rounded-full flex items-center justify-center">
						<ArrowUpRight className="w-4 h-4 md:w-5 md:h-5 text-white" />
					</div>
					<span className="text-xs md:text-sm font-normal">Claim address</span>
				</motion.button>
			</div>
		</nav>
	);
}

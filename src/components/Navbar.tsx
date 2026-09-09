import { motion } from "motion/react";
import { ArrowUpRight } from "lucide-react";

interface Props {
	onClaim: () => void;
	onExplore: () => void;
	onSimulate: () => void;
	onSearch: () => void;
	onHome: () => void;
	showMenu?: boolean;
}

/**
 * Header in the original RIVR-template design this project was built on: brand
 * mark left, plain centred text links, one action right. Links use the muted
 * blue-grey (#5E6470) the template reads over the video with, rather than the
 * body navy. The button is squared (10px), not a pill, and has no circled-arrow
 * chrome.
 */
export default function Navbar({
	onClaim,
	onExplore,
	onSimulate,
	onSearch,
	onHome,
	showMenu = true,
}: Props) {
	const items = [
		{ label: "Explorer", action: onExplore },
		{ label: "Find a name", action: onSearch },
		{ label: "ENS v2 pricing", action: onSimulate },
	];

	return (
		<nav className="flex items-center justify-between py-6 px-6 md:px-10 w-full relative z-10">
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
				<ul className="hidden md:flex items-center gap-8 text-[#5E6470] font-medium text-[15px]">
					{items.map((item) => (
						<li key={item.label}>
							<button
								onClick={item.action}
								className="cursor-pointer hover:text-[#3a3f4a] transition-colors"
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
					onClick={onClaim}
					className="flex items-center gap-2 bg-[rgba(28,58,41,0.9)] text-white rounded-[10px] px-4 md:px-5 py-2 md:py-2.5 hover:bg-[rgba(28,58,41,1)] transition-colors"
				>
					<span className="text-[14px] font-normal">Find a Namepass</span>
					<ArrowUpRight className="w-4 h-4 md:w-[18px] md:h-[18px]" />
				</motion.button>
			</div>
		</nav>
	);
}

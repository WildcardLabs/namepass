import { motion, AnimatePresence } from "motion/react";
import { useEffect, useState } from "react";
import { X, ArrowUpRight, Loader2 } from "lucide-react";
import { LABEL_PROBLEM_TEXT, labelProblem } from "../lib/namepass";
import { activateName } from "../lib/publicApi";


interface Props {
	open: boolean;
	onClose: () => void;
	/** Fired once the Namepass exists — the page scrolls to its Explorer entry. */
	onActivated: (name: string) => void;
}

type Phase = "input" | "activating";

export default function ClaimModal({ open, onClose, onActivated }: Props) {
	const [value, setValue] = useState("");
	const [phase, setPhase] = useState<Phase>("input");
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (open) return;
		const t = setTimeout(() => {
			setValue("");
			setPhase("input");
			setError(null);
		}, 300);
		return () => clearTimeout(t);
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, onClose]);

	/* Validated by the same function that derives the address, rather than by a
	   regex that approximates it. ENSIP-15 admits far more than `[a-z0-9-]` —
	   emoji names are real names — and rejects a few things that pass a regex,
	   and either mismatch ends with someone looking at an address for a name
	   that can't exist. */
	const trimmed = value.trim().replace(/\.eth$/i, "");
	const problem = labelProblem(trimmed);
	const valid = problem === null;

	async function activate() {
		if (!valid || phase !== "input") return;
		setPhase("activating");
		setError(null);
		try {
			const created = await activateName(trimmed);
			onActivated(created.name.displayName);
			onClose();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Activation failed. Try again.");
			setPhase("input");
		}
	}

	return (
		<AnimatePresence>
			{open && (
				<motion.div
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					transition={{ duration: 0.25 }}
					className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-4 py-8 sm:py-12"
				>
					<div
						className="absolute inset-0 bg-[rgba(20,28,45,0.45)] backdrop-blur-sm"
						onClick={onClose}
					/>

					{/* Same translucent glass as the hero's bottom-left card */}
					<motion.div
						initial={{ opacity: 0, y: 24, scale: 0.97 }}
						animate={{ opacity: 1, y: 0, scale: 1 }}
						exit={{ opacity: 0, y: 12, scale: 0.98 }}
						transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
						className="relative w-full max-w-[440px] my-auto bg-white rounded-[1.5rem] md:rounded-[2rem] p-6 md:p-8 shadow-[0_24px_80px_-24px_rgba(30,50,90,0.35)]"
					>
						<button
							onClick={onClose}
							aria-label="Close"
							className="absolute top-5 right-5 w-8 h-8 rounded-full flex items-center justify-center text-[rgba(30,50,90,0.5)] hover:bg-[rgba(30,50,90,0.06)] hover:text-[rgba(30,50,90,0.9)] transition-colors"
						>
							<X className="w-4 h-4" />
						</button>

								<h2 className="text-[24px] md:text-[28px] font-normal text-[rgba(30,50,90,0.95)] tracking-tight leading-tight">
									Claim your address
								</h2>
								<p className="mt-2 text-[14px] text-[rgba(30,50,90,0.65)] leading-relaxed">
									Activate your Namepass. Every USDC payment
									received on any supported chain extends your ENS name.
								</p>

								<div className="mt-6">
									<label htmlFor="claim-name" className="text-[11px] uppercase tracking-wider text-[rgba(30,50,90,0.55)]">
										ENS Name
									</label>
									<div className="mt-2 flex items-center bg-[rgba(30,50,90,0.04)] border border-[rgba(30,50,90,0.1)] rounded-full pl-5 pr-2 py-2 focus-within:border-[rgba(30,50,90,0.35)] transition-colors">
										<input
											id="claim-name"
											autoFocus
											value={value}
											disabled={phase === "activating"}
											onChange={(e) => setValue(e.target.value)}
											onKeyDown={(e) => e.key === "Enter" && activate()}
											placeholder="yourname"
											className="flex-1 min-w-0 bg-transparent outline-none text-[16px] text-[rgba(30,50,90,0.95)] placeholder:text-[rgba(30,50,90,0.4)] disabled:opacity-60"
										/>
										<span className="text-[15px] text-[rgba(30,50,90,0.5)] mr-2">
											.eth
										</span>
									</div>
									{/* Say why the button is dead rather than leaving it dead. */}
									{problem && trimmed && (
										<p className="mt-2 px-1 text-[12.5px] text-[rgba(30,50,90,0.55)] leading-relaxed">
											{LABEL_PROBLEM_TEXT[problem]}
										</p>
									)}
									{error && (
										<p role="alert" className="mt-2 px-1 text-[12.5px] text-red-700 leading-relaxed">
											{error}
										</p>
									)}
								</div>

								<motion.button
									whileHover={valid && phase === "input" ? { scale: 1.02 } : undefined}
									whileTap={valid && phase === "input" ? { scale: 0.98 } : undefined}
									onClick={activate}
									disabled={!valid || phase === "activating"}
									className="mt-6 w-full flex items-center justify-center bg-[rgba(30,50,90,0.9)] text-white rounded-full py-3 gap-2.5 hover:bg-[rgba(30,50,90,1)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
								>
									{phase === "activating" ? (
										<>
											<Loader2 className="w-4 h-4 animate-spin" />
											<span className="text-[14px] font-normal">Activating…</span>
										</>
									) : (
										<>
											<div className="bg-white/20 p-1 rounded-full flex items-center justify-center">
												<ArrowUpRight className="w-4 h-4 text-white" />
											</div>
											<span className="text-[14px] font-normal">
												Activate Namepass
											</span>
										</>
									)}
								</motion.button>

								<p className="mt-4 text-[12px] text-center text-[rgba(30,50,90,0.5)]">
									Free to activate.
								</p>
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}

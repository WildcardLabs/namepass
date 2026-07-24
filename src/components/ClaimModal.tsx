import { motion, AnimatePresence } from "motion/react";
import { useEffect, useState } from "react";
import { X, ArrowUpRight, Check, Loader2 } from "lucide-react";
import { claimName, type NameRecord } from "../lib/registry";

import PassCard from "./PassCard";

interface Props {
	open: boolean;
	onClose: () => void;
	onView?: (name: string) => void;
}

type Phase = "input" | "activating" | "done";

export default function ClaimModal({ open, onClose, onView }: Props) {
	const [value, setValue] = useState("");
	const [phase, setPhase] = useState<Phase>("input");
	const [record, setRecord] = useState<NameRecord | null>(null);

	useEffect(() => {
		if (open) return;
		const t = setTimeout(() => {
			setValue("");
			setPhase("input");
			setRecord(null);
		}, 300);
		return () => clearTimeout(t);
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, onClose]);

	const trimmed = value.trim().replace(/\.eth$/i, "");
	const valid = /^[a-z0-9-]{3,}$/i.test(trimmed);

	function activate() {
		if (!valid || phase !== "input") return;
		setPhase("activating");
		setTimeout(() => {
			setRecord(claimName(trimmed));
			setPhase("done");
		}, 1100);
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
						className="absolute inset-0 bg-[rgba(20,28,45,0.35)]"
						onClick={onClose}
					/>

					{/* Same translucent glass as the hero's bottom-left card */}
					<motion.div
						initial={{ opacity: 0, y: 24, scale: 0.97 }}
						animate={{ opacity: 1, y: 0, scale: 1 }}
						exit={{ opacity: 0, y: 12, scale: 0.98 }}
						transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
						data-wide={phase === "done"}
						className="relative w-full max-w-[440px] data-[wide=true]:max-w-[560px] my-auto bg-white/30 backdrop-blur-xl rounded-[1.5rem] md:rounded-[2.2rem] p-6 md:p-7 shadow-[0_24px_80px_-24px_rgba(20,28,45,0.45)] border border-white/40"
					>
						<button
							onClick={onClose}
							aria-label="Close"
							className="absolute top-5 right-5 w-8 h-8 rounded-full flex items-center justify-center text-[rgba(30,50,90,0.5)] hover:bg-white/40 hover:text-[rgba(30,50,90,0.9)] transition-colors"
						>
							<X className="w-4 h-4" />
						</button>

						{phase !== "done" ? (
							<>
								<h2 className="text-[24px] md:text-[28px] font-normal text-[rgba(30,50,90,0.95)] tracking-tight leading-tight">
									Claim your address
								</h2>
								<p className="mt-2 text-[14px] text-[rgba(30,50,90,0.65)] leading-relaxed">
									Activate a Namepass for your ENS name. You get a permanent
									address that anyone can fund, from any chain — and every payment
									extends your name.
								</p>

								<div className="mt-6">
									<label className="text-[11px] uppercase tracking-wider text-[rgba(30,50,90,0.55)]">
										ENS Name
									</label>
									<div className="mt-2 flex items-center bg-white/50 border border-white/60 rounded-full pl-5 pr-2 py-2 focus-within:border-[rgba(30,50,90,0.3)] transition-colors">
										<input
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
								</div>

								<motion.button
									whileHover={valid && phase === "input" ? { scale: 1.02 } : undefined}
									whileTap={valid && phase === "input" ? { scale: 0.98 } : undefined}
									onClick={activate}
									disabled={!valid || phase === "activating"}
									className="mt-6 w-full flex items-center justify-center bg-white rounded-full py-3 gap-2.5 hover:bg-white/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
								>
									{phase === "activating" ? (
										<>
											<Loader2 className="w-4 h-4 animate-spin text-[rgba(30,50,90,0.9)]" />
											<span className="text-[15px] font-normal text-[rgba(30,50,90,0.9)]">
												Activating…
											</span>
										</>
									) : (
										<>
											<div className="bg-[rgba(30,50,90,0.1)] p-1 rounded-full flex items-center justify-center">
												<ArrowUpRight className="w-4 h-4 text-[rgba(30,50,90,0.9)]" />
											</div>
											<span className="text-[15px] font-normal text-[rgba(30,50,90,0.9)]">
												Activate Namepass
											</span>
										</>
									)}
								</motion.button>

								<p className="mt-4 text-[12px] text-center text-[rgba(30,50,90,0.5)]">
									Free to activate. You only pay when you renew.
								</p>
							</>
						) : (
							record && (
								<motion.div
									initial={{ opacity: 0 }}
									animate={{ opacity: 1 }}
									transition={{ duration: 0.3 }}
								>
									<div className="w-12 h-12 rounded-full bg-white/50 border border-white/60 flex items-center justify-center">
										<Check className="w-5 h-5 text-[rgba(30,50,90,0.85)]" />
									</div>

									<h2 className="mt-4 text-[24px] md:text-[28px] font-normal text-[rgba(30,50,90,0.95)] tracking-tight leading-tight">
										Namepass is live
									</h2>
									<p className="mt-2 text-[14px] text-[rgba(30,50,90,0.65)] leading-relaxed">
										Share this with anyone. It never changes.
									</p>

									<div className="mt-5">
										<PassCard
											name={record.name}
											pass={record.pass}
											address={record.address}
											animate
											surface="glass"
											layout="split"
										/>
									</div>

									<motion.button
										whileHover={{ scale: 1.02 }}
										whileTap={{ scale: 0.98 }}
										onClick={() => {
											onView?.(record.name);
											onClose();
										}}
										className="mt-6 w-full flex items-center justify-center bg-white rounded-full py-3 gap-2.5 hover:bg-white/90 transition-colors"
									>
										<div className="bg-[rgba(30,50,90,0.1)] p-1 rounded-full flex items-center justify-center">
											<ArrowUpRight className="w-4 h-4 text-[rgba(30,50,90,0.9)]" />
										</div>
										<span className="text-[15px] font-normal text-[rgba(30,50,90,0.9)]">
											View in Explorer
										</span>
									</motion.button>
								</motion.div>
							)
						)}
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}

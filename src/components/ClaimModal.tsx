import { motion, AnimatePresence } from "motion/react";
import { useEffect, useState } from "react";
import { X, ArrowUpRight, Check, Copy, Loader2 } from "lucide-react";
import { claimName, type NameRecord } from "../lib/registry";
import { fmtDate, truncAddress } from "../lib/format";

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
	const [copied, setCopied] = useState<"pass" | "address" | null>(null);

	/* Reset a beat after close so the exit animation isn't disturbed. */
	useEffect(() => {
		if (open) return;
		const t = setTimeout(() => {
			setValue("");
			setPhase("input");
			setRecord(null);
			setCopied(null);
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

	function copy(text: string, which: "pass" | "address") {
		const done = () => {
			setCopied(which);
			setTimeout(() => setCopied(null), 1600);
		};
		if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, done);
		else done();
	}

	return (
		<AnimatePresence>
			{open && (
				<motion.div
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					transition={{ duration: 0.25 }}
					className="fixed inset-0 z-50 flex items-center justify-center p-4"
				>
					<div
						className="absolute inset-0 bg-[rgba(20,28,45,0.45)] backdrop-blur-sm"
						onClick={onClose}
					/>

					<motion.div
						initial={{ opacity: 0, y: 24, scale: 0.97 }}
						animate={{ opacity: 1, y: 0, scale: 1 }}
						exit={{ opacity: 0, y: 12, scale: 0.98 }}
						transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
						className="relative w-full max-w-[440px] bg-white rounded-[1.5rem] md:rounded-[2rem] p-6 md:p-8 shadow-[0_24px_80px_-24px_rgba(30,50,90,0.35)]"
					>
						<button
							onClick={onClose}
							aria-label="Close"
							className="absolute top-5 right-5 w-8 h-8 rounded-full flex items-center justify-center text-[rgba(30,50,90,0.5)] hover:bg-[rgba(30,50,90,0.06)] hover:text-[rgba(30,50,90,0.9)] transition-colors"
						>
							<X className="w-4 h-4" />
						</button>

						{phase !== "done" ? (
							<>
								<h2 className="text-[24px] md:text-[28px] font-normal text-[rgba(30,50,90,0.95)] tracking-tight leading-tight">
									Claim your address
								</h2>
								<p className="mt-2 text-[14px] text-[rgba(30,50,90,0.6)] leading-relaxed">
									Activate a Namepass for your ENS name. You'll get a permanent
									subdomain and deposit address that anyone can fund, from any
									chain.
								</p>

								<div className="mt-6">
									<label className="text-[11px] uppercase tracking-wider text-[rgba(30,50,90,0.5)]">
										ENS Name
									</label>
									<div className="mt-2 flex items-center bg-[rgba(30,50,90,0.04)] border border-[rgba(30,50,90,0.1)] rounded-full pl-5 pr-2 py-2 focus-within:border-[rgba(30,50,90,0.35)] transition-colors">
										<input
											autoFocus
											value={value}
											disabled={phase === "activating"}
											onChange={(e) => setValue(e.target.value)}
											onKeyDown={(e) => e.key === "Enter" && activate()}
											placeholder="yourname"
											className="flex-1 min-w-0 bg-transparent outline-none text-[16px] text-[rgba(30,50,90,0.95)] placeholder:text-[rgba(30,50,90,0.35)] disabled:opacity-60"
										/>
										<span className="text-[15px] text-[rgba(30,50,90,0.45)] mr-2">
											.eth
										</span>
									</div>
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
											<span className="text-[15px] font-normal">
												Activating…
											</span>
										</>
									) : (
										<>
											<div className="bg-white/20 p-1 rounded-full flex items-center justify-center">
												<ArrowUpRight className="w-4 h-4 text-white" />
											</div>
											<span className="text-[15px] font-normal">
												Activate Namepass
											</span>
										</>
									)}
								</motion.button>

								<p className="mt-4 text-[12px] text-center text-[rgba(30,50,90,0.45)]">
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
									<div className="w-12 h-12 rounded-full bg-[rgba(30,50,90,0.06)] border border-[rgba(30,50,90,0.1)] flex items-center justify-center">
										<Check className="w-5 h-5 text-[rgba(30,50,90,0.85)]" />
									</div>

									<h2 className="mt-4 text-[24px] md:text-[28px] font-normal text-[rgba(30,50,90,0.95)] tracking-tight leading-tight">
										{record.name} is live
									</h2>
									<p className="mt-2 text-[14px] text-[rgba(30,50,90,0.6)] leading-relaxed">
										Anyone can now send stablecoins to either of these. Every
										payment becomes renewal time at the best available rate.
									</p>

									<div className="mt-6 space-y-2.5">
										<button
											onClick={() => copy(record.pass, "pass")}
											className="w-full text-left bg-[rgba(30,50,90,0.04)] border border-[rgba(30,50,90,0.1)] rounded-2xl px-4 py-3 hover:border-[rgba(30,50,90,0.25)] transition-colors group"
										>
											<div className="text-[10px] uppercase tracking-wider text-[rgba(30,50,90,0.45)]">
												Namepass subdomain
											</div>
											<div className="mt-1 flex items-center justify-between gap-3">
												<span className="text-[15px] text-[rgba(30,50,90,0.95)] truncate">
													{record.pass}
												</span>
												{copied === "pass" ? (
													<Check className="w-4 h-4 shrink-0 text-[rgba(30,50,90,0.8)]" />
												) : (
													<Copy className="w-4 h-4 shrink-0 text-[rgba(30,50,90,0.35)] group-hover:text-[rgba(30,50,90,0.7)] transition-colors" />
												)}
											</div>
										</button>

										<button
											onClick={() => copy(record.address, "address")}
											className="w-full text-left bg-[rgba(30,50,90,0.04)] border border-[rgba(30,50,90,0.1)] rounded-2xl px-4 py-3 hover:border-[rgba(30,50,90,0.25)] transition-colors group"
										>
											<div className="text-[10px] uppercase tracking-wider text-[rgba(30,50,90,0.45)]">
												Deposit address
											</div>
											<div className="mt-1 flex items-center justify-between gap-3">
												<span className="text-[15px] text-[rgba(30,50,90,0.95)]">
													{truncAddress(record.address)}
												</span>
												{copied === "address" ? (
													<Check className="w-4 h-4 shrink-0 text-[rgba(30,50,90,0.8)]" />
												) : (
													<Copy className="w-4 h-4 shrink-0 text-[rgba(30,50,90,0.35)] group-hover:text-[rgba(30,50,90,0.7)] transition-colors" />
												)}
											</div>
										</button>
									</div>

									<div className="mt-4 flex items-center justify-between text-[13px] text-[rgba(30,50,90,0.6)] px-1">
										<span>Currently expires</span>
										<span className="text-[rgba(30,50,90,0.9)]">
											{fmtDate(record.baseExpiry)}
										</span>
									</div>

									<motion.button
										whileHover={{ scale: 1.02 }}
										whileTap={{ scale: 0.98 }}
										onClick={() => {
											onView?.(record.name);
											onClose();
										}}
										className="mt-6 w-full flex items-center justify-center bg-[rgba(30,50,90,0.9)] text-white rounded-full py-3 gap-2.5 hover:bg-[rgba(30,50,90,1)] transition-colors"
									>
										<div className="bg-white/20 p-1 rounded-full flex items-center justify-center">
											<ArrowUpRight className="w-4 h-4 text-white" />
										</div>
										<span className="text-[15px] font-normal">
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

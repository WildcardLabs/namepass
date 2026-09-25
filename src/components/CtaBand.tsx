import { useEffect, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowUpRight } from "lucide-react";

interface Props {
	onSearch: () => void;
	onSimulate: () => void;
}

type VantaEffect = { destroy: () => void };

declare global {
	interface Window {
		VANTA?: { TOPOLOGY: (opts: Record<string, unknown>) => VantaEffect };
	}
}

/* TOPOLOGY is a p5.js effect, so p5 must be on `window` before the Vanta script
   runs. Both are loaded once from CDN and reused across mounts. */
const P5_SRC = "https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.1.9/p5.min.js";
const VANTA_SRC =
	"https://cdn.jsdelivr.net/npm/vanta@latest/dist/vanta.topology.min.js";

function loadScript(src: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const existing = document.querySelector<HTMLScriptElement>(
			`script[data-vanta="${src}"]`,
		);
		if (existing) {
			if (existing.dataset.loaded === "true") resolve();
			else {
				existing.addEventListener("load", () => resolve());
				existing.addEventListener("error", () => reject(new Error(src)));
			}
			return;
		}
		const s = document.createElement("script");
		s.src = src;
		s.async = true;
		s.dataset.vanta = src;
		s.addEventListener("load", () => {
			s.dataset.loaded = "true";
			resolve();
		});
		s.addEventListener("error", () => reject(new Error(src)));
		document.head.appendChild(s);
	});
}

/**
 * Near-footer CTA band. The background is Vanta.js TOPOLOGY — an animated point
 * mesh in the brand green — with the copy left and two actions right. If the CDN
 * scripts do not load, the solid dark-green panel behind them stands in.
 */
export default function CtaBand({ onSearch, onSimulate }: Props) {
	const bandRef = useRef<HTMLDivElement>(null);
	const reduced = useReducedMotion();

	useEffect(() => {
		let effect: VantaEffect | undefined;
		let cancelled = false;
		let visible = false;
		let loading = false;
		const element = bandRef.current;
		if (!element || reduced) return;
		const update = async () => {
			if (!visible || document.hidden) {
				effect?.destroy();
				effect = undefined;
				return;
			}
			if (effect || loading || cancelled) return;
			loading = true;
			try {
				await loadScript(P5_SRC);
				await loadScript(VANTA_SRC);
				if (cancelled || !visible || document.hidden || !window.VANTA) return;
				effect = window.VANTA.TOPOLOGY({
					el: bandRef.current,
					mouseControls: true,
					touchControls: true,
					gyroControls: false,
					minHeight: 200.0,
					minWidth: 200.0,
					scale: 1.0,
					scaleMobile: 1.0,
					color: 0x1c3a29,
					backgroundColor: 0x0e1c14,
				});
			} catch {
				/* CDN blocked or offline — the solid dark panel remains. */
			} finally {
				loading = false;
			}
		};
		const observer = new IntersectionObserver(([entry]) => {
			visible = entry.isIntersecting;
			void update();
		});
		observer.observe(element);
		document.addEventListener("visibilitychange", update);
		return () => {
			cancelled = true;
			observer.disconnect();
			document.removeEventListener("visibilitychange", update);
			effect?.destroy();
		};
	}, [reduced]);

	return (
		<section className="px-5 md:px-10 pb-14 md:pb-20">
			<div
				ref={bandRef}
				className="relative max-w-[1100px] mx-auto overflow-hidden rounded-[1.25rem] md:rounded-[1.75rem] min-h-[220px] md:min-h-[260px] bg-[#0e1c14]"
			>
				{/* Vanta renders its canvas into the element above; content sits over it. */}
				<div className="relative z-10 h-full min-h-[220px] md:min-h-[260px] flex flex-col md:flex-row md:items-center md:justify-between gap-6 px-7 py-10 md:px-14 md:py-12">
					<motion.div
						initial={{ opacity: 0, y: 16 }}
						whileInView={{ opacity: 1, y: 0 }}
						viewport={{ once: true, margin: "-80px" }}
						transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
						className="max-w-md"
					>
						<h2 className="text-[30px] md:text-[42px] font-normal text-white tracking-tight leading-[1.05]">
							Give a name more time.
						</h2>
						<p className="mt-3 text-[14px] md:text-[15px] text-white/70 leading-relaxed">
							Send USDC to a Namepass address. Namepass executes the renewal using the best qualifying discount tier.
						</p>
					</motion.div>

					<motion.div
						initial={{ opacity: 0, y: 12 }}
						whileInView={{ opacity: 1, y: 0 }}
						viewport={{ once: true, margin: "-80px" }}
						transition={{ duration: 0.7, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
						className="flex flex-wrap items-center gap-3 shrink-0"
					>
						{/* Left: solid white */}
						<button
							onClick={onSearch}
							className="inline-flex items-center gap-2 rounded-[10px] bg-white text-[rgba(28,58,41,0.95)] px-5 py-3 text-[15px] hover:bg-white/90 transition-colors"
						>
							Get Started
							<ArrowUpRight className="w-4 h-4" />
						</button>
						{/* Right: liquid glass */}
						<button
							onClick={onSimulate}
							className="inline-flex items-center rounded-[10px] bg-white/10 backdrop-blur-md text-white px-5 py-3 text-[15px] hover:bg-white/20 transition-colors"
						>
							Explore pricing
						</button>
					</motion.div>
				</div>
			</div>
		</section>
	);
}

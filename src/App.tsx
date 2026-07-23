import { motion } from "motion/react";
import { useEffect, useState } from "react";

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

/* ------------------------------------------------------------------
   Exact ENS v2 StandardRentPriceOracle math (5+ character names).
   Verified against the deployed constructor args — BigInt end to end.
   ------------------------------------------------------------------ */
const DENOM = 100000000000000000000000000000000000000n;
const YEAR_SECONDS = 31557600n;
const RATE_PER_SECOND = 253505n;

const TIERS = [
	{ start: 189345600n, numer: 56250000000000000000000000000000000000n, off: "44% off" },
	{ start: 94672800n, numer: 68750000000000000000000000000000000000n, off: "31% off" },
	{ start: 63115200n, numer: 87500000000000000000000000000000000000n, off: "12% off" },
	{ start: 0n, numer: DENOM, off: "" },
];

const divCeil = (a: bigint, b: bigint) => (a + b - 1n) / b;

function solve(budgetMicro: bigint) {
	for (const tier of TIERS) {
		const minCost = divCeil((RATE_PER_SECOND * tier.start * tier.numer) / DENOM, 1000000n);
		if (budgetMicro >= minCost) {
			const seconds =
				((budgetMicro * 1000000n + 1n) * DENOM - 1n) / (RATE_PER_SECOND * tier.numer);
			return { seconds, off: tier.off };
		}
	}
	return { seconds: 0n, off: "" };
}

/* ------------------------------------------------------------------
   The payments that land on the phone screen, in order.
   ------------------------------------------------------------------ */
/* Exact tier thresholds, derived from the oracle above:
   2y = $14.000017 · 3y = $16.500020 · 6y = $27.000032
   `label` is what the phone screen shows; `amount` is what it charges. */
const PAYMENTS = [
	{ from: "base", label: "+$5", amount: 5_000000n },
	{ from: "arbitrum", label: "+$27", amount: 27_000032n },
	{ from: "an agent", label: "+$14", amount: 14_000017n },
];

const BASE_EXPIRY = Date.UTC(2029, 2, 18);

const TYPING_SPEED_MS = 100;
const DELETING_SPEED_MS = 50;
const PAUSE_BEFORE_DELETE_MS = 2000;

function formatYears(seconds: bigint) {
	const years = Number(seconds) / Number(YEAR_SECONDS);
	return years >= 1 ? `+${years.toFixed(1)}y` : `+${Math.floor(Number(seconds) / 86400)}d`;
}

function formatExpiry(ms: number) {
	return new Date(ms).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

/* ------------------------------------------------------------------
   RenewalScreen — the live element layered over the in-video phone.
   Types out an incoming payment, resolves it into time, and the
   expiry line below it steps forward. Money in. Time out.
   ------------------------------------------------------------------ */
function RenewalScreen() {
	const [paymentIndex, setPaymentIndex] = useState(0);
	const [text, setText] = useState("");
	const [isDeleting, setIsDeleting] = useState(false);
	const [expiry, setExpiry] = useState(BASE_EXPIRY);
	const [gain, setGain] = useState("");

	const payment = PAYMENTS[paymentIndex];
	const line = `${payment.label} ${payment.from}`;

	useEffect(() => {
		let timeout: ReturnType<typeof setTimeout>;

		if (!isDeleting) {
			if (text.length < line.length) {
				timeout = setTimeout(
					() => setText(line.slice(0, text.length + 1)),
					TYPING_SPEED_MS,
				);
			} else {
				/* Payment fully received — convert it to time. */
				timeout = setTimeout(() => {
					const { seconds } = solve(payment.amount);
					setGain(formatYears(seconds));
					setExpiry((prev) => prev + Number(seconds) * 1000);
					setIsDeleting(true);
				}, PAUSE_BEFORE_DELETE_MS);
			}
		} else if (text.length > 0) {
			timeout = setTimeout(
				() => setText(line.slice(0, text.length - 1)),
				DELETING_SPEED_MS,
			);
		} else {
			timeout = setTimeout(() => {
				setGain("");
				setIsDeleting(false);
				setPaymentIndex((i) => (i + 1) % PAYMENTS.length);
			}, 400);
		}

		return () => clearTimeout(timeout);
	}, [text, isDeleting, paymentIndex, line, payment.amount]);

	return (
		<div className="absolute left-[48.5%] md:left-[47.5%] lg:left-[48.5%] -translate-x-1/2 bottom-[32%] z-30 w-[110px] sm:w-[130px] flex flex-col justify-start text-left">
			<p className="font-nokia text-[#2A3616] text-[10px] sm:text-[14px] leading-tight break-words min-h-[1.5em]">
				{text}
				<motion.span
					className="inline-block w-1.5 h-3 bg-[#2A3616] ml-1 align-middle"
					animate={{ opacity: [0, 1, 0] }}
					transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
				/>
			</p>

			<p className="font-nokia text-[#2A3616] text-[9px] sm:text-[12px] leading-tight mt-1 opacity-80">
				alive till {formatExpiry(expiry)}
			</p>

			{gain ? (
				<motion.p
					className="font-nokia text-[#2A3616] text-[10px] sm:text-[13px] leading-tight mt-0.5"
					initial={{ opacity: 0, y: 4 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.4, ease: EASE_OUT_EXPO }}
				>
					{gain}
				</motion.p>
			) : null}
		</div>
	);
}

const NAV_LINKS = ["How it works", "Pricing", "Teams", "Docs"];

function Navbar() {
	return (
		<header className="fixed top-6 left-1/2 -translate-x-1/2 w-[95%] max-w-5xl z-50 pointer-events-none">
			<nav className="pointer-events-auto flex items-center justify-between backdrop-blur-md bg-transparent border border-black/10 rounded-full pl-7 pr-2.5 py-2.5">
				<a
					href="#"
					className="font-instrument text-[28px] tracking-tight text-[#1a1a1a] leading-none"
				>
					namepass
				</a>

				<div className="hidden md:flex items-center gap-10">
					{NAV_LINKS.map((link) => (
						<a
							key={link}
							href={`#${link.toLowerCase().replace(/\s+/g, "-")}`}
							className="font-sans text-[14px] text-[#1a1a1a] transition-opacity duration-200 hover:opacity-50"
						>
							{link}
						</a>
					))}
				</div>

				<a
					href="#get"
					className="group relative overflow-hidden bg-[#0871E7] rounded-full text-white font-sans text-[14px] font-medium px-6 py-2.5 shadow-[inset_0_-4px_4px_rgba(255,255,255,0.39)] outline-1 outline-[#0871E7] -outline-offset-1"
				>
					<span
						aria-hidden="true"
						className="absolute w-[80%] h-4 left-[10%] top-[1px] bg-gradient-to-b from-[#DEF0FC] to-transparent rounded-[12px] transition-transform duration-300 group-hover:scale-x-105"
					/>
					<span className="relative">Get yours</span>
				</a>
			</nav>
		</header>
	);
}

const VIDEO_SRC = `${import.meta.env.BASE_URL}assets/hf_20260427_054418_a6d194f0-ac86-4df9-abe5-ded73e596d7c.mp4`;

function Hero() {
	return (
		<section
			id="get"
			className="relative min-h-screen bg-[#F3F4ED] pt-24 md:pt-32 flex flex-col items-center overflow-hidden"
		>
			<video
				className="absolute inset-0 z-0 w-full h-full object-cover"
				src={VIDEO_SRC}
				autoPlay
				loop
				muted
				playsInline
			/>
			<div className="absolute inset-0 z-10 bg-white/5" aria-hidden="true" />

			<div className="relative z-20 pointer-events-none text-center px-6">
				<motion.div
					initial={{ opacity: 0, scale: 0.95 }}
					animate={{ opacity: 1, scale: 1 }}
					transition={{ duration: 1.5, ease: EASE_OUT_EXPO }}
				>
					<h1 className="font-instrument text-[38px] md:text-[56px] lg:text-[72px] leading-[0.85] tracking-tight text-[#1a1a1a] mb-6">
						Money in. <br /> Time out.
					</h1>
				</motion.div>

				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 1.2, delay: 0.3, ease: EASE_OUT_EXPO }}
				>
					<p className="font-sans text-[16px] md:text-[18px] text-[#1a1a1a]/70 leading-relaxed font-normal max-w-xl mx-auto">
						One permanent address for your name. Anyone sends stablecoins from any
						chain. Your name gains time.
					</p>
				</motion.div>
			</div>

			<RenewalScreen />
		</section>
	);
}

export default function App() {
	return (
		<div className="min-h-screen bg-[#F3F4ED]">
			<Navbar />
			<Hero />
		</div>
	);
}

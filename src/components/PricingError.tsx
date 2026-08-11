import { AlertTriangle, RefreshCw } from "lucide-react";

/**
 * Shown when ENS's oracle can't be read.
 *
 * **Only the failure gets words.** While the read is in flight the app shows
 * skeletons in the shape of the numbers it's waiting on — a page that narrates
 * its own network activity is noise, and the read normally lands in ~150ms.
 * A read that *fails* is different: every price in this app is inverted from
 * those values, there is no cached table to fall back to, and the user needs
 * to know that rather than watch a skeleton pulse forever.
 *
 * Deliberately no "continue anyway". There is nothing to continue with, and a
 * remembered price is how a funder sends an amount that quietly misses a
 * discount tier.
 */
export default function PricingError({
	message,
	onRetry,
}: {
	message: string;
	onRetry: () => void;
}) {
	return (
		<div className="w-full flex items-center justify-center py-10">
			<div className="max-w-[400px] text-center">
				<AlertTriangle className="w-5 h-5 mx-auto text-[rgba(30,50,90,0.5)]" />
				<p className="mt-4 text-[15px] text-[rgba(30,50,90,0.9)]">
					Couldn't reach ENS to check the current rates
				</p>
				<p className="mt-1.5 text-[13px] text-[rgba(30,50,90,0.55)] leading-relaxed">
					{message}
				</p>
				<button
					onClick={onRetry}
					className="mt-5 inline-flex items-center gap-2 bg-[rgba(30,50,90,0.9)] text-white rounded-full px-5 py-2.5 hover:bg-[rgba(30,50,90,1)] transition-colors"
				>
					<RefreshCw className="w-3.5 h-3.5" />
					<span className="text-[14px]">Try again</span>
				</button>
			</div>
		</div>
	);
}

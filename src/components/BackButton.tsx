import { ChevronLeft } from "lucide-react";

export const ICON_BUTTON_BASE_CLASS = "shrink-0 inline-flex h-11 w-11 items-center justify-center rounded-[9px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(28,58,41,0.6)]";
export const QUIET_ICON_BUTTON_CLASS = `${ICON_BUTTON_BASE_CLASS} border text-ink-action hover:border-transparent hover:bg-surface-hover`;

export function BackButton({
	onClick,
	label,
	className = "",
}: {
	onClick: () => void;
	label: string;
	className?: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={label}
			title={label}
			className={`${QUIET_ICON_BUTTON_CLASS} border-[rgba(28,58,41,0.16)] bg-white ${className}`}
		>
			<ChevronLeft aria-hidden="true" className="h-[18px] w-[18px]" />
		</button>
	);
}

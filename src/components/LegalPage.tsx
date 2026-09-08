import { ArrowLeft } from "lucide-react";

interface Section {
	heading: string;
	body: string;
}

interface Props {
	title: string;
	updated: string;
	intro: string;
	sections: Section[];
	onBack: () => void;
}

export default function LegalPage({ title, updated, intro, sections, onBack }: Props) {
	return (
		<div className="w-full px-5 md:px-10 pt-4 pb-20 md:pb-28">
			<div className="max-w-[720px] mx-auto">
				<button
					onClick={onBack}
					className="flex items-center gap-2 text-[13px] text-[rgba(18,36,26,0.55)] hover:text-[rgba(18,36,26,0.9)] transition-colors"
				>
					<ArrowLeft className="w-4 h-4" />
					Back to Namepass
				</button>

				<h1 className="mt-8 text-[32px] md:text-[44px] font-normal text-[rgba(18,36,26,0.95)] tracking-tight leading-tight">
					{title}
				</h1>
				<p className="mt-2 text-[12px] uppercase tracking-wider text-[rgba(18,36,26,0.45)]">
					Last updated {updated}
				</p>
				<p className="mt-6 text-[15px] text-[rgba(18,36,26,0.65)] leading-relaxed">
					{intro}
				</p>

				<div className="mt-10 space-y-8">
					{sections.map((s) => (
						<div key={s.heading}>
							<h2 className="text-[16px] text-[rgba(18,36,26,0.9)] tracking-tight">
								{s.heading}
							</h2>
							<p className="mt-2 text-[14px] text-[rgba(18,36,26,0.6)] leading-relaxed">
								{s.body}
							</p>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

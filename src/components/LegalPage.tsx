import { BackButton } from "./BackButton";

interface Section {
	heading: string;
	paragraphs: string[];
}

interface Props {
	title: string;
	status: string;
	intro: string;
	sections: Section[];
	onBack: () => void;
}

export default function LegalPage({ title, status, intro, sections, onBack }: Props) {
	return (
		<div className="w-full px-5 md:px-10 pt-4 pb-20 md:pb-28">
			<div className="max-w-[720px] mx-auto">
				<BackButton onClick={onBack} label="Back to Namepass" />

				<h1 className="mt-8 text-[32px] md:text-[44px] font-normal text-[rgba(28,58,41,0.95)] tracking-tight leading-tight">
					{title}
				</h1>
				<p className="mt-4 rounded-xl border border-[rgba(28,58,41,0.18)] bg-[rgba(28,58,41,0.06)] px-4 py-3 text-[12px] font-semibold uppercase tracking-wider text-[rgba(28,58,41,0.85)]">
					{status}
				</p>
				<p className="mt-6 text-[15px] text-[rgba(28,58,41,0.65)] leading-relaxed">
					{intro}
				</p>

				<div className="mt-10 space-y-8">
					{sections.map((s) => (
						<div key={s.heading}>
							<h2 className="text-[16px] text-[rgba(28,58,41,0.9)] tracking-tight">
								{s.heading}
							</h2>
							{s.paragraphs.map((paragraph) => (
								<p key={paragraph} className="mt-2 text-[14px] text-[rgba(28,58,41,0.6)] leading-relaxed">
									{paragraph}
								</p>
							))}
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

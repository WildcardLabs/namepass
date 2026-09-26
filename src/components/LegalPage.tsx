import { BackButton } from "./BackButton";

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
				<BackButton onClick={onBack} label="Back to Namepass" />

				<h1 className="mt-8 text-[32px] md:text-[44px] font-normal text-ink-primary tracking-tight leading-tight">
					{title}
				</h1>
				<p className="mt-2 text-[12px] uppercase tracking-wider text-ink-label">
					Last updated {updated}
				</p>
				<p className="mt-6 text-[15px] text-ink-secondary leading-relaxed">
					{intro}
				</p>

				<div className="mt-10 space-y-8">
					{sections.map((s) => (
						<div key={s.heading}>
							<h2 className="text-[16px] text-ink-primary tracking-tight">
								{s.heading}
							</h2>
							<p className="mt-2 text-[14px] text-ink-secondary leading-relaxed">
								{s.body}
							</p>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

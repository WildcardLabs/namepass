import LegalPage from "./LegalPage";

export default function Privacy({ onBack }: { onBack: () => void }) {
	return (
		<LegalPage
			onBack={onBack}
			title="Privacy Policy"
			updated="July 2026"
			intro="Namepass is built on public, on-chain infrastructure. This page explains what we collect and what stays on-chain by default."
			sections={[
				{
					heading: "On-chain activity is public",
					body: "ENS names, Namepass addresses, and renewal payments are recorded on public blockchains and are visible to anyone via the Explorer — this is by design, not a data collection practice.",
				},
				{
					heading: "What we don't collect",
					body: "Activating a Namepass doesn't require an account, email, or personal information. We don't track wallet activity beyond what's already public on-chain.",
				},
				{
					heading: "Third-party infrastructure",
					body: "Namepass uses third-party services to watch for incoming payments and to move USDC to Ethereum, including Circle's Cross-Chain Transfer Protocol. Deposit addresses are derived on-chain rather than issued by a custodian, so no provider holds funds on your behalf. These services process transaction data solely to execute that automation.",
				},
				{
					heading: "Contact",
					body: "Questions about this policy can be sent via X (@namepass_com).",
				},
			]}
		/>
	);
}

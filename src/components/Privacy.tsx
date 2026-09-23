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
					body: "ENS names, deposit addresses, and renewal payments are visible on public blockchains. The Namepass Explorer indexes transaction evidence for names monitored by the service.",
				},
				{
					heading: "What we don't collect",
					body: "Activating a Namepass doesn't require an account, email, or personal information. We don't track wallet activity beyond what's already public on-chain.",
				},
				{
					heading: "Third-party infrastructure",
					body: "Namepass uses third-party providers to detect deposits and move USDC to Ethereum, including Circle's Cross-Chain Transfer Protocol. Deposit addresses are derived on-chain rather than issued by a custodian, so no provider holds funds on your behalf. These providers process transaction data solely to run Namepass's service.",
				},
				{
					heading: "Contact",
					body: "Questions about this policy can be sent via X (@namepass_eth).",
				},
			]}
		/>
	);
}

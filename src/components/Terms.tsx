import LegalPage from "./LegalPage";

export default function Terms({ onBack }: { onBack: () => void }) {
	return (
		<LegalPage
			onBack={onBack}
			title="Terms of Service"
			status="Prepublication draft · Not effective"
			intro="These draft terms describe the planned Namepass mainnet service. Namepass LLC is being formed in Wyoming and is not yet the operator of this website. These terms will take effect only after the company is formed and an effective date is published."
			sections={[
				{
					heading: "Website and protocol",
					paragraphs: [
						"Once effective, these terms will govern your use of the Namepass website, its explorer, and any hosted automation provided by Namepass LLC (we, us). Namepass also consists of public smart contracts. People can interact with those contracts without this website or our automation. A transaction sent directly to a contract does not, by itself, show that its sender saw or accepted these website terms.",
						"ENS, USDC, Circle, supported blockchains, wallets, and linked websites are separate services with their own rules. We do not control them. Check the current supported chains, tokens, contract addresses, and known limitations before funding a wallet.",
					],
				},
				{
					heading: "What Namepass does",
					paragraphs: [
						"A supported ENS name has a deterministic deposit wallet within a particular Namepass deployment. Anyone can send supported USDC to that wallet. Any executor can call the public contracts to use eligible funds toward extending that name's ENS registration. Our hosted automation may submit these transactions, but it is not required for the protocol to work.",
						"Funding a name does not give the funder ownership, control, or any right in the ENS name. Namepass does not take ownership or control of the name. You are responsible for checking the exact name, chain, token, wallet address, and deployment before sending funds.",
					],
				},
				{
					heading: "No custody of user funds",
					paragraphs: [
						"The deterministic deposit wallets are smart contracts, not accounts with private keys held by us. The current design gives us no discretionary withdrawal or owner sweep from those wallets. During settlement, protocol contracts route supported USDC through the configured payment path and, where applicable, Circle's cross-chain transfer process. We do not hold deposits in a custodial account for users.",
						"This design does not mean a deposit can always be recovered. Funds can remain in a wallet while awaiting a valid execution, and unsupported assets may be permanently inaccessible.",
					],
				},
				{
					heading: "Pricing, fees, and timing",
					paragraphs: [
						"The ENS contracts determine the renewal charge at execution. Website quotes are estimates, not promises of a particular rate or duration. Supported funds may first need to meet minimum amounts and contract conditions. The amount available for renewal can be reduced by a disclosed executor allowance, Circle fees when applicable, and the ENS charge. Balances on different chains are handled separately.",
						"A deposit is not an immediate or guaranteed renewal. Execution may be delayed by network conditions, insufficient funds, failed transactions, unavailable third-party services, or missing attestations. A name may expire before a renewal completes. Check the on-chain renewal result and the name's expiry rather than relying only on a deposit or website status.",
					],
				},
				{
					heading: "Irreversible transactions and errors",
					paragraphs: [
						"Blockchain transactions generally cannot be cancelled after confirmation. We cannot reverse an ENS renewal or promise to return a deposit. The current contract design does not give us a general ability to refund, recover, or redirect funds sent to a deposit wallet. Sending the wrong token, using the wrong chain or deployment, or sending to an incorrect address may result in permanent loss. These statements describe technical limits and do not exclude any legal rights or remedies that cannot be excluded by contract.",
					],
				},
				{
					heading: "Changes and dependencies",
					paragraphs: [
						"Some contract settings and renewal helpers can change through the governance mechanisms disclosed for a deployment. Future deployments can use different addresses and rules. We may change or stop providing the website or hosted automation, but that does not cancel transactions already recorded on a blockchain or give us control over independent public contracts.",
						"The service depends on ENS, USDC, Circle, blockchain networks, oracles, and other infrastructure. Their outages, rule changes, faults, or restrictions may prevent or delay a renewal. We do not promise uninterrupted access, a successful renewal, preservation of a name, or a particular financial outcome.",
					],
				},
				{
					heading: "Your use of the website",
					paragraphs: [
						"You must have legal capacity to use the website and comply with laws that apply to you. If you act for an organization, you must have authority to bind it. Do not use the website to break the law, interfere with its operation, or attempt unauthorized access. We may restrict access to our website and hosted services when reasonably needed for security, abuse prevention, or legal compliance. Such restrictions do not disable independent access to public contracts.",
					],
				},
				{
					heading: "Information and third-party content",
					paragraphs: [
						"The website may show public ENS records, transaction data, third-party content, and links. Their owners are responsible for that content. We may correct, hide, or remove content from our interface where appropriate, without changing the underlying blockchain or ENS records. Website information is provided to help you understand the protocol; it is not financial, legal, or tax advice.",
					],
				},
				{
					heading: "Liability and mandatory rights",
					paragraphs: [
						"To the extent permitted by applicable law, we are not responsible for losses caused by independent networks, protocols, wallets, or third-party services that we do not control, or for indirect or consequential losses. Nothing in these terms excludes or limits liability or consumer rights that cannot lawfully be excluded or limited, including liability for fraud, wilful misconduct, or death or personal injury caused by negligence where applicable. Any limits on liability remain subject to mandatory local law.",
					],
				},
				{
					heading: "Governing law and changes to these terms",
					paragraphs: [
						"Once effective, these terms will be governed by Wyoming law, subject to any mandatory protections that apply in your place of residence. Please contact us first about a dispute so we can try to resolve it. We may update these terms prospectively by posting a new version and effective date. A change will not retroactively alter a completed blockchain transaction.",
					],
				},
				{
					heading: "Contact",
					paragraphs: [
						"Questions or complaints about the planned website service can be sent to legal@namepass.com. The company's registered address and the effective date will be added after formation and before these terms are published as effective.",
					],
				},
			]}
		/>
	);
}

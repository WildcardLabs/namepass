import LegalPage from "./LegalPage";

export default function Privacy({ onBack }: { onBack: () => void }) {
	return (
		<LegalPage
			onBack={onBack}
			title="Privacy Policy"
			status="Prepublication draft · Not effective"
			intro="This draft explains how the planned Namepass LLC website and hosted services would use information. Namepass LLC is being formed in Wyoming and is not yet the operator or data controller for this website. This notice will take effect only after the company is formed and an effective date is published."
			sections={[
				{
					heading: "Who this notice covers",
					paragraphs: [
						"Once effective, Namepass LLC (we, us) will be responsible for the personal information it processes to operate its website, explorer, and optional hosted automation. Public blockchains and ENS are separate systems. This notice cannot control what independent users, node operators, or third-party services do with public records.",
						"You do not need a Namepass account or an email address to derive or fund a deposit wallet. If you contact us, we receive the information you choose to include in your message.",
					],
				},
				{
					heading: "Information we use",
					paragraphs: [
						"To show names and process renewals, our systems index ENS names, deposit wallet and sender addresses where available, chain and token identifiers, amounts, transaction hashes, timestamps, execution status, and renewal outcomes. We obtain these records from public blockchains, ENS, and infrastructure that reports relevant on-chain events. A wallet address or ENS record can identify a person when linked with other information, even when the record is public.",
						"When you visit the website, hosting providers may receive technical request information such as your IP address, browser details, requested page, and time of access. The website uses Vercel Web Analytics for aggregate page statistics. The browser also contacts external providers for ENS profiles, avatar images, blockchain reads, and some page assets. These requests can reveal your IP address and the ENS name or page requested to those providers.",
						"If you write to us, we use your contact details and message to respond and keep a record of the request. We do not ask you to send private keys or wallet recovery phrases.",
					],
				},
				{
					heading: "Why we use it",
					paragraphs: [
						"We use name and transaction records to derive deposit wallets, detect and reconcile deposits, support renewal execution, show accurate public history, investigate failed flows, and protect the service. We use request and analytics data to deliver, secure, and improve the website. We use messages to answer requests and resolve complaints. We may also use records where needed to meet legal obligations or respond to lawful requests.",
						"Where a privacy law requires a legal basis, we expect to rely on performance of a contract for requested website services, legitimate interests in operating and securing the service and maintaining accurate public records, and legal obligations where applicable. We will assess each purpose and any required consent before this notice takes effect; using the website is not treated as blanket consent to unrelated processing.",
					],
				},
				{
					heading: "Public blockchain and ENS data",
					paragraphs: [
						"ENS records and blockchain transactions are public and may be copied or indexed by anyone. A blockchain record may remain available indefinitely. We cannot edit or erase a blockchain transaction or an ENS record on your behalf. We may be able to correct or remove an off-chain record we control, subject to our need to keep an accurate transaction history and any applicable law. Removing a record from our website does not remove it from the underlying network.",
					],
				},
				{
					heading: "Providers and disclosures",
					paragraphs: [
						"We use providers for website hosting and analytics, event indexing, databases, workflow execution, ENS profile resolution, avatar images, blockchain access, and cross-chain messaging. Current examples include Vercel, Goldsky, Neon, Resolvio, DiceBear, public RPC providers, and Circle. A provider receives the information needed for its role; a direct browser request is also governed by that provider's own privacy practices. We may disclose information to professional advisers, successor operators, or authorities when required by law or needed to protect legal rights.",
					],
				},
				{
					heading: "Analytics and local storage",
					paragraphs: [
						"Vercel Web Analytics records aggregate page activity without third-party tracking cookies. Restricted operator functions may use a necessary session cookie. We do not use the website to serve targeted advertisements. We will review any additional cookies or similar technologies and provide the notice and choices required by applicable law before enabling them.",
					],
				},
				{
					heading: "Retention",
					paragraphs: [
						"Raw event webhook payloads are configured to expire after 30 days. We keep normalized deposit, renewal, and name records while needed to operate the explorer, reconcile payments, investigate failures, and meet legal duties. Hosting, analytics, and other providers keep their records under their own retention arrangements. Before this notice becomes effective, we will publish a defined retention schedule for our operational records and correspondence.",
					],
				},
				{
					heading: "International processing",
					paragraphs: [
						"Namepass LLC is planned as a United States company. The website's providers and public blockchain infrastructure may process or make information accessible in multiple countries. Where law requires safeguards for a transfer of personal information, we will identify and use an appropriate transfer mechanism before this notice takes effect. Public on-chain data may be accessible globally regardless of our providers' locations.",
					],
				},
				{
					heading: "Your choices and rights",
					paragraphs: [
						"Depending on where you live, you may have rights to access, correct, delete, or obtain a copy of personal information we control, or to object to or restrict certain uses. You may also have a right to complain to a data protection authority or appeal a decision on a privacy request. Contact legal@namepass.com to make a request. We may need to verify your connection to the relevant information, and legal exceptions may apply. We cannot erase records from public blockchains or from independent third parties' systems.",
					],
				},
				{
					heading: "Children and changes",
					paragraphs: [
						"The website is not designed for children, and we do not knowingly ask children to provide personal information. If you believe a child has sent us personal information, contact us so we can review it. We may update this notice when our processing changes. We will post a new effective date and provide additional notice when required by law.",
					],
				},
				{
					heading: "Contact",
						paragraphs: [
							"Privacy questions and requests can be sent to legal@namepass.com. The company's registered address and the effective date will be added after formation and before this notice is published as effective.",
						],
					},
				]}
		/>
	);
}

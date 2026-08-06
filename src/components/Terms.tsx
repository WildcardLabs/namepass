import LegalPage from "./LegalPage";

export default function Terms({ onBack }: { onBack: () => void }) {
	return (
		<LegalPage
			onBack={onBack}
			title="Terms of Service"
			updated="July 2026"
			intro="Namepass is infrastructure for keeping ENS names registered. By activating a Namepass or sending funds to one, you agree to the terms below."
			sections={[
				{
					heading: "What Namepass does",
					body: "Namepass gives an ENS name a deposit address for name extensions. Incoming USDC is automatically converted into renewal time and applied to that name's registration, at the best rate available for the funds received.",
				},
				{
					heading: "No custody of your name",
					body: "Namepass never takes ownership or control of the underlying ENS name. It only extends the registration period on the owner's behalf when funds arrive.",
				},
				{
					heading: "Payments are final",
					body: "USDC sent to a Namepass address is applied to renewal immediately and cannot be reversed or refunded. Anyone may fund any Namepass. Funding does not transfer ownership.",
				},
				{
					heading: "No guarantees",
					body: "Namepass is provided as-is. While automation runs continuously, network conditions, bridging delays, or chain outages can affect processing time.",
				},
			]}
		/>
	);
}

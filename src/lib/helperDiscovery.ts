import { HUB_CHAIN } from "./chains";

export type HelperCall = { to: string; signature: string; args?: string[] };
export type HelperReader = (calls: HelperCall[]) => Promise<string[]>;

function address(word: string): string {
	if (!/^0{24}[0-9a-f]{40}$/i.test(word)) throw new Error("Invalid helper address response.");
	const result = `0x${word.slice(24).toLowerCase()}`;
	if (/^0x0+$/.test(result)) throw new Error("The helper deployment is not configured.");
	return result;
}

function equal(actual: string, expected: string | undefined): void {
	if (actual !== expected?.toLowerCase()) throw new Error("The helper deployment does not match the configured gateway.");
}

/** The caller must pin every call to the same block. Do not cache across requests. */
export async function discoverHelper(read: HelperReader) {
	const [selected, boundGateway, gatewayPointer] = await read([
		{ to: HUB_CHAIN.pointerAddress!, signature: "currentHelper()" },
		{ to: HUB_CHAIN.pointerAddress!, signature: "gateway()" },
		{ to: HUB_CHAIN.gatewayAddress!, signature: "pointer()" },
	]);
	equal(address(boundGateway), HUB_CHAIN.gatewayAddress);
	equal(address(gatewayPointer), HUB_CHAIN.pointerAddress);
	const helper = address(selected);
	const [version, gateway, factory, token] = await read([
		{ to: helper, signature: "interfaceVersion()" },
		{ to: helper, signature: "gateway()" },
		{ to: helper, signature: "factory()" },
		{ to: helper, signature: "paymentToken()" },
	]);
	if (!/^0{63}1$/.test(version)) throw new Error("Unsupported renewal helper interface.");
	equal(address(gateway), HUB_CHAIN.gatewayAddress);
	equal(address(factory), HUB_CHAIN.factoryAddress);
	equal(address(token), HUB_CHAIN.usdcAddress);
	return helper;
}

/** ENS V2 metadata is optional to the stable interface. Unsupported adapters fail closed. */
export async function readEnsV2Metadata(read: HelperReader, helper: string) {
	const [registrar, renewerV1, referrer] = await read([
		{ to: helper, signature: "ethRegistrar()" },
		{ to: helper, signature: "ethRenewerV1()" },
		{ to: helper, signature: "referrer()" },
	]);
	if (!/^[0-9a-f]{64}$/i.test(referrer)) throw new Error("Invalid helper referrer response.");
	return { registrar: address(registrar), renewerV1: address(renewerV1), referrer: `0x${referrer}` };
}

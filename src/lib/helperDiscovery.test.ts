import { describe, expect, it } from "vitest";
import { discoverHelper, type HelperReader } from "./helperDiscovery";
import { HUB_CHAIN } from "./chains";

const a = "0x1111111111111111111111111111111111111111";
const b = "0x2222222222222222222222222222222222222222";
const word = (x: string | number) => BigInt(x).toString(16).padStart(64, "0");
function reader(helper: string, overrides: Record<string, string | number> = {}): HelperReader {
	const config: Record<string, string | number> = {
		"currentHelper()": helper, "gateway()": HUB_CHAIN.gatewayAddress!, "pointer()": HUB_CHAIN.pointerAddress!,
		"interfaceVersion()": 1, "factory()": HUB_CHAIN.factoryAddress!, "paymentToken()": HUB_CHAIN.usdcAddress,
		...overrides,
	};
	return async calls => calls.map(call => word(config[call.signature]));
}

describe("pointer discovery", () => {
	it("follows replacement without reusing a previous helper", async () => {
		expect(await discoverHelper(reader(a))).toBe(a);
		expect(await discoverHelper(reader(b))).toBe(b);
	});
	it.each(["gateway()", "pointer()", "factory()", "paymentToken()"])("rejects incompatible %s", async signature => {
		await expect(discoverHelper(reader(a, { [signature]: b }))).rejects.toThrow("configured gateway");
	});
	it("rejects an inactive pointer and unknown interface", async () => {
		await expect(discoverHelper(reader("0x0"))).rejects.toThrow("not configured");
		await expect(discoverHelper(reader(a, { "interfaceVersion()": 2 }))).rejects.toThrow("Unsupported");
	});
});

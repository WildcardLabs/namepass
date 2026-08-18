import assert from "node:assert/strict";
import test from "node:test";
import {
	encodeAbiParameters,
	encodeEventTopics,
	parseAbi,
	parseAbiParameters,
	type Address,
	type Hex,
} from "viem";

import { HUB_CHAIN } from "../src/lib/chains";
import { parseEnsRenewalExpiry } from "./ens-renewal";

const ABI = parseAbi([
	"event NameRenewed(uint256 indexed tokenId, string label, uint64 duration, uint64 newExpiry, address paymentToken, bytes32 indexed referrer, uint256 amount)",
]);

test("the receipt expiry comes from the matching ENS renewal event", () => {
	const labelHash = `0x${"1".padStart(64, "0")}` as Hex;
	// ENS v2 token IDs encode registry roles and are not label hashes. The
	// receipt is bound by the allowed renewer, label, token, and referrer.
	const tokenId = BigInt(labelHash) & ~((1n << 32n) - 1n);
	const referrer = HUB_CHAIN.ensReferrer as Hex;
	const topics = encodeEventTopics({
		abi: ABI,
		eventName: "NameRenewed",
		args: { tokenId, referrer },
	});
	const data = encodeAbiParameters(
		parseAbiParameters("string, uint64, uint64, address, uint256"),
		["receipt-test", 100n, 2_000_000_000n, HUB_CHAIN.usdcAddress as Address, 1n],
	);
	const expiry = parseEnsRenewalExpiry([{
		address: HUB_CHAIN.ensRegistrarAddress as Address,
		data,
		topics: topics as readonly Hex[],
	}], { label: "receipt-test" });

	assert.equal(expiry.toISOString(), "2033-05-18T03:33:20.000Z");
});

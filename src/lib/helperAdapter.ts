import { keccak256, type Hex } from "viem";
import { ENS_V2_ADAPTER } from "./helperAdapter.generated";

/** Immutable address changes preserve this adapter's pricing algorithm. Other code needs review. */
export function assertEnsV2Adapter(bytecode: string | undefined): void {
	let code = bytecode?.replace(/^0x/, "") ?? "";
	if (code.length !== ENS_V2_ADAPTER.bytes * 2 || !/^[0-9a-f]+$/i.test(code)) {
		throw new Error("The active helper has an unsupported pricing adapter.");
	}
	for (const { start, length } of ENS_V2_ADAPTER.ranges) {
		code = code.slice(0, start * 2) + "00".repeat(length) + code.slice((start + length) * 2);
	}
	if (keccak256(`0x${code}` as Hex) !== ENS_V2_ADAPTER.hash) {
		throw new Error("The active helper has an unsupported pricing adapter.");
	}
}

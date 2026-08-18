import { decodeUint, ethCallBatch } from "./rpc";
import { HUB_CHAIN } from "./chains";

/**
 * What a renewal costs on top of the ENS price.
 *
 * Standard CCTP transfers carry no Circle fee, so there is nothing to quote
 * and nothing that varies by chain — the whole per-chain estimate/buffer
 * machinery this file used to hold is gone. What remains is a flat allowance
 * toward the gas Namepass fronts, collected by the mainnet contract in the
 * same transaction that renews.
 */

/**
 * Gas allowance taken from every flow, 6dp micro-units. $0.10.
 *
 * Universal — an Ethereum-origin payment never bridges but still triggers a
 * mainnet renewal, so it carries the same allowance. Charged **per flow**, not
 * per deposit: several payments that accumulate and settle together are one
 * renewal and one deduction.
 *
 * Deliberately a rebate rather than cost recovery. A mainnet renewal costs
 * dollars of gas, not cents; Namepass covers the difference.
 */
export const GAS_ALLOWANCE = 100000n;

/**
 * The renewal helper on Sepolia — `docs/DEPLOYMENTS.md`. Not deterministic,
 * so unlike the factory there is nothing to derive; it has to be pinned.
 */
export const NAMEPASS_HELPER = HUB_CHAIN.helperAddress!;

/**
 * Check the allowance above against the deployed contract.
 *
 * This one stays a local constant rather than being read at boot like ENS's
 * rates, and the distinction is worth stating. The rates are **ENS's**, they
 * are mutable by ENS governance, and a stale copy silently mis-quotes someone
 * else's price — so the app refuses to hold one. The allowance is
 * **Namepass's own**, and it is `uint256 public constant` in the helper's
 * bytecode: it cannot change without a redeployment, which is a fact about
 * which contract we point at rather than a value that drifts underneath us.
 *
 * A constant that can't drift still doesn't need to be taken on faith, though,
 * which is what this is for. Verified at boot alongside the oracle read; a
 * mismatch means the app is quoting send amounts against a helper that will
 * take a different cut, so it stops rather than being a dime wrong on every
 * figure it shows.
 */
export async function assertGasAllowance(): Promise<void> {
	const [raw] = await ethCallBatch([
		{ to: NAMEPASS_HELPER, signature: "GAS_ALLOWANCE()" },
	]);
	const onChain = decodeUint(raw);
	if (onChain !== GAS_ALLOWANCE) {
		throw new Error(
			`The renewal helper takes ${onChain} in gas allowance, not ${GAS_ALLOWANCE}.`,
		);
	}
}

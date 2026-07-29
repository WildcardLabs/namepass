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

/** Chains a payment can arrive on, in the order the UI lists them. */
export const FEE_CHAINS = ["Base", "Arbitrum", "Polygon", "Ethereum"];

/**
 * Per-name ENS state, read from the chain.
 *
 * Two facts about a label, and both are things the app previously invented:
 *
 * - **When the registration lapses.** ENS's registry answers `findExpiry`, and
 *   returns `0` for a name nobody has registered.
 * - **Whether ENS will renew it right now.** Each renewer answers
 *   `isRenewable` for its own population, and they are deliberately disjoint —
 *   `ETHRegistrar` for migrated v2 names, `ETHRenewerV1` for premigrated v1
 *   reservations. A label is renewable if *either* says so, which is exactly
 *   how `_selectRenewer` picks in the helper.
 *
 * This is the difference between a card that says "expires 30 May 2037"
 * because a seeded PRNG said so and one that says it because the chain does.
 * It also decides something real for a funder: money sent to a name ENS won't
 * renew sits at the address until that changes, so the UI has to be able to
 * say so before they send.
 *
 * - **Whether it is in its grace period** — expired, but ENS will still renew
 *   it — with `getRemainingGracePeriod` for how long that lasts.
 *
 * Everything comes from `ETHRegistrar`, `ETHRenewerV1`, or the registry those
 * two agree on — the same contracts the helper prices and renews against, and
 * the pair that answers for **both** populations. Nothing is pinned beyond the
 * two renewer addresses.
 */

import { decodeAddress, decodeUint, encodeString, ethCallBatch } from "./rpc";
import { ETH_REGISTRAR, ETH_RENEWER_V1 } from "./oracle";

export interface NameState {
	/**
	 * Unix **ms** the registration lapses, or `null` when the label has never
	 * been registered. Note the contract answers in seconds; this is converted
	 * so it can sit beside `Date.now()` everywhere else in the app.
	 */
	expiry: number | null;
	/** ENS will accept a renewal for this label right now. */
	renewable: boolean;
	/** Which renewer claims it, for the rare places that care. */
	renewer: "registrar" | "v1" | null;
	/**
	 * Milliseconds left in the grace period, or `null` when the name isn't in
	 * one. **This is the only signal that a name has already lapsed** — see the
	 * note at the read; it cannot be inferred by comparing `expiry` to now.
	 */
	graceRemaining: number | null;
	/**
	 * Milliseconds the name has already been expired, or `null` when it hasn't.
	 * A renewal extends from the expiry, not from today, so this is what has to
	 * be bought back before the name is live again.
	 */
	lapsedFor: number | null;
}

let registryPromise: Promise<string> | null = null;

/**
 * ENS v2's `.eth` registry, discovered off the renewers. Read once and shared.
 *
 * Everything this module reads comes from `ETHRegistrar`, `ETHRenewerV1`, or
 * the registry those two agree on — the same three contracts the helper
 * prices and renews against. v1's `BaseRegistrar` is deliberately **not** in
 * that set: it isn't on the helper's path, nothing points the app at it, and
 * a fourth address to pin is a fourth thing to go stale.
 */
async function ensRegistry(): Promise<string> {
	if (!registryPromise) {
		registryPromise = (async () => {
			const [rawA, rawB] = await ethCallBatch([
				{ to: ETH_REGISTRAR, signature: "ETH_REGISTRY()" },
				{ to: ETH_RENEWER_V1, signature: "ETH_REGISTRY()" },
			]);

			const fromRegistrar = decodeAddress(rawA);
			const fromV1 = decodeAddress(rawB);
			if (fromRegistrar !== fromV1) {
				/* Same reasoning as the oracle: one registry, or the app can't
				   speak about "the" expiry of a name. */
				registryPromise = null;
				throw new Error(
					`ENS's renewers disagree on the registry (${fromRegistrar} vs ${fromV1}).`,
				);
			}
			return fromRegistrar;
		})();
	}
	return registryPromise;
}

const cache = new Map<string, NameState>();
const inflight = new Map<string, Promise<NameState | null>>();

/**
 * Read a label's on-chain state. Cached and deduplicated per label.
 *
 * Returns `null` when the read fails — callers should treat that as "not
 * known", which is **not** the same as `{ expiry: null }`, which is the chain
 * positively saying the name isn't registered. Conflating them would show
 * "not registered" to someone whose RPC merely timed out.
 *
 * Takes no `AbortSignal`, for the same reason `fetchProfile` doesn't: the
 * promise is shared between every caller asking about the same label, so one
 * component's unmount must not cancel it for the others.
 */
export async function fetchNameState(label: string): Promise<NameState | null> {
	const key = label.toLowerCase();
	const hit = cache.get(key);
	if (hit) return hit;

	const existing = inflight.get(key);
	if (existing) return existing;

	const request = (async () => {
		try {
			const registry = await ensRegistry();
			const arg = encodeString(label);

			const [rawExpiry, rawV2, rawV1, rawGraceV2, rawGraceV1] =
				await ethCallBatch([
					{ to: registry, signature: "findExpiry(string)", args: [arg] },
					{ to: ETH_REGISTRAR, signature: "isRenewable(string)", args: [arg] },
					{ to: ETH_RENEWER_V1, signature: "isRenewable(string)", args: [arg] },
					{
						to: ETH_REGISTRAR,
						signature: "getRemainingGracePeriod(string)",
						args: [arg],
					},
					{
						to: ETH_RENEWER_V1,
						signature: "getRemainingGracePeriod(string)",
						args: [arg],
					},
				]);

			const seconds = decodeUint(rawExpiry);
			const byRegistrar = decodeUint(rawV2) !== 0n;
			const byV1 = decodeUint(rawV1) !== 0n;

			const expiry = seconds === 0n ? null : Number(seconds) * 1000;
			const renewable = byRegistrar || byV1;

			/*
			 * **Grace is "expired, and ENS will still renew it".**
			 *
			 * Definitional, and it needs no window constant: once a name is past
			 * grace both renewers return false for `isRenewable` (checked on
			 * `nouns`, released and false on both), so expired-and-renewable is
			 * exactly the grace window.
			 *
			 * Everything here hangs off `findExpiry`, deliberately. ENS v2 cuts
			 * grace 90 → 28 days and applies a one-time +62 day renewal to every
			 * v1 name **at the upgrade, automatically** (DAO proposal 6.43), so
			 * from launch `findExpiry` is the operative expiry for both
			 * populations and both are released at the same instant.
			 *
			 * `getRemainingGracePeriod` is still ENS's own answer for *how long
			 * is left*, but it is only consulted once `findExpiry` says the name
			 * has expired. On testnet today a premigrated name is mid-migration
			 * — the +62 days is recorded in the registry but v1 still governs —
			 * so `ETHRenewerV1` reports grace against the un-extended v1 expiry
			 * and would put `farcaster` "73 days into grace" on a card whose
			 * headline says it expires in 46. Gating on `findExpiry` keeps the
			 * card to one clock and lands on the right answer at launch.
			 */
			const expired = expiry !== null && expiry <= Date.now();
			const graceSeconds = byRegistrar
				? decodeUint(rawGraceV2)
				: decodeUint(rawGraceV1);

			const state: NameState = {
				expiry,
				renewable,
				renewer: byRegistrar ? "registrar" : byV1 ? "v1" : null,
				graceRemaining:
					expired && renewable && graceSeconds !== 0n
						? Number(graceSeconds) * 1000
						: null,
				lapsedFor: expired ? Date.now() - (expiry as number) : null,
			};
			cache.set(key, state);
			return state;
		} catch {
			/* Don't cache a failure — the next mount should retry. */
			return null;
		} finally {
			inflight.delete(key);
		}
	})();

	inflight.set(key, request);
	return request;
}

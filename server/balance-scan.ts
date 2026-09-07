import { eq, sql } from "drizzle-orm";

import { database } from "./db/client";
import { names } from "./db/schema";

/** Add or advance one durable balance-scan request. */
export function requestBalanceScanSql(input: {
	nameId: string;
	chainId: number | string;
	requestedThroughBlock?: bigint | number | string | null;
}) {
	const block = input.requestedThroughBlock === undefined
		? null
		: String(input.requestedThroughBlock);
	return sql`
		insert into balance_scan_requests (
			name_id,
			chain_id,
			requested_through_block,
			version,
			updated_at
		)
		values (${input.nameId}, ${String(input.chainId)}, ${block}, 1, now())
		on conflict (name_id, chain_id) do update set
			requested_through_block = case
				when excluded.requested_through_block is null
					then balance_scan_requests.requested_through_block
				when balance_scan_requests.requested_through_block is null
					then excluded.requested_through_block
				else greatest(
					balance_scan_requests.requested_through_block,
					excluded.requested_through_block
				)
			end,
			version = balance_scan_requests.version + 1,
			updated_at = now()
	`;
}

/** Persist a scan request and its public-read marker in one transaction. */
export async function markBalanceScanRequested(input: {
	nameId: string;
	chainId: number | string;
	requestedThroughBlock?: bigint | number | string | null;
}): Promise<void> {
	await database().transaction(async (tx) => {
		await tx.execute(requestBalanceScanSql(input));
		await tx.update(names).set({
			unscannedChainIds: sql`case
				when ${String(input.chainId)}::numeric = any(${names.unscannedChainIds})
				then ${names.unscannedChainIds}
				else array_append(${names.unscannedChainIds}, ${String(input.chainId)}::numeric)
			end`,
		}).where(eq(names.id, input.nameId));
	});
}

/** Serialize origin-wallet release with a deposit webhook for the same route. */
export function originWalletLockSql(nameId: string, chainId: number | string) {
	return sql`select pg_advisory_xact_lock(hashtextextended(
		${`origin-wallet:${nameId}:${String(chainId)}`},
		0
	))`;
}

export function balanceScanCanComplete(input: {
	requestedThroughBlock: string | null;
	snapshotBlock: string;
	blockedByFlow: boolean;
}): boolean {
	return !input.blockedByFlow && (
		input.requestedThroughBlock === null
		|| BigInt(input.snapshotBlock) >= BigInt(input.requestedThroughBlock)
	);
}

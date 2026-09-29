import { sql } from "drizzle-orm";
import { database } from "../db/client";
import { ApiError } from "../http";
import { query, type Executor } from "./store";
import { getResource, resolveNameId } from "./reads";
import { watch } from "./commands";
import { publicIntegrationConfig } from "./config";
import type { Context } from "./http";
import { managementPage, managementCursor } from "./pagination";
import * as validate from "./validation";

export async function nameResource(partner: string, label: string) {
	return database().transaction(
		async (tx) => {
			const id = await resolveNameId(label, tx),
				name = await getResource(partner, "name", id, tx);
			const coverage = await query(
				sql`select chain_id::text as "chainId",from_block::text as "fromBlock",through_block::text as "throughBlock",through_hash as "throughBlockHash",native_from::text as "nativeFromBlock",native_through::text as "nativeThroughBlock",native_target::text as "nativeTargetBlock",status,updated_at as "checkedAt"
      from integration_coverage where name_id=${id} order by chain_id`,
				tx,
			);
			const balances = await query(
				sql`select chain_id::text as "chainId",amount::text as "snapshotAmount",block_number::text as "snapshotBlock",updated_at as "checkedAt" from balance_snapshots where name_id=${id}`,
				tx,
			);
			return {
				...name,
				alias: {
					name: `${validate.name(label)}.namepass.eth`,
					...publicIntegrationConfig().alias,
				},
				historyCoverage: coverage,
				balances,
				fundingStatus:
					Array.isArray(name.unscannedChainIds) &&
					name.unscannedChainIds.length === 0
						? "ready"
						: "initializing",
			};
		},
		{ isolationLevel: "repeatable read" },
	);
}
export async function depositResource(
	partner: string,
	id: string,
	db: Executor = database(),
) {
	const [alias] = await query<{ canonical_id: string }>(
		sql`select canonical_id from integration_identity_aliases where alias=${id} and kind='deposit'`,
		db,
	);
	const canonical = alias?.canonical_id ?? id;
	const deposit = await getResource(partner, "deposit", canonical, db);
	let consumption: unknown = null;
	try {
		consumption = await getResource(partner, "consumption", canonical, db);
	} catch (error) {
		if (!(error instanceof ApiError) || error.status !== 404) throw error;
	}
	const [evidence] = await query(
		sql`select chain_id::text as "chainId",tx_hash as "txHash",block_number::text as "blockNumber",block_hash as "blockHash",
    transaction_index as "transactionIndex",log_index as "logIndex",canonical,verified_at as "verifiedAt" from integration_evidence where id=${canonical}`,
		db,
	);
	return {
		...deposit,
		requestedId: id,
		verification: evidence ?? null,
		consumption,
	};
}
export async function flowResource(partner: string, id: string) {
	validate.uuid(id);
	const flow = await getResource(partner, "flow", id);
	const [alias] = await query<{ canonical_id: string }>(
		sql`select canonical_id from integration_identity_aliases where alias=${id} and kind='flow'`,
	);
	const [settlement] = await query<{ resource_id: string }>(
		sql`select resource_id from integration_versions where resource_kind='settlement' and payload->>'flowId'=${id} order by position desc limit 1`,
	);
	return {
		...flow,
		executionStatus: flow.executionStatus,
		supersededBy: alias?.canonical_id ?? null,
		settlement: settlement
			? await getResource(partner, "settlement", settlement.resource_id)
			: null,
	};
}
export async function listWatches(context: Context) {
	const page = managementPage(context.partner.id, "watches", context.search),
		{ limit } = page;
	const rows = await query(
		sql`select n.display_name as name,n.id as "nameId",w.created_at as "createdAt" from integration_watches w join names n on n.id=w.name_id
    where w.partner_id=${context.partner.id} and w.enabled ${page.after ? sql`and n.id>${validate.uuid(page.after)}` : sql``} and w.created_at<=to_timestamp(${page.through}::numeric/1000)
    order by n.id limit ${limit + 1}`,
		context.db,
	);
	return {
		body: {
			items: rows.slice(0, limit),
			hasMore: rows.length > limit,
			nextCursor: managementCursor(
				context.partner.id,
				"watches",
				page,
				rows.length > limit ? String(rows[limit - 1].nameId) : null,
			),
		},
	};
}
export async function changeWatch(
	context: Context,
	label: string,
	enabled: boolean,
) {
	validate.fields(context.body, []);
	const id = await resolveNameId(label, context.db);
	await watch(context.db, context.partner.id, id, enabled);
	return { body: { nameId: id, enabled, snapshotRequired: enabled } };
}

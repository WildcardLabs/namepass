import { sql } from "drizzle-orm";
import { ApiError } from "../http";
import { depositAddress } from "../../src/lib/namepass";
import { SERVER_CHAINS } from "../../src/lib/chains";
import { labelHash, ensNamehash } from "../chain";
import { query, jsonValue, type Executor } from "./store";
import type { Context } from "./http";
import * as validate from "./validation";
import { DEPLOYMENT_ID } from "./config";

export async function enqueue(
	db: Executor,
	key: string,
	kind: string,
	input: unknown,
): Promise<void> {
	await db.execute(sql`insert into integration_jobs(key,kind,input) values(${key},${kind},${jsonValue(input)})
    on conflict(key) do update set input=excluded.input,
    status=case when integration_jobs.status='running' then 'running' else 'pending' end,next_at=now(),updated_at=now()`);
}
export async function watch(
	db: Executor,
	partner: string,
	nameId: string,
	enabled = true,
) {
	const changed = await query<{ name_id: string }>(
		sql`insert into integration_watches(partner_id,name_id,enabled)
    values(${partner},${nameId},${enabled}) on conflict(partner_id,name_id)
    do update set enabled=excluded.enabled where integration_watches.enabled<>excluded.enabled returning name_id`,
		db,
	);
	if (changed.length) {
		const id = crypto.randomUUID();
		await db.execute(sql`insert into integration_outbox(resource_kind,resource_id,revision,name_id,partner_id,payload,event_type)
      values('watch',${id},1,${nameId},${partner},${jsonValue({ id, version: "1", nameId, enabled, snapshotRequired: enabled })},${enabled ? "watch.created" : "watch.removed"})`);
	}
}

export async function activate(context: Context, refresh = false) {
	const { body, db, partner } = context;
	validate.fields(body, ["name"]);
	const label = validate.name(body.name);
	const address = depositAddress(label).toLowerCase();
	const [stored] = await query<{
		id: string;
		unscanned_chain_ids: string[];
		ens_synced_at: Date;
	}>(
		sql`
    insert into names(normalized_label,display_name,label_hash,namehash,deposit_address,ens_synced_at,unscanned_chain_ids)
    values(${label},${`${label}.eth`},${labelHash(label)},${ensNamehash(label)},${address},'1970-01-01',${sql.param(SERVER_CHAINS.map((c) => String(c.chainId)))}::numeric[])
    on conflict(normalized_label) do update set normalized_label=excluded.normalized_label
    returning id,unscanned_chain_ids,ens_synced_at`,
		db,
	);
	await db.execute(
		sql`insert into goldsky.watched_addresses(value) values(${address}) on conflict(value) do nothing`,
	);
	await watch(db, partner.id, stored.id);
	if (
		!refresh &&
		stored.unscanned_chain_ids.length === 0 &&
		new Date(String(stored.ens_synced_at)).getTime() > 0
	) {
		return {
			status: 200,
			body: {
				nameId: stored.id,
				name: `${label}.eth`,
				depositAddress: address,
				alias: `${label}.namepass.eth`,
				deploymentId: DEPLOYMENT_ID,
				status: "ready",
				operationId: null,
				snapshotRequired: true,
			},
		};
	}
	const [existing] = await query<{ id: string }>(
		sql`select id from integration_operations
    where partner_id=${partner.id} and name_id=${stored.id} and kind in ('activation','refresh') and status in ('pending','running') order by created_at limit 1`,
		db,
	);
	const id = existing?.id ?? crypto.randomUUID();
	if (!existing)
		await db.execute(sql`insert into integration_operations(id,partner_id,kind,name_id,input)
    values(${id},${partner.id},${refresh ? "refresh" : "activation"},${stored.id},${jsonValue({ name: label })})`);
	await enqueue(db, `operation:${id}`, "operation", { operationId: id });
	return {
		status: 202,
		body: {
			operationId: id,
			nameId: stored.id,
			name: `${label}.eth`,
			depositAddress: address,
			alias: `${label}.namepass.eth`,
			deploymentId: DEPLOYMENT_ID,
			status: "initializing",
			snapshotRequired: true,
		},
	};
}

export async function reportTransfer(context: Context) {
	const { body, db, partner } = context;
	validate.fields(body, [
		"name",
		"chainId",
		"txHash",
		"transferKind",
		"logIndex",
		"reference",
	]);
	const label = validate.name(body.name),
		chain = validate.chain(body.chainId),
		txHash = validate.hash(body.txHash);
	const reference = validate.string(body.reference, "reference");
	const transferKind = body.transferKind ?? "erc20";
	if (
		transferKind !== "erc20" &&
		(transferKind !== "native" || chain.key !== "arc")
	)
		validate.invalid("transferKind");
	const logIndex = body.logIndex ?? null;
	if (
		logIndex !== null &&
		(!Number.isSafeInteger(logIndex) ||
			Number(logIndex) < 0 ||
			transferKind === "native")
	)
		validate.invalid("logIndex");
	const [name] = await query<{ id: string }>(
		sql`select n.id from names n join integration_watches w on w.name_id=n.id
    where w.partner_id=${partner.id} and w.enabled and n.normalized_label=${label}`,
		db,
	);
	if (!name)
		throw new ApiError(
			409,
			"name_not_watched",
			"Activate or watch this name before reporting a transfer.",
		);
	await db.execute(
		sql`select pg_advisory_xact_lock(hashtextextended(${`reference:${partner.id}:${reference}`},0))`,
	);
	const [previous] = await query<{
		id: string;
		name_id: string;
		chain_id: string;
		attempts: Array<{ txHash: string; logIndex: number | null }>;
		transfer_kind: string;
	}>(
		sql`
    select id,name_id,chain_id::text,attempts,transfer_kind from integration_transfers where partner_id=${partner.id} and reference=${reference}`,
		db,
	);
	const attempts = [{ txHash, logIndex }];
	if (previous) {
		if (
			previous.name_id !== name.id ||
			previous.chain_id !== String(chain.chainId) ||
			previous.transfer_kind !== transferKind ||
			!previous.attempts.some(
				(a) => a.txHash === txHash && a.logIndex === logIndex,
			)
		)
			throw new ApiError(
				409,
				"reference_conflict",
				"This reference already identifies a different transfer.",
			);
		return { body: { transferId: previous.id }, status: 200 };
	}
	const [transfer] = await query<{ id: string }>(
		sql`insert into integration_transfers(partner_id,name_id,reference,chain_id,transfer_kind,attempts)
    values(${partner.id},${name.id},${reference},${String(chain.chainId)},${transferKind},${jsonValue(attempts)}) returning id`,
		db,
	);
	await enqueue(db, `transfer:${transfer.id}`, "transfer", {
		transferId: transfer.id,
	});
	return { body: { transferId: transfer.id }, status: 202 };
}

export async function addTransaction(context: Context, id: string) {
	validate.uuid(id);
	const { body, partner, db } = context;
	validate.fields(body, ["txHash", "logIndex"]);
	const txHash = validate.hash(body.txHash),
		logIndex = body.logIndex ?? null;
	const [row] = await query<{
		attempts: Array<{ txHash: string; logIndex: number | null }>;
		transfer_kind: string;
		status: string;
	}>(
		sql`
    select attempts,transfer_kind,status from integration_transfers where id=${id} and partner_id=${partner.id} for update`,
		db,
	);
	if (!row)
		throw new ApiError(
			404,
			"transfer_not_found",
			"The transfer was not found.",
		);
	if (
		logIndex !== null &&
		(!Number.isSafeInteger(logIndex) ||
			Number(logIndex) < 0 ||
			row.transfer_kind === "native")
	)
		validate.invalid("logIndex");
	if (row.attempts.some((a) => a.txHash === txHash && a.logIndex === logIndex))
		return { body: { transferId: id }, status: 200 };
	if (
		row.attempts.length >= 20 ||
		["completed", "settled"].includes(row.status)
	)
		throw new ApiError(
			409,
			"transfer_not_editable",
			"This transfer cannot accept another attempt.",
		);
	await db.execute(
		sql`update integration_transfers set attempts=${jsonValue([...row.attempts.filter((a) => a.txHash !== txHash || a.logIndex !== null), { txHash, logIndex }])},status='reported',updated_at=now() where id=${id}`,
	);
	await enqueue(db, `transfer:${id}`, "transfer", { transferId: id });
	return { body: { transferId: id }, status: 202 };
}

export async function retryFlow(context: Context, id: string) {
	validate.uuid(id);
	validate.fields(context.body, []);
	const [row] = await query<{ id: string; name_id: string; status: string }>(
		sql`select f.id,f.name_id,f.status from flows f
    join integration_watches w on w.name_id=f.name_id where f.id=${id} and w.partner_id=${context.partner.id} and w.enabled`,
		context.db,
	);
	if (!row)
		throw new ApiError(404, "flow_not_found", "The flow was not found.");
	if (["completed", "settled"].includes(row.status))
		return { body: { flowId: id, status: row.status } };
	if (
		!["held", "unclaimed", "queued", "failed", "cancelled"].includes(row.status)
	)
		throw new ApiError(
			409,
			"flow_already_running",
			"The flow is already being processed.",
		);
	const [op] = await query<{ id: string }>(
		sql`insert into integration_operations(partner_id,kind,name_id,input)
    values(${context.partner.id},'retry',${row.name_id},${jsonValue({ flowId: id })}) returning id`,
		context.db,
	);
	await enqueue(context.db, `operation:${op.id}`, "operation", {
		operationId: op.id,
	});
	return { body: { operationId: op.id, flowId: id }, status: 202 };
}

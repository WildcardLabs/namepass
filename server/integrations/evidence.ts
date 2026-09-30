import { sql } from "drizzle-orm";
import { decodeEventLog, toHex, type Hex, type TransactionReceipt } from "viem";
import { chainById, HUB_CHAIN } from "../../src/lib/chains";
import { database } from "../db/client";
import { evidenceClient } from "./rpc";
import { pollIris } from "../../workflows/iris";
import { ApiError } from "../http";
import { readReceiptEnsEvidence } from "../ens-renewal";
import {
	parseOriginBurnReceipt,
	parseClaimReceipt,
	validateCctpMessage,
} from "../../workflows/cctp";
import { parseEthereumRenewalReceipt } from "../ethereum";
import { labelHash } from "../chain";
import { query, jsonValue } from "./store";
import { enqueue } from "./commands";
import {
	receiptTransfers,
	selectTransfer,
	identity,
	RENEWED_ABI,
	PROCESSED_ABI,
	consumptionEvidence,
	comparePosition,
	type Position,
} from "./receipts";

export async function canonicalReceipt(chainId: number, hash: string) {
	const chain = chainById(chainId);
	if (!chain) throw new Error("Unsupported evidence chain.");
	const client = await evidenceClient(chain);
	const receipt = await client.getTransactionReceipt({ hash: hash as Hex });
	const block = await client.getBlock({ blockNumber: receipt.blockNumber });
	if (block.hash !== receipt.blockHash)
		throw new ApiError(
			409,
			"receipt_not_canonical",
			"The receipt block is no longer canonical.",
		);
	if (receipt.status !== "success")
		throw new ApiError(
			422,
			"transaction_reverted",
			"The transaction reverted.",
		);
	return { chain, client, receipt, block };
}
export async function storeEvidence(
	id: string,
	chainId: number,
	receipt: TransactionReceipt,
	logIndex: number | null,
	kind?: string,
) {
	await database().transaction(async (tx) => {
		const [source] = await query<{
			canonical: boolean;
			block_number: string;
			tx_hash: string;
			log_index: number;
			chain_id: string;
		}>(
			sql`
      select canonical,block_number::text,tx_hash,log_index,chain_id::text from chain_events where event_id=${id} for share`,
			tx,
		);
		if (
			!source?.canonical ||
			source.block_number !== receipt.blockNumber.toString() ||
			source.tx_hash !== receipt.transactionHash.toLowerCase() ||
			source.chain_id !== String(chainId) ||
			source.log_index !== (logIndex ?? -1)
		)
			throw new ApiError(
				409,
				"evidence_source_changed",
				"Reconcile the current source identity before verifying its receipt.",
				{
					eventId: id,
					chainId: String(chainId),
					txHash: receipt.transactionHash.toLowerCase(),
				},
			);
		await tx.execute(sql`insert into integration_evidence(id,chain_id,tx_hash,block_number,block_hash,transaction_index,log_index,transfer_kind,receipt)
    values(${id},${String(chainId)},${receipt.transactionHash.toLowerCase()},${receipt.blockNumber.toString()},${receipt.blockHash},${receipt.transactionIndex},${logIndex},${kind ?? null},${jsonValue(receipt)})
    on conflict(id) do update set block_number=excluded.block_number,block_hash=excluded.block_hash,transaction_index=excluded.transaction_index,
    log_index=excluded.log_index,receipt=excluded.receipt,canonical=true,verified_at=now()`);
	});
}
export async function verifyDeposit(id: string) {
	const [deposit] = await query<{
		name_id: string;
		chain_id: string;
		tx_hash: string;
		log_index: number;
		transfer_kind: string;
		deposit_address: string;
		amount: string;
		status: string;
	}>(sql`
    select d.*,n.deposit_address from deposits d join names n on n.id=d.name_id where d.event_id=${id}`);
	if (!deposit) return;
	if (deposit.status === "orphaned") {
		await database().execute(
			sql`update integration_evidence set canonical=false where id=${id}`,
		);
		await enqueue(
			database(),
			`consumption:${deposit.name_id}:${deposit.chain_id}`,
			"consumption",
			{ nameId: deposit.name_id, chainId: deposit.chain_id },
		);
	}
	try {
		const { chain, client, receipt } = await canonicalReceipt(
			Number(deposit.chain_id),
			deposit.tx_hash,
		);
		const transaction = await client.getTransaction({
			hash: deposit.tx_hash as Hex,
		});
		const candidate = selectTransfer(
			receiptTransfers(chain, deposit.deposit_address, receipt, transaction),
			deposit.transfer_kind,
			deposit.transfer_kind === "native" ? null : deposit.log_index,
		);
		if (candidate.amount !== deposit.amount)
			throw new ApiError(
				409,
				"deposit_mismatch",
				"The receipt amount differs.",
			);
		const [source] = await query<{ canonical: boolean; block_number: string }>(
			sql`select canonical,block_number::text from chain_events where event_id=${id}`,
		);
		if (
			!source?.canonical ||
			source.block_number !== receipt.blockNumber.toString()
		)
			await (
				await import("./coverage")
			).repairTransaction(deposit.name_id, deposit.chain_id, deposit.tx_hash);
		await storeEvidence(
			id,
			chain.chainId,
			receipt,
			candidate.logIndex,
			candidate.kind,
		);
	} catch (error) {
		if (!(error instanceof ApiError)) throw error;
		await database().execute(
			sql`update integration_evidence set canonical=false,verified_at=now() where id=${id}`,
		);
		await database()
			.execute(sql`insert into integration_consumptions(id,name_id,status,reason) values(${id},${deposit.name_id},'unresolved',${error.code})
      on conflict(id) do update set status='unresolved',reason=excluded.reason,updated_at=now()`);
	}
	await database()
		.execute(sql`insert into integration_coverage(name_id,chain_id,from_block) values(${deposit.name_id},${deposit.chain_id},${(await query<{ block_number: string }>(sql`select block_number::text from deposits where event_id=${id}`))[0].block_number}) on conflict(name_id,chain_id) do update set
    from_block=least(integration_coverage.from_block,excluded.from_block),
    through_block=case when excluded.from_block<integration_coverage.from_block then null else integration_coverage.through_block end,
    status='pending',updated_at=now()`);
	await enqueue(
		database(),
		`coverage:${deposit.name_id}:${deposit.chain_id}`,
		"coverage",
		{ nameId: deposit.name_id, chainId: deposit.chain_id },
	);
	await enqueue(
		database(),
		`consumption:${deposit.name_id}:${deposit.chain_id}`,
		"consumption",
		{ nameId: deposit.name_id, chainId: deposit.chain_id },
	);
}

type FlowEvidenceRow = {
	id: string;
	name_id: string;
	origin_chain_id: string;
	origin_event_id: string | null;
	renewal_event_id: string | null;
	origin_evidence_tx_hash: string | null;
	cctp_nonce: string | null;
	amount_processed: string | null;
	normalized_label: string;
	deposit_address: string;
};
export async function verifyFlow(id: string) {
	const [flow] = await query<FlowEvidenceRow>(
		sql`select f.*,n.normalized_label,n.deposit_address from flows f join names n on n.id=f.name_id where f.id=${id}`,
	);
	if (!flow) return;
	if (!flow.origin_event_id && flow.origin_evidence_tx_hash)
		await enqueue(
			database(),
			`protocol:${flow.origin_chain_id}:${flow.origin_evidence_tx_hash}:${flow.name_id}`,
			"protocol",
			{
				nameId: flow.name_id,
				chainId: flow.origin_chain_id,
				txHash: flow.origin_evidence_tx_hash,
			},
		);
	if (!flow.renewal_event_id) {
		const [intent] = await query<{
			hash: string | null;
		}>(sql`select coalesce(receipt->>'transactionHash',current_tx_hash) as hash from transaction_intents
      where flow_id=${id} and kind=${Number(flow.origin_chain_id) === HUB_CHAIN.chainId ? "origin_renew" : "claim"} and status in ('mined','confirmed') order by created_at desc limit 1`);
		if (intent?.hash)
			await enqueue(
				database(),
				`protocol:${HUB_CHAIN.chainId}:${intent.hash}:${flow.name_id}`,
				"protocol",
				{
					nameId: flow.name_id,
					chainId: String(HUB_CHAIN.chainId),
					txHash: intent.hash,
				},
			);
		await database().execute(
			sql`update integration_settlements set status='invalidated',finalized_at=null,updated_at=now() where flow_id=${id} and status<>'invalidated'`,
		);
		throw new Error("exact_renewal_identity_pending");
	}
	const [event] = await query<{
		tx_hash: string;
		log_index: number;
		canonical: boolean;
	}>(
		sql`select tx_hash,log_index,canonical from chain_events where event_id=${flow.renewal_event_id}`,
	);
	if (!event?.canonical) {
		await database().execute(
			sql`update integration_settlements set status='invalidated',finalized_at=null,updated_at=now() where flow_id=${id} and status<>'invalidated'`,
		);
		await recomputeConsumption(flow.name_id, flow.origin_chain_id);
		return;
	}
	const { client, receipt } = await canonicalReceipt(
		HUB_CHAIN.chainId,
		event.tx_hash,
	);
	const renewals = receipt.logs.flatMap((log) => {
		if (log.address.toLowerCase() !== HUB_CHAIN.gatewayAddress!.toLowerCase())
			return [];
		try {
			return [
				{
					log,
					args: decodeEventLog({ abi: RENEWED_ABI, ...log, strict: true }).args,
				},
			];
		} catch {
			return [];
		}
	});
	const index = renewals.findIndex((r) => r.log.logIndex === event.log_index),
		selected = renewals[index];
	if (
		!selected ||
		selected.args.label !== flow.normalized_label ||
		selected.args.wallet.toLowerCase() !== flow.deposit_address.toLowerCase() ||
		selected.args.labelHash.toLowerCase() !==
			labelHash(flow.normalized_label).toLowerCase()
	)
		throw new Error("renewal_identity_mismatch");
	const previous = index > 0 ? renewals[index - 1].log.logIndex : -1;
	const next = renewals[index + 1]?.log.logIndex ?? Number.MAX_SAFE_INTEGER;
	const before = receipt.logs.filter(
		(l) => l.logIndex > previous && l.logIndex <= event.log_index,
	);
	const expected = {
		wallet: flow.deposit_address as `0x${string}`,
		label: flow.normalized_label,
		labelHash: labelHash(flow.normalized_label) as Hex,
	};
	let bridgeFee = 0n,
		processed: bigint,
		remainder: bigint,
		source: unknown = null;
	if (Number(flow.origin_chain_id) === HUB_CHAIN.chainId) {
		const end = receipt.logs.find(
			(l) =>
				l.logIndex > event.log_index &&
				l.logIndex < next &&
				l.address.toLowerCase() === HUB_CHAIN.factoryAddress!.toLowerCase() &&
				(() => {
					try {
						decodeEventLog({ abi: PROCESSED_ABI, ...l, strict: true });
						return true;
					} catch {
						return false;
					}
				})(),
		);
		if (!end) throw new Error("origin_processing_pending");
		const [origin] = await query<{
			tx_hash: string;
			log_index: number;
			chain_id: string;
			canonical: boolean;
		}>(
			sql`select tx_hash,log_index,chain_id::text,canonical from chain_events where event_id=${flow.origin_event_id}`,
		);
		if (
			!origin?.canonical ||
			origin.tx_hash !== receipt.transactionHash.toLowerCase() ||
			origin.log_index !== end.logIndex ||
			origin.chain_id !== String(HUB_CHAIN.chainId)
		)
			throw new Error("origin_identity_pending");
		const segment = receipt.logs.filter(
			(l) => l.logIndex > previous && l.logIndex <= end.logIndex,
		);
		const parsed = parseEthereumRenewalReceipt(segment, expected);
		processed = BigInt(parsed.amountProcessed);
		remainder = BigInt(parsed.remainingAmount);
		source = identity(HUB_CHAIN.chainId, receipt, end.logIndex);
		if (flow.origin_event_id)
			await storeEvidence(
				flow.origin_event_id,
				HUB_CHAIN.chainId,
				receipt,
				end.logIndex,
			);
	} else {
		if (
			!flow.origin_event_id ||
			!flow.origin_evidence_tx_hash ||
			!flow.cctp_nonce
		)
			throw new Error("origin_identity_pending");
		const [originEvent] = await query<{
			log_index: number;
			canonical: boolean;
			tx_hash: string;
			chain_id: string;
		}>(
			sql`select log_index,canonical,tx_hash,chain_id::text from chain_events where event_id=${flow.origin_event_id}`,
		);
		if (
			!originEvent?.canonical ||
			originEvent.tx_hash !== flow.origin_evidence_tx_hash.toLowerCase() ||
			originEvent.chain_id !== flow.origin_chain_id
		)
			throw new Error("origin_identity_pending");
		const origin = await canonicalReceipt(
			Number(flow.origin_chain_id),
			flow.origin_evidence_tx_hash,
		);
		const burn = parseOriginBurnReceipt(
			origin.receipt.logs.flatMap((l) =>
				l.topics.length ? [{ ...l, topics: l.topics as [Hex, ...Hex[]] }] : [],
			),
			{
				...expected,
				originChainId: Number(flow.origin_chain_id),
				depositLogIndex: originEvent.log_index,
			},
		);
		processed = burn.amount;
		remainder = burn.remaining;
		const nonce = toHex(BigInt(flow.cctp_nonce), { size: 32 });
		const attested = await pollIris(
			{
				baseUrl: process.env.CIRCLE_IRIS_URL ?? "",
				sourceDomain: origin.chain.circleDomain,
				transactionHash: origin.receipt.transactionHash,
				messageIndex: burn.messageIndex,
				attempt: 0,
				initialDelayMs: 1000,
				maxDelayMs: 30000,
			},
			(input, init) =>
				fetch(input, { ...init, signal: AbortSignal.timeout(8000) }),
		);
		if (attested.kind !== "complete")
			throw new Error("source_attestation_pending");
		validateCctpMessage(attested.message, {
			...expected,
			originChainId: Number(flow.origin_chain_id),
			amount: processed,
			nonce,
		});
		const claimResult = parseClaimReceipt(
			before.flatMap((l) =>
				l.topics.length ? [{ ...l, topics: l.topics as [Hex, ...Hex[]] }] : [],
			),
			{
				...expected,
				originChainId: Number(flow.origin_chain_id),
				nonce,
				amount: processed,
			},
		);
		bridgeFee = processed - claimResult.amountReceived;
		source = {
			...identity(
				Number(flow.origin_chain_id),
				origin.receipt,
				originEvent.log_index,
			),
			messageIndex: burn.messageIndex,
			sourceDomain: origin.chain.circleDomain,
			nonce,
			attestationFinality: "verified",
		};
		await storeEvidence(
			flow.origin_event_id,
			Number(flow.origin_chain_id),
			origin.receipt,
			originEvent.log_index,
		);
	}
	const a = selected.args;
	if (
		a.amountReceived !== processed - bridgeFee ||
		a.amountReceived !== a.gasAllowance + a.amountApplied + a.remainder
	)
		throw new Error("settlement_accounting_mismatch");
	const ens = await readReceiptEnsEvidence(
		before,
		flow.normalized_label,
		receipt.blockNumber,
	);
	const expiry = ens.expiry;
	if (
		ens.durationSeconds !== a.duration.toString() ||
		ens.amountApplied !== a.amountApplied.toString()
	)
		throw new Error("ens_accounting_mismatch");
	let finalized = false;
	try {
		finalized =
			(await client.getBlock({ blockTag: "finalized" })).number >=
				receipt.blockNumber &&
			(await client.getBlock({ blockNumber: receipt.blockNumber })).hash ===
				receipt.blockHash;
	} catch {
		/* Observed only. */
	}
	const amounts = {
		amountProcessed: processed.toString(),
		bridgeFee: bridgeFee.toString(),
		amountReceivedOnHub: a.amountReceived.toString(),
		executorAllowance: a.gasAllowance.toString(),
		amountApplied: a.amountApplied.toString(),
		roundingResidue: a.remainder.toString(),
		originWalletRemainder: remainder.toString(),
	};
	const settlementId = `${HUB_CHAIN.chainId}:${receipt.transactionHash.toLowerCase()}:${event.log_index}`;
	await storeEvidence(
		flow.renewal_event_id,
		HUB_CHAIN.chainId,
		receipt,
		event.log_index,
	);
	await database().transaction(async (tx) => {
		const sources = await query<{ event_id: string; canonical: boolean }>(
			sql`select event_id,canonical from chain_events
    where event_id in (${flow.origin_event_id},${flow.renewal_event_id}) order by event_id for share`,
			tx,
		);
		const [current] = await query<{
			origin_event_id: string | null;
			renewal_event_id: string | null;
		}>(
			sql`select origin_event_id,renewal_event_id from flows where id=${id} for update`,
			tx,
		);
		if (
			!current ||
			current.origin_event_id !== flow.origin_event_id ||
			current.renewal_event_id !== flow.renewal_event_id ||
			!sources.length ||
			sources.some((s) => !s.canonical)
		)
			throw new Error("flow_evidence_changed");
		await tx.execute(
			sql`update integration_settlements set status='invalidated',finalized_at=null,updated_at=now() where flow_id=${id} and id<>${settlementId} and status<>'invalidated'`,
		);
		await tx.execute(sql`insert into integration_settlements(id,flow_id,name_id,status,evidence,amounts,duration_seconds,expiry_after,finalized_at)
    values(${settlementId},${id},${flow.name_id},${finalized ? "finalized" : "observed"},${jsonValue({ hub: identity(HUB_CHAIN.chainId, receipt, event.log_index), source, ens: { ...ens, expiry: undefined } })},${jsonValue(amounts)},${a.duration.toString()},${expiry},${finalized ? new Date() : null})
    on conflict(id) do update set status=excluded.status,evidence=excluded.evidence,amounts=excluded.amounts,duration_seconds=excluded.duration_seconds,
    expiry_after=excluded.expiry_after,finalized_at=case when excluded.status='finalized' then coalesce(integration_settlements.finalized_at,excluded.finalized_at) else null end,updated_at=now()`);
	});
	await enqueue(
		database(),
		`consumption:${flow.name_id}:${flow.origin_chain_id}`,
		"consumption",
		{ nameId: flow.name_id, chainId: flow.origin_chain_id },
	);
	await enqueue(
		database(),
		`coverage:${flow.name_id}:${flow.origin_chain_id}`,
		"coverage",
		{ nameId: flow.name_id, chainId: flow.origin_chain_id },
	);
	if (!finalized) throw new Error("hub_finality_pending");
}

export async function recomputeConsumption(nameId: string, chainId: string) {
	return database().transaction(
		async (tx) => {
			const [coverage] = await query<{
				from_block: string;
				through_block: string | null;
			}>(
				sql`select * from integration_coverage where name_id=${nameId} and chain_id=${chainId}`,
				tx,
			);
			const deposits = await query<{
				event_id: string;
				block_number: string;
				transaction_index: number;
				log_index: number | null;
				canonical: boolean;
			}>(
				sql`
    select d.event_id,e.block_number::text,e.transaction_index,e.log_index,e.canonical from deposits d
    join integration_evidence e on e.id=d.event_id where d.name_id=${nameId} and d.chain_id=${chainId}`,
				tx,
			);
			const processing = await query<{
				event_id: string;
				flow_id: string | null;
				block_number: string;
				transaction_index: number;
				log_index: number;
				verified: boolean;
				remaining: string;
				finalized: boolean;
			}>(
				sql`
    select c.event_id,f.id as flow_id,c.block_number::text,coalesce(e.transaction_index,-1) as transaction_index,c.log_index,(e.canonical is true) as verified,c.facts->>'remaining_amount' as remaining,
    exists(select 1 from integration_settlements s where s.flow_id=f.id and s.status='finalized') as finalized
    from chain_events c join names n on n.deposit_address=lower(c.facts->>'wallet_address')
    left join integration_evidence e on e.id=c.event_id
    left join flows f on f.origin_event_id=c.event_id
    where n.id=${nameId} and c.chain_id=${chainId} and c.event_type='DepositProcessed' and c.canonical order by e.block_number,e.transaction_index,e.log_index`,
				tx,
			);
			const positions = processing.map((p) => ({
				blockNumber: p.block_number,
				transactionIndex: p.transaction_index,
				logIndex: p.log_index,
				remaining: p.remaining,
				finalized: p.finalized,
				flowId: p.flow_id,
			}));
			for (const deposit of deposits) {
				const position: Position = {
					blockNumber: deposit.block_number,
					transactionIndex: deposit.transaction_index,
					logIndex: deposit.log_index,
				};
				const drain = positions
					.filter((p) => comparePosition(p, position) > 0)
					.find((p) => p.remaining === "0");
				const relevant = processing.filter(
					(p) =>
						BigInt(p.block_number) >= BigInt(deposit.block_number) &&
						(!drain || BigInt(p.block_number) <= BigInt(drain.blockNumber)),
				);
				const covered =
					deposit.canonical &&
					!!coverage?.through_block &&
					BigInt(coverage.from_block) <= BigInt(deposit.block_number) &&
					relevant.every(
						(p) =>
							BigInt(p.block_number) <= BigInt(coverage.through_block!) &&
							p.verified,
					);
				const result = consumptionEvidence(position, positions, covered);
				await tx.execute(sql`insert into integration_consumptions(id,name_id,status,linkage,flow_ids,reason)
      values(${deposit.event_id},${nameId},${result.status},${result.linkage},${sql.param(result.flowIds)}::uuid[],${result.reason})
      on conflict(id) do update set status=excluded.status,linkage=excluded.linkage,flow_ids=excluded.flow_ids,reason=excluded.reason,updated_at=now()`);
			}
		},
		{ isolationLevel: "serializable" },
	);
}

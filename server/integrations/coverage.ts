import { sql } from "drizzle-orm";
import {
	decodeEventLog,
	TransactionReceiptNotFoundError,
	type Hex,
	type Log,
} from "viem";
import { chainById, HUB_CHAIN } from "../../src/lib/chains";
import { evidenceClient } from "./rpc";
import { indexedRenewalSegment } from "../indexed-renewal";
import { readReceiptEnsExpiry } from "../ens-renewal";
import { database } from "../db/client";
import {
	ingestGoldskyEvent,
	postgresGoldskyStore,
	startGoldskyFlow,
	type GoldskyEvent,
} from "../goldsky";
import { canonicalReceipt, storeEvidence } from "./evidence";
import {
	PROCESSED_ABI,
	RENEWED_ABI,
	CLAIMED_ABI,
	TRANSFER_ABI,
	receiptTransfers,
} from "./receipts";
import { query } from "./store";
import { enqueue } from "./commands";

/** Each invocation repairs a finite range. A range advances only after all receipts commit. */
export async function repairCoverage(nameId: string, chainId: string) {
	const chain = chainById(Number(chainId));
	if (!chain) throw new Error("Unsupported coverage chain.");
	const [name] = await query<{ deposit_address: string }>(
		sql`select deposit_address from names where id=${nameId}`,
	);
	if (!name) return;
	const client = await evidenceClient(chain),
		tip = await client.getBlockNumber();
	await database().execute(
		sql`insert into integration_coverage(name_id,chain_id,from_block) values(${nameId},${chainId},${(tip > 12n ? tip - 12n : 0n).toString()}) on conflict do nothing`,
	);
	if (chain.key === "arc")
		await database().execute(
			sql`update integration_coverage set native_from=coalesce(native_from,greatest(from_block,${(tip > 12n ? tip - 12n : 0n).toString()})),native_target=${tip.toString()} where name_id=${nameId} and chain_id=${chainId} and native_target is null`,
		);
	const [coverage] = await query<{
		from_block: string;
		through_block: string | null;
		through_hash: string | null;
		native_from: string | null;
		native_target: string | null;
	}>(
		sql`select * from integration_coverage where name_id=${nameId} and chain_id=${chainId}`,
	);
	if (coverage.through_block) {
		const old = await client.getBlock({
			blockNumber: BigInt(coverage.through_block),
		});
		if (old.hash !== coverage.through_hash) {
			// Do not retain a coverage claim across a fork. Receipt jobs revalidate facts.
			await database().execute(
				sql`update integration_coverage set through_block=null,through_hash=null,native_through=null,status='reconciling',updated_at=now() where name_id=${nameId} and chain_id=${chainId}`,
			);
			await database()
				.execute(sql`update integration_evidence set canonical=false where chain_id=${chainId} and block_number>=${coverage.from_block}
        and (id in(select event_id from deposits where name_id=${nameId}) or id in(select origin_event_id from flows where name_id=${nameId}))`);
			const deposits = await query<{ event_id: string }>(
				sql`select event_id from deposits where name_id=${nameId} and chain_id=${chainId}`,
			);
			for (const deposit of deposits)
				await enqueue(
					database(),
					`deposit:${deposit.event_id}`,
					"deposit_evidence",
					{ depositId: deposit.event_id },
				);
			const flows = await query<{ id: string }>(
				sql`select id from flows where name_id=${nameId} and origin_chain_id=${chainId}`,
			);
			for (const flow of flows)
				await enqueue(database(), `flow:${flow.id}`, "flow_evidence", {
					flowId: flow.id,
				});
			await enqueue(
				database(),
				`consumption:${nameId}:${chainId}`,
				"consumption",
				{ nameId, chainId },
			);
			throw new Error("coverage_reorg");
		}
	}
	const [batch] = await query<{
		anchor_from: string;
		anchor_through: string | null;
		from_block: string;
		to_block: string;
		to_hash: string;
		hashes: string[];
		next_index: number;
	}>(
		sql`select * from integration_coverage_batches where name_id=${nameId} and chain_id=${chainId}`,
	);
	if (
		batch &&
		(batch.anchor_from !== coverage.from_block ||
			batch.anchor_through !== coverage.through_block)
	) {
		await database().execute(
			sql`delete from integration_coverage_batches where name_id=${nameId} and chain_id=${chainId}`,
		);
		throw new Error("coverage_anchor_changed");
	}
	if (!batch) {
		const from = coverage.through_block
			? BigInt(coverage.through_block) + 1n
			: BigInt(coverage.from_block);
		if (from > tip) return;
		const inNative =
			coverage.native_from !== null &&
			coverage.native_target !== null &&
			from >= BigInt(coverage.native_from) &&
			from <= BigInt(coverage.native_target);
		const span = inNative ? 11n : 499n;
		let to = from + span < tip ? from + span : tip;
		if (
			coverage.native_from !== null &&
			from < BigInt(coverage.native_from) &&
			to >= BigInt(coverage.native_from)
		)
			to = BigInt(coverage.native_from) - 1n;
		const anchor = await client.getBlock({ blockNumber: to });
		const wallet = name.deposit_address as `0x${string}`;
		const groups = await Promise.all([
			client.getLogs({
				address: chain.usdcAddress as `0x${string}`,
				event: TRANSFER_ABI[0],
				args: { to: wallet },
				fromBlock: from,
				toBlock: to,
				strict: true,
			}),
			client.getLogs({
				address: chain.factoryAddress as `0x${string}`,
				event: PROCESSED_ABI[0],
				args: { wallet },
				fromBlock: from,
				toBlock: to,
				strict: true,
			}),
			Number(chainId) === HUB_CHAIN.chainId
				? client.getLogs({
						address: HUB_CHAIN.gatewayAddress as `0x${string}`,
						event: RENEWED_ABI[0],
						args: { wallet },
						fromBlock: from,
						toBlock: to,
						strict: true,
					})
				: [],
			Number(chainId) === HUB_CHAIN.chainId
				? client.getLogs({
						address: HUB_CHAIN.gatewayAddress as `0x${string}`,
						event: CLAIMED_ABI[0],
						args: { wallet },
						fromBlock: from,
						toBlock: to,
						strict: true,
					})
				: [],
		]);
		const hashes = new Set(groups.flat().map((log) => log.transactionHash!));
		if (inNative) {
			const end =
				to < BigInt(coverage.native_target!)
					? to
					: BigInt(coverage.native_target!);
			for (let first = from; first <= end; first += 4n) {
				const numbers = Array.from(
					{ length: Number(end - first + 1n < 4n ? end - first + 1n : 4n) },
					(_, i) => first + BigInt(i),
				);
				const blocks = await Promise.all(
					numbers.map((blockNumber) =>
						client.getBlock({ blockNumber, includeTransactions: true }),
					),
				);
				for (const block of blocks)
					for (const tx of block.transactions)
						if (tx.to?.toLowerCase() === name.deposit_address && tx.value > 0n)
							hashes.add(tx.hash);
			}
		}
		await database()
			.execute(sql`insert into integration_coverage_batches(name_id,chain_id,anchor_from,anchor_through,from_block,to_block,to_hash,hashes)
      values(${nameId},${chainId},${coverage.from_block},${coverage.through_block},${from.toString()},${to.toString()},${anchor.hash},${sql.param([...hashes])}::text[]) on conflict do nothing`);
		throw new Error("coverage_batch_ready");
	}
	const canonicalEnd = await client.getBlock({
		blockNumber: BigInt(batch.to_block),
	});
	if (canonicalEnd.hash !== batch.to_hash) {
		await database().execute(
			sql`delete from integration_coverage_batches where name_id=${nameId} and chain_id=${chainId}`,
		);
		throw new Error("coverage_batch_reorged");
	}
	const hash = batch.hashes[batch.next_index];
	if (hash) {
		await repairTransaction(nameId, chainId, hash);
		await database().execute(
			sql`update integration_coverage_batches set next_index=next_index+1 where name_id=${nameId} and chain_id=${chainId} and next_index=${batch.next_index}`,
		);
		throw new Error("coverage_receipt_complete");
	}
	await database().transaction(async (tx) => {
		await tx.execute(sql`update integration_coverage set through_block=${batch.to_block},through_hash=${batch.to_hash},
      native_through=case when native_from is not null and ${batch.to_block}::numeric>=native_from then least(${batch.to_block}::numeric,native_target) else native_through end,status=${BigInt(batch.to_block) === tip ? "covered" : "reconciling"},updated_at=now()
      where name_id=${nameId} and chain_id=${chainId} and from_block=${coverage.from_block} and through_block is not distinct from ${coverage.through_block}::numeric`);
		await tx.execute(
			sql`delete from integration_coverage_batches where name_id=${nameId} and chain_id=${chainId}`,
		);
		await enqueue(tx, `consumption:${nameId}:${chainId}`, "consumption", {
			nameId,
			chainId,
		});
	});
	if (BigInt(batch.to_block) < tip) throw new Error("coverage_incomplete");
}

export async function repairTransaction(
	nameId: string,
	chainId: string,
	hash: string,
) {
	const chain = chainById(Number(chainId));
	if (!chain) throw new Error("unsupported_chain");
	const [name] = await query<{ deposit_address: string }>(
		sql`select deposit_address from names where id=${nameId}`,
	);
	if (!name) return;
	const client = await evidenceClient(chain);
	const verified = await canonicalReceipt(chain.chainId, hash),
		{ receipt, block } = verified;
	const transaction = await client.getTransaction({ hash: hash as Hex });
	for (const transfer of receiptTransfers(
		chain,
		name.deposit_address,
		receipt,
		transaction,
	)) {
		const event: GoldskyEvent = {
			eventId: transfer.id,
			eventFamily: "deposit",
			eventType: "Transfer",
			chainId: chain.chainId,
			blockNumber: receipt.blockNumber.toString(),
			blockTime: new Date(Number(block.timestamp) * 1000),
			txHash: hash.toLowerCase(),
			logIndex: transfer.logIndex ?? -1,
			transferKind: transfer.kind,
			gsOp: "c",
			tokenAddress: chain.usdcAddress.toLowerCase(),
			senderAddress: transfer.sender,
			recipientAddress: name.deposit_address,
			amount: transfer.amount,
			facts: {},
			payload: {},
		};
		const flowId = await ingestGoldskyEvent(
			postgresGoldskyStore,
			event,
			undefined,
			true,
		);
		await storeEvidence(
			event.eventId,
			chain.chainId,
			receipt,
			transfer.logIndex,
			transfer.kind,
		);
		if (flowId) await startGoldskyFlow(flowId);
	}
	for (const log of receipt.logs) {
		const emitter = log.address.toLowerCase();
		if (
			emitter !== chain.factoryAddress?.toLowerCase() &&
			!(
				Number(chainId) === HUB_CHAIN.chainId &&
				emitter === HUB_CHAIN.gatewayAddress!.toLowerCase()
			)
		)
			continue;
		let wallet: string;
		try {
			wallet = decodeEventLog({
				abi: [...PROCESSED_ABI, ...RENEWED_ABI, ...CLAIMED_ABI],
				...log,
				strict: true,
			}).args.wallet;
		} catch {
			continue;
		}
		if (wallet.toLowerCase() !== name.deposit_address) continue;
		await ingestProtocolLog(chain.chainId, log, verified);
	}
}

async function ingestProtocolLog(
	chainId: number,
	log: Log,
	verified?: Awaited<ReturnType<typeof canonicalReceipt>>,
) {
	if (log.logIndex === null || !log.transactionHash)
		throw new Error("Unmined log.");
	const { chain, receipt, block } =
		verified ?? (await canonicalReceipt(chainId, log.transactionHash));
	const actual = receipt.logs.find((l) => l.logIndex === log.logIndex);
	if (
		!actual ||
		actual.data !== log.data ||
		actual.address.toLowerCase() !== log.address.toLowerCase()
	)
		throw new Error("Protocol receipt mismatch.");
	const abi = [...PROCESSED_ABI, ...RENEWED_ABI, ...CLAIMED_ABI];
	const decoded = decodeEventLog({ abi, ...actual, strict: true });
	const a = decoded.args;
	const mapping: Record<string, string> = {
		labelKey: "label_key",
		wallet: "wallet_address",
		remaining: "remaining_amount",
		labelHash: "label_hash",
		executor: "executor_address",
		amountReceived: "amount_received",
		gasAllowance: "gas_allowance",
		amountApplied: "amount_applied",
		fromCCTP: "from_cctp",
		sourceDomain: "source_domain",
		burnAmount: "burn_amount",
		feeExecuted: "fee_executed",
		mintedAmount: "minted_amount",
	};
	const facts: Record<string, unknown> = {
		contract_address: log.address.toLowerCase(),
	};
	for (const [key, value] of Object.entries(a))
		facts[mapping[key] ?? key] =
			typeof value === "bigint" ||
			typeof value === "boolean" ||
			typeof value === "number"
				? String(value)
				: typeof value === "string" && value.startsWith("0x")
					? value.toLowerCase()
					: value;
	// Goldsky uses provider-specific dataset IDs; reuse an existing exact identity.
	const [existing] = await query<{ event_id: string }>(
		sql`select event_id from chain_events where chain_id=${String(chainId)} and tx_hash=${log.transactionHash.toLowerCase()} and log_index=${log.logIndex} and event_type=${decoded.eventName}`,
	);
	const event: GoldskyEvent = {
		eventId:
			existing?.event_id ??
			`${chainId}:log_${log.transactionHash.toLowerCase()}_${log.logIndex}`,
		eventFamily: "namepass",
		eventType: decoded.eventName,
		chainId,
		blockNumber: receipt.blockNumber.toString(),
		blockTime: new Date(Number(block.timestamp) * 1000),
		txHash: log.transactionHash.toLowerCase(),
		logIndex: log.logIndex,
		gsOp: "c",
		facts,
		payload: {},
	};
	if (event.eventType === "Renewed")
		event.facts.new_expiry = String(
			(
				await readReceiptEnsExpiry(
					indexedRenewalSegment(receipt, event),
					String(event.facts.label),
					receipt.blockNumber,
				)
			).getTime() / 1000,
		);
	await ingestGoldskyEvent(postgresGoldskyStore, event);
	await storeEvidence(event.eventId, chain.chainId, receipt, log.logIndex);
}

/** Receipt authority prevents a late indexer deletion from orphaning a reminted transaction. */
export async function normalizeIndexedDeposit(
	event: GoldskyEvent,
): Promise<void> {
	let verified: Awaited<ReturnType<typeof canonicalReceipt>>;
	try {
		verified = await canonicalReceipt(event.chainId, event.txHash);
	} catch (error) {
		if (
			event.gsOp !== "d" ||
			!(error instanceof TransactionReceiptNotFoundError)
		)
			throw error;
		const chain = chainById(event.chainId)!;
		const client = await evidenceClient(chain);
		const current = await client.getBlock({
			blockNumber: BigInt(event.blockNumber),
		});
		// Receipt absence plus a canonical block without this transaction proves
		// removal. Transport errors never become orphan evidence.
		if (
			current.transactions.some(
				(hash) => hash.toLowerCase() === event.txHash.toLowerCase(),
			)
		)
			throw error;
		return;
	}
	const { chain, client, receipt, block } = verified;
	const transaction = await client.getTransaction({
		hash: event.txHash as Hex,
	});
	const candidates = receiptTransfers(
		chain,
		event.recipientAddress!,
		receipt,
		transaction,
	);
	let candidate = candidates.find(
		(t) =>
			t.kind === event.transferKind &&
			(t.kind === "native" || t.logIndex === event.logIndex),
	);
	if (!candidate && event.transferKind === "erc20")
		candidate = candidates.find(
			(t) =>
				t.kind === "native" &&
				t.amount === event.amount &&
				t.sender === event.senderAddress,
		);
	if (!candidate) {
		if (event.gsOp === "d") return;
		throw new Error("indexer_receipt_conflict");
	}
	Object.assign(event, {
		eventId: candidate.id,
		logIndex: candidate.logIndex ?? -1,
		transferKind: candidate.kind,
		blockNumber: receipt.blockNumber.toString(),
		blockTime: new Date(Number(block.timestamp) * 1000),
		gsOp: "c",
		amount: candidate.amount,
		senderAddress: candidate.sender,
	});
}

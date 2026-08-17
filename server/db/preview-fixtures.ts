import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";
import {
	chainEvents,
	deposits,
	flows,
	names,
	watchedAddresses,
} from "./schema";

if (!new Set(["development", "preview", "test"]).has(process.env.VERCEL_ENV ?? "development")) {
	throw new Error("Preview fixtures cannot run in production.");
}

const nameId = "00000000-0000-4000-8000-000000000001";
const flowId = "00000000-0000-4000-8000-000000000002";
const eventId = "preview:base-sepolia:deposit:1";
const depositAddress = "0x043c184003266644372ba5fa4946777b3f1cfc3d";
const now = new Date("2026-08-11T12:00:00.000Z");
const connectionString = process.env.DATABASE_URL_UNPOOLED;
if (!connectionString) {
	throw new Error("DATABASE_URL_UNPOOLED is required for preview fixtures.");
}
const pool = new Pool({ connectionString, max: 1 });
const db = drizzle(pool, { schema });

await db.transaction(async (tx) => {
	await tx
		.insert(names)
		.values({
			id: nameId,
			normalizedLabel: "vitalik",
			displayName: "vitalik.eth",
			labelHash: "0xaf2caa1c2ca1d027f1ac823b529d0a67cd144264b2789fa2ea4d63a67c7103cc",
			namehash: "0xee6c4522aab0003e8d14cd40a6af439055fd2577951148c14b6cea9a53475835",
			depositAddress,
			ensSyncedAt: now,
			lifetimeReceived: "5000000",
		})
		.onConflictDoNothing();
	await tx
		.insert(watchedAddresses)
		.values({ value: depositAddress.toLowerCase(), updatedAt: now })
		.onConflictDoNothing();
	await tx
		.insert(chainEvents)
		.values({
			eventId,
			eventFamily: "deposit",
			eventType: "Transfer",
			chainId: "84532",
			txHash: `0x${"1".repeat(64)}`,
			logIndex: 0,
			blockNumber: "1",
			blockTime: now,
			gsOp: "CREATE",
			facts: {
				token_address: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
				sender_address: "0x0000000000000000000000000000000000000001",
				recipient_address: depositAddress,
				amount: "5000000",
			},
			payloadExpiresAt: new Date("2026-09-10T12:00:00.000Z"),
		})
		.onConflictDoNothing();
	await tx
		.insert(deposits)
		.values({
			eventId,
			nameId,
			chainId: "84532",
			tokenAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
			senderAddress: "0x0000000000000000000000000000000000000001",
			amount: "5000000",
			txHash: `0x${"1".repeat(64)}`,
			logIndex: 0,
			blockNumber: "1",
			blockTime: now,
			source: "goldsky",
			status: "finalized",
		})
		.onConflictDoNothing();
	await tx
		.insert(flows)
		.values({
			id: flowId,
			nameId,
			originChainId: "84532",
			trigger: "automatic",
			status: "held",
			holdReason: "preview_fixture",
			amountDetected: "5000000",
			heldAt: now,
		})
		.onConflictDoNothing();
	await tx.execute(sql`select 1`);
}).finally(() => pool.end());

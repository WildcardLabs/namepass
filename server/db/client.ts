import { attachDatabasePool } from "@vercel/functions";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

let pool: Pool | undefined;
let db: Database | undefined;

function databasePool(): Pool {
	if (pool) return pool;
	const connectionString = process.env.DATABASE_URL;
	if (!connectionString) throw new Error("DATABASE_URL is not configured.");
	pool = new Pool({ connectionString, max: 10 });
	attachDatabasePool(pool);
	return pool;
}

export function database(): Database {
	if (db) return db;
	db = drizzle(databasePool(), { schema });
	return db;
}

/** Use a transaction-scoped Postgres advisory lock for a bounded cron batch. */
export async function withDatabaseLease<T>(key: number, work: () => Promise<T>): Promise<T | undefined> {
	return database().transaction(async (tx) => {
		const result = await tx.execute<{ locked: boolean }>(
			sql`select pg_try_advisory_xact_lock(${key}) as locked`,
		);
		return result.rows[0]?.locked ? work() : undefined;
	});
}

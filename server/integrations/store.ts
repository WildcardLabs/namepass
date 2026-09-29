import { sql, type SQL } from "drizzle-orm";
import { database, type Database } from "../db/client";

export type Executor = Pick<Database, "execute">;
export async function query<T extends Record<string, unknown>>(
	statement: SQL,
	db: Executor = database(),
): Promise<T[]> {
	const result = await db.execute<T>(statement);
	// Raw Drizzle execution deliberately bypasses its column decoders. Normalize
	// PostgreSQL temporal fields before they reach JSON or lease expiry checks.
	const temporal = result.fields.filter(
		(field) => field.dataTypeID === 1184 || field.dataTypeID === 1114,
	);
	for (const row of result.rows)
		for (const field of temporal) {
			const value = row[field.name];
			if (value !== null && value !== undefined)
				(row as Record<string, unknown>)[field.name] = new Date(String(value));
		}
	return result.rows as T[];
}
export const jsonValue = (value: unknown) =>
	sql`${JSON.stringify(value, (_key, item: unknown) => (typeof item === "bigint" ? item.toString() : item))}::jsonb`;

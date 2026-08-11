import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL_UNPOOLED;
if (!connectionString) {
	throw new Error("DATABASE_URL_UNPOOLED is required for migrations.");
}

const pool = new Pool({ connectionString, max: 1 });
try {
	await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
} finally {
	await pool.end();
}

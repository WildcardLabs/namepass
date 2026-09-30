import { defineConfig } from "drizzle-kit";

export default defineConfig({
	dialect: "postgresql",
	schema: "./server/db/schema.ts",
	out: "./drizzle",
	// `check` and `generate` only read the schema. `server/db/migrate.ts` is
	// the command that requires a real direct URL before it can modify Neon.
	dbCredentials: {
		url: process.env.DATABASE_URL_UNPOOLED ?? "postgresql://unused:unused@localhost:5432/unused",
	},
	strict: true,
	verbose: true,
});

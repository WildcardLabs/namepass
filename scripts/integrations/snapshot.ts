import { generateDrizzleJson } from "drizzle-kit/api";
import { readFile, writeFile } from "node:fs/promises";
import * as core from "../../server/db/schema";
import * as integrations from "../../server/integrations/schema";
const previous = JSON.parse(
	await readFile("drizzle/meta/0007_snapshot.json", "utf8"),
);
const snapshot = generateDrizzleJson(
	{ ...core, ...integrations },
	previous.id,
	["public", "goldsky"],
);
await writeFile(
	"drizzle/meta/0009_snapshot.json",
	JSON.stringify(
		snapshot,
		(_key, value) => (typeof value === "bigint" ? Number(value) : value),
		2,
	) + "\n",
);

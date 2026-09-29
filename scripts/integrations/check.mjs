import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import SwaggerParser from "@apidevtools/swagger-parser";
import openapiTS, { astToString } from "openapi-typescript";

execFileSync(
	process.execPath,
	["scripts/integrations/openapi.mjs", "--check"],
	{ stdio: "inherit" },
);
await SwaggerParser.validate("docs/api/openapi.json");
const generated = astToString(
	await openapiTS(new URL("../../docs/api/openapi.json", import.meta.url)),
);
const stored = await readFile("src/lib/integration-api.generated.ts", "utf8");
// The CLI adds a generated-file banner; the compiler API returns only the AST.
assert.equal(
	stored.slice(stored.indexOf("export interface paths")),
	generated.slice(generated.indexOf("export interface paths")),
	"Run npm run generate:api.",
);
console.log("OpenAPI schema and generated artifacts are current.");

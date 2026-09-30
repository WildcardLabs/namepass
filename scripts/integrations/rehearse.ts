/** Rehearse on an isolated branch. This command never migrates its source database. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { depositAddress } from "../../src/lib/namepass";
import { SERVER_CHAINS } from "../../src/lib/chains";

const sourceUrl = process.env.NAMEPASS_SOURCE_DATABASE_URL;
const targetUrl = process.env.DATABASE_URL_UNPOOLED;
const output = process.argv[2];
if (!sourceUrl || !targetUrl || !output)
  throw new Error(
    "Source URL, isolated target URL and output file are required.",
  );
assert.notEqual(
  new URL(sourceUrl).hostname,
  new URL(targetUrl).hostname,
  "The rehearsal must use a separate endpoint.",
);
const source = new Pool({ connectionString: sourceUrl, max: 1 });
const target = new Pool({ connectionString: targetUrl, max: 1 });
const tables = [
  "names",
  "chain_events",
  "deposits",
  "flows",
  "flow_transitions",
  "transaction_intents",
  "balance_snapshots",
  "balance_scan_requests",
  "goldsky.watched_addresses",
];
async function fingerprint(pool: Pool) {
  const result: Record<string, unknown> = {};
  for (const table of tables) {
    const rows = await pool.query(
      `select count(*)::int as rows, md5(coalesce(string_agg(row_hash,'' order by row_hash),'')) as fingerprint from (select md5((to_jsonb(t)-'evidence_kind'-'transfer_kind')::text) row_hash from ${table} t) hashes`,
    );
    result[table] = rows.rows[0];
  }
  return result;
}
try {
  const read = await source.connect();
  let sourceSummary;
  try {
    await read.query("begin read only");
    const names = await read.query(
      "select normalized_label,deposit_address from names",
    );
    assert.ok(
      names.rows.every(
        (row) =>
          depositAddress(row.normalized_label).toLowerCase() ===
          row.deposit_address.toLowerCase(),
      ),
      "Stored addresses do not match the current factory.",
    );
    const chains = await read.query(
      "select distinct chain_id::text from chain_events",
    );
    assert.ok(
      chains.rows.every((row) =>
        SERVER_CHAINS.some((c) => String(c.chainId) === row.chain_id),
      ),
      "Stored events contain unsupported chains.",
    );
    const migrations = await read.query(
      "select id,created_at::text from drizzle.__drizzle_migrations order by id",
    );
    sourceSummary = {
      names: names.rowCount,
      chains: chains.rows.map((r) => r.chain_id),
      migrations: migrations.rows,
    };
    await read.query("commit");
  } finally {
    read.release();
  }
  const before = await fingerprint(target);
  const pending = await target.query(
    "select count(*)::int n from flows where status not in ('settled','cancelled','failed')",
  );
  await migrate(drizzle(target), { migrationsFolder: "drizzle" });
  const after = await fingerprint(target);
  assert.deepEqual(
    after,
    before,
    "The migration changed existing payment evidence.",
  );
  const candidates = await target.query(
    `select count(*)::int n from deposits a join deposits b on a.chain_id=b.chain_id and a.tx_hash=b.tx_hash and a.name_id=b.name_id and a.sender_address=b.sender_address and a.amount=b.amount where a.transfer_kind='native' and b.transfer_kind='erc20'`,
  );
  assert.equal(
    candidates.rows[0].n,
    0,
    "Ambiguous native/token deposits require reconciliation.",
  );
  const counts = await target.query(
    `select (select count(*) from deposits)::int deposits,(select count(*) from flows where status='settled' or origin_evidence_tx_hash is not null)::int flows,(select count(*) from integration_jobs where kind='deposit_evidence')::int deposit_jobs,(select count(*) from integration_jobs where kind='flow_evidence')::int flow_jobs`,
  );
  assert.equal(counts.rows[0].deposits, counts.rows[0].deposit_jobs);
  assert.equal(counts.rows[0].flows, counts.rows[0].flow_jobs);
  const ids = await target.query(
    "select transfer_kind,count(*)::int rows from deposits group by transfer_kind order by transfer_kind",
  );
  const trigger = await target.query(
    "select tgname,count(*)::int rows from pg_trigger where not tgisinternal and tgname like 'integration_%' group by tgname order by tgname",
  );
  const receipt = {
    recordedAt: new Date().toISOString(),
    source: sourceSummary,
    isolatedTarget: true,
    pendingFlowsAtSnapshot: pending.rows[0].n,
    coreEvidenceUnchanged: true,
    before,
    after,
    nativeIdentityPreflight: true,
    identityKinds: ids.rows,
    backfill: counts.rows[0],
    triggers: trigger.rows,
    migrationSha256: (await import("node:crypto"))
      .createHash("sha256")
      .update(await readFile("drizzle/0009_public_status.sql"))
      .digest("hex"),
  };
  await writeFile(output, JSON.stringify(receipt, null, 2) + "\n");
  console.log(
    JSON.stringify({
      coreEvidenceUnchanged: true,
      nativeIdentityPreflight: true,
      backfill: counts.rows[0],
      pendingFlowsAtSnapshot: pending.rows[0].n,
    }),
  );
} finally {
  await source.end();
  await target.end();
}

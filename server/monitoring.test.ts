import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { PgDialect } from "drizzle-orm/pg-core";
import { monitoringQuery } from "./monitoring";
import type { MonitorRead } from "../src/lib/monitoring";

test("monitoring SQL excludes reorgs, deduplicates senders, preserves amounts and measures canonical outcomes", async () => {
  const db = new PGlite();
  try {
    for (const file of readdirSync(new URL("../drizzle/", import.meta.url))
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      await db.exec(
        readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8"),
      );
    }
    const query = new PgDialect().sqlToQuery(monitoringQuery(7));
    const read = async () =>
      (await db.query<{ data: MonitorRead }>(query.sql, query.params)).rows[0]
        .data;
    const empty = await read();
    assert.equal(empty.totals.renewals, "0");
    assert.equal(empty.daily.length, 7);
    assert.deepEqual(empty.flows, []);
    await db.exec(`
   insert into names (id,normalized_label,display_name,label_hash,namehash,deposit_address,ens_synced_at)
   values ('00000000-0000-0000-0000-000000000001','example','example.eth','hash','namehash','wallet',now());
   insert into chain_events (event_id,event_family,event_type,chain_id,tx_hash,log_index,block_number,block_time,gs_op,canonical,facts)
   values ('d1','deposit','Transfer',84532,'tx1',0,1,now()-interval '5 minutes','c',true,'{}'),
   ('d2','deposit','Transfer',84532,'tx2',0,2,now()-interval '4 minutes','c',true,'{}'),
   ('d3','deposit','Transfer',84532,'tx3',0,3,now(),'c',false,'{}'),
   ('r1','namepass','Renewed',11155111,'tx4',0,4,now(),'c',true,'{"amount_received":"9007199254740993000001","amount_applied":"9007199254740992900001","duration":"12345"}'),
   ('r2','namepass','Renewed',11155111,'tx5',0,5,now(),'c',false,'{"amount_received":"999","amount_applied":"999","duration":"999"}');
   insert into deposits (event_id,name_id,chain_id,token_address,sender_address,amount,tx_hash,log_index,block_number,block_time,source,status)
   select event_id,'00000000-0000-0000-0000-000000000001',chain_id,'usdc',case when event_id='d1' then '0xAbC' else '0xabc' end,1000000,tx_hash,log_index,block_number,block_time,'goldsky','finalized' from chain_events where event_family='deposit';
   insert into flows (name_id,origin_chain_id,trigger,status,amount_detected,deposit_event_id,renewal_event_id)
   values ('00000000-0000-0000-0000-000000000001',84532,'automatic','settled',1000000,'d1','r1');
   insert into flows (name_id,origin_chain_id,trigger,status,amount_detected,waiting_attestation_at,updated_at)
   values ('00000000-0000-0000-0000-000000000001',84532,'automatic','waiting_attestation',1000000,now()-interval '20 minutes',now()),
    ('00000000-0000-0000-0000-000000000001',84532,'automatic','waiting_attestation',1000000,now()-interval '2 hours',now());
  `);
    const data = await read();
    assert.equal(data.totals.depositors, "1");
    assert.equal(data.totals.deposits, "2");
    assert.equal(data.totals.depositVolume, "2000000");
    assert.equal(data.totals.renewals, "1");
    assert.equal(data.totals.received, "9007199254740993000001");
    assert.equal(data.totals.seconds, "12345");
    assert.equal(data.flowCount, "2");
    assert.equal(data.reviewCount, "1");
    assert.equal(data.latency[0].samples, 1);
    assert.ok(Math.abs(data.latency[0].p50 - 300) < 1);
    assert.equal(
      data.daily.reduce((sum, d) => sum + d.renewals, 0),
      1,
    );

    await db.exec(`insert into flows (name_id,origin_chain_id,trigger,status,amount_detected,waiting_attestation_at)
     select '00000000-0000-0000-0000-000000000001',84532,'automatic','waiting_attestation',1000000,now()-interval '2 hours' from generate_series(1,55)`);
    const all = await read();
    assert.equal(all.flowCount, "57");
    assert.equal(all.reviewCount, "56");
    assert.equal(all.flows.length, 50);
    const filtered = new PgDialect().sqlToQuery(monitoringQuery(7, {status: "attention", page: 2, search: "EXAMPLE", chainId: 84532}));
    const page = (await db.query<{data: MonitorRead}>(filtered.sql, filtered.params)).rows[0].data;
    assert.equal(page.matchingFlowCount, "56");
    assert.equal(page.flows.length, 6);
    assert.equal(page.reviewCount, "56");
  } finally {
    await db.close();
  }
});

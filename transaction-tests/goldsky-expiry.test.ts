import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { expect, test, vi } from "vitest";
const state = vi.hoisted(() => ({ database: vi.fn() }));
vi.mock("../server/db/client", () => ({ database: state.database }));
import { ingestGoldskyEvent, postgresGoldskyStore, type GoldskyEvent } from "../server/goldsky";

test("database expiry projection handles last deletion, same-block order, older deletion, and replay", async () => {
 const pg = new PGlite();
 try {
  for (const file of readdirSync(new URL("../drizzle/", import.meta.url)).filter(f => f.endsWith(".sql")).sort()) {
   await pg.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
  }
  state.database.mockReturnValue(drizzle(pg));
  await pg.exec(`insert into names (id,normalized_label,display_name,label_hash,namehash,deposit_address,ens_synced_at)
   values ('00000000-0000-0000-0000-000000000001','alice','alice.eth','hash','node','wallet',now());`);
  const event = (id: string, block: number, logIndex: number, expiry: number, deleted = false): GoldskyEvent => ({
   eventId: id, eventFamily: "ens", eventType: "NameRenewed", chainId: 11155111,
   blockNumber: String(block), blockTime: new Date(1700000000000), txHash: `tx-${id}`, logIndex,
   gsOp: deleted ? "d" : "c", payload: {}, facts: { label: "alice", new_expiry: String(expiry), duration: "100", amount: "1" },
  });
  const apply = (e: GoldskyEvent) => ingestGoldskyEvent(postgresGoldskyStore, e);
  const expiry = async () => (await pg.query<{ expiry: number | null }>("select extract(epoch from current_expiry)::int as expiry from names")).rows[0].expiry;
  // Create the gateway event and linked flow to exercise clearing flow evidence too.
  await pg.exec(`insert into chain_events (event_id,event_family,event_type,chain_id,tx_hash,log_index,block_number,block_time,gs_op,canonical,facts)
   values ('r1','namepass','Renewed',11155111,'tx-e1',2,1,now(),'c',true,'{"label":"alice","duration":"100","amount_applied":"1"}');
   insert into flows (name_id,origin_chain_id,trigger,status,amount_detected,renewal_event_id)
   values ('00000000-0000-0000-0000-000000000001',11155111,'external','settled',1,'r1');`);
  await apply(event("e1", 1, 1, 1800000000));
  expect(await expiry()).toBe(1800000000);
  await apply(event("e1", 1, 1, 1800000000, true));
  expect(await expiry()).toBeNull();
  expect((await pg.query<{ expiry_after: Date | null }>("select expiry_after from flows")).rows[0].expiry_after).toBeNull();
  await apply(event("e1", 1, 1, 1800000000));
  expect(await expiry()).toBe(1800000000);
  expect((await pg.query<{ expiry: number | null }>("select extract(epoch from expiry_after)::int as expiry from flows")).rows[0].expiry).toBe(1800000000);
  await apply(event("e2", 2, 3, 1900000000));
  await apply(event("e3", 2, 7, 2000000000));
  await apply(event("e4", 3, 0, 2100000000));
  await apply(event("e4", 3, 0, 2100000000, true));
  expect(await expiry()).toBe(2000000000);
  await apply(event("e1", 1, 1, 1800000000, true));
  expect(await expiry()).toBe(2000000000);
  await apply(event("e3", 2, 7, 2000000000, true));
  expect(await expiry()).toBe(1900000000);
 } finally { await pg.close(); }
}, 30000);

test("gateway expiry facts clear on deletion, preserve newer renewals, and recover on replay", async () => {
 const pg = new PGlite();
 try {
  for (const file of readdirSync(new URL("../drizzle/", import.meta.url)).filter(f => f.endsWith(".sql")).sort())
   await pg.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
  state.database.mockReturnValue(drizzle(pg));
  await pg.exec(`insert into names (id,normalized_label,display_name,label_hash,namehash,deposit_address,ens_synced_at)
   values ('00000000-0000-0000-0000-000000000001','alice','alice.eth','hash','node','wallet',now());`);
  const event = (id: string, expiry: number, deleted = false): GoldskyEvent => ({
   eventId: id, eventFamily: "namepass", eventType: "Renewed", chainId: 11155111,
   blockNumber: String(expiry), blockTime: new Date(1700000000000), txHash: `tx-${id}`, logIndex: 1,
   gsOp: deleted ? "d" : "c", payload: {}, facts: { label: "alice", label_hash: "hash", wallet_address: "wallet", new_expiry: String(expiry), duration: "100", amount_received: "1000000", amount_applied: "900000", gas_allowance: "100000", remainder: "0", from_cctp: "false" },
  });
  const apply = (e: GoldskyEvent) => ingestGoldskyEvent(postgresGoldskyStore, e);
  const expiry = async () => (await pg.query<{ expiry: number | null }>("select extract(epoch from current_expiry)::int as expiry from names")).rows[0].expiry;
  await apply(event("r1", 1800000000));
  expect(await expiry()).toBe(1800000000);
  await apply(event("r1", 1800000000, true));
  expect(await expiry()).toBeNull();
  expect((await pg.query<{ expiry_after: Date | null }>("select expiry_after from flows where renewal_event_id='r1'")).rows[0].expiry_after).toBeNull();
  await apply(event("r1", 1800000000));
  expect(await expiry()).toBe(1800000000);
  await apply(event("r2", 1900000000));
  await apply(event("r1", 1800000000, true));
  expect(await expiry()).toBe(1900000000);
  await apply(event("r1", 1800000000));
  await apply(event("r2", 1900000000, true));
  expect(await expiry()).toBe(1800000000);
 } finally { await pg.close(); }
}, 30000);

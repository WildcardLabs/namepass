// One-shot cutover operation. Credentials must stay outside the repository.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import pg from 'pg';
const [urlPath, reportPath] = process.argv.slice(2);
assert(urlPath && reportPath, 'Usage: reset-testnet.mjs PRIVATE_URL_FILE REPORT');
const connectionString = fs.readFileSync(urlPath, 'utf8').trim();
assert.equal(new URL(connectionString).hostname, 'ep-winter-dream-av1w9cdt.c-11.us-east-1.aws.neon.tech');
const tables = ['public.transaction_intents','public.flow_transitions','public.flows','public.deposits','public.chain_events','public.balance_scan_requests','public.balance_snapshots','public.relayer_nonces','goldsky.watched_addresses','public.names'];
const client = new pg.Client({connectionString});
await client.connect();
try {
 await client.query('BEGIN');
 await client.query(`LOCK TABLE ${tables.join(', ')} IN ACCESS EXCLUSIVE MODE`);
 const intents = (await client.query('select status,count(*) from transaction_intents group by status')).rows;
 assert(intents.every(r => ['confirmed','reverted'].includes(r.status)), 'Unreconciled transaction intents remain');
 const flows = (await client.query('select status,count(*) from flows group by status')).rows;
 assert(flows.every(r => ['settled','cancelled','held','empty_wallet'].includes(r.status)), 'Active flows remain');
 const before = {};
 for (const table of tables) before[table] = Number((await client.query(`select count(*) from ${table}`)).rows[0].count);
 await client.query(`TRUNCATE TABLE ${tables.join(', ')}`);
 for (const table of tables) assert.equal(Number((await client.query(`select count(*) from ${table}`)).rows[0].count),0);
 await client.query('COMMIT');
 fs.writeFileSync(reportPath,JSON.stringify({resetAt:new Date().toISOString(),project:'nameless-paper-91018372',branch:'br-noisy-bird-avey45an',before,intents,flows,allTablesEmpty:true,preserved:'schema, migrations, roles'},null,2)+'\n');
 console.log('Testnet reset committed; all ten tables are empty.');
} catch (e) {await client.query('ROLLBACK');throw e;} finally {await client.end();}

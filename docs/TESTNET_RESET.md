# Clean testnet reset

The user authorized clearing all current data, flows, and deposit addresses on 2026-09-18.
This replaces the legacy data migration in the initial contract plan. No reset has run yet.

Execute the reset at cutover, after the new contracts are verified and replacement service code
is ready. Do not keep old names, activity, flows, or address rows in the new application. Keep the
database schema, migration journal, roles, and service infrastructure unless their replacement is
required. Blockchain contracts and transactions cannot be deleted by this reset.

## Stop old writers

1. Identify the stable-testnet Neon branch, Vercel deployment, and Goldsky pipeline from RUNBOOK.md.
   Verify the actual connection target. Do not use the separate mainnet production database.
2. Disable funding, activation, manual triggers, CCIP-Read activation, and recovery entrypoints.
3. Stop the old Goldsky pipeline and its delivery retries.
4. Stop or cancel all old durable workflow runs. Confirm that none can resume after deletion.
5. Reconcile already signed or broadcast transactions before discarding their records. They can
   still be mined after a workflow stops. Start the new relayer queue from the chain's current
   nonce state, never from zero. Do not rebroadcast old intents after reset.
6. Remove old deployment access to the live writer role or replace its credentials. Ensure that
   old webhook deliveries cannot authenticate against the replacement deployment.

## Clear application records

Clear these tables in one transaction, with all writers stopped:

| Schema | Tables |
|---|---|
| `public` | `transaction_intents`, `flow_transitions`, `flows`, `deposits`, `chain_events`, `balance_scan_requests`, `balance_snapshots`, `relayer_nonces`, `names` |
| `goldsky` | `watched_addresses` |

Use an explicit table list. Do not use an unrestricted schema drop or `CASCADE`. Preserve the
schema migration journal. Verify zero rows in every listed table before enabling any writer.
This clears saved addresses, normalized facts, raw event payloads, flow history, totals, balances,
nonce reservations, signed transaction data, and the address watch list.

Clear old durable workflow state and any replayable webhook delivery data in their own services.
Discard the old pipeline checkpoints and datasets that would replay the old generation. Use new
source identities and deployment start blocks. Do not backfill old contracts or old wallets.

## Start the new generation

1. Replace the current factory and helper configuration with the verified factory, gateway, and
   pointer. Replace ENS addresses, resolver assumptions, deployment blocks, and derivation fixtures.
2. Deploy the replacement APIs and workflows against the empty database. Rotate webhook delivery
   credentials as needed to reject queued requests from the retired pipeline.
3. Start the new pipeline with an empty address watch list and the new contract start blocks.
4. Clear application configuration and response caches. Show no old activity or saved address.
5. Activate one test name. Verify the new deposit address against each factory before funding.
6. Run a direct renewal and one canary for every supported source chain. Confirm that each payment
   appears once and that only new-generation addresses enter the watch list.
7. Enable normal activation, triggers, and recovery. Confirm that old workflows and indexer retries
   cannot recreate deleted data.

Record the reset time, verified targets, new deployment manifest, empty-table checks, new source
checkpoints, and canary receipts. Do not copy old operational records into the new database.

# Namepass operations runbook

This runbook records the commands and role ownership for the stable testnet and production
environments. Do not put secret values or personal names in this file. A verified resource does
not prove that its Phase 0 gate is complete.

## Role ownership

| Responsibility | Owner role |
|---|---|
| Provider billing and plan changes | Project owner |
| Vercel project and environment variables | Application operator |
| Neon branches, migrations, and restore drills | Database operator |
| Goldsky pipelines, datasets, and secrets | Indexing operator |
| Relayer keys, gas balance, and replacement transactions | Relayer operator |
| Release gates and canary evidence | Release operator |

The private operator record must name one primary operator and one backup operator for each role.

## Verified resources

| Resource | Current value | Status |
|---|---|---|
| GitHub repository | `stevegachau/namepass-v2` | Verified |
| Vercel project | `wildcard-labs/namepass-v2` | Verified |
| Stable testnet origin | `https://demo-five-gray-37.vercel.app` | Verified |
| Neon project | `Namepass` (`nameless-paper-91018372`) | Verified |
| Neon production branch | `production` (`br-bitter-leaf-avog4zs6`) | Verified |
| Neon stable testnet branch | `testnet` (`br-noisy-bird-avey45an`) | Created and verified |
| Neon stable testnet migration | `f0316ff61d800f0e904d327c43bf6794f9eca508adc59c33e2ce7fd5065cfbbe` | Applied 2026-08-17 |
| Neon testnet roles | `namepass_migrator`, `namepass_app`, `goldsky_reader` | Created and verified |
| Vercel server environment variables | Stable testnet values | Configured 2026-08-17 |
| Vercel production deployment | `dpl_2PJqoLujWrk1HEBosJE1AJH98Aun` | Ready 2026-08-17 |
| Vercel Firewall rules | Not created | Project-owner permission required |
| Goldsky project | `Namepass` (`project_cmshghhiu0ign01u4b8gm0kqm`) | Active and verified |
| Goldsky stable testnet plan | Starter | Selected; free allowance covers `namepass-testnet` |
| Goldsky stable testnet pipeline | `namepass-testnet` | Running 2026-08-17 |
| Stable-testnet automated renewal | Managed-service path | Verified end to end |

## Phase 0 checks

The server configuration defines `500_000` USDC base units as the $0.50 floor for each stable
testnet chain. The configuration has local tests. It does not prove that the stable-testnet
environment exists or that the workflow can spend funds.

### Vercel

```bash
vercel whoami
vercel link --yes --project namepass-v2 --scope wildcard-labs
vercel project inspect namepass-v2 --scope wildcard-labs
vercel env ls --scope wildcard-labs
```

The stable deployment has the database, RPC, relayer, cron, Circle, deployment-environment, and
Goldsky webhook variables. `.env.example` lists the required value-free variable names.

Use test-only values for preview and stable testnet. Put production values in the production
environment only. Do not expose a server secret through a `VITE_*` variable. In particular, keep
a relayer key, a database URL, and the webhook secret out of preview unless the value is test-only.

Before stable-testnet funding, add Vercel Firewall rate limits for these public API endpoints:

- `POST /api/names/activate`: 10 requests per minute for one source IP.
- `POST /api/flows/trigger`: 20 requests per minute for one source IP.
- `POST /api/ccip` and `GET /api/ccip/*` (the CCIP-Read gateway): 30 requests per minute for one
  source IP. A resolution enrols a new label for tracking on first sight, so this is a public
  write path. A known name takes the fast path and does not write.
- `GET /api/names/[label]`: 120 requests per minute for one source IP. One active name polls 15
  times per minute. The limit gives that polling rate eight times the required capacity.

These are conservative initial limits for human actions. Change them only after measured legitimate
traffic shows that they block ordinary use or do not control provider cost. Stage each new rule in
log mode. Review the matched traffic before the rule returns `429` responses.

Do not apply these rules to the Goldsky webhook or cron endpoints. Verify that an excess request is
blocked and that ordinary activation and retry requests still pass. Record the rule IDs and the
test time in the private operator record.

### Neon

Use a pooled URL for application traffic. Use a direct URL for migrations and the Goldsky reader.
Apply migrations to the stable `testnet` branch before production:

```bash
npx tsx server/db/migrate.ts
```

Use two release points for the exact flow-identity change. Do not let the migration runner see
`0007_exact_cctp_identity.sql` during the first release.

- Release 1 target commit: `1f6f88a`.
- Release 2 migration target: `ceacbd0`.

Commit `1f6f88a` is the last commit without migration `0007`. Commit `2041990` adds migration
`0007`. Commit `ceacbd0` adds the guarded repair for the historical split-evidence row.

Release 1:

1. Apply `0006_transaction_identity_support.sql` with `DATABASE_URL_UNPOOLED`.
2. Deploy the release-1 application commit. It writes exact origin event and message-index fields.
3. Keep recovery active until existing workflows finish. Settled workflows clear their run owner.
   The runtime merge resolves safe source and bare-external duplicate pairs.

Release 2:

1. Stop new deposits and manual triggers. Pause Goldsky delivery and `/api/cron/recover`.
2. Confirm that every remaining duplicate Circle group has no unresolved transaction intent. A
   non-null `workflow_run_id` normally stops the migration. The split-evidence repair is the only
   exception. Confirm that its canonical settled Workflow run is complete before you continue.
3. Create a Neon restore point or branch.
4. Apply `0007_exact_cctp_identity.sql`. It locks the affected tables for its transaction.
5. Stop if the migration reports an ambiguous origin event, conflicting duplicate evidence, a live
   workflow, or an unresolved transaction. Investigate that exact row. Do not rank or delete rows.
6. Deploy the release-2 commit.
7. Verify one owner for each non-null `origin_event_id` and `(origin_chain_id, cctp_nonce)`. Verify
   that each repaired loser has `duplicate_flow_repaired` and points to its canonical flow.
8. Resume Goldsky delivery, replay the paused range, resume recovery, and then allow new deposits.

Migration `0006` adds nullable exact identity fields and safely backfills only one-to-one origin
event matches. Migration `0007` supports two guarded repair shapes. The normal shape has one
evidence-rich source row and one bare external settlement row. The historical split shape has one
completed automatic row with deposit and settlement evidence and one external row with the exact
origin event. Both rows must contain the same Circle message and attestation. The deposit event,
origin transaction, claim transaction, exact preceding `CCTPClaimed` event, `Renewed` event, and
renewal accounting must all agree. The migration aborts the complete transaction for every other
shape. The full Circle identity index includes cancelled rows. A cancelled loser must release its
nonce before the canonical row receives it.

For the 2026-08-18 explorer repair, use this release order:

1. Apply `0001_flow_expiry_after.sql`.
2. Deploy the API and workflow code.
3. Call `/api/cron/recover` until `resumableFlows` is zero. This reconciles old cancelled flows
   that still have successful transaction intents.
4. Replay the Goldsky raw-log source from a block before the earliest missing renewal. Do this with
   a bounded provider replay or a temporary backfill pipeline. Do not insert `chain_events` by hand.
5. Confirm that every successful Namepass receipt has one canonical `Renewed` row and one
   `NameRenewed` row. Then confirm the global activity feed, per-name totals, and expiry values.

The workflow recovery repairs flow state. The Goldsky replay repairs canonical history and
aggregates. Both steps are required for renewals that settled before the pipeline started at
`latest`.

For an isolated local or preview branch, load the deterministic preview records after the
migration:

```bash
VERCEL_ENV=preview npx tsx server/db/preview-fixtures.ts
```

The fixture command rejects `VERCEL_ENV=production`. Do not run it against the production branch
or the shared stable testnet branch.

Set `DATABASE_URL_UNPOOLED` in the private terminal before either command. Do not put that
administrator connection string in a preview deployment environment or in a repository file.

Create the migration role first. It owns schema changes. After the migration succeeds, create the
application role with only the table privileges that the API needs. Then create `goldsky_reader`,
after the migration creates `goldsky.watched_addresses`.

The stable `testnet` branch completed this setup on 2026-08-17. The resource table shows the
committed migration hash. `namepass_migrator` owns all application tables and the Drizzle migration
journal. `namepass_app` can read and write application tables. It cannot create database or schema
objects. It cannot access the Drizzle schema. `goldsky_reader` cannot access public application
tables. It cannot write `goldsky.watched_addresses`.

Create runtime roles with SQL, not `neon roles create`. The Neon role API grants its managed
`neon_superuser` membership to a new role. After SQL creates a runtime role, reset its password
through the Neon Console or API. This registers the password with the Neon proxy without adding
the managed membership.

Give `goldsky_reader` only these privileges:

- `CONNECT` on the database.
- `USAGE` on the `goldsky` schema.
- `SELECT` on `goldsky.watched_addresses`.

Do not give it application-table write access. Use a direct Neon connection string with
`sslmode=require`. Store that string only in Goldsky Secrets. The application receives the pooled
`DATABASE_URL` only.

### Goldsky

Use Goldsky Starter for stable testnet. Its free allowance covers the one continuously active small
`namepass-testnet` pipeline, which reads all four testnet chains. Do not require Scale for Phase 0
or stable-testnet setup. Decide on Scale at production launch, and use it only if
`namepass-testnet` and `namepass-mainnet` must run concurrently.

Install and authenticate the CLI in a private terminal:

```bash
curl https://goldsky.com | sh
goldsky login
goldsky project list
```

Do not paste a Goldsky token into a chat or repository file. Verify each dataset and version before
deployment:

```bash
goldsky dataset get <dataset-name> --outputFormat json
goldsky turbo validate goldsky/namepass-testnet.yaml
goldsky turbo apply goldsky/namepass-testnet.yaml
```

The eight datasets matched the committed names, versions, and fields on 2026-08-17. The pipeline
passed validation. The stable webhook returned an authorized `200`. Goldsky then applied the
pipeline. Its current resource size is `s`, and its state is `Running`.

The first live definition included global Circle `MessageSent` events. CCTP v2 puts a zero nonce
placeholder in that on-chain event and assigns the final nonce off chain. The corrected definition
does not index Circle events. The workflow gets the final message, nonce, and attestation from
Iris. The raw-log sources now contain only Namepass addresses and the two Ethereum ENS renewers.
The ENS transform requires the Namepass referrer from the shared chain registry.

The testnet pipeline target is
`https://demo-five-gray-37.vercel.app/api/webhooks/goldsky`. Store the authorization header in a
Goldsky `httpauth` secret and store the matching verification value as
`GOLDSKY_WEBHOOK_SECRET` in Vercel. Store the direct `goldsky_reader` Neon URL only as a Goldsky
secret. Do not target a preview URL.

### Relayer

Configure one test-only account in `RELAYER_PRIVATE_KEY`. Do not use this account from a wallet,
script, deployment tool, or another service. Namepass must have exclusive nonce ownership. Fund and
monitor the same address on every active chain. The external address alert must notify the operator.
Do not poll balances from the application when no transaction is running.

Before deployment, confirm that no deployed version created an unresolved intent from an old pool
address. This branch was not deployed, so the normal release has no pool drain. If such an intent
exists in another environment, keep its key available until the exact intent gets a receipt. Do not
move a pending nonce to the new sender.

## Operations

Vercel calls these authenticated endpoints. `CRON_SECRET` must be present only in the applicable
Vercel environment. The endpoint responses do not return a key, URL, relayer address, native
balance, raw Goldsky payload, or signed transaction.

| Endpoint | Schedule | Action |
|---|---|---|
| `/api/cron/recover` | Every minute | Restarts safe unowned work, scans activation failures, and monitors the lowest transaction nonce in each sender and chain queue. |
| `/api/cron/retention` | Daily at 03:17 UTC | Clears at most 500 expired raw payloads. It keeps normalized chain-event data. |

The recovery job has a transaction-scoped PostgreSQL advisory lock. It takes at most 10 rows from
each recovery category. It checks stale workflow IDs through Vercel Workflow. It restarts any
resumable workflow stage. It separately drains any durable signed intent without reopening a
cancelled or failed flow. It does not poll terminal `empty_wallet` history. A new Goldsky deposit or an explicit
manual trigger supplies new balance evidence. It restarts a flow only when the stored run is
missing or terminal. It does not replace a pending or running Workflow run. The CCTP workflow owns
its active Iris polling.

### Pending transaction replacement

The service emits a structured warning after 30 seconds. It automatically replaces a transaction
that remains pending or rejected for three minutes. The
replacement keeps the sender, chain, nonce, destination, value, call data, and gas limit, and raises
both EIP-1559 fee fields. An insufficient-funds rejection retries the same bytes after funding; a
higher fee cannot repair it. The workflow checks every stored attempt for the current nonce because
an older same-nonce attempt can be mined after a replacement is broadcast.

The service does not create cancellation transactions. If a signed call becomes obsolete, recovery
keeps its original business bytes until a success or revert receipt exists. Terminal flow guards
prevent the receipt from reopening canonical state. Do not free the queue by editing an intent
status because that can leave a nonce gap.

Only the lowest unresolved nonce in a sender and chain queue can be replaced. A `nonce too low`
response causes a receipt check across every stored attempt before another broadcast. One unresolved
nonce blocks later transactions from that sender on that chain. If a
transaction remains pending after repeated automatic replacements:

1. Stop new stable-testnet funding and pause the recovery cron.
2. Check every stored attempt through two RPC providers. Confirm whether any attempt has a receipt
   and whether the relayer's latest nonce has passed the intent nonce.
3. Confirm the relayer has enough native gas for the replacement's maximum cost.
4. Do not send a transaction with a later nonce as a repair. Do not edit the intent or flow rows by
   hand.
5. If no attempt is mined and the nonce is still pending, prepare a reviewed same-nonce replacement
   with higher fees. Store the new attempt before broadcast.
6. If the account nonce was consumed by an unknown transaction, treat the relayer key as an
   integrity incident. Keep the service paused until the transaction and key use are explained.
7. Confirm the receipt and expected contract events, then restore recovery and funding.

### Platform monitoring page

Use `/monitoring` for the read-only usage and flow dashboard. Use its manual gas check to inspect
current balances. This does not replace external balance alerts. Review
[metric definitions and coverage](MONITORING.md) before interpreting a review flag or a missing
provider signal. This feature needs the existing database and RPC configuration, with no migration.

### Dashboards and alerts

Configure provider alerts before stable-testnet use:

- Vercel: Function `5xx` rate, cron failures, and Workflow failures.
- Vercel: any structured warning with `event = goldsky.rejected_payload`.
- Goldsky: pipeline failure, source lag, and webhook backpressure.
- Neon: connection saturation, query latency, storage, and restore availability.
- Relayer: an external native-balance alert for the exclusive address on every active chain.

Provider dashboards and alert delivery remain external runtime gates. An alert without a tested
notification destination is not monitoring.

### Rejected Goldsky payload

An authenticated payload that fails validation returns `200`. This keeps later rows moving. The
Vercel warning contains the event ID when safe, chain ID, source block, validation error, receipt
time, and SHA-256 payload hash. It does not contain the raw payload or authorization header.

Before deployment, configure and test delivery of this warning to the on-call operator. Retain
these structured warning fields for at least 30 days in the approved operational log destination.
Limit access to operators and project administrators. Expire the warning evidence after 30 days
unless an active incident requires longer retention. Do not export request bodies, authorization
headers, or environment variables. Record the tested destination and retention setting in the
release evidence. Until delivery and retention are verified, issue #71 remains open.

`payloadHash` is SHA-256 of the exact request bytes. `payloadHashScope = complete_body` identifies
a complete request. Oversized bodies are cancelled after the 8 KiB limit; their scope is
`first_8192_bytes`, and the hash covers that prefix only. These authenticated rows are acknowledged
and skipped, with no database write. Malformed JSON and unknown fields use the same rejection
path. Unauthorized requests still return 401 before their body is read. A transport failure while
reading the body remains retryable and is not acknowledged as a rejected payload.

When the alert fires:

1. Save the warning fields and inspect the Goldsky row at that receipt time. Confirm the chain,
   block, event ID, and payload hash (using its recorded scope). Do not paste the raw payload or secrets into an issue.
2. Fix and deploy the parser or pipeline mismatch. Test the rejected event shape locally.
3. Copy the affected source, transform, and webhook sink to a temporary backfill pipeline. Use the
   same pinned dataset version. Set `start_at: earliest`, set `end_block` to the rejected block, and
   add a source filter that starts and ends at that block. Keep the existing address filters.
4. On Starter, pause `namepass-testnet`, validate and apply the temporary pipeline, and wait until
   that bounded row reaches the stable webhook. Do not run two pipelines at the same time.
5. Confirm the expected canonical `chain_events` row and domain state in Neon. Duplicate delivery
   is safe because the event ID and on-chain position are unique.
6. Delete the temporary pipeline and resume `namepass-testnet`. Confirm that source lag returns to
   normal and that no new rejection warning appears.

Do not use `restart --clear-state` for this repair. Deposit sources use `start_at: latest`, so a
checkpoint reset does not reliably replay an old deposit. Do not insert a `chain_events` row by
hand.

### Recovery drills

Run all drills on the stable testnet environment first. Do not edit production rows by hand.

1. **Queued flow:** create a testnet eligible deposit. Stop a Workflow start after the flow is
   queued. Call the recovery endpoint. Confirm that one workflow starts and that the same flow ID
   settles. Repeat with a missing or terminal real run ID. Confirm that recovery replaces it.
   Repeat with a pending run ID. Confirm that recovery does not start a second run.
2. **Stored transaction:** use a testnet flow that has signed bytes but no broadcast time. Call the
   recovery endpoint. Confirm that the stored transaction hash is broadcast. Confirm the receipt
   before a flow becomes settled.
   Repeat with a successful receipt whose flow row says `cancelled`. Confirm that recovery records
   the intent receipt but does not reopen the terminal flow.
3. **Iris outage:** cause Iris to return a retryable response in a test environment. Confirm that
   the active workflow backs off. Confirm that the recovery job does not start another active run.
   When the flow becomes `unclaimed`, confirm that its due retry resumes the same Circle message.
4. **Activation scan:** make one testnet RPC unavailable during activation. Restore it and call the
   recovery endpoint. Confirm that only the recorded chain is read and then removed from
   `unscanned_chain_ids`.
5. **Stopped deposit:** use an eligible canonical deposit and stop its Workflow run before an
   origin transaction exists. Confirm that the public name response shows `empty_wallet`, the
   deposit transaction, and a retry. Call the recovery endpoint. Confirm that it checks the live
   balance, replaces only a missing or terminal Workflow owner, and settles the same flow ID.
   Repeat with two deposits. Confirm that activity reports multiple deposits instead of one sender.
6. **Neon restore:** create a disposable Neon branch from the required restore point. Apply the
   migration and fixtures there. Verify row counts, one canonical event, one flow, and one
   transaction intent. Do not point Vercel or Goldsky at the restored branch. The database operator
   records the result and deletes the drill branch after review.

For an authenticated manual drill call, use a private terminal with the environment value already
loaded. Do not paste it into chat or a repository file:

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<stable-domain>/api/cron/recover
```

### Local verification

```bash
npm install
npm run build
npm run check:server
npm run test:frontend
npm run test:server
npm run test:transactions
npm run test:workflow
node scripts/check-chains.mjs
node goldsky/generate-testnet.mjs --check
npx drizzle-kit check --config drizzle.config.ts
forge test
```

Install the ignored Foundry test dependency when `lib/forge-std` is missing:

```bash
forge install foundry-rs/forge-std --no-git
```

## External gates

The project owner must confirm Vercel Pro and Neon Launch before production purchase or deployment.
Goldsky Starter needs no purchase for stable testnet. At production launch, decide whether
`namepass-testnet` and `namepass-mainnet` must run concurrently. Require Goldsky Scale only if they
must. Provider names, prices, and limits can change. Verify them again before purchase.

Phase 0 is complete only when the $0.50 trigger floor is configured on each stable-testnet chain,
all required CLIs authenticate, the stable testnet environments exist, the least-privilege roles
exist, the test relayer has gas, exact Goldsky datasets and versions are verified, and no
production credential is available to a preview deployment.

## Phase 8 mainnet launch

Do not change `ACTIVE_ENVIRONMENT` or `MAINNET_LAUNCH_APPROVED` until every item in this section
has recorded evidence. The current registry is deliberately testnet-only. Ethereum, Base, and
Arbitrum mainnet rows contain only Circle public data. They do not contain a Namepass factory,
helper, or ENS deployment. Arc has no mainnet row and is excluded from this launch.

Before the reviewed public-configuration change:

1. Complete an independent contract audit.
2. Deploy the mainnet contracts and verify the source, creation hash, configuration, and owner.
3. Record the verified addresses and transaction hashes in `docs/DEPLOYMENTS.md`.
4. Validate the mainnet Goldsky pipeline and its dataset versions.
5. Set production-only Vercel, Neon, Goldsky, RPC, relayer, and cron values. Do not put them in a
   preview environment.
6. Run one low-value canary on each launch chain.
7. Attach the evidence below to the release PR before one reviewed change activates mainnet.

| Canary evidence | Ethereum | Base | Arbitrum |
|---|---|---|---|
| Deposit | Deposit address, sender transaction, final block | Deposit address, sender transaction, final block | Deposit address, sender transaction, final block |
| Flow | API flow ID and canonical Goldsky event ID | API flow ID and canonical Goldsky event ID | API flow ID and canonical Goldsky event ID |
| Circle | Not applicable | Burn, Iris attestation, and Ethereum claim | Burn, Iris attestation, and Ethereum claim |
| Helper | `DepositProcessed` and `Renewed` receipt logs | Ethereum claim `CCTPClaimed` and `Renewed` receipt logs | Ethereum claim `CCTPClaimed` and `Renewed` receipt logs |
| ENS | Exact name expiry before and after renewal | Exact name expiry before and after renewal | Exact name expiry before and after renewal |
| API | Name, activity, flow, and stats responses match receipts | Name, activity, flow, and stats responses match receipts | Name, activity, flow, and stats responses match receipts |
| Frontend | The public screen shows the same chain, amount, state, and transactions | The public screen shows the same chain, amount, state, and transactions | The public screen shows the same chain, amount, state, and transactions |

Store the evidence in the release PR or its linked private operator record. Do not store secrets in
the repository. Re-run `node scripts/check-chains.mjs` after the reviewed change. That check must
change with the launch gate so it verifies the audited deployment set instead of the current
testnet-only state.

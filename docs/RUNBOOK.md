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

One test-only relayer account exists. Its private key is in the stable testnet Vercel environment.
It has executed the verified stable-testnet automation path. Do not use this account outside
Namepass. Monitor its native balance on Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia, and Arc
Testnet with an external address alert that notifies the operator. Do not poll balances from the
application when no transaction is running.

## Operations

Vercel calls these authenticated endpoints. `CRON_SECRET` must be present only in the applicable
Vercel environment. The endpoint responses do not return a key, URL, relayer address, native
balance, raw Goldsky payload, or signed transaction.

| Endpoint | Schedule | Action |
|---|---|---|
| `/api/cron/recover` | Every minute | Restarts safe unowned work, scans recorded activation failures, and rebroadcasts prepared transaction bytes. |
| `/api/cron/retention` | Daily at 03:17 UTC | Clears at most 500 expired raw payloads. It keeps normalized chain-event data. |

The recovery job has a transaction-scoped PostgreSQL advisory lock. It takes at most 10 rows from
each recovery category. It checks stale workflow IDs through Vercel Workflow. It restarts any
resumable workflow stage and reconciles a cancelled row that still owns a non-reverted transaction
intent. It does not poll terminal `empty_wallet` history. A new Goldsky deposit or an explicit
manual trigger supplies new balance evidence. It restarts a flow only when the stored run is
missing or terminal. It does not replace a pending or running Workflow run. The CCTP workflow owns
its active Iris polling.

### Pending transaction replacement

The testnet service does not automatically replace a pending transaction with a higher-fee
transaction. A pending transaction can block later nonces on the same chain.

If this happens on stable testnet:

1. Stop new stable-testnet funding and pause the recovery cron.
2. Confirm through two RPC providers that the stored transaction has no receipt and that its nonce
   is still pending for the configured relayer.
3. Do not send a transaction with a different nonce. Do not edit the intent or flow rows by hand.
4. Prepare a reviewed hotfix that signs the same chain ID, sender, nonce, destination, value, and
   call data with sufficient replacement fees. The hotfix must store the new signed bytes, hash,
   fees, and attempt before it broadcasts them.
5. Deploy the hotfix to stable testnet. Confirm the replacement receipt and the expected contract
   events. Then restore the recovery cron and funding.

Production remains blocked until the repository has an automated same-nonce replacement path and
a test that proves it cannot change the transaction intent.

### Dashboards and alerts

Configure provider alerts before stable-testnet use:

- Vercel: Function `5xx` rate, cron failures, and Workflow failures.
- Goldsky: pipeline failure, source lag, and webhook backpressure.
- Neon: connection saturation, query latency, storage, and restore availability.
- Relayer: an external native-balance alert for the configured address on every active chain.

Provider dashboards and alert delivery remain external runtime gates. An alert without a tested
notification destination is not monitoring.

### Recovery drills

Run all drills on the stable testnet environment first. Do not edit production rows by hand.

1. **Queued flow:** create a testnet eligible deposit. Stop a Workflow start after the flow is
   queued. Call the recovery endpoint. Confirm that one workflow starts and that the same flow ID
   settles. Repeat with a missing or terminal real run ID. Confirm that recovery replaces it.
   Repeat with a pending run ID. Confirm that recovery does not start a second run.
2. **Stored transaction:** use a testnet flow that has signed bytes but no broadcast time. Call the
   recovery endpoint. Confirm that the stored transaction hash is broadcast. Confirm the receipt
   before a flow becomes settled.
   Repeat with a successful receipt whose flow row says `cancelled`. Confirm that recovery checks
   the stored receipt instead of the now-empty deposit wallet and changes the same row to `settled`.
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

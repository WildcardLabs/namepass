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
| Neon stable testnet migration | Not applied | Operator action required |
| Neon least-privilege roles | Not created | Operator action required |
| Vercel server environment variables | None | Incomplete |
| Vercel Firewall rules | Not created | Project-owner permission required |
| Goldsky project | Not selected | Operator action required |
| Goldsky stable testnet plan | Starter | Selected; free allowance covers `namepass-testnet` |

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

The project currently has no server environment variables. This does not meet the stable-testnet
environment gate. `.env.example` lists the required value-free variable names.

Use test-only values for preview and stable testnet. Put production values in the production
environment only. Do not expose a server secret through a `VITE_*` variable. In particular, keep
a relayer key, a database URL, and the webhook secret out of preview unless the value is test-only.

Before stable-testnet funding, add Vercel Firewall rate limits for these public API endpoints:

- `POST /api/names/activate`: 10 requests per minute for one source IP.
- `POST /api/flows/trigger`: 20 requests per minute for one source IP.
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

Run `apply` only after validation succeeds and the stable webhook returns an authorized `2xx`
response. The current origin does not prove that this receiver is deployed.

The testnet pipeline target is
`https://demo-five-gray-37.vercel.app/api/webhooks/goldsky`. Store the authorization header in a
Goldsky `httpauth` secret and store the matching verification value as
`GOLDSKY_WEBHOOK_SECRET` in Vercel. Store the direct `goldsky_reader` Neon URL only as a Goldsky
secret. Do not target a preview URL.

### Relayer

Create one test-only relayer account. Store its private key only in the stable testnet Vercel
environment. Fund its address with native test gas on Ethereum Sepolia, Base Sepolia, Arbitrum
Sepolia, and Arc Testnet. Do not use this account outside Namepass. This step is incomplete while
the Vercel project has no server variables.

## Operations

Vercel calls these authenticated endpoints. `CRON_SECRET` must be present only in the applicable
Vercel environment. The endpoint responses do not return a key, URL, relayer address, native
balance, raw Goldsky payload, or signed transaction.

| Endpoint | Schedule | Action |
|---|---|---|
| `/api/cron/recover` | Every minute | Restarts safe unowned work, scans recorded activation failures, and rebroadcasts prepared transaction bytes. |
| `/api/cron/health` | Every 5 minutes | Checks Neon, each RPC chain ID, and relayer gas status. |
| `/api/cron/retention` | Daily at 03:17 UTC | Clears at most 500 expired raw payloads. It keeps normalized chain-event data. |

The recovery job has a transaction-scoped PostgreSQL advisory lock. It takes at most 10 rows from
each recovery category. It checks stale workflow IDs through Vercel Workflow. It restarts a flow
only when the stored run is missing or terminal. It does not replace a pending or running
Workflow run. The CCTP workflow owns its active Iris polling.

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

### Relayer gas thresholds

Set one `RELAYER_TRANSACTION_UNIT_WEI_<CHAIN>` value for every active chain. The value is two times
the greater of the tested maximum transaction gas cost and the observed seven-day 95th-percentile
cost. Use native-token wei. Do not estimate this value from the USDC allowance.

| Status | Threshold | Operator action |
|---|---:|---|
| Warning | At or below 20 units | Relayer operator checks the next funding window. |
| Critical | At or below 5 units | Relayer operator asks the project owner for a manual refill. |
| Refill target | 50 units | Project owner funds the relayer manually. |

There is no automatic refill signer. The private operator record identifies the primary and backup
relayer operators. Recalculate units after a material gas-price or transaction-shape change.

### Dashboards and alerts

Configure provider alerts before stable-testnet use:

- Vercel: Function `5xx` rate, cron failures, and Workflow failures.
- Goldsky: pipeline failure, source lag, and webhook backpressure.
- Neon: connection saturation, query latency, storage, and restore availability.
- Operations health: a non-`ok` relayer gas result, unavailable database, or unavailable RPC.

The repository provides the checked status endpoint and structured logs. Provider dashboards and
alert delivery remain external runtime gates. The health endpoint returns `503` for a critical or
unavailable check. It returns `200` for a warning, so alert rules must also inspect its structured
logs.

### Recovery drills

Run all drills on the stable testnet environment first. Do not edit production rows by hand.

1. **Queued flow:** create a testnet eligible deposit. Stop a Workflow start after the flow is
   queued. Call the recovery endpoint. Confirm that one workflow starts and that the same flow ID
   settles. Repeat with a missing or terminal real run ID. Confirm that recovery replaces it.
   Repeat with a pending run ID. Confirm that recovery does not start a second run.
2. **Stored transaction:** use a testnet flow that has signed bytes but no broadcast time. Call the
   recovery endpoint. Confirm that the stored transaction hash is broadcast. Confirm the receipt
   before a flow becomes settled.
3. **Iris outage:** cause Iris to return a retryable response in a test environment. Confirm that
   the active workflow backs off. Confirm that the recovery job does not start another active run.
   When the flow becomes `unclaimed`, confirm that its due retry resumes the same Circle message.
4. **Activation scan:** make one testnet RPC unavailable during activation. Restore it and call the
   recovery endpoint. Confirm that only the recorded chain is read and then removed from
   `unscanned_chain_ids`.
5. **Neon restore:** create a disposable Neon branch from the required restore point. Apply the
   migration and fixtures there. Verify row counts, one canonical event, one flow, and one
   transaction intent. Do not point Vercel or Goldsky at the restored branch. The database operator
   records the result and deletes the drill branch after review.

For an authenticated manual drill call, use a private terminal with the environment value already
loaded. Do not paste it into chat or a repository file:

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<stable-domain>/api/cron/recover
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<stable-domain>/api/cron/health
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

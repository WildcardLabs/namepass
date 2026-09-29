# Operations

Operational reference for a Namepass deployment. Account IDs, credentials, billing records and
operator handovers belong in private operational storage. Public contract addresses and release
evidence are in [DEPLOYMENTS.md](DEPLOYMENTS.md).

## Deployment prerequisites

1. Configure a separate database and credentials for each environment. Apply the committed
   Drizzle migrations with the migration role. Give the app its application role and Goldsky
   read-only access to `goldsky.watched_addresses`.
2. Configure server credentials through the hosting provider. Keep relayer, database, webhook,
   cron and OAuth secrets server-side. Never put them in `VITE_` variables.
3. Deploy the application through the repository's GitHub-connected deployment process.
   Preview deployments must not have production credentials.
4. Generate and validate the Goldsky Turbo pipeline using [its README](../goldsky/README.md).
   Configure its reader and webhook secrets before applying it to the stable service URL.
5. Fund the dedicated relayer with native gas on each supported chain. Use the authenticated
   monitoring page to inspect stored state and request gas checks.

Changing the factory changes all derived deposit addresses. Treat that as a coordinated release
of contracts, chain configuration, indexing and application data. Stop old writers and resolve
pending transaction intents before a deliberately authorized reset. Do not truncate a running
service or reuse an old deployment's data with a new factory.

Provider capacity must cover actual polling, workflow and database activity. The current
one-minute recovery schedule has a known compute-cost concern; it is not a free-tier sizing
recommendation. Configure provider usage alerts and review budgets before broader testing.

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
release evidence. Delivery and retention must be verified separately from parser tests.

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

## Integration API operations

Apply migration `0009_integration_journal.sql` before deploying its writers. Rehearse it on a
copy of the current schema and representative data. It is additive and enqueues receipt
verification for existing evidence. Its preflight rejects ambiguous historical native/ERC-20
representations; reconcile those exact receipts before retrying the migration. Do not delete
history to get past the check. The deployment's factory and environment must match the database.

Configure these server-only values through the hosting provider:

| Variable | Purpose |
| --- | --- |
| `NAMEPASS_INTEGRATIONS_ENABLED` | Set to `1` only after the release gates pass; otherwise API commands and integration workers remain disabled. |
| `INTEGRATION_KEY_PEPPER` | Independent random secret of at least 32 characters for environment-bound API-key digests. |
| `INTEGRATION_CURSOR_SECRET` | Independent random secret of at least 32 characters for deployment-bound cursors. |
| `INTEGRATION_ENCRYPTION_KEY` | Base64 encoding of 32 random bytes for webhook secrets and idempotent responses. |
| `NAMEPASS_ALIAS_VERIFIED_DEPLOYMENT` | Exact `/config` deployment ID, only after recording mainnet resolver/parent evidence and matching derived addresses. Omit until verified. |

The existing database, chain RPC, Circle Iris, cron, Workflow and monitoring OAuth configuration
also remains required. Archive receipts and a working hub `finalized` block tag are required to
prove historical completion. Never reuse production credentials in previews. Keep encryption-key
backups: replacing it without re-encrypting stored secrets breaks deliveries and idempotent replay.
Changing the pepper revokes all existing partner credentials. Changing the cursor secret requires
partners to bootstrap again. These are coordinated operator changes.

Use **Monitoring → Integrations** with the existing GitHub operator login to create a partner,
issue scoped keys, revoke keys, suspend access and retry eligible jobs. A key is displayed once.
Record its recipient and scope in private operational records. Use the partner API to verify,
test, rotate and replay webhook destinations. Raw signing secrets and API keys must not appear in
logs or tickets. Operator mutations are same-origin requests and leave an audit record.

The recovery cron wakes three independent pumps. A missed start has a 90-second dispatch lease;
a running pump renews its lease for ten minutes. Evidence jobs have five-minute leases, and
webhook attempts have 60-second leases. A source change during a job preserves another wake.
Do not clear a live lease to force a retry. Inspect its Workflow run first. An uncertain broadcast
belongs to the existing payment-intent recovery path, never a second bank payment.

A failed receipt lookup is not proof of a removed deposit. For an indexer deletion, receipt absence
and absence from the canonical block establish removal; a valid reminted receipt takes priority.
History repair uses bounded block ranges and a durable receipt cursor. ERC-20/protocol ranges
advance only after every discovered receipt commits. Arc native discovery has a separate recent
activation range. Older or missed native transfers require the exact transaction hash or live
indexer evidence; never claim complete native history from a token-log scan.

After an outage, verify publication lag, pending jobs and paused/exhausted deliveries. Partners
resume `/events` from their last committed cursor; `410` requires a new `/sync` snapshot. Replaying
a delivery preserves its event ID and body. A destination edit pauses old queued work and requires
explicit replay. Requests already sent can still reach the previous destination. Disabling the
feature flag stops new API/worker work but preserves all durable records for resumption.

Integration retention runs in bounded batches on the minute recovery cron and the daily retention
cron. It removes expired snapshots/idempotency responses, bounds replay to 90 days, prunes
superseded versions while preserving baselines, and clears expired rotation secrets. It never
removes normalized payment evidence. Monitor backlog so its bounded batches can keep up.

For local verification, use a disposable PostgreSQL server on loopback with a database-creation
role, then set `TEST_DATABASE_URL` and run `npm run test:server`. The suite creates and drops its
own databases. `scripts/integrations/capacity.ts` uses the same fixture, defaults to 15 minutes,
and writes `/tmp/namepass-integration-capacity.json`. It measures stored reads/publication only;
HTTP, RPC, Workflow scheduling and external webhook latency require hosted validation.

## Mainnet release requirements

Do not change `ACTIVE_ENVIRONMENT` or `MAINNET_LAUNCH_APPROVED` until every item in this section
has recorded evidence. The active chains are deliberately testnet-only. Ethereum, Base, Arbitrum,
and Arc mainnet rows contain only public chain and Circle data. They do not contain a Namepass
factory, helper, or ENS deployment. All four chains are in scope for the initial mainnet release.
Arc mainnet uses chain ID 5042 and native USDC, with its ERC-20 interface at
`0x3600000000000000000000000000000000000000`; verify the production integration against the
[Arc network details](https://docs.arc.io/arc/references/connect-to-arc) and
[contract addresses](https://docs.arc.io/arc/references/contract-addresses) before deployment.

Before the reviewed public-configuration change:

1. Complete an independent contract audit.
2. Deploy the mainnet contracts and verify the source, creation hash, configuration, and owner.
3. Record the verified addresses and transaction hashes in `docs/DEPLOYMENTS.md`.
4. Validate the mainnet Goldsky pipeline and its dataset versions.
5. Set production-only Vercel, Neon, Goldsky, RPC, relayer, and cron values. Do not put them in a
   preview environment.
6. Run one low-value canary on each launch chain.
7. Attach the evidence below to the release PR before one reviewed change activates mainnet.

| Canary evidence | Ethereum | Base | Arbitrum | Arc |
|---|---|---|---|---|
| Deposit | Deposit address, sender transaction, final block | Deposit address, sender transaction, final block | Deposit address, sender transaction, final block | Deposit address, native USDC sender transaction, final block |
| Flow | API flow ID and canonical Goldsky event ID | API flow ID and canonical Goldsky event ID | API flow ID and canonical Goldsky event ID | API flow ID and canonical Goldsky event ID |
| Circle | Not applicable | Burn, Iris attestation, and Ethereum claim | Burn, Iris attestation, and Ethereum claim | Burn, Iris attestation, and Ethereum claim |
| Settlement | `DepositProcessed` and `Renewed` receipt logs | Ethereum claim `CCTPClaimed` and `Renewed` receipt logs | Ethereum claim `CCTPClaimed` and `Renewed` receipt logs | Ethereum claim `CCTPClaimed` and `Renewed` receipt logs |
| ENS | Exact name expiry before and after renewal | Exact name expiry before and after renewal | Exact name expiry before and after renewal | Exact name expiry before and after renewal |
| API | Name, activity, flow, and stats responses match receipts | Name, activity, flow, and stats responses match receipts | Name, activity, flow, and stats responses match receipts | Name, activity, flow, and stats responses match receipts |
| Frontend | The public screen shows the same chain, amount, state, and transactions | The public screen shows the same chain, amount, state, and transactions | The public screen shows the same chain, amount, state, and transactions | The public screen shows the same chain, amount, state, and transactions |

Store the evidence in the release PR or its linked private operator record. Do not store secrets in
the repository. Re-run `node scripts/check-chains.mjs` after the reviewed change. That check must
change with the launch gate so it verifies the audited deployment set instead of the current
testnet-only state.

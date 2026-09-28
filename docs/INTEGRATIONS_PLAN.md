# Namepass integrations and developer documentation

Status: proposed for approval. Date: 2026-09-28.

This plan defines one complete integration release. Its implementation stages are
dependencies, not deferred product features. Approval authorizes implementation and
verification on a `codex/` branch. A hosted migration, production configuration change,
live wallet transaction, or release merge keeps its existing repository authorization boundary.

## Recommended release

Ship a versioned, authenticated partner API with activation, funding estimates,
transaction tracking, complete resource history, durable events, signed webhooks,
replay, delivery diagnostics, and public developer documentation. Keep the current
contracts, Goldsky Turbo, Neon and Vercel Workflow. Integration reads use stored
projections; requests that need chain verification create bounded durable work.

The release targets the current four-chain testnet deployment. Mainnet is a separate
protocol launch with the audit, deployments and canaries already required by
[RUNBOOK.md](RUNBOOK.md#mainnet-release-requirements). A comprehensive API does not
make an undeployed mainnet protocol available. Do not promise a one-day completion
or production availability before the release gates below pass.

The partner contract is:

1. Activate a name and obtain its full deposit address, supported funding routes,
   current eligibility and configured alias.
2. Send supported USDC using the partner's existing wallet infrastructure.
3. Register the transaction with a private partner reference. Namepass verifies it.
4. Receive deposit, processing, settlement and finality updates through webhooks.
5. Recover missed notifications through the same event feed and reconcile current
   state through complete paginated reads.

No partner-specific deposit wallet or per-payment smart contract is required.
Namepass never receives the bank's signing keys. Tracking a transaction does not
prove that the caller owns its sender or the ENS name.

## Evidence and current gaps

Reviewed `origin/main` at `e5b0704` after fetching origin. The working tree was clean.
Read the contracts, chain registry, activation and public reads, Goldsky definition
and ingestion, flow/transaction writers, receipt parsers, CCTP identity, recovery,
retention, HTTP/auth boundaries, frontend routing and CI.

Read-only requests to the pipeline's configured hosted application confirmed:

- `/api/config/public`: testnet, four chains, automatic trigger minimum of 500000
  USDC base units on each chain.
- `/api/activity?limit=1`: a completed Arc-origin renewal with deposit, burn, claim
  and renewal transaction hashes, exact amounts, duration and expiry.

These observations establish the responses at review time, not provider health,
capacity, deployed-commit identity or an end-to-end mainnet test. No private hosted
database or provider configuration was inspected or changed.

| Finding | Evidence | Required implementation |
| --- | --- | --- |
| Useful execution machinery already exists | `server/transactions.ts`, `server/workflows.ts`, `workflows/` | Reuse nonce ownership, replacement attempts and durable execution |
| Name GET performs RPC, updates ENS state and can resume held work | `server/names.ts:publicName` | Separate integration reads from refresh/activation commands |
| Activity is a website view, not a sync API | `server/reads.ts:activity`, `server/names.ts:recentNameFlows` | Replace limits of six global and 32 per-name flows with complete cursor pagination |
| A flow has only one optional triggering deposit | `server/db/schema.ts:flows`, `server/goldsky.ts:ensureFlow` | Explicit deposit-consumption relationships and pooled results |
| Several paths write public state directly | `goldsky.ts`, `ethereum.ts`, `cctp-renewal.ts`, `flow-state.ts`, `names.ts`, `operations.ts`, `trigger.ts`, `stopped-flows.ts`, `transactions.ts`, `workflow-failures.ts` | Transactional event capture at every public mutation boundary |
| A settled flow can be corrected or merged | Goldsky reorg handling and CCTP identity reconciliation | Corrections, supersession links and durable identity lookup |
| `deposits.status = finalized` is written when settlement succeeds | `server/ethereum.ts`, `server/cctp-renewal.ts` | Do not expose this as chain-finality evidence |
| Event rows lack block hashes and native transfer typing | `server/db/schema.ts`, `goldsky/namepass-testnet.yaml` | Preserve canonical occurrence, transaction ordering and transfer kind |
| Arc native transaction index is stored as `log_index` | `goldsky/namepass-testnet.yaml:all_usdc_transfers` | Separate native transaction identity from ERC-20 log identity |
| Some public flow evidence falls back to a transaction-wide renewal match | `server/reads.ts:publicFlow` | Exact receipt-event linkage; no first-match fallback in v1 |
| Watching starts asynchronously; deposit sources start at latest | `goldsky/README.md`, dynamic table definition | Receipt registration and bounded coverage repair, with honest readiness |
| No partner credentials or outgoing webhook subsystem exists | `routes/api/`, schema; monitoring OAuth is operator-only | Partner tenancy, quotas, endpoint management and delivery records |
| Pricing is browser-oriented and has mutable module state | `src/lib/pricing.ts`, `oracle.ts`, `fees.ts` | Pure pricing inputs and a server adapter with verified live configuration |
| Source and settlement remainders have different meanings | `NamepassFactory._renew`, `NamepassL1Gateway._renew` | Separate origin-wallet remainder from gateway rounding residue |
| Docs is a placeholder | `src/App.tsx`, `Navbar.tsx`, `CtaBand.tsx`, `Footer.tsx` | Real `/docs` routes and enabled links |

Focused baseline verification: 66 tests passed across public reads, names, Goldsky,
CCTP identity, settlement identity, deposit eligibility, flow transitions and both
recovery paths. This is existing-behavior evidence, not verification of the proposed API.

## Resource and ownership model

Use `/api/v1` on the application origin. Publish the configured canonical base URL
in the docs and config response; do not require a new API domain or provider.
Every resource and cursor is bound to an environment and immutable deployment ID.
Never silently retarget an activation after a factory change.

| Resource | Meaning |
| --- | --- |
| Integration | Partner identity, credentials, quotas and audit records |
| Watch | An integration's subscription to a public ENS name; not name ownership |
| Name | Normalized name, deployment-specific wallet, alias, eligibility, balances and freshness |
| Activation | Durable initialization/refresh operation with per-chain progress |
| Transfer | Partner-private tracking request and opaque reference, with reported transaction attempts |
| Deposit | Verified on-chain receipt of supported USDC; independent of any partner's claim |
| Flow | One protocol processing operation, with exact origin/CCTP/renewal identity |
| Settlement | Verified renewal result and its separate finality state |
| Event | Immutable, versioned public change with a stable ID |
| Webhook endpoint/delivery | Partner destination, subscription, signing version and delivery attempts |

Two partners watching `alice.eth` see the same public on-chain facts. They cannot
read each other's private references, transfer records, keys or delivery logs.
Sender-address filtering is not a tenant boundary. Activating a name creates a
watch for the caller; adding a watch to an already active name does not repeat all
RPC initialization. Stopping a watch stops notifications, not protocol execution.

All monetary values are decimal integer strings with explicit token and decimals.
Chain IDs, block numbers, versions and feed positions are also serialized safely.
Use UTC RFC 3339 timestamps. Unknown amounts and unknown evidence remain null with
reason codes. Each resource includes `id`, `version`, `environment`, `deploymentId`
and observation/publication timestamps where applicable.

## Funding and transfer tracking

Activation separates these facts: durable watch registration, ENS eligibility,
initial balance coverage, and alias configuration. Return `202` and a durable
activation ID while initialization is pending; return `200` for an existing usable
activation. Per-chain results prevent one failed RPC from making every route appear
ready or unavailable. Retry the same operation rather than recreate it.

Return the full address. Return `<label>.namepass.eth` with its resolution network,
deployment association and verification status. The current mainnet parent resolves
testnet funding addresses; the response and examples must make that explicit.
Mainnet ENS resolution is not evidence of a mainnet funding route.

Funding estimates accept either a USDC budget or a requested duration. Return the
normalized name, route, pricing block, selected helper, read time, expiry time,
estimated duration/cost and fee assumptions. Refactor pricing into functions that
take explicit rate inputs; do not set process-global rates per request. Read and
validate the helper/oracles at one block. Estimates expire after 60 seconds and
do not reserve a price. Existing wallet funds and future deposits may change the
amount processed and discount tier. Apply the allowance per flow, including slices;
do not promise a fixed deduction per deposit or assume Circle fees are always zero.

For reliable bank tracking, require a transaction report after broadcasting:

```json
{
  "name": "alice.eth",
  "chainId": "84532",
  "txHash": "<the bank's transaction hash>",
  "transferKind": "erc20",
  "logIndex": 12,
  "reference": "<opaque bank transfer reference>"
}
```

The example is schematic. `logIndex` may be omitted before mining; bind it only if
one supported transfer matches the requested name. Multiple matches return a
selection-required result with candidate IDs, never an arbitrary first match.
Native Arc uses `transferKind: native` and no log index. Persist replacement hashes
on the same transfer; verify the mined attempt. Do not treat unmined, missing,
reverted, wrong-recipient or unsupported-token transactions as deposits.

The registration endpoint returns a durable transfer ID even before indexing.
A Workflow verifies chain identity, receipt success, recipient, token, amount,
block hash and exact event position. Normalize through the same ingestion service
used by Goldsky, with a canonical identity shared by both paths. A later Goldsky
delivery must enrich the same deposit, not add another balance contribution.
Keep ingestion source and chain canonicality separate; a delayed delete cannot
overwrite newer receipt evidence without verification of the occurrence.
If a chain exposes both native and token-interface evidence for the same economic
transfer, reconcile those representations before applying the balance contribution.

Goldsky remains the normal discovery path for unreported deposits. Transaction
registration closes the partner's watchlist propagation and indexer delay gap.
Activation records a per-chain block anchor and schedules bounded overlap repair.
Repair scans supported transfer and protocol evidence through explicit block ranges;
it does not claim full pre-activation history from a balance snapshot. Native Arc
top-level transfers require block/transaction evidence. Internal native transfers
are outside the current supported funding modes; advertise only modes covered by
receipt parsing, discovery and tests.

Background work has durable cursors, budgets and retry reasons. An uncertain coverage
range remains `reconciling`. No fixed sleep or watched-address row alone proves that
the indexer has caught up. Registering an old exact transaction may recover it when
archive/provider evidence is available; otherwise report the coverage limit.

## What settlement tracking guarantees

Maintain separate axes:

- Deposit observation: reported, verified, orphaned or rejected.
- Consumption: pending, partial/pooled, consumed or unresolved.
- Flow execution: the existing detailed state plus reason, funds location and recovery action.
- Settlement: observed, finalized or invalidated, with exact receipt evidence.

The word `settled` in the v1 flow means a verified successful renewal. The bank's
recommended completion rule is deposit consumption proven, all relevant renewals
settled, and hub finality proven. Send separate `settlement.observed` and
`settlement.finalized` events so a UI can show progress promptly.

For both direct and CCTP renewals, persist exact gateway/ENS event identities and
the helper used by that call, amounts, duration and expiry. CCTP also keeps the
source event, exact Circle message index, source domain and final nonce. Preserve
the mined transaction attempt, not merely the latest replacement hash.

Finality is a bounded verification task attached to a settlement. On the Ethereum
hub, verify that its block hash is canonical and at or below the node's finalized
head. Batch checks for outstanding settlements and stop after completion. This is
settlement work, not continuous health RPC polling. Provider errors retain an
unverified state; they cannot promote finality. Circle source attestation finality
and hub renewal finality are separate facts. Do not publish a wall-clock settlement SLA.

### Pooled deposits and sliced flows

Do not invent FIFO allocation or attribute a fraction of renewal time to a sender.
The existing contract spends a wallet balance and does not encode that allocation.
Implement conservative, evidence-based consumption relationships:

1. Order verified deposits and origin processing by chain, block hash/number,
   transaction index and event position. For native transfers use their actual
   transaction position, not a fabricated ERC-20 log index.
2. A full-wallet processing operation after a deposit proves that it has left the
   wallet, provided all intervening protocol processing is accounted for.
3. With partial slices, preserve every subsequent flow that could have consumed
   the deposit until the first verified full drain. Completion requires settlement
   of all those candidate flows. This deliberately gives a conservative answer.
4. Expose exact one-to-one links where proven, pooled links otherwise, and an
   unresolved reason when evidence is incomplete. Per-flow allocation amounts are
   null unless independently provable. A trigger-deposit link alone is not proof.
5. Recompute relationships after late evidence, an absorbed/merged flow or a reorg.
   Retain the old relationship revisions for replay and audit.

For example, two deposits of 3 and 7 USDC can be consumed by one 10 USDC flow.
Both transfers can report completion when that renewal finalizes. Each references
the same renewal totals and shared fee. Neither receives an invented exclusive
share of the duration. A deposit split across burns remains processing until the
relevant claims complete. Deposits below the service trigger minimum remain funds
at the source wallet, not failed renewals.

Expose these flow totals separately: `amountProcessed`, `bridgeFee`,
`amountReceivedOnHub`, `executorAllowance`, `amountApplied`, `roundingResidue`,
`originWalletRemainder`, `durationSeconds`, `expiryAfter`. The gateway retains the
rounding residue; it is not a refundable deposit-wallet balance. Conservation checks
must reconcile the source and hub totals independently.

Failed/cancelled execution does not imply refunded funds. `unclaimed` means a
source burn exists and the same Circle message needs completion. Recovery endpoints
resume existing safe work; they never authorize a second bank transfer. Keep stable
flow lookups through merges using `supersededBy`/alias records instead of hiding them.

## Complete HTTP contract

All routes below are included in this release. The OpenAPI document defines exact
schemas, errors, pagination and examples before route implementation.

| Method and path under `/api/v1` | Purpose |
| --- | --- |
| `GET /config` | Environment, deployment, funding modes/tokens, minima and published capabilities |
| `POST /names/activate` | Ensure activation and caller watch; idempotent |
| `GET /activations/{id}` | Initialization status and per-chain results |
| `GET /names/{name}` | Stored name/funding/eligibility snapshot; no RPC or execution side effects |
| `POST /names/{name}/refresh` | Rate-limited asynchronous ENS/coverage refresh |
| `GET /watches`, `PUT /watches/{name}`, `DELETE /watches/{name}` | Manage caller's name subscriptions |
| `POST /quotes` | Verified, expiring funding estimate |
| `POST /transfers`, `GET /transfers`, `GET /transfers/{id}` | Report and track partner transfers |
| `POST /transfers/{id}/transactions` | Add a replacement/reported transaction attempt |
| `GET /deposits`, `GET /deposits/{id}` | Exact receipt identity and consumption relationships |
| `GET /flows`, `GET /flows/{id}` | Complete execution history and current evidence |
| `POST /flows/{id}/retry` | Revalidate and resume that flow when permitted |
| `GET /settlements`, `GET /settlements/{id}` | Renewal evidence, amounts and finality |
| `POST /sync`, `GET /sync/{id}` | Create and page through a consistent bootstrap snapshot |
| `GET /events`, `GET /events/{id}` | Resume/replay the caller's durable change feed |
| `POST/GET /webhook-endpoints` | Register/list callback destinations |
| `GET/PATCH/DELETE /webhook-endpoints/{id}` | Inspect, change or disable a destination |
| `POST /webhook-endpoints/{id}/test` | Send a clearly marked synthetic event |
| `POST /webhook-endpoints/{id}/rotate-secret` | Rotate with overlap |
| `GET /webhook-deliveries`, `GET /webhook-deliveries/{id}` | Delivery status and bounded attempt diagnostics |
| `POST /webhook-deliveries/{id}/replay` | Retry the original immutable event |

Lists support name, chain and resource-appropriate status/time filters, a default
page size of 50 and maximum of 100. Paginated endpoints distinguish the next page
from the next synchronization position. No truncated active-flow side arrays.
Use stable tie-breakers and opaque, signed cursors bound to deployment, caller,
filter and snapshot. Invalid cursors return `400`; expired sync history returns
`410` with instructions to bootstrap again.

`createdFrom` means resource creation. `updatedFrom` is useful for investigation,
but is not a lossless synchronization protocol. `GET /events?from=...` means
publication time in Namepass, including changes to old resources. After the first
request, use the returned cursor. Block time is separately available for reporting.

## Event storage and synchronization

Use a transactional outbox in the existing Neon database. Its measured purpose is
to prevent a committed settlement from losing its integration notification if the
process dies before dispatch. This is a public-change journal, not another payment
execution queue or financial ledger. Record this tradeoff in `DECISIONS.md`.

At every public mutation boundary, write an allowlisted immutable resource snapshot
and per-resource revision in the same transaction as the business change. Cover
status changes, evidence enrichment, name/balance changes, supersession, finality
and correction paths. No-op webhook redeliveries and internal Workflow owner changes
alone do not create customer events. Centralize this operation and document lock
ordering. Public revisions for the same resource serialize with its updates.

A bounded publisher claims committed outbox rows, takes a short publication lock,
assigns feed positions, updates versioned integration read projections, persists
event audiences and creates delivery work in a single transaction. It performs no
network calls while holding that lock. Process each resource's revisions in order;
all committed unpublished rows remain eligible regardless of ID. Never use
`max(outbox_id)` as a checkpoint over transactions that may still be committing.
The published sequence is assigned only under the serialized publication boundary.

Events include `id`, `type`, `apiVersion`, `resourceId`, `resourceVersion`,
`environment`, `deploymentId`, `recordedAt`, `publishedAt`, an allowlisted snapshot,
and correction/supersession references when relevant. Example families:
`name.updated`, `transfer.updated`, `deposit.updated`, `flow.updated`,
`flow.superseded`, `settlement.observed`, `settlement.finalized`,
`settlement.invalidated`. A distinct type does not eliminate resource-version checks.

Integration reads use the same published projections as events. This prevents a
bootstrap snapshot from mixing unrelated publication boundaries. `POST /sync`
captures a published high-water mark and a fixed caller scope. Page resource versions
as of that mark, then follow events after it. New watch registrations include an
initial snapshot event; changing a watch cannot create an invisible gap. Replay
audience membership is immutable; dropping a watch does not rewrite earlier history.

Retain events and their required resource versions for 90 days; snapshots expire
after 24 hours. Retain canonical normalized deposit/flow/settlement facts for the
deployment lifetime. Existing 30-day raw-payload cleanup remains separate. Older
history is available through resource reads with documented coverage, but do not
fabricate old state transitions. Mark migration bootstrap events as snapshots,
not historical notifications. Never purge unpublished events or unresolved deliveries.

Wake publishing/delivery after commit through Workflow, with existing recovery cron
repairing missed starts and stale owners. Durability comes from the database, not
from an in-memory promise. Delivery outages cannot block renewals or Goldsky ingestion.

## Credentials, quotas and webhooks

Provision integrations and initial credentials through the existing operator-only
monitoring area. Ship operator controls for key creation, revocation, rotation,
partner status, quotas and delivery inspection. Partners manage their endpoints and
subscriptions through the API. A separate public account/signup application is
not required to deliver the complete integration.

Use random environment-scoped bearer keys; store only key prefixes and keyed hashes.
Scopes separate reads, activation/refresh, transfers, retry and webhook administration.
Private records always use the authenticated integration ID in the query predicate.
Operator cookie mutations need CSRF protection. Keys never enter URLs or browser
bundles. The public config and docs do not require a key.

Require `Idempotency-Key` on creation/action POSTs except read-only quote/snapshot
operations. Persist caller, route, payload hash, operation ID and response state.
Concurrent duplicates share the operation; changed payloads return `409`. Keep
replay responses for seven days and durable resource uniqueness after expiry.
Do not cache a transient pre-operation failure as permanent success/failure.
If the HTTP result is uncertain, return or recover the durable operation identity.

Starting configurable quotas per integration: 10 read requests/second with a burst
of 20; 60 general writes/minute; 10 activation/refresh/quote requests/minute; five
webhook endpoints. Enforce consistently across function instances using bounded
database-backed quota state, not process memory. Return `429` and `Retry-After`.
Validate capacity before publishing quotas. Use explicit CORS/preflight behavior;
partner secret keys remain server-side. Return a request ID on successful and failed
responses, bounded bodies, structured error codes and appropriate cache headers.

Webhook behavior included at launch:

- Standard Webhooks headers and HMAC-SHA256 signing over event ID, attempt timestamp
  and exact body bytes. Stable event IDs across retries and manual replay.
- Per-endpoint random signing secrets, encrypted at rest using a separately
  configured server key. Reveal only at creation/rotation. Dual signatures during
  a 24-hour rotation overlap. Verify raw bodies and a five-minute timestamp window
  in examples; persist deduplication beyond the replay window.
- Durable delivery rows, bounded concurrency and leases. A Workflow step may execute
  more than once; a receiver may commit and lose its acknowledgement. Promise
  at-least-once attempts and replay, never exactly-once delivery or ordered HTTP arrival.
- Persisted retry schedule: immediate, then delays of 10 seconds, 1 minute,
  5 minutes, 30 minutes, 2 hours, 6 hours, 12 hours and 24-hour intervals until
  72 hours from creation; jitter and bounded `Retry-After` handling. Timeouts,
  network failures, `408`, `429` and `5xx` retry. Other `4xx` pause that delivery
  for endpoint repair; no redirect following. Only `2xx` acknowledges delivery.
- Twenty-second request timeout, small response-body cap, and no stored raw
  response body by default. Store timestamp, status, duration and safe error code.
- HTTPS destinations only. Verify destination control before delivering real data.
  Reject credentials in URLs, local/private/metadata addresses and unsupported
  ports. Resolve and validate all A/AAAA addresses and pin the actual connection
  to a validated address; repeat on each attempt. Preserve TLS hostname validation.
  Test DNS rebinding and redirects. URL string checks alone are insufficient.
- Endpoint failure state, attempt history, secret rotation, synthetic tests and
  manual replay available through the API and operator view. Endpoint edits do
  not silently redirect queued deliveries; explicitly replay against a verified
  new endpoint configuration.

The reference receiver verifies signatures, durably saves the event, responds
promptly, deduplicates by event ID and applies newer resource versions. It uses
cursor reconciliation after outages. Events from other partners are not delivery
deduplication inputs or authorization evidence.

## Database and code changes

Implement additive migrations, with bounded backfills and no reset:

| Area | Changes |
| --- | --- |
| Existing evidence | Block hashes, transaction indices, transfer kind, source provenance, exact origin/settlement links and stable identity aliases |
| Activation/coverage | Durable initialization operations and per-chain verification/backfill ranges |
| Reconciliation | Deposit-consumption relationships, coverage state and revision history; settlement/finality records |
| Partners | Integrations, credential hashes/scopes, watches, private transfers/attempts, idempotency records and quota buckets |
| Event publication | Transactional outbox, serialized publication position, published events, audiences and versioned read projections |
| Delivery | Endpoints/secret versions, durable deliveries/attempts and lease/recovery fields |
| Operations | Audit records, publisher/finality/reconciliation progress and retention indexes |

Keep source database enums and old endpoints compatible during migration. Introduce
new public states in adapters rather than changing all legacy semantics at once.
Legacy deposit event IDs remain resolvable. Correct the Arc native/ERC-20 uniqueness
boundary without double-counting old data. Backfill only evidence that can be
verified; unknown historical linkage/finality stays unknown.

New backend modules live under `server/integrations/`; HTTP handlers live under
`routes/api/v1/`; integration workflows live under `workflows/`. Reuse existing
normalization, chain registry, receipt parsing, recovery guards and HTTP primitives.
Extend the handler deliberately for PATCH/PUT/DELETE/OPTIONS. Extract shared ingestion
and exact evidence services where needed rather than making the partner API call
the website HTTP routes. No second relayer or new external queue/webhook vendor.

## Docs and developer experience

Build a lazy-loaded `/docs` section in the current React application using its
PageShell, Navbar and design system. Support direct links, back/forward navigation,
mobile navigation, search, accessible code blocks and copy controls. Loading docs
must not initialize the pricing RPC loop or require an API key.

Pages included: overview; neobank quickstart; deployment/network/token matrix;
activation and alias resolution; quotes and fees; reporting transfers; pooled funds
and slices; lifecycle/finality/reorgs; authentication/scopes/quotas/idempotency;
pagination/bootstrap/reconciliation; webhooks/signatures/retries/replay; errors and
recovery; API reference; changelog and support/coverage policy.

Maintain an OpenAPI 3.1 document as the machine-readable contract, including webhook
schemas. Generate client types and reference material from it; validate actual
HTTP fixtures against the schemas in CI. Add runnable TypeScript and cURL examples,
a sample receiver and a reconciliation worker. Cover the bank's sender flow from
activation through final settlement and a restart. Examples must use testnet
configuration returned by the service and environment variables for secrets.

Wire Navbar, Footer and the existing CTA directly to `/docs`. Keep the approved
CTA wording. Publish a clear compatibility policy: additive nullable fields may be
added in v1; existing meanings do not change; breaking changes require another API
version. Enumerated states/event types have explicit unknown-value handling guidance.

## Implementation sequence and acceptance

All stages below are required for the agreed release.

| Stage | Deliverable | Exit evidence |
| --- | --- | --- |
| 1. Contract and fixtures | OpenAPI, resource examples, state/amount definitions, identity and lock-order design | Walk the complete neobank journey and all error paths using fixtures |
| 2. Evidence foundation | Canonical transfer identity, receipt/indexer reconciliation, activation repair, pooled consumption, exact settlements and finality | Database and receipt tests for combined deposits, slices, late evidence, reorgs and external executors |
| 3. Durable publication | Outbox capture at every mutation boundary, publisher, projections, consistent bootstrap and feed | Crash, concurrent commit, pagination, replay, correction and retention tests |
| 4. Partner API | Credentials/scopes, watches, transfers, quotes, idempotency, quotas and complete reads/actions | Schema-validated HTTP tests and tenant-isolation tests |
| 5. Delivery and operations | Signed webhooks, retries, endpoint verification, logs/replay, operator controls and alerts | Receiver crash/retry tests, signing vectors, SSRF tests and delivery recovery drill |
| 6. Docs and examples | `/docs`, API reference, sample bank/receiver/reconciliation workflow and real navigation | Direct-route build checks, browser review and executable quickstart |
| 7. Release validation | Additive migration/backfill rehearsal, capacity test and hosted canaries | Evidence below, then reviewed release PR and deployed verification |

Required regression scenarios:

- Same activation and POST retried concurrently; worker startup lost after commit;
  no duplicate operation, watch, transfer, burn or notification identity.
- Transfer mined before watch propagation; receipt-first and Goldsky-first ingestion;
  repeated Goldsky events; reported transaction with several matching logs;
  Arc native and ERC-20 identity collision case; wrong token/network/recipient.
- Deposits below threshold accumulating into one flow; two funders; same-block
  deposit and processing; partial slices; unknown opening balance; later deposits
  after a drain; already-consumed deposits; unavailable coverage.
- Two equal renewals inside one transaction; actual helper selection; older
  replacement attempt mines; external executor; flow merge and supersession.
- Source burn succeeds and claim is delayed/reverted; retry uses the same message;
  no resend instruction; source funds are not shown as spendable.
- Deposit/origin/settlement deletion and reinclusion; late old deliveries after a
  correction; updated expiry and totals; no false promotion to finality.
- Commit A allocates an outbox identifier then stalls while B commits; publisher
  restart after each boundary; no skipped event; per-resource revision order.
- More than 100 ongoing and completed flows; mutations during every snapshot page;
  clock ties; timestamp replay of an old flow updated today; expired cursors;
  subscription changes during bootstrap; tenant and deployment cursor misuse.
- Receiver accepts then connection drops; duplicate/out-of-order delivery; process
  death after send; endpoint disable/edit; rotation; replay after seven days;
  retained event beyond raw payload expiry.
- Tenant escape attempts; revoked/wrong-environment keys; changed idempotent payload;
  concurrent quota enforcement; private IPv4/IPv6, DNS rebinding and redirect SSRF.

Use disposable PostgreSQL for multi-connection isolation/locking tests. Existing
PGlite fixtures remain useful for migrations and SQL behavior but do not establish
real server concurrency. Apply migrations to an isolated empty database and to
representative historical fixtures. Run the repository's required CI suite and
focused new integration/Workflow tests. Validate Goldsky generation and its schemas
if event fields change. No new Solidity deployment is planned.

Proposed capacity acceptance profile: 100000 retained flow/deposit records,
10000 watched names, ten concurrent integrations at their read quotas, and 20
public changes/second for a 15-minute run. Target p95 stored-read latency below
500 ms when warm, no cursor gaps and no unbounded backlog. In a healthy hosted
test, target first webhook attempt within 10 seconds of publication and recovery
of missed starts within two cron intervals. These are release test targets, not
unmeasured customer SLAs. Record database/Workflow cost and adjust advertised
quotas downward if the deployed capacity requires it.

Before enabling partner access on the hosted testnet: validate provider capacity,
canonical origin/base URL, environment separation, signing/encryption secrets,
archive and finalized-block RPC support, tested alert destinations and retention.
Verify the actual wildcard ENS/CCIP resolution against the configured deposit
derivation and record the resolver/parent evidence missing from the current release
record. Advertise address funding independently if alias verification is unavailable.
Run a fresh low-value direct renewal and one renewal on each supported source chain,
including both advertised Arc modes, with a sample partner receiver. Exercise a
receiver outage/replay and compare API amounts, identity, expiry and finality with
receipts. Wallet funding needs the user's signature; do not imply that local tests
or the older canaries cover this new integration release.

Monitor outbox age, publication lag, first-attempt delay, retry backlog, failed
deliveries, reconciliation age, finality age, rejected indexer records, API errors,
database saturation and quota rejection. Separate indexer freshness from lack of
new deposits. Extend the current monitoring/retention/recovery services with bounded
work; do not hold a database transaction open during webhook HTTP or RPC calls.

Deploy schema first, then compatible writers/publisher behind an integration feature
flag; backfill projections; validate shadow results; enable a test integration; then
enable docs and partner access. Preserve source names/checkpoints in any Goldsky
change. Rollback disables integration access/delivery while preserving outbox and
evidence and leaving renewal execution intact. During a rollback to writers without
event capture, keep the integration paused, mark a coverage gap and require a
verified resync before reopening; never promise continuous replay across that gap.

## Decisions included in sign-off

Approve one complete testnet integration release with:

1. Webhooks, event replay and consistent snapshots together.
2. Transaction registration as the reliable bank reconciliation path, alongside
   automatic discovery of other deposits.
3. Conservative pooled-deposit completion without invented per-funder renewal time.
4. Observed settlement and finalized settlement as separate states.
5. Partner keys, quotas, operator provisioning and endpoint-management APIs.
6. The current contracts and hosting stack, with additive database changes.
7. Public `/docs`, OpenAPI and working integration/receiver examples.

Implementation can start with these decisions; no vendor purchase, separate developer
portal, contract migration or mainnet switch is assumed. Mainnet release, hosted
changes and signing remain the concrete release approvals described above.

## Research informing the design

- [Goldsky dynamic tables](https://docs.goldsky.com/turbo-pipelines/transforms/dynamic-tables):
  lookup changes propagate asynchronously. This supports explicit initialization
  and transaction verification rather than treating a database insert as an indexer acknowledgement.
- [Goldsky delivery guarantees](https://docs.goldsky.com/turbo-pipelines/delivery-guarantees)
  and [webhook sink](https://docs.goldsky.com/turbo-pipelines/sinks/webhook): duplicates,
  replay and reorg corrections require idempotent ingestion; callback failures can
  backpressure indexing. Partner callbacks must be separate from that path.
- [AWS transactional outbox guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html):
  commit business changes and notification intent together; consumers still deduplicate.
- [PostgreSQL sequence semantics](https://www.postgresql.org/docs/current/functions-sequence.html):
  sequence allocation is not a transactional publication boundary. The proposed
  serialized publisher is a design choice to prevent skipping late commits.
- [Standard Webhooks specification](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md):
  interoperable signing, stable message IDs, attempt timestamps and secret rotation.
- [Stripe webhook guidance](https://docs.stripe.com/webhooks): design receivers for
  duplicate/out-of-order delivery and recover state through resource reads.
- [Circle finality](https://developers.circle.com/cctp/concepts/finality-and-block-confirmations)
  and [Ethereum finalized block API](https://ethereum.github.io/execution-apis/api/methods/eth_getBlockByNumber/):
  source attestation and destination-chain finality are distinct milestones.
- [OWASP SSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html):
  protect outgoing callback connections against private-address access and DNS rebinding.
- [OpenAPI 3.1.1](https://spec.openapis.org/oas/v3.1.1.html): describe HTTP resources
  and outgoing webhook contracts in the same machine-readable specification.
- Installed `workflow@4.8.5` documentation under `node_modules/workflow/docs/foundations/`
  was checked for retries and idempotency. Durable steps can retry; a new outgoing
  delivery must remain safe across step replay and ambiguous network outcomes.

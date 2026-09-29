# Architecture

Namepass combines permissionless renewal contracts with hosted indexing and execution.
Independent executors can use the contracts directly. Contract boundaries are described in
[CONTRACTS_V2.md](CONTRACTS_V2.md); deployed addresses and verification limits are in
[DEPLOYMENTS.md](DEPLOYMENTS.md).

## Contract route

An ENSIP-15-normalized label determines an ERC-1167 wallet through CREATE2. The factory address
and wallet bytecode are part of the derivation. Each deployment set uses the same factory on
all supported chains, so a label has one address but independent balances on each chain.

On the hub chain, the factory routes payment to the fixed gateway. On a source chain, it burns
USDC through Circle CCTP V2. The attested message mints on the hub through the gateway. The
gateway snapshots the helper selected by the timelock-governed pointer, authenticates payment,
and settles through that immutable ENS adapter. Mint and renewal succeed or revert together.
An independent executor can use these contracts without the hosted application.

## Service boundaries

| Component | Responsibility |
| --- | --- |
| `src/lib/chains.ts` | Shared chains, tokens, contract addresses and provider configuration names |
| Goldsky Turbo | Detect deposits and protocol events for watched wallets |
| Neon PostgreSQL | Canonical event projection, names, balance snapshots, flows and transaction intents |
| `routes/api/` and `server/` | HTTP validation, public reads, activation and authenticated operations |
| Vercel Workflow | Durable renewal execution, transaction confirmation and Circle attestation waits |
| `src/lib/publicApi.ts` | Browser access to application data |

Goldsky delivers events to the authenticated webhook. Native Arc transfers require transaction
value indexing; they need not emit ERC-20 Transfer logs. Gateway events supply renewal facts,
with receipt enrichment for ENS expiry. See [the pipeline reference](../goldsky/README.md).

## Names and balances

Activation normalizes a label, derives its wallet, reads ENS state and records block-pinned
balances. The watched-address table enables deposit detection. Failed scans remain recoverable.

Public balances start from a snapshot and apply canonical events after its block. Public
activity polling does not call chain RPC. Missing or inconsistent evidence is unavailable,
not zero. A flow amount is not another wallet balance. Arc's native and ERC-20 USDC views
represent the same funds and must not be added together.

## Flows and transactions

Eligible funds create a flow. Execution checks the name, submits the origin transaction, and
waits for its receipt. A cross-chain flow then waits for Circle's attestation and submits the
hub claim. Held, failed and unclaimed states preserve their reason and evidence.

An exact `DepositProcessed` event and Circle source nonce identify execution. Name, amount or
transaction hash alone cannot safely identify a flow. The final CCTP nonce comes from Circle
Iris; the origin MessageSent nonce is a placeholder. Unclaimed payments resume the same
message rather than burning again.

A durable transaction intent stores a business call before broadcast. A per-sender, per-chain
nonce queue serializes submissions. Same-nonce replacements preserve the business call. Any
stored attempt can mine, so confirmation checks all attempts. See [RUNBOOK.md](RUNBOOK.md) for
recovery procedures and [ENGINEERING_CONSTRAINTS.md](ENGINEERING_CONSTRAINTS.md) for invariants.

## Storage and reorgs

The schema is defined in `server/db/schema.ts`; migrations are in `drizzle/`.

- `names` and `goldsky.watched_addresses` identify tracked wallets.
- `chain_events` and `deposits` retain canonical evidence and deletion state.
- `balance_snapshots` and versioned `balance_scan_requests` support indexed balances.
- `flows` and `flow_transitions` record execution state.
- `transaction_intents` and `relayer_nonces` make broadcasts recoverable.

Canonical deletion removes an event's contribution. ENS expiry is recomputed from surviving
verified evidence. Locks serialize projections and balance recovery; a scan clears only the
request version it actually processed. Raw delivery payload retention is separate from normalized
facts. Unknown or malformed authenticated webhook rows are acknowledged with bounded diagnostic
evidence; authorization failures are rejected before body processing.

## Application and operations

The frontend displays public read models, exact prices and transaction evidence. On-chain flows
remain permissionless. Service health dashboards require GitHub authentication and add no scheduled
health RPC polling. They do not replace provider alerts. Recovery and retention jobs are documented in
[RUNBOOK.md](RUNBOOK.md); metric definitions are in [MONITORING.md](MONITORING.md).

## Partner integrations

`routes/api/v1/` uses scoped server credentials, database quotas and encrypted idempotent
responses. Activation and receipt registration create durable jobs. Name and activity GETs
read stored projections; they do not call an RPC or start payment workflows. Partner references,
keys and webhook destinations are private. Watches subscribe to public name activity and do not
claim ownership of that name or its pooled wallet.

Migration `0009` adds the SQL journal and integration tables, described by
`server/integrations/schema.ts`. Source triggers capture allowlisted public revisions in the same
transaction as each change. The publisher locks one publication row and assigns positions only
to committed outbox rows. An allocated outbox sequence is never a replay checkpoint. Event,
resource version, audience and webhook delivery commit together. Source writers do not acquire
the publication lock.

`POST /sync` captures a published position and the caller's watches in a repeatable-read
transaction. Its immutable snapshot lasts 24 hours. The matching event cursor follows subsequent
publications. Replay lasts 90 days; retention preserves a baseline for each resource and every
version required by a live snapshot. Canonical deposits, flows and settlements are not pruned by
the legacy raw-payload retention job.

Execution, deposit consumption and settlement finality are separate facts. Receipt verification
binds chain, transaction, log index, wallet, token, amount and canonical block. CCTP settlement
also binds the exact source-message index and attested nonce. The selected gateway renewal must
agree with the ENS receipt's duration and charge. Hub finality is required for completion.
Pooled deposits keep all possible processing slices through a proven full drain; no per-sender
renewal-time allocation is invented. Evidence corrections revoke dependent completion in the
same transaction. Missing provider evidence remains unresolved.

Publication, evidence repair and webhook delivery run as separate bounded Workflow pumps.
Durable job and delivery leases fence concurrent attempts. Recovery cron repairs missed starts.
Webhooks use Standard Webhooks signatures, immutable bodies, destination verification, secret
rotation and a 72-hour retry window. DNS is checked and pinned for each request; redirects and
private destinations are blocked. Event replay remains the recovery authority.

The public guide is `/docs`. The machine-readable contract is `docs/api/openapi.json`; run
`npm run generate:api` after changing its builder, and `npm run check:api` to verify both generated
artifacts. Runnable bank, receiver and reconciliation examples are in `examples/integration/`.

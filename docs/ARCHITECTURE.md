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

## Public integration

The integration has four unauthenticated endpoints: `POST /api/v1/address`, `POST /api/v1/quote`,
`GET /api/v1/status/{chainId}?transactionHash={hash}` and `GET /api/v1/names/{name}/renewals`. Apps, wallets, scripts and agents use
one flow: get the address, send USDC with their own wallet, then poll. There are no integration
accounts, API keys, transaction registration, event feeds, outgoing webhooks or MCP server.
Goldsky's authenticated ingestion webhook remains an internal provider boundary.

Address activation reuses `activateName`: ENS reads, deterministic address derivation, the
Goldsky watch table and initial balance scans. It returns the full address, subname, alias
verification flag and current funding chains with token addresses and minimum amounts.
Status polling reads stored evidence in one query. It makes no chain RPC and starts no payment.
The lookup uses an indexed source chain ID and transaction hash and returns every matching
Namepass deposit. No indexed deposit returns `404` with `Retry-After: 5` and queues one receipt
discovery job per transaction. Repeated polls do not reset its lease or 30-minute discovery window.
The worker matches supported transfers to activated names and ingests the same canonical identity
as Goldsky, closing watchlist propagation gaps. It also supports native Arc transactions.

The public statuses are `pending`, `processing`, `complete` and `failed`. Completion requires
canonical receipt evidence, proven consumption through a covered full-wallet drain, and final
settlement for every candidate processing flow. CCTP verification binds the source message and
attested nonce. The gateway renewal must agree with the exact ENS receipt's duration and charge.
Hub finality is required. Pooled deposits reference shared renewal totals; no per-sender time
allocation is invented. Source corrections revoke dependent completion in the same transaction.

Migration `0009_public_status.sql` adds receipt, coverage, consumption, settlement and job tables
in `server/integrations/schema.ts`. Native transaction identity remains distinct from ERC-20 log
identity. One bounded evidence Workflow pump repairs and verifies receipts. Durable leases fence
concurrent work and retain source changes that arrive during a job. Recovery cron repairs missed
starts. Provider errors leave evidence unverified.

The public guide is `/docs`. `docs/api/openapi.json` defines the four endpoints. Run
`npm run generate:api` and `npm run check:api` for the generated contract and TypeScript types.
The runnable general-purpose example is in `examples/integration/`.

Quotes normalize the name and read the pointer-selected helper's actual `quote` method at one
hub block. The frontend mirrors this verified helper algorithm. The allowance is read from the
gateway and subtracted first. Source route reads use one source block. The quote refuses disabled
burns, nonzero minimum Circle fees, unsupported helper code and amounts above the live burn cap.
The current [Circle contract](https://github.com/circlefin/evm-cctp-contracts/blob/master/src/v2/TokenMessengerV2.sol)
exposes `getMinFeeAmount`. This matters because automatic processing authorizes zero bridge fees.
Quotes expire after 60 seconds, assume one flow and exclude pre-existing wallet funds. There is
no shared mutable pricing cache or fallback rate.

Name history is a stored, name-filtered keyset query over canonical renewal events and their
flows. It includes recorded expiry/freshness and verification status. An opaque cursor orders
by event time and identity and never changes the name predicate. This is a public query scope,
not private user authorization. No all-platform history endpoint is exposed.

## Documentation and agent skill

`docs/content/` and OpenAPI generate the standalone `/docs` catalog in `shared/docs/`, plain
Markdown, `llms.txt`, `llms-full.txt` and the downloadable integration skill. Run
`npm run generate:docs` after editing inputs; CI checks freshness with `npm run check:docs`.
An existing wallet or coding agent uses the same two HTTP calls. The short skill supplies the
send-and-poll sequence; it needs no Namepass-specific MCP connection.

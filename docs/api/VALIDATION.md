# Integration validation — 2026-09-29

The implementation targets the configured testnet deployment. These checks used disposable
local databases and mocked chain receipts. They do not establish hosted availability or a live
funding result. Hosted release gates are owned by [DEPLOYMENTS.md](../DEPLOYMENTS.md#integration-release-gate--2026-09-29).

## Database capacity

The [15-minute measurement](validation/2026-09-29-capacity.json) used PostgreSQL 18.4 with
100,000 retained flow/deposit records, 10,000 names and ten partners watching those names.
The test ran stored-resource queries at ten reads/second per partner and committed twenty source
changes/second through the actual outbox publisher.

| Result | Measured value |
| --- | --- |
| Duration | 900 seconds |
| Stored reads | 90,000; 100/second |
| Source changes | 18,000; 20/second |
| Stored-read p95 | 14.27 ms |
| Publication-batch p95 | 21.74 ms |
| Query failures | 0 |
| Public cursor gaps | 0 |
| Remaining outbox rows | 0 |

This measures database resource reads and publication. It excludes API authentication/quotas,
HTTP latency, RPC, Workflow scheduling and real webhook transport. It is a local acceptance
result, not a hosted throughput promise. `scripts/integrations/capacity.ts` reproduces it with
`TEST_DATABASE_URL` pointing at a disposable loopback PostgreSQL service.

## Behavioral evidence

The real PostgreSQL suite creates and drops its own database, applies every committed migration,
and verifies the following boundaries:

- A transaction with an earlier allocated outbox ID can commit later and still appear after the
  consumer's saved cursor. Publisher rollback and concurrent publication cannot skip an event.
- Snapshot and list pagination freeze their position across more than 100 changing resources.
  Retention preserves a live snapshot's baseline; expired replay requires a fresh bootstrap.
- Partner scopes, revocation, private references, concurrent idempotent writes and body conflicts
  are enforced through the API route wrapper and database.
- Receipt registration and a late provider-specific indexer ID produce one deposit. A valid
  reminted receipt overrides a stale deletion; temporary receipt absence cannot orphan a
  transaction that remains in its canonical block.
- A mismatched ENS charge cannot produce a settlement. Exact gateway/helper/ENS receipt evidence
  becomes observed, then finalized only after the hub finality check. A canonicality correction
  revokes dependent settlement and completion in the source transaction.
- Pooled deposits require complete processing coverage, a proven full drain and final settlement
  for every candidate flow. No per-deposit renewal time is allocated.
- Webhook retries retain the same event ID and body. The runnable receiver verifies their raw-body
  signatures. Endpoint edits fence queued work; destination validation rejects private addresses.
- Public projections conform to the generated OpenAPI contract, and private Circle fields are
  excluded from journal payloads.

The app build, frontend, server, transaction, Workflow, chain registry, generated Goldsky pipeline,
contract tests and helper fingerprint checks are required by CI. CI now runs the database suite
against a PostgreSQL service and checks OpenAPI/generated-type freshness.

The final local run passed 156 server tests, 60 frontend tests, 26 transaction tests and the
Workflow runtime test. Foundry passed 83 contract tests; two existing RPC-dependent fork tests
were skipped because no fork RPC was configured. Application build, server types, API contract
and generated types, migration metadata, chain registry, Goldsky generation and helper
fingerprint checks passed.

## Interface review

The standalone docs application contains 50 pages generated from guide Markdown and OpenAPI.
The browser review covers desktop and 390-pixel mobile layouts, search-to-page navigation,
Markdown copy, agent context, endpoint pages and mobile navigation. The frontend regression
checks direct opening, settlement navigation and browser back without pricing, chain or account
reads. A real MCP SDK client passes handshake, search, complete-guide retrieval, transitively
referenced schemas, skill resources, prompts, unknown-page handling and request bounds.
Documentation freshness and internal links are checked in CI.

## Release evidence still required

The local tests do not cover a hosted migration, provider archive/finality guarantees, real
HTTPS/DNS delivery, hosted latency or missed-start drills, mainnet ENS resolver configuration,
or a newly signed direct/CCTP funding canary. Keep the integration feature disabled until the
recorded release gates pass. Merge, hosted changes and wallet signing require their existing
explicit authorization.

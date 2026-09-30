# Public API validation

The integration contract has four unauthenticated endpoints: address activation, quotes, polling by
source chain ID and transaction hash, and name history. Local tests use a disposable loopback PostgreSQL service
and apply every committed migration. They verify repeated activation through an RPC fixture,
Goldsky watch registration, anonymous polling, CORS, invalid input, indexing retries, multi-log
transactions, chain-specific lookup, coverage, finality and immediate completion revocation.

The exact ENS receipt test rejects mismatched accounting, keeps observed renewals incomplete
until hub finality, and invalidates evidence after a canonicality correction. The consumption
regression requires every candidate processing slice and never allocates per-deposit duration.
API results are checked against OpenAPI. History tests cover normalized name filtering,
equal-timestamp keyset pagination, cursor scope, missing names and reorg corrections. Quote tests
check verified helper selection, block pinning, allowance subtraction, live burn caps, current
Circle minimum fees, concurrent requests and unavailable pricing. Frontend coverage checks direct docs navigation and
browser back without pricing or chain reads. Documentation generation checks internal links and
Markdown/skill freshness.

The local run passed 149 server tests, 60 frontend tests, 26 transaction tests and the Workflow
runtime test. Foundry passed 83 contract tests; two existing fork tests were skipped because no
fork RPC was configured. The application build, server types, OpenAPI/generated types, 13-page
documentation catalog, skill validation, chain registry, Goldsky generation and helper fingerprint
checks passed.

Run the application build, server types, frontend/server/transaction/Workflow suites, API/docs
checks, registry, Goldsky and helper-fingerprint checks required by CI. No outgoing webhook or
MCP test suite applies. The [September 29 capacity receipt](validation/2026-09-29-capacity.json)
is historical evidence for the removed partner journal design; it does not establish throughput
for the current public endpoints.

Hosted availability, platform abuse limits, indexer propagation/recovery, archive/finality support
and a signed public-flow funding canary remain release checks in
[DEPLOYMENTS.md](../DEPLOYMENTS.md#integration-release-gate--2026-09-30). Local verification
cannot establish a deployed mainnet service.

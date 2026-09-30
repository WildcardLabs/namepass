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

The [September 30 migration rehearsal](validation/2026-09-30-migration-rehearsal.json)
applied `0009_public_status.sql` to an isolated clone of the hosted testnet database. It
preserved fingerprints for nine existing data tables, passed the native identity preflight
and queued five deposit evidence jobs and eight flow evidence jobs. The snapshot had no
pending flows. It did not migrate beta.

The [provider preflight](validation/2026-09-30-provider-preflight.json) verified chain IDs,
factory code and the same derived address on all four configured testnet RPCs. Historical
receipts and canonical blocks passed on all four chains; Sepolia also served `finalized`.
The Base and Arbitrum receipts come from the September 18 deployment. This is provider
evidence, not a new public API funding canary.

The rollout wallet page adds four payment boundary tests. The build, TypeScript checks and
all 64 frontend tests passed. Hosted endpoint, recovery, abuse-limit and signed funding
checks remain pending; the public API release flag is still disabled on beta.

Initial hosted checks passed preflight/error CORS, scoped history, direct/Arc quotes and a
recovery wake. Base and Arbitrum quotes exposed an incompatible Circle fee-view assumption;
the quote now uses Circle's documented standard-route fee API. It rejects missing, ambiguous,
malformed or nonzero standard fees. The regression covers those unavailable responses.

A 31-request staging burst returned 30 input errors and one platform `429`. That edge response
omitted CORS and retry headers. The rollout now uses the official Vercel SDK counters before
API work, with application-owned JSON/CORS/retry responses and closed access when a counter
is missing. Hosted validation of this revised configuration is pending.

The first staging Sepolia provider omitted two renewal receipts even though its matching
canonical blocks contain both transactions. The configured beta RPC retrieved the receipts
and historical ENS state. Staging must pass those same reads before settlement verification
can be considered validated. No missing receipt was treated as removal or completion.

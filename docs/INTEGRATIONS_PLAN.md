# Public Namepass integration

Approved scope, updated 2026-09-30: get an address, send USDC, poll with source transaction hash
and chain ID, with optional quotes and name history. This replaces the partner integration design. The same flow serves any app, wallet,
script or agent. Circle CCTP's source-transaction polling pattern guides the interface; Namepass
performs bridging, claiming and ENS renewal internally.

| Call | Result |
| --- | --- |
| `POST /api/v1/address` with `{ "name": "example.eth" }` | Full deposit address, subname, alias verification flag and supported funding chains |
| `POST /api/v1/quote` with name, chain ID and USDC amount | Estimated seconds, applied amount, fees, pricing block and expiry |
| Send USDC with the caller's wallet | Source transaction hash and EVM chain ID |
| `GET /api/v1/status/{chainId}?transactionHash={hash}` | `pending`, `processing`, `complete` or `failed`, with deposits and verified renewal results |
| `GET /api/v1/names/{name}/renewals` | Name-filtered past renewals, recorded expiry and pagination |

No API keys, partner registration, transfer registration, webhooks, event cursors, sync snapshots,
or MCP are included. Repeat address requests return the same address. Poll the same URL
about every five seconds; honor `Retry-After`. Retry `404` while indexing is pending and temporary
`429`/`503` responses. Pending progress does not authorize another payment.

Completion still has a strict internal evidence boundary: canonical source receipt, complete
processing coverage, consumption through a full drain and final settlement for every candidate
flow. Exact helper/gateway/ENS accounting and CCTP identity checks remain. Pooled deposits share
renewal results; the service does not invent per-deposit duration allocations. Corrections revoke
completion. A transaction with several deposits returns them together; callers need no log selector.

Quotes use the same helper algorithm as the frontend, after fees. They verify live contract code
and source route limits. A quote expires after 60 seconds and assumes one flow without existing
wallet funds. Name history is filtered by normalized ENS name and never exposes a global feed.
Name scope is a public on-chain query, not proof of caller ownership.

The docs prioritize a runnable quickstart, four endpoint references and a short downloadable
agent skill. Markdown and LLM indexes provide context to existing agents without a new server.
The application remains testnet-only until the existing mainnet protocol launch requirements pass.

Implementation is verified locally and reviewed through the existing draft PR. Hosted migration,
provider checks, live funding canaries and release configuration have the boundaries in
[DEPLOYMENTS.md](DEPLOYMENTS.md#integration-release-gate--2026-09-30).

# Platform monitoring

The developer dashboard is at `/monitoring`. It is GitHub-authenticated and limited to the two
usernames in `MONITORING_GITHUB_USERS`. It uses official
shadcn Card, Alert, Badge, Button, Input, Select, Table, Tabs, Skeleton, and Chart components.
The registry source is `https://ui.shadcn.com/r/styles/new-york/{component}.json`.
Local changes adapt imports and styling. Chart uses the compatible Recharts 2 dependency.

## Metric definitions

| Signal | Definition and source | Limit |
|---|---|---|
| Activated names | Count of `names` | Activation is not a deposit or renewal |
| Known depositors | Distinct lowercase non-null sender addresses on canonical, non-orphaned deposits | Addresses are not people. Pre-activation deposits and recovered balances can lack a sender |
| Deposit volume | Sum of indexed canonical, non-orphaned deposit amounts | Not the same as renewal volume. Historical coverage can be incomplete |
| Renewal volume | Sum of `amount_received` in canonical Namepass `Renewed` events | Includes completed renewals only |
| Applied USDC | Sum of `amount_applied` in those same canonical events | Does not include funds still waiting |
| Completed renewals | Count of canonical Namepass `Renewed` events | A flow row alone does not prove a renewal |
| Time delivered | Sum of canonical `duration` in seconds | No estimate from current prices |
| Ongoing flows | All eight active flow states | Excludes held, unclaimed, failed, cancelled and settled |
| Needs review | Failed, unclaimed, or active flows past the step review budget | A review flag does not prove a failed transaction |
| Delivery p50 / p95 | Deposit block time to canonical renewal block time, grouped by origin chain | Only exact linked deposits with nonnegative durations. Sample count is shown. Batched and unlinked recoveries are excluded |
| Ingestion p95 | First stored time minus event block time, floored at zero, over 24 hours | This is observed event delay, not chain-tip lag. Receipt writers can also insert events |
| Pending transactions | Prepared or broadcast transaction intents, by chain | Pending warnings come from the existing transaction monitor |
| Pending scans | Count of versioned balance scan requests | A request can wait normally behind an origin transaction |
| Upcoming expiry | Stored name expiry in the next 30 days | ENS state can be stale. This is not a current chain read |
| Relayer gas | Explicit native `eth_getBalance` read per active chain | Cached for 60 seconds; no claim of sufficient runway or delivered alerts |

USDC sums and counts remain decimal strings. Summary USDC values retain six decimal places.
Charts convert amounts to numbers for plotting and state that they are rounded.
Daily charts include empty UTC days. The 7/30/90-day control changes charts and delivery statistics;
lifetime metrics and current queue metrics retain their stated scope.

## Step review budgets

| State | Review after |
|---|---:|
| Queue, deposit confirmation, name check, transaction preparation | 10 minutes |
| Origin or claim receipt wait | 15 minutes |
| Circle attestation on Base or Arbitrum | 60 minutes |
| Circle attestation on Arc | 5 minutes |
| Unclaimed or failed | Immediately visible for review |
| Held | Separate list; no generic timeout |

These are initial operator review budgets, not provider service guarantees. Use step-entry timestamps,
not `updated_at`: routine retries can update the row without advancing the step. Check the exact
reason and transaction evidence before action. Resume an unclaimed CCTP message. Do not burn again.

Circle documents standard-transfer finality in minutes on Ethereum L2s and sub-second finality on
Arc. Base batch publication can add delay. A short universal timeout would produce false alarms.
Calibrate these review budgets from observed per-chain delivery samples before mainnet use.
[Circle finality documentation](https://developers.circle.com/cctp/concepts/finality-and-block-confirmations).

## Required external monitoring

| Priority | Signal | Action |
|---|---|---|
| Critical | Relayer native balance below configured per-chain floor | Notify the operator. Fund the correct native gas asset. Set the floor from maximum transaction cost and expected demand |
| Critical | Unclaimed funds, unresolved nonce, or failed claim | Inspect existing flow and transaction evidence; use the runbook recovery procedure |
| High | Goldsky block lag, Kafka lag, failed checkpoints, sink errors | Inspect pipeline health and delivery. Do not use the time of the last deposit as a heartbeat |
| High | API 5xx or p95 latency, failed Workflow runs, missed recovery invocations | Configure provider alerts and a tested notification destination |
| High | Neon connection exhaustion, storage pressure, compute failures | Check provider metrics and database errors |
| High | ENS quote mismatch or a newly non-renewable name | Inspect reason codes and ENS state before retry |
| Medium | Growing held funds, scan backlog, or expiry risk | Inspect each reason and due action |

Goldsky separates block lag, Kafka lag, throughput, checkpoint failures, and sink latency. The
application's filtered event table cannot reconstruct all these signals.
[Goldsky health dashboard](https://docs.goldsky.com/turbo-pipelines/health-dashboard).

Arc `eth_getBalance` uses 18 decimals and represents native USDC. Its ERC-20 balance uses six
decimals. They represent the same funds and must not be added together.
[Arc infrastructure documentation](https://docs.arc.io/integrate/infrastructure).

The dashboard does not send alerts or claim that provider monitoring is connected. Test notification
delivery separately. Future gas-cost and subsidy reporting needs receipt gas usage, L2 fee fields,
and timestamped native-token prices. Do not infer runway from a fixed balance threshold or count the
$0.10 allowance as profit. Live wallet reconciliation must reuse block-pinned balance snapshots and
later canonical events. Flow amounts are not another balance aggregate.

## API and operations

GitHub login requires `MONITORING_GITHUB_CLIENT_ID`, `MONITORING_GITHUB_CLIENT_SECRET`,
`MONITORING_GITHUB_USERS` (two distinct usernames separated by a comma), and
`MONITORING_SESSION_SECRET` (at least 32 random characters). Keep secrets in server environment
variables. Configure the OAuth callback as `https://<deployment-host>/api/auth/github/callback`.
Sessions expire after 12 hours. Both monitoring endpoints enforce the session and current allowlist.
Without configuration, access fails closed. GitHub login has not been verified against a configured
OAuth app; tests cover mocked GitHub responses and session validation.

- `GET /api/monitoring?days=30&page=1&status=all`: one read-only SQL statement provides a consistent
  database snapshot. Optional `chain` is a chain ID; `search` matches a name substring. Queue pages
  contain 50 rows. Filters search all open flows. Global review counts do not depend on pagination.
- Allowed windows: 7, 30, 90 days. Allowed queue filters: all, attention, active, held, unclaimed,
  failed. The route validates filter bounds and parameterizes all user input.
- The response is private and must not be stored in shared caches. The browser refreshes on explicit request or filter
  change. After two minutes it labels the snapshot stale. A failed refresh keeps the old snapshot
  with an error. Missing data is not zero.
- `GET /api/monitoring/gas`: manual balance checks only, with an eight-second RPC timeout and no
  retries. The in-process cache lasts 60 seconds; HTTP responses are private and not cached. Concurrent checks in one process share a
  request. No scheduler calls this route. External gas alerts remain required.
- The gas route requires the existing `RELAYER_ADDRESS` or `RELAYER_PRIVATE_KEY` and chain RPC
  environment variables. Only the public address and balance result leave the server.
- The database route needs `DATABASE_URL` and the existing migrations. No new schema or service is
  required. Flow evidence links to the origin transaction when recorded, or to the exact linked canonical
  deposit transaction before execution. A recovered balance without a linked deposit has no
  fabricated transaction link. No transaction, activation, or recovery action is available on this page.
- The dashboard loads as a separate frontend chunk. Opening it does not read the pricing oracle.

The local checkout may have frontend configuration without `DATABASE_URL`. In that case the API
returns an error and the dashboard keeps values unavailable. Configure the API in the deployment
environment before expecting live results. Do not fill the production page with demonstration data.

Tests execute the SQL in embedded PostgreSQL with the repository migrations. They cover empty
results, canonical deletion, case-insensitive sender counts, exact amounts, linked latency, and
step review logic. Browser checks cover navigation, filters, missing data, and gas errors.

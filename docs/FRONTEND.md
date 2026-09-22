# Web client

The React application derives deposit addresses, displays ENS pricing, and reads activity and
flow state through the public API. It is an optional client of the renewal contracts.

## Module boundaries

| Module | Responsibility |
| --- | --- |
| `src/App.tsx` | Page state, browser history and shared page shell |
| `src/lib/namepass.ts` | ENS normalization and deterministic wallet derivation |
| `src/lib/chains.ts` | Shared chain and deployment registry |
| `src/lib/publicApi.ts` | Typed HTTP reads and activation |
| `src/lib/readModel.ts` | Presentation adapters for stored facts |
| `src/lib/flowPresentation.ts` | Flow labels that preserve origin-chain meaning |
| `src/lib/oracle.ts`, `pricing.ts`, `fees.ts` | Validated chain configuration and exact pricing |
| `src/lib/ens.ts` | Shared, cached ENS profile requests |

`registry.ts` contains legacy fixtures and is not a production data source. Components do not
query Neon or perform public balance polling through RPC.

## Pricing and addresses

Normalize labels before derivation and show payment addresses in full. Helper selection and
configuration reads use one block. Unknown helper code or invalid oracle configuration prevents
pricing. The gateway provides the fixed executor allowance. Only price-dependent content waits
for these reads; the rest of the page can render immediately.

Use integer arithmetic and exact amount formatting where rounding would hide a discount boundary.
There are no default oracle rates. See [ENGINEERING_CONSTRAINTS.md](ENGINEERING_CONSTRAINTS.md)
for pricing and shared-request constraints.

## Activity and flow state

Balances stay separate by chain. Missing data remains unavailable. Canonical renewals supply
completed totals; a deposit is not a renewal. Sender and executor are distinct evidence fields.
The browser renders server flow identity without merging rows by name, amount or transaction hash.
After a source-chain burn, an unclaimed payment is not a spendable source-wallet balance.

## Interface conventions

Pages share `PageShell` and `Navbar`. Reuse existing visual primitives, tooltips and chain labels.
Monitoring is a separately loaded, GitHub-authenticated page built with the existing shadcn
components. Its snapshot and manual gas-read behavior are defined in [MONITORING.md](MONITORING.md).

Build and verification commands are in [CONTRIBUTING.md](../CONTRIBUTING.md). Deployment facts
belong in [DEPLOYMENTS.md](DEPLOYMENTS.md).

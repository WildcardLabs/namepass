# Engineering constraints

Constraints for changes to payment routing, accounting and presentation. Current deployment evidence lives in [DEPLOYMENTS.md](DEPLOYMENTS.md).
Implementation detail remains in source; this document records constraints that are easy to lose.

## Contract and address changes

- Compiler version, EVM target, optimizer settings, metadata settings and factory constructor
  inputs affect creation code and CREATE2 addresses. Keep `foundry.toml` pinned. Treat any change
  to these inputs or the factory deployment as an address migration.
- `namepass.ts` implements the factory's address derivation. Its normalization uses ENSIP-15;
  do not replace it with a regex. Contracts key on the label (`vitalik`), not `vitalik.eth`.
- Deposit wallets delegatecall the factory through ERC-1167 proxies. Preserve factory/wallet
  execution-context guards and the established minimal-proxy bytecode. Native Arc reception is
  an explicit wallet-only exception; preserve its chain and hub restrictions.
- Factory payment configuration is initialized once. Do not add an owner-controlled sweep or
  payment destination. Such a change alters the custody model.
- The fixed gateway authenticates wallet and CCTP funding, settles payments and pays the executor.
  The pointer selects an immutable ENS helper; the helper's ENS addresses have no setters.
  ENS DAO governance is the intended mainnet authority. A test-wallet timelock is not that DAO.
- ENS has two renewal populations: migrated names and premigrated V1 reservations. Preserve both
  paths and select the matching oracle. See [CONTRACTS_V2.md](CONTRACTS_V2.md).
- Local pricing tests use ENS's vendored oracle implementation. Fork tests cover deployed ENS
  compatibility without broadcasting. A passing mocked CCTP test is not live-route evidence.

## Pricing and browser data

- `chains.ts` is the shared registry. `publicApi.ts` is the browser HTTP boundary; `readModel.ts`
  adapts facts for views. `registry.ts` is legacy demonstration data, not a production source.
- Helper discovery and configuration reads are block-pinned. Unknown helper runtime stops
  pricing. Regenerate its reviewed algorithm fingerprint only for a reviewed contract change.
- The two ENS renewers must agree on the oracle used by the UI. Validate oracle points. Keep
  pricing unavailable until live configuration loads; do not add fallback rates.
- Use `BigInt` for USDC and rounding. A year is `31_536_000` seconds. Oracle length indexing is
  `length - 1`, clamped. Price display and suggested payment amounts must preserve tier boundaries.
- The fixed allowance comes from the gateway. Apply it once per flow, not once per deposit.
  Quotes solve from the budget after fees; `fmtUsdcExact` is used where rounding hides a boundary.
- Quick-select options cover the three discount tiers. The omitted one-year option is a product
  decision; see `DECISIONS.md` if reconsidering it.
- Only pricing-dependent content waits for pricing. Preserve the shared profile-request cache:
  `fetchProfile` has no per-caller AbortSignal because requests are shared.
- Keep balances by chain. Unavailable is not zero. An unclaimed CCTP payment is no longer an
  origin-wallet balance. Deposits do not prove completed renewals.

## Flow identity and recovery

- Goldsky detects events, Neon stores application state, Functions validate/read HTTP, and
  Workflow runs durable execution. A second queue or ledger needs a measured need and recorded
  design decision. Chain receipts remain authoritative.
- Flow identity uses exact `DepositProcessed` event identity and Circle source-chain nonce.
  Never merge by name, amount or transaction hash alone: a transaction can contain several calls.
- The origin `MessageSent` nonce is a placeholder. Circle Iris provides the final CCTP V2 nonce;
  bind the response to the exact message index. Resume an unclaimed message without another burn.
- Transaction intents include same-nonce replacements. Any attempt can mine; canonical receipt
  evidence determines the outcome.
- Public balances use a block-pinned snapshot plus subsequent canonical events. Activity polling
  must not add chain RPC calls. Activation, due recovery and execution can read chain state.
- Balance scans are versioned per name and chain. Clear only the scanned version after reaching
  its requested block. Receipt writers and deposit webhooks share that name-and-chain lock.
  A zero-remainder receipt may absorb an earlier deposit without creating another flow.

## UI and tooling

- Pages use `PageShell` and `Navbar`. Keep existing routing unless changing it is in scope.
  Nitro owns API routing; a catch-all Vercel rewrite can turn API responses into HTML.
- Monitoring uses the existing shadcn components. Reuse shared `Tooltip`, `ChainTag` and visual
  primitives. Tooltip's portal avoids clipping; its scroll dismissal avoids detached positioning.
- Payment addresses stay fully visible. Informational ENS profile addresses may be truncated.
- OpenZeppelin comes from npm. Foundry dependencies and pinned CI commands are recorded in
  `.github/workflows/ci.yml`. Do not reinstall tooling merely because an old handover says it is absent.

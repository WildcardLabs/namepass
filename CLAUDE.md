# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Technical writing

Use **ASD-STE100 Simplified Technical English** for technical writing about this repository. This
includes agent responses, documentation, issues, pull requests, plans, and code comments.

- Use short, direct sentences. Prefer the active voice.
- Put one instruction or action in each sentence.
- Use one term for one concept. Do not change terms only to add variety.
- Avoid idioms, filler, unnecessary jargon, and unclear pronouns.
- Define a necessary technical term when the reader might not know it.
- Keep code identifiers, commands, error messages, quotations, and proper nouns exact.
- Do not apply this rule to source-code syntax, legal text, historical quotations, or approved
  product copy.
- Keep all necessary technical detail. Simplified English controls the wording, not the depth of
  the explanation.
- Accuracy has priority. If a strict Simplified English construction changes or hides the meaning,
  use the clearest accurate wording and explain the necessary term.

The purpose of this rule is to make technical communication easier to understand. It must not
limit analysis, technical accuracy, or the ability to explain a complex subject.

## Read these too

- **`README.md`** — the product pitch, feature tour, and tech stack, written for a human visiting
  the repo.
- **`PRODUCT.md`** — the detailed "what and why": the problem being solved, the core mechanic,
  positioning/tone decisions made through design iteration, and what's explicitly *not* decided
  yet. Read this before making product-facing decisions (copy, new features, framing) that aren't
  already covered below.
- **`docs/FRONTEND.md`** — **the long version of this file.** How the app that exists actually
  works: the `lib/` boundaries, the full domain model, the simulation lifecycle end to end, the
  state/re-render model and its gotchas, the component map, the invariants list, and how to verify a
  change. Read it before any non-trivial change; it's written so you don't have to re-derive the
  mechanics from the code.
- **`docs/ARCHITECTURE.md`** — CREATE2-derived addresses, Circle CCTP with a hook that renews on the
  mint, the Postgres schema, and the trigger/retry policy. **This file has a mixed status and marks
  each part.** The contracts are deployed to four testnets and proven on chain. Everything from
  "Services" onward is a specification only: the webhook, schema, worker, and cron do not exist. The
  UI follows that specification. Read this file before you change anything that models deposits,
  flows, or pending balances.
- **`docs/DEPLOYMENTS.md`** — live contract addresses, the salt and creation-code hashes behind
  them, per-chain configuration, and what has actually been proven on chain. Read it before
  touching anything deployment-shaped; the addresses are not recoverable from the source alone.
- **`docs/DECISIONS.md`** — a dated log of non-obvious architecture/product calls and why they
  were made, e.g. why routing has no library, why certain copy avoids certain words. Check here
  before re-litigating something that looks like it could've been done differently — it might
  already have been tried and rejected for a reason.

## Keeping these docs current

`README.md`, `PRODUCT.md`, this file, and `docs/DECISIONS.md` drift out of date unless updated
deliberately. **After any substantial change** — a new feature or page, a meaningful architecture
change, a new dependency/service integration, or a shift in product goals/positioning discussed
with the user — update whichever doc actually covers that change:

- New feature/page/user-facing behavior → `README.md` (feature tour) and, if it changes the
  product's scope or story, `PRODUCT.md`.
- New architectural pattern, convention, or constraint another session would need to know →
  this file, under Architecture.
- New product decision (positioning, tone, business/goal clarification, something moved from
  "not yet defined" to defined) → `PRODUCT.md`'s current-state summary.
- **Any non-obvious call that could reasonably have gone differently** — a rejected alternative,
  a tradeoff knowingly accepted, a "we tried X, it looked wrong, went with Y instead" — append a
  dated entry to `docs/DECISIONS.md`. This is the one most likely to be forgotten because it's
  easy to just make the change and move on; it's also the one most valuable to a future session
  trying to understand *why* something is the way it is instead of re-litigating it.

Don't do this reflexively for every small fix — only when the change is substantial enough that a
future session (or the user, months later) would otherwise be working from a stale picture of the
app.

## What this is

Namepass: every ENS name gets a permanent, chain-agnostic USDC deposit address. Anyone can send
USDC to it (no ownership required) and it's converted into ENS renewal time at the exact on-chain
rate. Addresses are derived deterministically with CREATE2 — no custodian holds keys. In the real
product an indexing pipeline detects payments, Circle's CCTP moves the USDC to Ethereum, and the
renewal executes in the same transaction that completes the transfer.

**The contracts are real and deployed; the app in front of them is not wired up yet.** Hold both
halves of that at once:

- `contracts/` is live on four testnets, tested, and verified against ENS's and Circle's deployed
  contracts. Addresses and what has been proven on chain are in `docs/DEPLOYMENTS.md`.
- **The frontend is still a prototype.** The UI, routing, pricing math, and **deposit addresses**
  are real and exact, but on-chain activity, balances, and ENS ecosystem stats shown in the app are
  seeded/simulated client-side (`src/lib/registry.ts`) — not read from the deployed contracts, not
  from an indexer. There is no backend at all; `docs/ARCHITECTURE.md` describes one that does not
  exist.

The deposit address is the seam between the two halves. `src/lib/namepass.ts` reimplements the
deployed factory's `predictWallet` derivation, so the address on a card is the address the
contracts would actually route — but nothing the app renders *around* it is. Don't let that leak:
an address being real doesn't make the balance beside it real.

So don't write copy or code comments implying the *app* talks to chain state, and don't write them
implying the *contracts* are hypothetical either. `src/lib/pricing.ts` used to hardcode the rates
the contracts read live; since 2026-08-11 it reads them from the same oracle at boot, so the two
can no longer drift apart.

## Commands

```bash
npm install
npm run dev       # Vite dev server
npm run build     # tsc --noEmit && vite build — this IS the type-check step, there is no separate typecheck script
npm run preview   # serve the production build locally
```

There is no lint script and no JS test framework — don't invent `npm run lint` or `npm test`.

**The contracts do have tests**, in Foundry:

```bash
forge build           # contracts only; `npm run build` does not touch them
forge test
forge test -vvv       # traces, for a failure worth reading
```

Foundry is not vendored — install it with `curl -L https://foundry.paradigm.xyz | bash && foundryup`.
Solidity dependencies come from **npm**, not git submodules (`remappings` in `foundry.toml`), so
`npm install` is a prerequisite for `forge build`. `forge-std` is the exception and lives in `lib/`.

`test/ens/` is ENS v2 source, copied verbatim — see the README there. The pricing tests run the
helper's inverse against **ENS's own `StandardRentPriceOracle`**, which is the point: both pricing
bugs this repo has shipped would have passed against a mocked oracle. If you change anything in
`_quote`, `_settle`, or the CCTP offsets, run `forge test` before believing it.

## Architecture

**Routing is hand-rolled, not a library.** `App.tsx` holds a `page` state
(`"home" | "leaderboard" | "supported" | "terms" | "privacy"`), synced to `window.location` via
`history.pushState`/`popstate` — see `pathToPage`/`pageToPath`. There's no router dependency.
Vite's dev server falls back to `index.html` for unknown paths automatically; the production
Vercel deployment needs `vercel.json`'s catch-all rewrite for the same behavior, or direct
navigation/reload to `/leaderboard` etc. 404s.

**Every page renders inside `PageShell`, with `Navbar` as its first child.** `PageShell` is the
rounded card (video background on Home, white elsewhere) that every route shares — this is what
makes Home/Leaderboard/Supported/Terms/Privacy feel like one app instead of five
stitched-together pages.
When adding a new page, wrap it in `PageShell` + `Navbar` the same way `App.tsx` does for the
existing ones, rather than giving it its own top-level layout. `Navbar` takes `showMenu={false}`
on non-Home pages (only Home shows the Explorer/Search/Cost simulator menu).

**`src/lib/` separates different kinds of "data" — don't blur them:**
- `namepass.ts` — ENS label → deposit address, the deployed factory's own CREATE2 derivation in
  TypeScript. **Nothing here is simulated and every constant is load-bearing** — the factory
  address is also the ERC-1167 implementation and the CREATE2 deployer, and changing any of them
  moves every address the product has ever shown. `NAMEPASS_FACTORY` is the **testnet** factory
  (`hubChainId` is in the creation code, so a mainnet set derives different addresses); it moves
  with `IS_TESTNET`, and `depositAddress` throws rather than derive against the wrong set.
  **Always normalize before deriving** — `normalizeLabel` is not cosmetic. The contract hashes the
  bytes it's given and can't run ENSIP-15, so an un-normalized label produces a valid-looking
  address for a name that can never be renewed, and there is no sweep. UI gates on
  `labelProblem()`; don't reintroduce a regex that approximates ENSIP-15, and don't validate names
  anywhere except through this module.
- `rpc.ts` — a ~180-line `eth_call` client, and deliberately not the start of a web3 layer. The
  app makes one kind of request (a batch of `view` calls, once, at boot) and every return type it
  decodes is listed in `oracle.ts`. Needing dynamic argument encoding, a transaction, or a revert
  reason is the signal to take a real dependency instead of extending this.
- `ensName.ts` — per-name ENS state: the real expiry, and `isRenewable` on both renewers for
  whether ENS will renew it now. Like the oracle, **no address is pinned** — `ETH_REGISTRY()`
  comes off the renewers, and the two must agree on it.
  **`ETHRegistrar` and `ETHRenewerV1` are authoritative for both populations, and nothing else is
  consulted.** In particular `findExpiry` is the expiry for v1 names too, 62 days later than v1's
  own registrar says. That is not an error to correct: ENS v2 cuts grace 90 → 28 days and applies
  a one-time +62 day renewal to every v1 name **automatically at the upgrade** (DAO proposal
  6.43), so from launch it is the operative date and both populations are released at the same
  instant. Don't "fix" it by reading v1's `BaseRegistrar.nameExpires` — that was tried, and it
  reintroduces the pre-upgrade clock. **Grace is `expired && renewable`**, which needs no window
  constant: past grace both renewers return false for `isRenewable`.
  `getRemainingGracePeriod` supplies how long is left, but is only consulted once `findExpiry`
  says the name has expired — on testnet today a premigrated name is mid-migration and
  `ETHRenewerV1` reports grace against the *un-extended* v1 expiry, which would put a name "73
  days into grace" on a card whose headline says it expires in 46. Two nulls that
  are not the same thing: a `null` **return** means the read failed (not known), while
  `{ expiry: null }` is the chain saying the name isn't registered. Rendering the second for the
  first tells someone their name doesn't exist because an RPC was slow.
- `oracle.ts` — ENS's live pricing configuration. **The oracle address is not pinned**: the two
  ENS renewer addresses are, and the oracle is read from `rentPriceOracle()` on them, which is
  what the helper does and for the same reason. It requires the two renewers to agree on one
  oracle and fails loudly if they don't, because the UI draws one price table and there'd be two.
  `validate()` mirrors the contract's `_validatePoints` — a mis-shaped oracle must stop the app,
  not quietly mis-price it.
- `pricing.ts` — exact ENS v2 `StandardRentPriceOracle` math, `BigInt` end to end. `divCeil`
  mirrors the contract's `Math.Rounding.Ceil`. **The arithmetic lives here; the numbers do not.**
  Base rates, discount tiers, the denominator and the USDC ratio all arrive via `setRates()` from
  `oracle.ts` at boot, and every function throws `PricingNotLoadedError` until then. **Do not add
  a default, a fallback table, or a cached copy** — a fallback price is a made-up price, and the
  failure it produces is a funder sending an amount the screen said clears a tier. The read takes
  ~150ms and **only what quotes a price waits on it** — the hero paints immediately and the
  Simulator shows skeletons sized to the numbers they'll become (see `docs/FRONTEND.md` §2, and
  don't reintroduce a whole-page gate: that put a white card where the hero belongs on every
  reload). The wait is silent; only a failure gets words. Two things that are *not* oracle
  values and stay constants: `YEAR_SECONDS` (`31_536_000` — ENS prices per second and has no
  notion of a year; this is a display convention that must stay equal to a 365-day year, since the
  tier durations are exact multiples of it, and deriving it from a Julian year shipped a real
  mispricing once — `docs/DECISIONS.md`, 2026-08-06), and `rateFor`'s indexing, which mirrors
  `_rateFor`'s **off-by-one**: the array index is `length - 1`, clamped, so a 3-character name
  reads `baseRates[2]`. Thresholds are not round numbers (e.g. the 3-year
  rate is exactly `$16.500044`), which is why `ceilToCent()`/`payableThresholds()` exist — UI
  quick-select buttons must never suggest an amount that silently under-shoots a tier. **The
  quick-selects cover the three discount tiers only — do not add a one-year button.** One year
  costs `$8.000021`, so a payable mark would read `$8.11`, and putting that beside the `$8/year`
  ENS itself advertises reads as skimming however the cent is explained; the 83-second shortfall is
  left to show as `11 months, 30 days` instead. Removed once already — see `docs/DECISIONS.md`. The same
  trap applies to *display*: `fmtUsdc` renders both `$27.000071` (six years, 43.75% off) and
  `$27.00` (four years eleven months, 31.25%) as "$27", so anywhere a reader might check the
  arithmetic use `fmtUsdcExact`.
- `registry.ts` — seeded mock activity/name data for the demo (see prototype note above). Two
  exceptions: `address` comes from `namepass.ts`, and `onchain` (expiry + renewability) comes from
  `ensName.ts` via `applyNameState` — don't fabricate either alongside the mock data.
  `applyNameState` **slides the whole simulated timeline** onto the real expiry rather than
  overwriting the end, or the runway reads "at activation 2027 → now 2045" against a history that
  only added ten years. Chain
  pool is `["Base", "Arbitrum", "Ethereum", "Arc"]` — **do not add Optimism**, there's no logo
  asset for it (`public/logos/`) and it's been deliberately removed from every mock data source.
  Polygon was replaced by Circle's **Arc** on 2026-08-05; if anything still says Polygon, it's
  stale. A chain lives in more places than it looks — `registry.ts`, `fees.ts`, `format.ts`'s
  explorer map, `tokens.ts`, `ChainTag`, `PassCard`, `BottomLeftCard`, and a logo in
  `public/logos/`. **The app currently points at testnets** (`IS_TESTNET` in `lib/tokens.ts`);
  `tokens.ts` and `format.ts`'s explorer map have to move together with it.
  Also models `PendingState` — funds that have arrived but aren't renewal time yet. **Balances are
  per chain and never merge**: the CREATE2 address is the same everywhere, but $5 on Base plus $8
  on Arbitrum is two pots that each have to clear the threshold alone, not $13. Hence
  `balances: ChainBalance[]` and `flows: ChainFlow[]` rather than single figures, one active flow
  per *chain* (a stuck Base transfer must not block a fresh Ethereum payment), and `canTrigger()`
  taking a specific balance. Keep UI enablement derived from `canTrigger()` rather than re-deriving
  the conditions in a component. **`holdReason` is non-nullable and must stay that way**: a deposit
  address is a pass-through, so money at rest is always blocked or broken, and an unexplained
  balance tells the funder the automation stalled and needs them. For the same reason the demo
  seeds every address at **zero** and grows states from simulated payments — a seeded balance has
  no story for why it's there. Only the two anomalies (`not_detected`, `flow_failed`) are
  triggerable; everything else resolves itself. There is **no** "awaiting confirmation" reason —
  the pipeline delivers finalized deposits only — and expired/premium-auction/never-registered are one
  `name_inactive` state, since the distinction changes nothing for the funder. `minTrigger()` is
  exported so the UI can name the per-chain minimum rather than just saying "too small".
  **`tickSimulation()` is the only source of pending state** — it's what the live feed drives on an
  interval, and it grows balances and flows from simulated payments (`activeFlows()` exposes the
  in-flight ones). It deliberately only touches the names in `SEED_NAMES`: a Namepass a visitor just
  activated has genuinely had nothing happen to it. `SEED_NAMES` has a **three-character floor** —
  ENS v2 prices nothing shorter, so such a name isn't registerable and any payment to it buys zero
  time. A renewal carries **three** amounts (`amountDeposited`,
  `gasAllowance`, `amountApplied`) because the allowance comes off on mainnet — don't collapse them
  back to one — and `steps: FlowStep[]` rather than a single tx hash. See `docs/ARCHITECTURE.md`.
- `fees.ts` — the flat `GAS_ALLOWANCE` ($0.10) taken from every flow. **Still a local constant,
  unlike ENS's rates, and the distinction is the point**: the rates are ENS's and mutable by ENS
  governance, so a stale copy mis-quotes someone else's price; the allowance is Namepass's own and
  is `public constant` in the helper's bytecode, so it can't drift without a redeployment. It is
  still checked rather than trusted — `assertGasAllowance()` reads it at boot and the app refuses
  to start on a mismatch. Standard CCTP has no Circle
  fee, so there is nothing per-chain to quote and nothing to buffer. Amounts the Simulator quotes
  are **send** amounts carrying the allowance, and results are solved from `budget − allowance` —
  quoting a send amount against what its pre-allowance value would buy silently drops a discount
  tier, which is the bug this arrangement exists to prevent. One allowance **per flow**, not per
  deposit.
- `ens.ts` — real network calls to the resolvio profile API (cached, deduplicated). **`fetchProfile`
  takes no `AbortSignal` on purpose** — requests are shared between callers, so cancelling on one
  component's unmount blanks the profile for every other one waiting on the same name. Callers
  ignore late results instead. Don't reintroduce the signal to "clean up properly".

**`contracts/` is Solidity, and nothing in the npm scripts touches it.** `npm run build` type-checks
and builds the frontend only. `contracts/NamepassFactory.sol` is a draft for mainnet deployment,
reviewed across several passes and covered by 61 Foundry tests, but **not audited**. It is deployed
to testnet only. Three constraints that are easy to break by accident:

- **Everything in `foundry.toml` is pinned on purpose.** `solc_version`, `evm_version`,
  `optimizer_runs` and `bytecode_hash = "none"` all feed the creation-code hash, and the factory
  must land on the *same address on all four chains* for the "one address, any chain" promise to
  hold. Changing any of them moves every deposit address the product has ever published. The
  pragma is pinned exactly (`pragma solidity 0.8.24;`) for the same reason — never float it.
- **On-chain, the key is the ENS *label*: `vitalik`, not `vitalik.eth`.** The contract rejects dots.
  The frontend and all user-facing copy still say *name*, which is correct — users have names. Don't
  "fix" one to match the other; the distinction is load-bearing and documented in
  `docs/ARCHITECTURE.md`.
- **The deposit wallet is an ERC-1167 proxy that delegatecalls the factory itself.** Every external
  factory function therefore carries `onlyFactoryContext` or `onlyWalletContext` — a new one added
  without either is reachable through every deposit wallet against the wallet's own storage. The
  assembly in `MinimalProxy` has been verified byte for byte against an independent CREATE2
  implementation; treat it as settled and don't rewrite it to "clean it up."
- **There is no sweep, and adding one back is a custody decision, not a convenience.** Tokens that
  aren't the configured USDC are permanently lost. A rescue path was written and removed after an
  audit — any function that moves a deposit wallet's tokens to an owner-chosen address has to
  exclude the payment asset by comparing against something, and the moment that something is
  mutable the guard is theatre. Relatedly, `usdc`/`tokenMessenger`/`l1Helper` are set once in
  `initialize` and frozen; **only `setFinality` stays mutable**, the CCTP per-burn cap is read live
  from Circle's TokenMinter rather than stored, and the CCTP fee ceiling is a per-call argument
  rather than state — so no owner setting can price or block a transfer. The helper's renewer
  pointers are movable only by ENS's own governance executor (the DAO **Timelock**, not the
  Governor), never by a Namepass key. **The helper holds two ENS renewers, not one** —
  `ETHRegistrar` for migrated names and `ETHRenewerV1` for premigrated v1 reservations — and picks
  per label via `isRenewable`, because both populations coexist during the migration. Its oracle
  must be read from whichever renewer was selected; see `docs/ARCHITECTURE.md`. Don't add an owner-settable address that
  a wallet transfers or approves to.

**`src/components/magicui/`** holds hand-ported Magic UI–style primitives (`ShineBorder`,
`AnimatedShinyText`, `NumberTicker`, `DotPattern`), restyled to the single navy brand accent
(`rgba(30,50,90,*)`) rather than Magic UI's default colors. When reusing one of these elsewhere,
reuse the same component/props combination rather than approximating the effect with new CSS —
visual consistency across instances has mattered more than novelty here.

**`Tooltip.tsx` and `ChainTag.tsx` are shared on purpose** — both were extracted after being
duplicated, so reuse them rather than writing a second one (same standing rule as the magicui
primitives). Two things about `Tooltip` that look like mistakes and aren't: it renders through a
**portal to `document.body`**, because it's used inside accordions that need `overflow-hidden` for
their height animations and would otherwise clip it; and it closes on scroll, because a fixed
bubble would otherwise drift away from its trigger.

**Security-relevant UI convention:** the Namepass deposit address is always shown in full, never
truncated (`PassCard.tsx`) — truncation would hide the middle of an address, which is where an
address-swap attack would land. The ENS profile's *resolved* address (informational, not a
payment target) is still truncated elsewhere.

## CI

**There is none.** The repo has no workflows at all — `.github/` holds only README screenshots. The
Claude Code Action that used to review every PR was removed on 2026-08-05, so nothing runs on push
or on a pull request, and nothing checks that `npm run build` passes before a merge. Verify locally.

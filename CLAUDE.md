# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
- **`docs/ARCHITECTURE.md`** — the planned backend: CREATE2-derived addresses, Circle CCTP with a
  hook that renews on the mint, the Postgres schema, and the trigger/retry policy. Nothing in it is
  built — this repo is still frontend-only — but the UI is being shaped against it, so read it
  before changing anything that models deposits, flows, or pending balances.
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
product a webhook detects payments, Circle's CCTP moves the USDC to Ethereum, and the renewal
executes in the same transaction that completes the transfer.

**This repo is a frontend prototype, not the production product.** The UI, routing, and pricing
math are real and exact; on-chain activity, balances, and ENS ecosystem stats shown in the app are
seeded/simulated client-side (`src/lib/registry.ts`), not pulled from a live indexer or contract.
Don't write copy or code comments that imply this repo talks to real chain state.

## Commands

```bash
npm install
npm run dev       # Vite dev server
npm run build     # tsc --noEmit && vite build — this IS the type-check step, there is no separate typecheck script
npm run preview   # serve the production build locally
```

There is no lint script and no test framework configured in this repo — don't invent `npm run
lint` or `npm test` invocations.

## Architecture

**Routing is hand-rolled, not a library.** `App.tsx` holds a `page` state
(`"home" | "leaderboard" | "terms" | "privacy"`), synced to `window.location` via
`history.pushState`/`popstate` — see `pathToPage`/`pageToPath`. There's no router dependency.
Vite's dev server falls back to `index.html` for unknown paths automatically; the production
Vercel deployment needs `vercel.json`'s catch-all rewrite for the same behavior, or direct
navigation/reload to `/leaderboard` etc. 404s.

**Every page renders inside `PageShell`, with `Navbar` as its first child.** `PageShell` is the
rounded card (video background on Home, white elsewhere) that every route shares — this is what
makes Home/Leaderboard/Terms/Privacy feel like one app instead of four stitched-together pages.
When adding a new page, wrap it in `PageShell` + `Navbar` the same way `App.tsx` does for the
existing ones, rather than giving it its own top-level layout. `Navbar` takes `showMenu={false}`
on non-Home pages (only Home shows the Explorer/Search/Cost simulator menu).

**`src/lib/` separates three different kinds of "data" — don't blur them:**
- `pricing.ts` — exact ENS v2 `StandardRentPriceOracle` math, `BigInt` end to end. `divCeil`
  mirrors the contract's `Math.Rounding.Ceil`. Thresholds are not round numbers (e.g. the 3-year
  rate is exactly `$16.500020`), which is why `ceilToCent()`/`payableThresholds()` exist — UI
  quick-select buttons must never suggest an amount that silently under-shoots a tier. The same
  trap applies to *display*: `fmtUsdc` renders both `$27.000032` (six years, 43.75% off) and
  `$27.00` (four years eleven months, 31.25%) as "$27", so anywhere a reader might check the
  arithmetic use `fmtUsdcExact`.
- `registry.ts` — seeded mock activity/name data for the demo (see prototype note above). Chain
  pool is `["Base", "Arbitrum", "Ethereum", "Polygon"]` — **do not add Optimism**, there's no logo
  asset for it (`public/logos/`) and it's been deliberately removed from every mock data source.
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
  webhooks fire on finalized deposits only — and expired/premium-auction/never-registered are one
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
- `fees.ts` — the flat `GAS_ALLOWANCE` ($0.10) taken from every flow. Standard CCTP has no Circle
  fee, so there is nothing per-chain to quote and nothing to buffer. Amounts the Simulator quotes
  are **send** amounts carrying the allowance, and results are solved from `budget − allowance` —
  quoting a send amount against what its pre-allowance value would buy silently drops a discount
  tier, which is the bug this arrangement exists to prevent. One allowance **per flow**, not per
  deposit.
- `ens.ts` — real network calls to the resolvio profile API (cached, deduplicated, abort-on-unmount).

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

`.github/workflows/claude.yml` runs this same Claude Code Action on every PR (open + push) and on
`@claude` mentions in comments/reviews/issues, authenticated via `CLAUDE_CODE_OAUTH_TOKEN` (bills
against the repo owner's Claude subscription, not a separate Anthropic API key).

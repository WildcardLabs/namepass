# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read these too

- **`README.md`** — the product pitch, feature tour, and tech stack, written for a human visiting
  the repo.
- **`PRODUCT.md`** — the detailed "what and why": the problem being solved, the core mechanic,
  positioning/tone decisions made through design iteration, and what's explicitly *not* decided
  yet. Read this before making product-facing decisions (copy, new features, framing) that aren't
  already covered below.
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
rate. In the real product, Coinbase CDP Agentic Wallets watch each address, detect payments,
calculate max renewal time, bridge if needed, and submit the renewal on-chain.

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
  quick-select buttons must never suggest an amount that silently under-shoots a tier.
- `registry.ts` — seeded mock activity/name data for the demo (see prototype note above). Chain
  pool is `["Base", "Arbitrum", "Ethereum", "Polygon"]` — **do not add Optimism**, there's no logo
  asset for it (`public/logos/`) and it's been deliberately removed from every mock data source.
- `ens.ts` — real network calls to the resolvio profile API (cached, deduplicated, abort-on-unmount).

**`src/components/magicui/`** holds hand-ported Magic UI–style primitives (`ShineBorder`,
`AnimatedShinyText`, `NumberTicker`, `DotPattern`), restyled to the single navy brand accent
(`rgba(30,50,90,*)`) rather than Magic UI's default colors. When reusing one of these elsewhere,
reuse the same component/props combination rather than approximating the effect with new CSS —
visual consistency across instances has mattered more than novelty here.

**Security-relevant UI convention:** the Namepass deposit address is always shown in full, never
truncated (`PassCard.tsx`) — truncation would hide the middle of an address, which is where an
address-swap attack would land. The ENS profile's *resolved* address (informational, not a
payment target) is still truncated elsewhere.

## CI

`.github/workflows/claude.yml` runs this same Claude Code Action on every PR (open + push) and on
`@claude` mentions in comments/reviews/issues, authenticated via `CLAUDE_CODE_OAUTH_TOKEN` (bills
against the repo owner's Claude subscription, not a separate Anthropic API key).

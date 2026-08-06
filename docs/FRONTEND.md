# Architecture — frontend (what actually exists)

`docs/ARCHITECTURE.md` describes the backend that is **planned and unbuilt**. This file describes
the app that is **built and running**, in enough detail to change it without re-deriving how it
works.

Read `CLAUDE.md` first for the short version and the working conventions. This is the long version.

---

## 1. What's real and what isn't

| Real | Simulated |
|---|---|
| ENS v2 pricing math, exact to the micro-unit (`lib/pricing.ts`) | All activity, balances and flows (`lib/registry.ts`) |
| ENS profile data — avatars, socials, addresses (`lib/ens.ts` → resolvio API) | Transaction hashes (random hex) |
| Block explorer URLs per chain (`lib/format.ts`) | Deposit addresses (random hex) |
| QR encoding (`lib/qr.ts`) | Expiry dates, renewal history |

There is **no** wallet connection, no RPC, no contract calls and no backend. Nothing writes
anywhere; reload resets everything.

---

## 2. Routing and shell

Hand-rolled, no router dependency. `App.tsx` holds `page: "home" | "leaderboard" | "terms" |
"privacy"` and syncs it to `window.location` via `history.pushState` + a `popstate` listener
(`pathToPage` / `pageToPath`).

Every route renders inside `PageShell` with `Navbar` as its first child — that's what makes four
pages feel like one app. `Navbar` takes `showMenu={false}` off Home. Vite's dev server falls back to
`index.html` for unknown paths; production needs `vercel.json`'s catch-all rewrite or a direct load
of `/leaderboard` 404s.

`App.tsx` also owns `selected: string | null` — the ENS name whose profile the Explorer is showing.
`goToName(name)` sets it, navigates Home if needed, and scrolls to the Explorer; it backs both
post-activation landing and the Leaderboard's "View activity" link.

---

## 3. The `lib/` layer

Five modules with deliberately separate jobs. Blurring them is the main way this codebase gets
worse.

**`pricing.ts` — exact contract math.** Mirrors ENS v2's `StandardRentPriceOracle` in `BigInt` end
to end. `divCeil` matches the contract's `Math.Rounding.Ceil`. Per-second rates by label length:
3 chars `20_280_377`, 4 chars `5_070_095`, 5+ chars `253_505` — nothing below 3 characters, which is
why a 2-character name can never be renewed.

Tier thresholds are **not round numbers**, and this is load-bearing:

| Duration | Exact threshold | Payable (`ceilToCent`) | Discount |
|---|---|---|---|
| 1 year | `$8.000010` | — | — |
| 2 years | `$14.000017` | `$14.01` | 12.5% |
| 3 years | `$16.500020` | `$16.51` | 31.25% |
| 6 years | `$27.000032` | `$27.01` | 43.75% |

`solve(budget, labelLength)` returns the longest duration a budget buys plus the tier it landed on.
Overshooting is always safe — it buys more time. Undershooting by one micro-unit costs a whole
tier. Every quoting decision in the app follows from that asymmetry.

**`fees.ts` — the flat `GAS_ALLOWANCE` ($0.10).** Standard CCTP has no Circle fee, so there is
nothing per-chain to quote. One allowance **per flow**, not per deposit, taken on mainnet in the
transaction that renews. Universal — Ethereum-origin payments never bridge but still trigger a
mainnet renewal.

**`registry.ts` — the domain model and the simulation.** Section 4 and 5.

**`ens.ts` — real network calls** to the resolvio profile API. Cached and deduplicated, and
deliberately **not** abortable — see the note in the file. Because requests are shared between
callers, one component's unmount must not cancel a request another is still waiting on; callers
ignore late results instead.

**`format.ts` — display only.** Note two pairs that exist because rounding lies:

- `fmtUsdc` → `$27` (dense rows) vs `fmtUsdcExact` → `$27.000032` (anywhere someone checks the
  arithmetic). `fmtUsdc` renders `$27.000032` and `$27.00` identically, and those buy 6 years and
  4y11m respectively.
- `fmtDuration` → `+6.0y` (table cells) vs `fmtDelivered` → `9 days` / `8 months` /
  `1 year 3 months` / `22 years` (adaptive, for the Leaderboard).

---

## 4. Domain model

```
NameRecord
├── name, labelLength, pass, address       identity
├── activatedAt, expiryAtActivation        runway start
├── events: ActivityEvent[]                history, oldest first
└── pending: PendingState                  money that isn't renewal time yet
```

**`ActivityEvent`** — one settled renewal (or the `activated` marker). Carries **three** amounts,
never collapse them: `amountDeposited` (what the funder sent) − `gasAllowance` = `amountApplied`
(what bought time). `seconds` and `off` are always solved from `amountApplied`. `steps: FlowStep[]`
is the transaction chain — 3 for an L2 payment (`deposit`, `burn`, `renewal`), 2 for Ethereum-origin
(no burn).

**`PendingState`** — the part most easily got wrong:

```ts
{
  balances: ChainBalance[]   // resting money, one entry per funded chain
  flows: ChainFlow[]         // renewals in motion, at most one per chain
  renewable: boolean         // can the ENS name be renewed at all
  gasAllowance: bigint       // what each flow will carry
}
```

Two invariants encoded in the types:

1. **Balances are per chain and never merge.** The CREATE2 address is identical everywhere, but $5
   on Base and $8 on Arbitrum are two pots that each have to clear the minimum alone. A single
   `held: bigint` was the original design and it was wrong.
2. **`holdReason` is non-nullable.** A deposit address is a pass-through, so resting money is always
   blocked or broken. An unexplained balance tells the funder the automation stalled and needs them.

| `holdReason` | Triggerable | Meaning |
|---|---|---|
| `not_detected` | ✅ | Webhook never fired — an anomaly |
| `flow_failed` | ✅ | Burn was attempted and didn't go out; funds never left |
| `flow_in_progress` | ❌ | Queued behind this chain's own active flow |
| `name_inactive` | ❌ | Expired, in premium auction, or never registered — one state on purpose |
| `below_threshold` | ❌ | Under `minTrigger()`, currently **$0.67** |

`canTrigger(pending, balance)` is the **only** gate — never re-derive its conditions in a component.
It requires a recoverable reason, a renewable name, no flow on that chain, and clearing the floor.

`minTrigger()` derives from `MAX_FEE_BPS` (1500 = 15%): the allowance may be at most 15% of the
balance, giving `$0.666667`. The UI must **state** this number; "too small" alone leaves nobody able
to act.

---

## 5. The simulation

All pending state is grown, never seeded. Every address starts empty — a seeded balance has no story
for why it's there.

**Entry point:** `tickSimulation()`, called on an interval by `LiveFeed`.

```
tickSimulation()
├── for each name, for each flow:
│     advanceFlow()  ──true──►  next stage, done for this tick
│                    ──false─►  6%: failFlow()      → balance, flow_failed
│                               94%: settleRenewal() → ActivityEvent
└── 55%: paymentArrives()
```

**`paymentArrives()`** picks a name from `SEED_NAMES` only — a Namepass a visitor just activated has
genuinely had nothing happen to it. 60% of the time it targets a chain already stuck
`below_threshold` (otherwise the accumulation path is statistically invisible); 25% of payments are
dust ($0.15–$0.60).

**`applyPayment(rec, chain, amount)`** is the webhook handler's logic. It judges the chain's **whole
balance**, not the arriving amount — which is what makes accumulation work for free:

```
total = existing balance on this chain + amount
  !renewable            → park as name_inactive
  flow on this chain    → park as flow_in_progress
  !clearsFloor(total)   → park as below_threshold
  4% chance            → park as not_detected
  otherwise            → start a flow with the whole total   ← the ordinary path
```

**Flow stages** (`advanceFlow`): `signing → burning → attesting → claiming`. Ethereum-origin flows
skip `burning` and `attesting` — nothing to bridge.

**`settleRenewal(rec, chain)`** computes `applied = flow.amount − gasAllowance`, solves the duration
from `applied`, appends an `ActivityEvent`, removes the flow, then **immediately starts the next flow
from any balance queued on that chain** — the backend wouldn't leave money resting once the chain is
free, and doing otherwise would need a null `holdReason`.

**`activeFlows()`** returns in-flight flows **newest first** (`startedAt` descending). Registry
order is seed order, so without the sort a payment that started seconds ago rendered below one that
had been bridging for a quarter of an hour. It flattens every in-flight flow across every name for
the live feed, with the
duration each will buy once it lands.

---

## 6. State ownership and re-rendering

`registry.ts` holds a **module-level mutable array**. Mutating it does not trigger React — so
components that drive it force their own re-render with `useReducer((n) => n + 1, 0)` and call the
dispatch after mutating. This is the one genuinely un-React-y thing in the codebase; it exists
because the mock is a stand-in for a server.

Two independent drivers, and they are **mutually exclusive by construction**:

- `LiveFeed` (Explorer, rendered only when no name is selected) — `tickSimulation()` every 2600ms.
- `PendingBalance` (inside `NameDetail`, only when a name *is* selected) — advances that name's own
  flows every 2000ms.

So flows never get double-advanced. `PendingBalance` is keyed `key={record.name}` so switching names
remounts it, resetting its timers and any open tooltip.

Consequences worth knowing before debugging:

- The demo compresses ~15 real minutes into ~8 seconds, so seeded in-flight states settle almost
  immediately. Reproducing a mid-flow state usually means triggering one deliberately.
- A dynamic `import('/src/lib/registry.ts')` from the browser console gets a **separate module
  instance** from the app's, with pristine seeded state. Fine for pure functions, useless for
  inspecting live state — read the DOM for that.
- `pending` must be built by `emptyPending()`, not spread from a shared literal. A shallow spread
  copies the array *references* and every name ends up pushing into the same two arrays.

---

## 7. Component map

```
App                       page + selected state, routing
├── PageShell             the rounded card every route lives in
│   └── Navbar            shared header
├── Hero                  home hero
├── Simulator             cost calculator; quotes send amounts incl. allowance
├── Explorer
│   ├── LiveFeed          in-flight rows (tinted, staged) above settled rows
│   └── NameDetail
│       ├── expiry panel + runway bar ("+X years via Namepass")
│       ├── PendingBalance    collapsed summary → per-chain rows
│       ├── PassCard          QR, full address, accepted chains
│       ├── aggregate tiles   time delivered / total received / renewals
│       └── activity table    expandable → RenewalBreakdown
├── Leaderboard           ranked rows → PassCard + "View activity"
└── Footer / Terms / Privacy
```

Shared primitives — reuse, don't reimplement: `Tooltip` (portaled to `document.body`, because it
sits inside `overflow-hidden` accordions), `ChainTag` (chain name + brand-coloured live dot),
`NameAvatar`, and `components/magicui/*`.

---

## 8. Invariants that must not break

1. Deposit addresses are shown **in full, never truncated** (`PassCard`) — truncation hides where an
   address-swap attack lands. The ENS profile's *resolved* address is informational and may be.
2. `holdReason` non-nullable; every resting balance explained.
3. Balances per chain; never summed into one figure.
4. One flow per `(name, chain)` — a stuck Base transfer must not block a fresh Ethereum payment.
5. `seconds` and `off` always solved from `amountApplied`, never the deposited amount.
6. Amounts in the breakdown panel use `fmtUsdcExact`; a tier can turn on a micro-unit.
7. `SEED_NAMES` labels are 3+ characters.
8. Chains are Base, Arbitrum, Arc, Ethereum. **No Optimism** — no logo asset, deliberately
   removed everywhere.
9. UI enablement derives from `canTrigger()`.
10. Aggregate tiles mix bases on purpose: `total received` is lifetime USDC at the address,
    `time delivered` is what the registry recorded. Not meant to reconcile.

---

## 9. Verifying a change

`npm run build` is the type-check (`tsc --noEmit && vite build`). There is no lint script and no
test framework — a Vitest suite over `pricing.ts` has been discussed and not built.

Beyond that, the useful technique is asserting invariants against the real modules in the browser
console while the dev server runs:

```js
const reg = await import('/src/lib/registry.ts');
const pricing = await import('/src/lib/pricing.ts');

let unexplained = 0;
for (let i = 0; i < 500; i++) {
  reg.tickSimulation();
  for (const r of reg.allNames())
    for (const b of r.pending.balances) if (!b.holdReason) unexplained++;
}
unexplained;   // must be 0
```

This caught the shared-array bug, confirmed 0 tier undershoots across all label/tier/chain
combinations, and verified the accumulation path fires. Remember the separate-instance caveat in
section 6: this is for logic, not for reading what's currently on screen.

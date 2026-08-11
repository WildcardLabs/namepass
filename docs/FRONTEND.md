# Architecture — frontend (what actually exists)

`docs/ARCHITECTURE.md` covers two things. The contracts are **deployed to testnet**. The automation
backend is **specified and unbuilt**. This file describes the app that is **built and running**. It
gives enough detail to change the app without a re-reading of the code.

The app does not call either of them. The app derives each deposit address to match the deployed
factory. The app does not read any activity or balance from a chain.

Read `CLAUDE.md` first for the short version and the working conventions. This is the long version.

---

## 1. What's real and what isn't

| Real | Simulated |
|---|---|
| ENS v2 pricing math, exact to the micro-unit (`lib/pricing.ts`) | All renewal history and activity (`lib/registry.ts`) |
| ENS's rates, read from its oracle at boot (`lib/oracle.ts`) | Transaction hashes (random hex) |
| Deposit addresses (`lib/namepass.ts` — the deployed factory's own derivation) | Balances, pending states, flow steps |
| **Name expiry and renewability (`lib/ensName.ts` — `findExpiry` / `isRenewable`)** | `activatedAt`, and the activation point on the runway bar |
| ENS profile data — avatars, socials, addresses (`lib/ens.ts` → resolvio API) | Aggregates and Leaderboard rank, which derive from the above |
| Block explorer URLs per chain (`lib/format.ts`) | The hero ticker's amounts and its `START_EXPIRY` base date |
| QR encoding (`lib/qr.ts`) | **`pass` (`<label>.namepass.eth`) — a template string that resolves to nothing** |

There is **no** wallet connection, no wallet-facing RPC, no transactions and no backend. Nothing
writes anywhere; reload resets everything. What the app *does* do on chain is read, twice, at
boot: ENS's pricing configuration and the helper's gas allowance.

**`pass` is the one to fix next.** `PassCard` shows `<label>.namepass.eth` under "Send here · auto
renewal address", above the raw address and copyable — but it's `${label}.namepass.eth` built by
string concatenation. `namepass.eth` is registered on Sepolia (expires 2027-08-11) and has **no
resolver**, so the subnames resolve to nothing: checked 2026-08-11, `vitalik.namepass.eth` comes
back with `resolver: null` and no addresses. It is a fabricated payment target presented more
prominently than the real one. Either set a wildcard resolver that returns the CREATE2 address, or
stop showing it.

Three things are real in a way the rest isn't:

- **The deposit address** depends on nothing but the factory address and the label, so it's
  computed locally and *matches* the chain rather than being read from it.
- **The prices** are ENS's own, fetched from the registrar's oracle. Only the inversion — longest
  duration a budget buys — is this app's arithmetic, and it's checked against the deployed
  helper's `quote()`.
- **The expiry and renewability** come from ENS's registry and renewers per name. The renewal
  *history* under them is still invented; `applyNameState` slides that history so its end lands on
  the real expiry rather than contradicting it.

  Both come from `ETHRegistrar` and `ETHRenewerV1`, which answer for **both** populations — v1's
  `BaseRegistrar` is deliberately not consulted. `findExpiry` runs 62 days later than v1's own
  registrar for premigrated names, and that is correct rather than a bug to fix: ENS v2 cuts grace
  90 → 28 days and applies a one-time +62 day renewal to every v1 name automatically at the
  upgrade, so from launch it is the operative date. See `docs/DECISIONS.md`, 2026-08-11.

Everything wrapped around them — what's arrived, what's pending, what it renewed — is still
simulation.

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

### Boot

`App.tsx` owns one more thing: `boot`, the state of the one-time read of ENS's pricing.

```
mount
  └─ Promise.all([ loadOracleRates(), assertGasAllowance() ])   ~150 ms
        ├─ setRates(live)      pricing.ts stops throwing
        ├─ initRegistry()      seeded demo history can now be priced
        └─ boot = "ready"
```

**Only what quotes a price waits.** This is a rule, not an implementation detail — an earlier
version held all of Home back and put a white card where the hero belongs for ~220ms on every
reload, with the document jumping 1007 → 3444px underneath it.

| Renders immediately | Waits |
|---|---|
| Hero — copy over video, quotes nothing | `BottomLeftCard`, the renewal ticker (`solve`) |
| Simulator's section, heading and card frame | its two inner panels, and the per-year rate on each length tab |
| Terms, Privacy, supported tokens | Explorer, Leaderboard |

While waiting, the Simulator shows **skeletons in the shape of the numbers** — its
placeholder and real bodies are both 916px, so nothing moves when the values land. Nothing
announces the read: a page narrating its own network calls is noise, and at ~150ms a spinner is a
flash rather than information.

A **failure** does get words (`PricingError`, inside the same card, with a retry), because there
is no fallback price to quietly carry on with — see `docs/DECISIONS.md` (2026-08-11) for why a
cached default was rejected. `Simulator` takes `priced` and `problem` and picks between body,
skeleton and error; `SimulatorBody` is a separate component precisely so it cannot mount before
the rates exist, since it prices in a `useState` initializer.

`initRegistry()` is the reason the seed can't be built at import any more: those renewals are
priced with the same `solve()`. It guards on its own `seeded` flag rather than on
`registry.length`, because a visitor can activate a Namepass from the claim modal — which never
waits — before the read lands.

**Dev-only gotcha:** editing `pricing.ts` resets its module singleton under mounted components, so
HMR surfaces `PricingNotLoadedError` where a fresh load wouldn't. Reload the page. There is no
error boundary, on purpose — the skeleton and error states are the handled paths, and a component
pricing without rates is a bug that should be loud.

---

## 3. The `lib/` layer

Modules with deliberately separate jobs. Blurring them is the main way this codebase gets worse.

**`rpc.ts` — a minimal `eth_call` client.** Batched JSON-RPC over `fetch`, selectors from
`keccak256`, and a decoder that handles exactly three shapes: a word, a pair of words, and a
length-prefixed array of fixed-width rows. Not a web3 library and not the start of one — the app
makes one kind of request, at boot, and never writes. Needing dynamic argument encoding, a
transaction, or a revert reason means taking a real dependency instead of growing this. Endpoint
is `VITE_SEPOLIA_RPC` or a public default.

**`oracle.ts` — ENS's live pricing configuration.** Reads `DISCOUNT_DENOMINATOR()`,
`getBaseRates()`, `getDiscountPoints()` and `getPaymentTokenRatio(USDC)` and hands them to
`pricing.ts`. Two details are load-bearing:

- **The oracle address is not pinned.** The two ENS *renewer* addresses are, and the oracle is
  whatever `rentPriceOracle()` currently returns on them — the same indirection the helper uses,
  for the same stated reason. ENS governance can repoint an oracle and the app follows.
- **Both renewers must agree.** `_quote` picks a renewer per label with `isRenewable`; the app's
  price table is generic (3 / 4 / 5+ characters) and has no label to pick with. So it reads both
  and refuses if they differ, rather than drawing one table for two price regimes.

`validate()` mirrors the contract's `_validatePoints`: durations must ascend and numerators
descend, or "the first affordable tier is the best tier" — which is how `solve` picks — stops
being true. A mis-shaped oracle stops the app rather than quietly mis-pricing it.

**`pricing.ts` — exact contract math, with no numbers of its own.** Mirrors ENS v2's
`StandardRentPriceOracle` in `BigInt` end to end; `divCeil` matches the contract's
`Math.Rounding.Ceil`. Rates arrive via `setRates()` at boot and **every function throws
`PricingNotLoadedError` until they do** — there is deliberately no default and no cached copy,
because a fallback price is a made-up price. Today's values give per-second rates of 3 chars
`20_294_267`, 4 chars `5_073_567`, 5+ chars `253_679`, i.e. `$640`/`$160`/`$8` per **365-day**
year — but read them off the chain rather than from this paragraph.

Two things here are *not* oracle values:

- `YEAR_SECONDS` (`31_536_000`). ENS prices per second and has no notion of a year; this is a
  display convention, and it's the right one only because the tier durations are exact multiples
  of it. Deriving it from a Julian year is a real bug this file has already had once — see
  `docs/DECISIONS.md`.
- `rateFor`'s indexing, which mirrors `_rateFor`'s **off-by-one**: index is `length - 1`, clamped
  to the array, so a 3-character name reads `baseRates[2]` and a 40-character one reads the last
  entry.

Tier thresholds are **not round numbers**, and this is load-bearing (values as of the oracle's
current configuration):

| Duration | Exact threshold | Payable (`ceilToCent`) | Discount |
|---|---|---|---|
| 1 year | `$8.000021` | — | — |
| 2 years | `$14.000037` | `$14.01` | 12.5% |
| 3 years | `$16.500044` | `$16.51` | 31.25% |
| 6 years | `$27.000071` | `$27.01` | 43.75% |

`solve(budget, labelLength)` returns the longest duration a budget buys plus the tier it landed on.
Overshooting is always safe — it buys more time. Undershooting by one micro-unit costs a whole
tier. Every quoting decision in the app follows from that asymmetry.

The one-year row has no payable amount because **there is deliberately no one-year quick-select** —
`payableThresholds()` returns the three discount tiers only. See `docs/DECISIONS.md` (2026-08-06)
before adding one; it was built and removed for positioning reasons, not oversight.

**`fees.ts` — the flat `GAS_ALLOWANCE` ($0.10).** Standard CCTP has no Circle fee, so there is
nothing per-chain to quote. One allowance **per flow**, not per deposit, taken on mainnet in the
transaction that renews. Universal — Ethereum-origin payments never bridge but still trigger a
mainnet renewal.

Unlike ENS's rates this stays a local constant, and the reason is worth keeping straight: the
rates belong to ENS and are mutable by ENS governance, so a stale copy mis-quotes someone else's
price; the allowance is Namepass's own and is `public constant` in the helper's bytecode, so it
can't move without a redeployment. It's still verified rather than trusted —
`assertGasAllowance()` reads it at boot and the app refuses to start on a mismatch, since a wrong
allowance is a dime off every figure the Simulator shows.

**`namepass.ts` — label → deposit address.** The deployed factory's `predictWallet(string)`,
reimplemented in TypeScript so the app can show an address without an RPC call:
`salt = keccak256(keccak256("NAMEPASS_DEPOSIT_WALLET_V1") ++ keccak256(label))`, then the ERC-1167
CREATE2 address with the factory as implementation *and* deployer (a deposit wallet delegatecalls
the factory itself). Output is EIP-55 checksummed. Verified against all four testnets:
`depositAddress("vitalik")` is `0x043c184003266644372bA5fA4946777b3f1cFC3D`, same as `cast call`.

Two things here are correctness, not politeness:

- **`NAMEPASS_FACTORY` belongs to the testnet set.** `hubChainId` is in the factory's creation
  code, so a mainnet factory lands elsewhere and derives a different address for every name.
  `depositAddress` throws outright if `IS_TESTNET` is false, because the alternative is quietly
  printing an address nobody controls. This constant and `tokens.ts` move together.
- **`normalizeLabel` runs before every derivation.** The contract hashes the exact UTF-8 bytes it
  is handed and cannot normalize — ENSIP-15 isn't reproducible in Solidity — so an un-normalized
  label derives a *valid-looking* address for a name that can never be renewed, and there is no
  sweep. `@adraffy/ens-normalize` is what closes that gap, and it is why the UI validates with
  `labelProblem()` rather than a regex that approximates the same rules.

**`registry.ts` — the domain model and the simulation.** Section 4 and 5. Its `address` field is
the one thing on a `NameRecord` that isn't invented; it comes from `namepass.ts`.

**`ens.ts` — real network calls** to the resolvio profile API. Cached and deduplicated, and
deliberately **not** abortable — see the note in the file. Because requests are shared between
callers, one component's unmount must not cancel a request another is still waiting on; callers
ignore late results instead.

**`format.ts` — display only.** Note two pairs that exist because rounding lies:

- `fmtUsdc` → `$27` (dense rows) vs `fmtUsdcExact` → `$27.000071` (anywhere someone checks the
  arithmetic). `fmtUsdc` renders `$27.000071` and `$27.00` identically, and those buy 6 years and
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
| `below_threshold` | ❌ | Under `minTrigger()`, **$0.50** |

`canTrigger(pending, balance)` is the **only** gate — never re-derive its conditions in a component.
It requires a recoverable reason, a renewable name, no flow on that chain, and clearing the floor.

`minTrigger()` returns `MIN_TRIGGER`, a flat **$0.50** per chain, decided 2026-08-11. It replaced a
ratio (`MAX_FEE_BPS = 1500`, giving `$0.666667`) that was a placeholder for an undecided business
number. The UI must **state** this figure; "too small" alone leaves nobody able to act.

In production the API returns the configured minimum and this constant goes away — see
`docs/ARCHITECTURE.md` → Minimum amount. Until the Phase 6 frontend cutover it is the number the
card states.

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

**`applyPayment(rec, chain, amount)`** is the ingestion handler's logic. It judges the chain's **whole
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
11. **No price is ever shown from memory.** `pricing.ts` holds no default rates and no cached
    copy; it throws until `setRates()` has run. Adding a fallback so the Simulator can paint
    sooner reintroduces the exact failure the gate exists to prevent.

---

## 9. Verifying a change

`npm run build` is the type-check (`tsc --noEmit && vite build`). There is no lint script and no
**JavaScript** test framework. A Vitest suite over `pricing.ts` has been discussed and not built.
The contracts do have tests: `forge test` runs 61 of them. `npm run build` does not build
`contracts/`.

Beyond that, the useful technique is asserting invariants against the real modules in the browser
console while the dev server runs:

The strongest check available for pricing is the deployed helper itself — `quote(label, amount)`
answers what the contract would actually charge, and `solve()` must match it to the second:

```js
const pricing = await import('/src/lib/pricing.ts');
pricing.solve(8000000n, 7).seconds;   // 31535917n
// cast call $HELPER 'quote(string,uint256)(uint64,uint256)' vitalik 8000000
```

Beyond that:

```js
const reg = await import('/src/lib/registry.ts');

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

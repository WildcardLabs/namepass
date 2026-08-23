# Architecture — frontend (what actually exists)

`docs/ARCHITECTURE.md` covers the contracts and automation backend. Both are deployed to the stable
testnet environment. This file describes the app that is built.
It gives enough detail to change the app without re-reading the code.

The app derives each deposit address to match the deployed factory. The Explorer and Leaderboard
read public data through the Vercel API. They do not connect to Neon or chain RPC directly.

Read `CLAUDE.md` first for the short version and the working conventions. This is the long version.

### Current public read model

`publicApi.ts` is the browser boundary for `GET /api/activity`, `GET /api/names/:label`,
`GET /api/names/:label/activity`, `GET /api/flows/:id`, `GET /api/leaderboard`, public
configuration, and activation.
`readModel.ts` adapts those responses to the existing visual components. It keeps USDC values as
decimal strings or `bigint`. It does not create simulated activity.

The activity endpoints return canonical `Renewed` events. The global endpoint also returns up to
six live workflow rows so a fresh Explorer load can show in-flight work. A payment event is not
shown as a completed renewal. Each renewal keeps `Funded by` separate from `Processed by`. The first value
comes from an exact linked deposit or one unique recovered deposit match. An ambiguous recovery
states why the sender is unavailable. The second value comes from the permanent `Renewed`
executor fact. A recent canonical delete removes the row on the next poll.

The selected-name endpoints return one native-USDC balance per active chain. An `amount: null`
means that the server could not read that chain. The UI renders it as unavailable, never as zero.
`GET /api/config/public` returns one decimal trigger floor for every active chain. The browser
validates the complete set before it enables a manual renewal. It shows the floor as unavailable
until this read succeeds. The endpoint can also return the optional public relayer address. It
never returns the relayer private key.

An eligible balance can become visible before its automatic flow row. The pending card shows this
gap as `preparing renewal`. It does not offer a manual retry until the balance remains unmatched for
two reads and at least 20 seconds. A recent stopped flow with eligible funds shows its safe error
code and deposit evidence. It is immediately retryable.

The live feed polls every 12 seconds. A selected name polls every 4 seconds while it has one of the
eight active workflow states and every 15 seconds while idle. A held, unclaimed, failed, settled,
or cancelled flow does not keep the fast poll active. Both views refetch on window focus and back
off after errors.
The live feed and per-name activity use ten-row pages with `Previous` and `Next` controls. They
consume the activity cursor only when the user opens an older page. The per-name flow list contains
pending, held, unclaimed, failed, and actionable stopped work. Settled renewals appear only in activity. Funding
controls appear only after activation returns from the API.

The browser preserves each active backend flow status. `flowPresentation.ts` supplies only the
user-facing copy. It also uses the origin chain. `submitting_origin` and `waiting_origin` describe
an Ethereum renewal when the origin is Ethereum. The same states describe a Circle transfer for
Base, Arbitrum, or Arc. A direct Ethereum renewal must not show transfer or burn copy. After an
origin receipt is available, flow cards show `amountProcessed` instead of the earlier detected
amount. An expanded pending card also shows confirmed transaction evidence with explorer links.
It shows the detected deposit first and adds the Circle burn only after its receipt succeeds. It
does not present a submitted transaction as complete. A reverted Ethereum origin says that the
renewal did not go through. A reverted source-chain
origin says that the Circle transfer did not go through.

The Leaderboard contains only names with at least one completed renewal. The server applies this
rule before its limit, and the browser applies the same rule at its response boundary. The
Leaderboard keeps a separate list of labels from its latest API response. Records loaded by the
Explorer cannot appear in the ranking by accident. Expanding one leaderboard row requests the
three latest renewals for that name. The expansion shows these transactions only. Its profile
button opens the selected-name Explorer, which contains the full profile and activity history.

---

## 1. What's real and what isn't

| Real | Demo-only |
|---|---|
| ENS v2 pricing math, exact to the micro-unit (`lib/pricing.ts`) | The hero ticker's sample activity |
| ENS's rates, read from its oracle at boot (`lib/oracle.ts`) | The hero ticker's amounts and its `START_EXPIRY` base date |
| Deposit addresses (`lib/namepass.ts` — the deployed factory's own derivation) | None on production screens |
| Activation, canonical renewals, flows, and leaderboard values (`lib/publicApi.ts`) | The hero ticker is product illustration, not activity data |
| ENS profile data — avatars, socials, addresses (`lib/ens.ts` → resolvio API) | None on production screens |
| Chain and deployment configuration (`lib/chains.ts`) | None on production screens |
| QR encoding (`lib/qr.ts`) | None on production screens |

There is no wallet connection or browser database credential. Activation and public reads use the
API. The backend still needs deployment before a hosted preview can show live records.

`PassCard` shows and copies only the activated deposit address. It does not show the unresolvable
`<label>.namepass.eth` template.

Three things are real in a way the rest isn't:

- **The deposit address** depends on nothing but the factory address and the label, so it's
  computed locally and *matches* the chain rather than being read from it.
- **The prices** are ENS's own, fetched from the registrar's oracle. Only the inversion — longest
  duration a budget buys — is this app's arithmetic, and it's checked against the deployed
  helper's `quote()`.
- **The expiry and renewability** are read by the server during activation and returned through the
  public API. The browser does not perform a second chain read.

  Both come from `ETHRegistrar` and `ETHRenewerV1`, which answer for **both** populations — v1's
  `BaseRegistrar` is deliberately not consulted. `findExpiry` runs 62 days later than v1's own
  registrar for premigrated names, and that is correct rather than a bug to fix: ENS v2 cuts grace
  90 → 28 days and applies a one-time +62 day renewal to every v1 name automatically at the
  upgrade, so from launch it is the operative date. See `docs/DECISIONS.md`, 2026-08-11.

The browser does not invent deposits, flow states, sender addresses, executor addresses, or
transaction hashes.

---

## 2. Routing and shell

Hand-rolled, no router dependency. `App.tsx` holds `page: "home" | "leaderboard" | "supported" |
"terms" | "privacy"` and syncs it to `window.location` through `history.pushState` and a
`popstate` listener (`pathToPage` / `pageToPath`).

Every route renders inside `PageShell` with `Navbar` as its first child. This makes five pages feel
like one app. `Navbar` takes `showMenu={false}` off Home. Vite's dev server falls back to
`index.html` for unknown paths; production needs `vercel.json`'s catch-all rewrite or a direct load
of `/leaderboard` 404s.

`App.tsx` also owns `selected: string | null` — the ENS name whose profile the Explorer is showing.
`goToName(name)` sets it, navigates Home if needed, and scrolls to the Explorer; it backs both
post-activation landing and the Leaderboard's "View profile" link.

### Boot

`App.tsx` owns one more thing: `boot`, the state of the one-time read of ENS's pricing.

```
mount
  └─ Promise.all([ loadOracleRates(), assertGasAllowance() ])   ~150 ms
        ├─ setRates(live)      pricing.ts stops throwing
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

**Dev-only gotcha:** editing `pricing.ts` resets its module singleton under mounted components, so
HMR surfaces `PricingNotLoadedError` where a fresh load wouldn't. Reload the page. There is no
error boundary, on purpose — the skeleton and error states are the handled paths, and a component
pricing without rates is a bug that should be loud.

---

## 3. The `lib/` layer

Modules with deliberately separate jobs. Blurring them is the main way this codebase gets worse.

**`chains.ts` — shared chain and deployment configuration.** It supplies chain names, IDs, native
USDC, Namepass and Circle deployments, explorers, RPC variable names, finality, polling, tags, and
logo files. The frontend and server views come from this one registry. `tokens.ts` remains a small
frontend adapter. Run `node scripts/check-chains.mjs` after a registry change.

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
  printing an address nobody controls. Both values come from `chains.ts`.
- **`normalizeLabel` runs before every derivation.** The contract hashes the exact UTF-8 bytes it
  is handed and cannot normalize — ENSIP-15 isn't reproducible in Solidity — so an un-normalized
  label derives a *valid-looking* address for a name that can never be renewed, and there is no
  sweep. `@adraffy/ens-normalize` is what closes that gap, and it is why the UI validates with
  `labelProblem()` rather than a regex that approximates the same rules.

**`publicApi.ts`** validates the browser response boundary. **`readModel.ts`** maps canonical
renewal facts and flow state into the existing Explorer and Leaderboard component contracts.

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

## 4. Component map

```
App                       page + selected state, routing
├── PageShell             the rounded card every route lives in
│   └── Navbar            shared header
├── Hero                  home hero
├── Simulator             cost calculator; quotes send amounts incl. allowance
├── Explorer
│   ├── LiveFeed          in-flight rows (tinted, staged) above settled rows
│   └── NameDetail
│       ├── authoritative ENS expiry panel
│       ├── PendingBalance    collapsed summary → per-chain rows
│       ├── PassCard          QR, full address, accepted chains
│       ├── aggregate tiles   time delivered / total received / renewals
│       └── activity table    expandable → RenewalBreakdown
├── Leaderboard           ranked rows → three latest transactions + "View profile"
└── Footer / Terms / Privacy
```

Shared primitives — reuse, don't reimplement: `Tooltip` (portaled to `document.body`, because it
sits inside `overflow-hidden` accordions), `ChainTag` (chain name + brand-coloured live dot),
`NameAvatar`, and `components/magicui/*`.

The production read model does not contain `expiryAtActivation`. The backend never recorded that
fact. Do not derive it by subtracting Namepass-delivered time from the current ENS expiry because
an owner or ENS migration can also change the expiry.

---

## 5. Invariants that must not break

1. Deposit addresses are shown **in full, never truncated** (`PassCard`) — truncation hides where an
   address-swap attack lands. The ENS profile's *resolved* address is informational and may be.
2. `holdReason` non-nullable; every resting balance explained.
3. Balances per chain; never summed into one figure.
4. One flow per `(name, chain)` — a stuck Base transfer must not block a fresh Ethereum payment.
5. `seconds` and `off` always solved from `amountApplied`, never the deposited amount.
6. Amounts in the breakdown panel use `fmtUsdcExact`; a tier can turn on a micro-unit.
7. `chains.ts` defines Base, Arbitrum, Arc, and Ethereum. **No Optimism.**
8. A manual renewal requires `canTrigger()` and, for an unmatched balance, an expired detection
   grace period. Explicit flow failures do not use the grace period.
9. Aggregate tiles use canonical renewals: `total received` is the sum received by completed
    renewals, and `time delivered` is the time those renewals added. Pending wallet funds remain in
    the separate pending balance section.
10. **No price is ever shown from memory.** `pricing.ts` holds no default rates and no cached
    copy; it throws until `setRates()` has run. Adding a fallback so the Simulator can paint
    sooner reintroduces the exact failure the gate exists to prevent.

---

## 6. Verifying a change

`npm run build` type-checks the browser and builds the Vite, Nitro, and Workflow output. Run
`npm run check:server` for the server TypeScript check. Run `npm run test:frontend` for the browser
adapter checks, `npm run test:server` for the Node server tests, and `npm run test:workflow` for the
Workflow runtime probe. There is no lint script and no `npm test` alias. The contracts have 61
Foundry tests. Run them with `forge test`; `npm run build` does not build `contracts/`.

Run `node scripts/check-chains.mjs` after a chain registry change. It checks completeness, unique
identifiers, generated views, and logo assets.

The strongest check available for pricing is the deployed helper itself — `quote(label, amount)`
answers what the contract would actually charge, and `solve()` must match it to the second:

```js
const pricing = await import('/src/lib/pricing.ts');
pricing.solve(8000000n, 7).seconds;   // 31535917n
// cast call $HELPER 'quote(string,uint256)(uint64,uint256)' vitalik 8000000
```

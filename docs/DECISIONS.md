# Decisions

A running, dated log of non-obvious architecture and product calls, and why they were made.
Append new entries at the top. Skip this for anything that's just "the obvious way to do it" —
this is for decisions someone could reasonably have made differently, where the *why* would
otherwise only live in a PR conversation or a chat transcript.

---

### 2026-07-29 — Hold reasons cut to five, and the minimum is stated

Review pass on the pending-balance model. Two states removed, one number surfaced, plus a
shared-mutable-state bug that the review is what caught.

- **No `awaiting_confirmations`.** Removed the day it was added. Webhooks fire on *finalized*
  deposits, so there is no moment where the app knows money is coming but hasn't arrived — it
  modelled something the platform cannot observe.
- **`premium_auction` + `unregistered` → `name_inactive`.** Expired, mid-auction and
  never-registered are different on-chain situations that make no difference to a funder: the name
  can't be renewed and the money waits. Three reasons were three ways of saying that.
- **The minimum is now stated, not just enforced.** `minTrigger()` (currently **$0.67**, derived
  from the 15% ratio) is exported so the card can say "under the $0.67 minimum on this chain".
  "Too small" without the number leaves nobody able to act on it — the funder can't tell whether
  they're 20¢ or $20 short.
- **The accumulation path was modelled but unobservable.** A second payment topping up a
  sub-threshold balance has always worked, but picking name and chain uniformly at random across
  12 names × 4 chains made hitting the same pot twice so rare you'd never see it. Payments now
  prefer a chain that's already stuck under the threshold, which is also what really happens.
  Verified: 49 accumulation events over 600 ticks, versus effectively none before.

**Bug found in review: `pending: { ...NO_PENDING }` shared its arrays across every name.** A
shallow spread copies the `balances`/`flows` *references*, so `park()` pushed into one array that
all twelve names pointed at, and a balance for one name appeared on the others until something
happened to reassign them. It surfaced as the non-renewable name showing a failed transfer, which
should be impossible — a flow can't start on a name that can't be renewed. Replaced with an
`emptyPending()` factory. Verified over 600 ticks: no shared arrays, and zero leaked states onto
the inactive name.

Two smaller display calls from the same pass:

- **The collapsed summary asks `canTrigger` rather than filtering on the reason**, because reason
  alone promised "needs a retry" on names where no button ever appears.
- **The runway bar reads "+27.4 years via Namepass", not "years added".** The expiry above it is the
  name's real one, and an owner may well have renewed elsewhere too — the unqualified version
  claimed credit for time Namepass didn't deliver. Also dropped "Already on Ethereum — no transfer
  needed" from the breakdown; the transaction list already shows there was no burn.
- **Time delivered is formatted adaptively** — `fmtDelivered()` gives days, then months, then years
  and months. No single unit works: a 3-character name's renewals are measured in days (months
  rounds them to "0 months"), most names sit under a year (where "0.4 years" reads as nothing), and
  the heavily-funded ones reach decades (where "264 months" is arithmetic homework). The
  leaderboard's ranked figure switches unit at the same boundaries as the subtitle under it.
- **Leaderboard rows gained a "View <name> activity" link** — they showed an address but no way to
  reach the history. Styled to PassCard's own radius, border and white surface, since a bare
  bordered button read as grey against the panel behind it.
- **`op.eth` removed from the seed data; three characters is the floor.** ENS v2 prices nothing
  below three characters, so a 2-character name isn't registerable and any payment to it buys zero
  time — it sat in the leaderboard claiming "4 renewals · 0 months delivered". Replaced with
  `nouns.eth`, documented on `SEED_NAMES`, and the activation path now refuses short names outright
  rather than minting an address that could never work.
- **An un-renewable name's whole runway shifts back, not just its final expiry.** Overwriting the
  end alone gave `ens.eth` "at activation: 2027 → now: expired", which says time ran backwards past
  nine renewals that genuinely added some. Sliding the timeline keeps the arithmetic intact: it was
  already near expiry when the pass was activated, renewals pushed it out, it lapsed anyway.
- **The simulation only touches the demo's own names.** A Namepass a visitor just activated was
  being fed invented payments from strangers within seconds, overwriting the one true thing the
  page could say about it — "waiting for the first payment".

### 2026-07-29 — Every resting balance must be explained, so addresses start empty

**A deposit address is a pass-through, not a wallet.** Money sitting in one is always either
blocked by something or a failure — so a balance shown with nothing wrong with it tells the funder
the automation stalled and is waiting on them, which is the opposite of what the product claims.

Caught in review: `vitalik.eth` held $24.50 on Base and `uniswap.eth` held $11 on Base, both with
`holdReason: null`, rendering as "· ready". Ready for what? Had a transfer failed? Was the deposit
too small? The card couldn't say, because there was nothing to say.

Three changes, in increasing order of how much they prevent a recurrence:

1. **`holdReason` is non-nullable.** An unexplained balance is now unrepresentable rather than
   merely absent from the fixtures.
2. **Every address seeds at zero.** Pending states are grown by the simulation from arriving
   payments, so each one carries the reason that parked it. The happy path — payment lands, clears
   the floor, goes straight out — became the common case rather than an absence, which is also a
   truer demo: a healthy address shows *no card at all*.
3. **Only anomalies are triggerable.** `canTrigger` now requires `not_detected` (the webhook never
   fired) or `flow_failed` (a burn was attempted and didn't go out) — the two cases a person can
   actually clear. Offering a button for `below_threshold` or `awaiting_confirmations` implied the
   automation needed supervision for states it resolves on its own. `not_detected` is new; the
   webhook-failure case previously had no reason of its own and would have shown up as an
   unexplained balance.

Consequences worth knowing:

- **A queued balance now starts its next flow the instant the previous one settles**, rather than
  reverting to a null reason. That's both what the backend would do and the only way to keep the
  invariant.
- **`awaiting_confirmations` is modelled as the first state of every deposit**, since it was
  otherwise unreachable and its copy was dead. A payment lands unconfirmed, then the next tick
  judges it — which is also how accumulation works, because the whole chain balance is re-judged,
  not just the new deposit.
- Verified over 500 simulated ticks: zero unexplained balances, zero non-positive balances, and all
  six reachable reasons occurring naturally. `unregistered` still has no fixture — every demo name
  shows an expiry above the card, which that reason would contradict.

Related bug fixed at the same time: the collapsed summary reported only the in-flight amount when a
flow existed, so a waiting balance vanished from the headline when a renewal started on a *different
chain* and reappeared when it settled — money seeming to come and go. It now names both.

### 2026-07-29 — Balances are per chain, and the feed shows work in progress

**A single `held` figure was wrong.** A CREATE2 address is identical on every chain, which makes one
global balance look natural — but the balances are separate pots that can never be combined. $5 on
Base plus $8 on Arbitrum is not $13; it's two payments that each have to clear the threshold alone.
`PendingState` is now `balances: ChainBalance[]` and `flows: ChainFlow[]`.

Consequences, all of which the single figure had been hiding:

- **The flow constraint moved from `(name)` to `(name, chain)`.** The stricter version was
  justified by batching mainnet gas — an argument that doesn't survive, since funds on different
  chains can't merge, so there was nothing to batch. Worse, it let a stuck Base transfer block a
  fresh Ethereum payment needing no CCTP at all. A name can now legitimately run four flows.
- **The threshold applies per chain.** 50¢ on Base and 50¢ on Polygon means neither moves, which
  looks like a bug unless the card says so — hence the "balances on different chains can't be
  combined" line whenever more than one chain is funded.
- **Dust strands permanently** on a chain nobody tops up. Shown honestly; no sweep designed.

**The trigger button was re-weighted from primary action to escape hatch.** Normal accumulation is
webhook-driven — a payment lands, the handler checks that chain's *balance* (not the deposit
amount) and goes. The button is for when the webhook or the burn didn't fire. So it now appears
per-chain, only where that chain is actually stuck, and the collapsed card leads with what's
waiting rather than a call to action.

**The card collapses to one line.** Priority: needs-a-retry, then in-progress, then waiting — the
actionable thing first, motion second. Expanding shows one row per funded chain; rows only exist
for chains with a balance, so in practice it's one or two.

**In-flight renewals now appear in the Explorer feed.** With Across a transfer took seconds and
there was nothing to watch; standard CCTP takes 13–19 minutes, so a feed of only settled renewals
called itself "Live" while showing nothing but the past. Rows appear at the burn and update through
the stages. They show projected values as `~6.0y` rather than `+6.0y` — nothing has been added yet,
and if the claim reverts nothing will be.

Two display bugs caught in review, both worth recording because they're the same underlying trap:

- **`fmtUsdc` rounds away the digits that decide a tier.** It renders `$27.000032` (six years at
  43.75% off) and `$27.00` (four years eleven months at 31.25%) identically as "$27" — so the
  breakdown panel showed an amount that, taken at face value, doesn't buy what's beside it. Added
  `fmtUsdcExact` for anywhere a reader checks arithmetic. This is exactly the trap `ceilToCent()`
  exists to prevent, one layer up in the display.
- **The breakdown showed where money went but never the rate it bought at**, so "$27 · 6 years"
  read as an error until you noticed the bulk rate is $4.50, not the headline $8. Added an
  "Effective rate" line.

Also: tooltips are portaled to `document.body`. They live inside accordions that need
`overflow-hidden` for their height animation, which clipped them. And the live-feed grid uses
`minmax(0,…)` columns — bare `fr` has an implicit `auto` minimum, so one long status string was
widening its column at every other column's expense.

### 2026-07-29 — CREATE2 addresses and CCTP, replacing CDP wallets and Across

**Supersedes the 2026-07-28 "Backend shape" entry below.** Two changes, and they resolve each
other's loose ends.

**Addresses are derived with CREATE2**, not issued by a CDP server wallet. A name's address is
computable from the name alone — it exists before anyone claims it and anyone can verify it offline
without trusting a Namepass API. Contract and factory work is deliberately out of scope until this
goes live.

**This makes the platform non-custodial**, which reverses yesterday's correction in the opposite
direction and is worth being precise about, since the log now contains both. Yesterday: the
"address, not agent" framing had been justified with "deterministic, non-custodial, no third party
in the loop", that was false under CDP server wallets, and it was corrected. Today the architecture
makes it true. The framing didn't change to fit the architecture; the architecture moved and the
claim became accurate. For renewal *infrastructure* asking people to send money to an address, that
distinction is the product.

**Bridging is standard CCTP, not Across.** A Moralis webhook hits a Vercel serverless function that
burns with a hook; a Vercel Workflow polls Circle's Iris API for the attestation; when it lands, one
atomic mainnet transaction mints and renews together. Consequences:

- **No fees to quote.** Standard CCTP carries no Circle fee, so the entire per-chain
  estimate/buffer apparatus built the day before is deleted — no quoting, no chain variance, no
  staleness problem, no circular quote. Replaced by a flat **$0.10 gas allowance** on every flow,
  taken by the mainnet contract in the renewal transaction. Universal: an Ethereum-origin payment
  never bridges but still triggers a mainnet renewal, so it carries the same allowance. It is a
  rebate, not cost recovery — a mainnet renewal costs dollars of gas.
- **One allowance per flow**, not per deposit. Several payments that accumulate and settle together
  are one renewal and one deduction; `deposit_allocations` already modelled this.
- **The refund hazard mostly disappears.** A CCTP burn is irreversible — there is no
  refund-to-origin, so `deposits.kind = 'bridge_refund'` and the infinite-retry loop it guarded
  against largely go away. The failure mode becomes "attested but unclaimed", which is strictly
  better: the funds sit as a replayable message rather than bouncing.
- **Burn only after confirming the name is renewable.** Load-bearing. Burn first on a
  premium-auction name and the funds leave the deposit address to sit as an unclaimed message, and
  the pending-balance card has nothing to show — it reads on-chain balance at the address. Gate the
  burn and the existing UI holds.
- **It is slower, not faster.** Standard CCTP waits ~13–19 minutes for attestation where an Across
  intent took seconds. In-flight state now persists long enough that people will reload mid-flow,
  so the stage copy names what is being waited on ("Waiting for Circle attestation") rather than
  showing a generic spinner.

Rejected alternative: CCTP Fast Transfer, which is near-instant but charges a fee — reintroducing
exactly the per-chain quoting problem this removes, to speed up something nobody is watching in
real time.

### 2026-07-28 — Simulator quotes fee-inclusively, with a worst-chain allowance

Settles the question left open earlier the same day. Every amount the Simulator shows is now a
**send** amount that carries a bridging allowance: `worst supported chain's fee + 20%`, currently
$1.20 (Arbitrum) + 20% = **$1.44**. Quick-select buttons read `$17.95 → 3y` where they used to read
`$16.51 → 3y`, and every result is solved from `budget − allowance` rather than `budget`.

**The bug this fixes was total, not marginal.** `payableThresholds()` rounds each tier up to the
next payable cent, so any fee above a cent drops the payment below the threshold. Checked across
every combination: all **9** tier/label-length pairs would have dropped a tier when sending the
quoted amount from Arbitrum — aim at the 6-year 43.75% rate on a 3-character name, land on 3-year
31.25%. After the change, **0 undershoots across 36 combinations** (3 lengths × 3 tiers × 4 chains),
verified against the real modules.

Why an allowance rather than the alternatives:

- **Worst chain, not per-chain.** A chain selector would be exactly correct for everyone and nobody
  would overpay, but it adds a control to a tool that currently asks the reader for nothing, and
  makes the headline number chain-dependent. Asking someone to look up their own chain and do the
  addition is the mistake this exists to prevent.
- **Overshooting is free**, which is what makes one-number-for-everyone viable. `solve()` buys the
  longest duration the money covers, so an Ethereum sender's surplus $1.44 comes back as extra time
  rather than being lost. The asymmetry is the whole argument: undershooting costs a *tier*.
- **20% of the fee, not a flat 20¢.** Volatility scales with the fee — mainnet gas spikes move it
  in absolute terms — so a proportional cushion tracks the risk. Circle give the same ~20% guidance
  for CCTP fees for the same reason.
- **A live quote can't be the safety mechanism**, only the displayed estimate. Fees move between
  render and send, and they move in the direction that hurts. `src/lib/fees.ts` is the seam where a
  real Across quote replaces the hardcoded table; the allowance stays either way.

Consequences worth knowing: the footnote changed from "These figures are before bridging fees" to
"Amounts include a bridging allowance", because the first became false. `Effective cost` is now
all-in (`send ÷ years`, $4.74/yr) rather than the ENS rate ($4.50/yr) — deliberate, since
"effective" means after everything, and the `Reaches renewal` row makes the difference visible.
The per-chain fee list under the buttons shows *raw* estimates, not buffered ones; it exists to
explain why the amounts are larger than the bare ENS thresholds, not to be added to them.

### 2026-07-28 — Renewal breakdown: three amounts, and demo data quoted fee-inclusively

`ActivityEvent.amount` became `amountDeposited` / `bridgeFee` / `amountApplied`, and `tx` (one hash)
became `steps: FlowStep[]`. The bridge takes its fee out of the amount in transit, so what bought
renewal time is genuinely less than what the funder sent, and collapsing that back to one number
would have hidden the gap.

The load-bearing call is in the seed data: **`AMOUNTS` is now the amount that gets *applied*, with
the fee added on top to reach the deposit** — a $16.50 renewal shows as $17.55 received on Base. The
alternative (treat the seeded value as the deposit and subtract) was tried in thinking and rejected:
every threshold in `AMOUNTS` is an exact tier boundary, so subtracting a fee drops all of them a
tier and the demo fills with near-misses that look like bugs rather than a feature tour.

That choice also amounts to modelling **fee-inclusive quoting** — the funder is assumed to have been
quoted an amount that survives the fee. It's the recommendation in `docs/ARCHITECTURE.md`, and this
is the first place the app takes a position on it, so flipping that decision means changing the
seed data too.

**Rows show both amounts when a fee was taken.** Caught during review: `seconds` and `off` are
correctly computed from `amountApplied` everywhere, but the row displayed only `amountDeposited`
beside them — so `$17.55 · 31.25% off · +3.0y` looked like an arithmetic error, since $17.55 at that
tier ($5.500007/yr for 5+ chars) implies +3.2y. Three numbers in one row, computed from two
different bases.

Rejected: showing only the applied amount (breaks the funder's own number and stops matching
`totalReceived` and the leaderboard) and leaving it to the expansion (the row still looks wrong at a
glance, and the live feed has no expansion at all). Settled on a muted `$16.50 applied` second line,
rendered by one shared `AmountCell` used in all four places rather than four near-copies. It
disappears for Ethereum-origin rows, which usefully doubles as a "no bridge here" signal.

**The aggregate tiles are deliberately *not* given the same treatment.** Proposed adding an
"applied" figure under "Total received" for consistency with the rows, and rejected: the two tiles
answer different questions. **Total received** is how much has ever arrived at the Namepass address
— the contribution total, which is also what the leaderboard ranks on. **Time delivered** is what
was actually bought in the ENS registry. Neither is derived from the other, so there is nothing to
reconcile and a fees line would only imply a relationship that isn't being claimed.

The row-level case was different, and that's the distinction to keep in mind: there, the amount, the
rate and the duration sit on one line and the last two *are* computed from the first, so showing a
pre-fee number beside them read as broken arithmetic. Independent tiles carry no such implication.

**The Simulator now says its figures are pre-fee**, since the ENS math it shows is exact but the
amount reaching that math isn't once a bridge takes its cut. First version spelled the whole thing
out inline and made the panel clunky; cut to one line with the detail behind the shared `Tooltip`,
which was extracted out of `PendingBalance.tsx` for the purpose rather than reimplemented — same
short-label-plus-explanation problem, so same component.

Smaller calls:

- **Aggregate tiles: values bottom-align via `flex-1` on the label, and the suffix is `y` not
  ` years`.** At three-up on a phone, "TIME DELIVERED" and "TOTAL RECEIVED" wrap to two lines while
  "RENEWALS" doesn't, so the values sat at three different heights; " years" wrapped too. Letting
  the label absorb the slack fixes the first, and the short suffix (already the convention in
  `fmtDuration`) fixes the second.
- **Fill and renewal are one step, not two.** The renewal rides Across's post-deposit hook, so it
  lands with the fill or reverts with it — showing them separately would imply a failure mode that
  can't happen. Cross-chain payments show 3 transactions, Ethereum-origin ones show 2.
- Reused the Leaderboard's accordion exactly (same `motion` props, same `ChevronDown` rotate) rather
  than writing a second expand animation — see the 2026-07-27 entry on approximating effects.
- Renamed the activity column "Amount" → "Received" in all four places it appears (desktop + mobile,
  live feed + name detail), since it's now specifically the pre-fee number.

### 2026-07-28 — Pending balance: allocation is the discriminator, not a status flag

The name card needed to distinguish "funds anyone can trigger" from "funds already moving," and the
obvious version — a status field on the balance — was rejected. Instead the split falls out of
`deposit_allocations`: `in_flight` is what an active flow has claimed, `held` is what's left.
Starting a flow allocates in the same transaction, so there's no window where money looks
triggerable while a flow owns it, and no second source of truth to drift.

Calls made alongside it:

- **One active flow per name** (unique partial index on non-terminal statuses). Guards the
  open-to-anyone trigger against double-spend races, and batches — mainnet gas gets paid once even
  when three people fund a name at the same moment. Consequence, accepted knowingly: funds arriving
  mid-flow *queue* rather than starting a second flow. An earlier sketch in the same conversation
  said held funds stayed triggerable during a flow; that contradicted the index and was wrong.
- **Auto-trigger threshold is a fee ratio (~15%), not a flat dollar floor.** $1 buys ~45 days on a
  5+ character name, ~2.3 days on a 4-character one, ~14 hours on a 3-character one, and the
  dominant cost is mainnet gas for the fill, which moves. A fixed floor is wrong in both directions
  and needs a config change every time gas spikes. (ENS has no minimum renewal duration — the
  28-day minimum is registration-only — so the constraint is purely economic.)
- **Hold reasons are stored, not inferred.** "The last attempt failed" and "the name can't be
  renewed yet" need different things from whoever is reading them, so they get different copy.
- **Short label inline, full sentence in the tooltip.** First pass put the same sentence in both and
  it read as a stutter.
- **No `unregistered` fixture in the demo data.** Tried it, and the card claimed the name wasn't
  registered directly beneath a panel reading "908 days of registration remaining." For the same
  reason, demo names seeded as un-renewable get their expiry pushed into the past so the panel above
  reads "Expired — needs renewal." The state is real on the backend; it just has no honest fixture
  here.
- `simulateRenewal()` skips un-renewable names — otherwise the live feed appended renewals to the
  name whose card said it was stuck in a premium auction.

### 2026-07-28 — Backend shape: CDP server wallets + Across intents with a post-deposit hook

> **Superseded 2026-07-29** by CREATE2 addresses and CCTP — see the entry at the top. Kept because
> the reasoning about atomicity, refund handling and why a durable orchestrator is needed still
> explains how the current design was arrived at.

Settled (not re-litigate territory). Each name's deposit address is a **CDP server wallet**, with
guardrails restricting what it can sign — its only job is signing an Across bridge intent. Across
intents carry a **post-deposit hook** that executes the ENS renewal on bridge settlement, so the
renewal isn't a separately orchestrated step we have to wait on and retry; it's part of the fill.
A separate API wallet pushes the transactions and sponsors gas. This flow is already proven in
another project of the author's; server wallets are in production use elsewhere (e.g. Bankr).

Consequences worth writing down:

- **This is custodial**, and that's accepted. Guardrails on the signer are the mitigation, not a
  claim of non-custody. See the correction on the "address, not agent" entry below.
- **No USDC→ETH swap step.** ENS v2 renewals are paid in stablecoins, so USDC goes end to end.
- **Failed Across bridges refund to the CDP wallet** — which re-triggers the deposit webhook. An
  inbound transfer is therefore *not* necessarily a user payment, and the ingestion layer has to
  classify it or the product double-counts its own refunds. This is the main reason the deposit
  ledger carries a `kind` discriminator.
- Rejected alternative (considered 2026-07-28, before the above was known): a durable
  multi-step saga — bridge, poll for attestation, swap, then renew — via Inngest/Trigger.dev.
  Unnecessary; the post-deposit hook collapses settlement and renewal into one atomic outcome.

### 2026-07-28 — Started this log instead of growing PRODUCT.md indefinitely

`PRODUCT.md`'s "positioning and tone" section was accumulating decision rationale as prose that
would need rewriting every time something new was decided. Splitting decisions out here means new
ones are appended, not edited-in. `PRODUCT.md` stays the current-state summary; this file is the
history of how it got that way.

---

### 2026-07-27 — Client-side routing is hand-rolled, not a router library

Four pages (home, leaderboard, terms, privacy), `history.pushState` + `popstate` is ~40 lines.
A router dependency would be more ceremony than the problem warrants at this size. Revisit if the
page count grows significantly or nested/dynamic routes show up.

### 2026-07-27 — Auto-review on every PR, not just `@claude` mentions

`.github/workflows/claude.yml` was originally mention-only (`@claude` in a comment/review/issue).
Changed to also trigger on `pull_request: [opened, synchronize]` per explicit request for
automatic review. Tradeoff accepted knowingly: this runs (and bills, against the user's Claude
subscription via `CLAUDE_CODE_OAUTH_TOKEN`) on *every* PR automatically, not just when asked.

### 2026-07-27 — `CLAUDE_CODE_OAUTH_TOKEN` over `ANTHROPIC_API_KEY` for CI

A plain API key from console.anthropic.com bills separately from the user's existing Claude
subscription. `claude setup-token` generates a long-lived (~1yr) OAuth token scoped to the
subscription instead. Tradeoff: the token is personal, tied to whoever ran `setup-token` — if that
person leaves/loses access, CI breaks. Acceptable for a solo-owned repo now; revisit (probably back
to an org-level API key) if this becomes a team repo.

### 2026-07-27 — Repo renamed `demo` → `namepass-v2`

No functional reason beyond naming clarity — flagging only because it required updating the local
git remote and any hardcoded clone URLs (README.md had one that went stale and was missed until
caught later — worth grepping for the old name if this ever needs doing again).

### 2026-07-27 — Deposit addresses are always shown in full, never truncated

Truncation hides the middle of an address, which is exactly where an address-swap/homograph attack
would land — a sender couldn't verify what they're actually paying. The ENS profile's *resolved*
address (informational, not a payment target) is still truncated elsewhere, since that tradeoff
doesn't apply the same way.

### 2026-07-27 — Leaderboard rows expand inline, not a separate page/route

Originally clicking a row navigated to that name's detail view on the Explorer page. Changed to an
inline accordion (chevron rotates, `PassCard` renders in place) per explicit request — keeps the
leaderboard self-contained rather than bouncing the user between pages for what's fundamentally a
"peek at this address" action.

### 2026-07-27 — The header lives inside `PageShell`, not above it

Tried a version where `Navbar` was a fixed/floating bar spanning all pages independent of page
content — rejected as looking like "a section bolted on top" rather than part of the page. Settled
on `PageShell` rendering `Navbar` as its first child on every route (video card on Home, white
card elsewhere), so the header is structurally part of whatever page it's on.

### 2026-07-27 — Reuse shine/shimmer effects exactly, don't approximate

Added a custom straight-line shimmer sweep to the Leaderboard button/toggle instead of reusing the
`ShineBorder`/`AnimatedShinyText` combo already established on the hero badge. Visually similar,
not identical — caught immediately. Standing rule now: "match X" means reuse the same
component/props, not a new implementation that looks similar.

### 2026-07-27 — Optimism excluded from supported chains

Appeared in mock/demo data (rotating chain preview, live activity feed) despite having no logo
asset and not being in the actual supported-chains list shown on `PassCard`. Removed everywhere —
`lib/registry.ts`'s chain pool, `Explorer.tsx`'s color/ping maps, `BottomLeftCard`'s rotation.
Chain support is Base, Arbitrum, Polygon, Ethereum only unless explicitly revisited.

### 2026-07-27 — Avoid the word "permanent" in user-facing copy

The underlying property (deposit address never changes) is genuinely permanent, but the word
itself was flagged for removal from copy — likely brand/liability-tone reasons, not stated
explicitly beyond "we want to avoid using the term 'permanent' anywhere on the app." Alternate
phrasing in use: "deposit address for name extensions," "auto renewal address," "never changes."

### 2026-07-27 — "Address," not "agent," as the primary framing

Considered leading with "Every name gets its own agent" instead of "Your name gets its own
address," since the real backend genuinely is agent-automated (CDP Agentic Wallets). Rejected:
for a security-conscious crypto audience, "agent" raises a custody question ("is the agent holding
my funds?") that "address" doesn't. Automation is still described, just as what happens *behind*
the address, not the headline noun.

> **Corrected 2026-07-28.** This entry originally justified the choice with "deterministic,
> non-custodial, no third party in the loop." That was never claimed by the project and was not
> true of the architecture at the time — CDP server wallets held keys and signed on our behalf.
> The decision here is about *which question the copy invites*, not about the custody model.
>
> **Update 2026-07-29.** Under CREATE2-derived addresses the original wording is now accurate.
> The framing was not retrofitted to the architecture — the architecture moved and the claim
> became true. See the CREATE2/CCTP entry at the top.

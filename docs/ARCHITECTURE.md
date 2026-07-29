# Architecture — backend (planned, unbuilt)

The plan for the real backend, as far as it's been worked out. This repo is still a frontend
prototype (see `CLAUDE.md`), so nothing here is built yet — this is the design the UI is being
shaped against, plus an honest list of what's still open.

**For the app that does exist, see `docs/FRONTEND.md`.** That covers the running frontend in
detail: data layer, domain model, simulation lifecycle, state model, component map and invariants.

Settled calls and their rationale live in `docs/DECISIONS.md`; this file is the current picture,
not the history.

## Addresses — CREATE2 derivation

Each name's deposit address is derived **deterministically with CREATE2** from the name. It exists
before anyone claims it, and anyone can recompute and verify it offline without trusting a Namepass
API. No third party holds keys — this is what makes the platform non-custodial, and for
infrastructure asking people to send money to an address, that is the product, not a detail.

```
salt    = namehash(ensip15_normalize(name))
address = CREATE2(factory, salt, keccak256(initcode))
```

Three properties this buys, each load-bearing:

1. **Same address on every chain.** Only if the *factory* is at the same address on every chain —
   deploy it through a deterministic deployer (the canonical CREATE2 factory / Safe singleton
   factory) rather than a normal deploy, or the addresses diverge per chain and the whole
   "one address, any chain" promise breaks.
2. **Counterfactual receipt.** A CREATE2 address can hold tokens *before the contract exists*. So an
   address can be advertised, funded and verified with nothing deployed; deploy on first flow. This
   is what makes "every name already has an address" true rather than marketing.
3. **The DB becomes an index, not a source of truth.** The address is a pure function of the name, so
   a lost row is recoverable by recomputation and a wrong row is detectable.

The deployed contract needs a deliberately tiny surface: hold USDC, and let an authorized caller
approve and burn it to CCTP. Nothing else — every capability added here is custody surface.

**ENSIP-15 normalization before hashing is a security requirement, not a formatting nicety.** Skip it
and a homoglyph of a well-known name derives a different address while rendering identically in the
Explorer, which turns Namepass's own UI into a credible-looking way to collect payments meant for
someone else. Use `@adraffy/ens-normalize`.

Contract and factory work is out of scope until this goes live.

## The flow

```
  deposit         burn + hook      attestation        mint + renewal
  ───────►  ───────────────►  ──────────────►  ─────────────────►
  (any chain)   Vercel fn         Circle Iris      (mainnet, atomic)
                                Vercel Workflow
```

1. USDC lands at a name's CREATE2 address on Base, Arbitrum, Polygon or Ethereum.
2. A **Moralis webhook** hits a Vercel serverless function. It records the deposit and, if the
   trigger conditions are met, starts a flow.
3. The function performs the CCTP **burn with a hook** on the origin chain.
4. A **Vercel Workflow** polls Circle's **Iris API** for the attestation — the slow step, roughly
   13–19 minutes on standard transfers.
5. Once attested, one atomic mainnet transaction **mints and renews together** via the CCTP hook,
   and takes the gas allowance in the same transaction.

An Ethereum-origin payment skips steps 3–4 entirely: the funds are already on mainnet, so it goes
straight to a renewal. It still carries the allowance.

Step 5 is atomic. If the renewal reverts, the whole transaction reverts and the message stays
**attested but unclaimed** — replayable indefinitely rather than stranded. There is no state where
funds arrived on mainnet but silently vanished.

**Burn only after confirming the name is renewable.** This is load-bearing. Burn first on a name
sitting in its premium auction and the funds leave the deposit address to wait as an unclaimed
message, and the pending-balance card has nothing to show, because it reads the on-chain balance at
the address. Gate the burn on renewability and held funds stay visible where the sender left them.

Consequences that shape everything else:

- **The gas allowance comes off on mainnet.** The renewal is bought with $0.10 less than the sender
  sent, so three amounts have to be tracked, not one.
- **A CCTP burn is irreversible.** There is no refund-to-origin, so the "a refund looks like a
  deposit" hazard that shaped the deposit ledger is largely gone (see `deposits.kind` below).

## CCTP at contract level

Standard (not Fast) transfers: no Circle fee, ~13–19 minutes for attestation. Fast Transfer is
near-instant but charges a fee, which would reintroduce the per-chain quoting problem the flat
allowance exists to remove — rejected, see `docs/DECISIONS.md`.

| Step | Contract | Call |
|---|---|---|
| Burn on origin | `TokenMessenger` | `depositForBurn` (v2: the hook-carrying variant) |
| Attest | — | off-chain, Circle's Iris API |
| Mint + renew on mainnet | `MessageTransmitter` | `receiveMessage(message, attestation)` |

The renewal rides the **hook payload** in the burn message, so it executes inside
`receiveMessage` — one transaction that mints, renews and takes the allowance. Atomic by
construction: a reverting renewal reverts the mint, leaving the message attested and replayable.

Two things to pin down against Circle's current docs before building — treat the details here as
directional, not verified: the exact v2 method name and hook-payload encoding, and the **domain IDs**
(Ethereum 0, Arbitrum 3, Base 6, Polygon 7 to the best of current knowledge — confirm, because
getting one wrong sends funds to the right address on the wrong chain).

## Services

Everything runs on Vercel alongside the app: same repo, same env, atomic deploys, no CORS.

### `POST /api/webhooks/moralis` — deposit ingestion

Thin by design. Verify the HMAC signature, write the row, decide, return 200 quickly (Moralis
retries non-2xx, and a slow handler becomes duplicate deliveries).

```
verify signature  →  store raw payload (webhook_deliveries)
                  →  upsert deposit, unique on (chain_id, tx_hash, log_index)
                  →  applyPayment: park with a reason, or start a flow
                  →  if starting, enqueue the renewal Workflow
                  →  200
```

It must **not** run the flow. Even with settlement and renewal collapsed into one transaction,
waiting on the attestation is 13–19 minutes — far outside any serverless limit.

### `POST /api/names/:name/claim` — activation

Normalize (ENSIP-15) → derive address → insert `names` row → register the address with the Moralis
stream. Idempotent: claiming an existing name returns it.

### `POST /api/flows/trigger` — the manual escape hatch

Open to anyone, rate-limited. Re-checks every precondition server-side (never trust the client's
view, which is stale the instant it renders) and returns `409` when a flow is already active on that
`(name, chain)`. Exists only for the anomalies — see Trigger policy.

### Vercel Workflow: `renewal` — durable orchestration

One instance per flow. Steps are individually idempotent and resumable, which is the whole reason
this isn't a request handler:

| Step | Does | On failure |
|---|---|---|
| `burn` | Sign + send `depositForBurn` on origin | Retry with backoff; funds never left, so safe |
| `awaitAttestation` | Poll Iris until complete | Sleep + retry; this is the 13–19 min wait |
| `claim` | `receiveMessage` on mainnet — mints, renews, takes allowance | Message stays attested + unclaimed → retryable forever |
| `record` | Write `renewals` + `flow_steps`, bump aggregates | Retry; reconciler catches drift |

### Vercel Cron: `reconcile`

The safety net, independent of webhooks. Compares each address's on-chain balance against
`Σ deposits − Σ allocations`, surfaces flows past their per-status SLA, and refreshes aggregates.
This is the only defence against a webhook that never arrives at all — the thing most likely to be
skipped and most expensive to skip.

### Environment

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (writes; never shipped to the client),
`SUPABASE_ANON_KEY` (client reads), `MORALIS_API_KEY`, `MORALIS_WEBHOOK_SECRET`, RPC URLs per chain,
the signer key for the gas-sponsoring wallet, and `CIRCLE_IRIS_URL`.

## Schema

Three layers: an append-only ledger (truth), a state machine (lifecycle), derived read models
(speed). Money is `numeric(78,0)` in base units throughout — never float, never JS `number`.

### names

`id`, `name` (ENSIP-15 normalized), `label`, `label_length`, `namehash`, `deposit_address`,
`claimed_at`, `current_expiry`, `expiry_synced_at`. No custodial account id — the address is a pure
function of the name, so this row is an index, not the source of truth.

Plus denormalized leaderboard columns — `total_received`, `total_seconds`, `renewal_count`,
`last_renewal_at`. The ledger is the source of truth; these are a cache a reconciler rebuilds and
alerts on when they drift.

### deposits

Every inbound transfer to a monitored address.

`id`, `name_id`, `kind`, `classified_by`, `refund_for_flow_id`, `chain_id`, `token`, `from_address`,
`amount`, `tx_hash`, `log_index`, `block_number`, `block_time`, `confirmations`, `status`.

```sql
constraint deposits_onchain_unique unique (chain_id, tx_hash, log_index)
```

That constraint is the idempotency key. Webhooks are at-least-once; this makes a duplicate delivery
a no-op instead of a double renewal.

`kind` is one of `user_deposit | internal | unknown`. Under CCTP a burn is irreversible, so the
`bridge_refund` case that originally motivated this field is gone — nothing comes back to the
address after a failed transfer, because the money was never returned, only left unclaimed.

`kind` stays anyway, and it is worth being clear that it is now doing a smaller job: quarantining
transfers that aren't sender payments (`unknown` by default rather than auto-processing) and keeping
non-payment movements out of contribution totals. It is no longer load-bearing for retry capping.

Retries still need a cap, but for a different reason: a flow can fail before the burn goes out
(gas, nonce, RPC), leaving the funds untouched at the address and eligible to try again. `attempt`
on the flow covers that directly, without needing to recognise returning money.

### flows

One renewal attempt. `id`, `name_id`, `status`, `origin_chain_id`, `amount_in`, `gas_allowance`,
`amount_applied`, `quoted_seconds`, `quoted_expiry`, `actual_seconds`, `actual_expiry`,
`cctp_nonce`, `attestation`, `attempt`, `retriggered_from`, `last_error`, `next_retry_at`,
`entered_status_at`, `created_at`.

```
pending → ready → signing → burning → attesting → claiming → settled
                                                       └──→ unclaimed
                                                       └──→ failed | cancelled
```

`unclaimed` is the CCTP-specific state: attested, mintable, but the claim reverted — most likely
because the name became un-renewable between burn and attestation. It is retryable forever, which
is why it is a distinct state rather than a failure.

An Ethereum-origin flow skips `burning` and `attesting`.

`quoted_*` and `actual_*` are separate because the pricing math is exact and the UI shows a specific
duration — storing both is how the day they diverge gets noticed.

```sql
create unique index one_active_flow_per_name_chain
  on flows (name_id, origin_chain_id)
  where status not in ('settled','failed','cancelled');
```

This is the real guard against double-triggering, since the trigger is open to anyone and UI state
is stale the instant it renders. A second concurrent trigger for the same chain hits a constraint
violation and the API returns `409 already in progress`.

**On `(name, chain)`, not on `name` alone.** An earlier draft used the stricter version, arguing it
batched mainnet gas. That argument doesn't survive: funds on different chains can't merge, so there
was never anything to batch — and it would have let a stuck Base transfer block a fresh Ethereum
payment that needs no CCTP at all. Chains proceed independently; a name can legitimately have four
flows running at once.

### flow_steps

Every on-chain transaction belonging to a flow — `deposit`, `burn`, `renewal` — with `chain_id`,
`tx_hash`, `gas_cost_wei`, `gas_payer`, `block_time`, `error`.

This is what the Explorer renders when a renewal is expanded — `ActivityEvent.steps` in
`src/lib/registry.ts` already models it. Cross-chain payments produce three (deposit, burn, mint +
renewal); Ethereum-origin payments skip the burn and produce two. The mint and the renewal are one
transaction, not two, because the renewal rides the CCTP hook — and the UI labels that final step
"Renewed" rather than "Minted and renewed" when nothing was bridged.

### flow_events

Append-only audit: `flow_id`, `from_status`, `to_status`, `actor`
(`webhook | worker | reconciler | admin:<id>`), `reason`, `payload`, `created_at`. This is what
answers "why is this stuck and what has already been tried" in the admin panel.

### deposit_allocations

`deposit_id`, `flow_id`, `amount`. N deposits → 1 flow (accumulation), 1 deposit → partial spend.

### webhook_deliveries

Raw payloads stored **before** parsing — `provider`, `signature_valid`, `payload`, `received_at`,
`processed_at`, `error`. This is the replay source when a delivery fails mid-processing.

## Held vs in-flight — and it's per chain

The UI needs to tell "funds you can trigger" from "funds already moving." That distinction is not a
flag — it falls out of allocation, **computed per chain**:

```
in_flight[c] = Σ allocations to flows on chain c in (ready, signing, burning, attesting, claiming)
held[c]      = Σ confirmed deposits on chain c − Σ allocations on chain c
```

**The per-chain part is load-bearing and easy to get wrong.** A CREATE2 address is identical on
every chain, which makes a single global balance figure look natural — and it's wrong. The balances
are separate pots that can never be combined, so:

- **The trigger threshold applies per chain.** 50¢ on Base plus 50¢ on Polygon means *neither*
  goes anywhere, despite $1 sitting at the address. The UI has to say this or it reads as broken.
- **Dust strands permanently.** 30¢ on a chain nobody else funds will sit there forever; under a
  global-balance model it would eventually combine with something. No sweep mechanism is designed.
  Show it honestly rather than implying it's on its way.
- **A stuck chain doesn't block the others**, which is what the `(name, chain)` constraint above
  buys.

Starting a flow allocates deposits **in the same transaction**, so there is no window where money
looks triggerable while a flow owns it, and no separate flag to keep in sync.

`src/components/PendingBalance.tsx` renders this, with a `holdReason` driving the tooltip:

**Every resting balance carries a reason — there is no unexplained state.** A deposit address is a
pass-through, not a wallet: money at rest is always either blocked by something or a failure. Show
a balance with nothing wrong with it and you've told the funder the automation stalled and needs
them, which is the opposite of the product. `holdReason` is non-nullable for exactly this reason.

| Reason | Triggerable | Meaning |
|---|---|---|
| `not_detected` | ✅ | The webhook never fired — an anomaly |
| `flow_failed` | ✅ | A burn was attempted and didn't go out; funds never left |
| `flow_in_progress` | ❌ | Queued behind this chain's active flow |
| `name_inactive` | ❌ | Expired, in premium auction, or never registered |
| `below_threshold` | ❌ | Under the per-chain minimum (currently **$0.67**) |

**`name_inactive` is deliberately one state, not three.** Expired, mid-premium-auction and
never-registered are different on-chain situations that make no difference here — all three mean the
name can't be renewed and the funds wait. Splitting them is three ways of telling the funder the
same thing.

**There is no "awaiting confirmation" state.** Webhooks fire on finalized deposits only, so there
is no moment where the app knows money is coming but hasn't arrived. An earlier draft modelled one;
it described something the platform can't observe.

**The minimum has to be stated, not just enforced.** `minTrigger()` exists so the UI can say
"under the $0.67 minimum on this chain" — "too small" without a number leaves nobody able to act on
it.

Only the two anomalies are triggerable. Everything else the system resolves on its own, and
offering a button for those would imply the automation needs supervision. Reasons are stored, not
inferred — "we tried and it failed" must never read the same as "waiting for the name to become
renewable", because they need different things from whoever is looking.

## Read models — what the frontend actually asks for

The schema above is the write side. This is the read side, and it's the part that decides whether the
frontend is usable. Each query below maps to something `src/lib/registry.ts` already exposes, so the
migration is a data-source swap rather than a UI rewrite — see `docs/FRONTEND.md` §4 for the shapes.

**Stats come from finalized renewals only, never from deposits.** That single rule is what stops
in-flight or failed money inflating anything public.

### Live feed — `recentActivity()`

Two queries, in-flight above settled:

```sql
-- in flight
select f.id, n.name, f.origin_chain_id, f.amount_in, f.status, f.quoted_seconds
from flows f join names n on n.id = f.name_id
where f.status in ('ready','signing','burning','attesting','claiming')
order by f.entered_status_at desc;

-- settled
select r.tx_hash, n.name, r.origin_chain_id, r.amount_in, r.gas_allowance,
       r.amount_applied, r.duration_seconds, r.discount, r.block_time
from renewals r join names n on n.id = r.name_id
order by r.block_time desc limit 20;
```

Subscribe the in-flight set via **Supabase Realtime** rather than polling — a 13–19 minute window is
exactly what makes live progress worth showing.

### Name detail — `findName()` / `nameExpiry()` / activity table

`names` row for expiry and aggregates; `renewals` joined to `flow_steps` for the expandable
breakdown (2–3 transactions per renewal). The frontend needs all three amounts per renewal, so
select `amount_in`, `gas_allowance`, `amount_applied` — don't collapse them.

### Pending balance — per chain

```sql
select b.chain_id, b.amount, b.hold_reason
from name_balances b
where b.name_id = $1 and b.amount > 0
order by b.chain_id;
```

Materialized per `(name, chain)`, or derived from `Σ deposits − Σ allocations` grouped by chain.
Never summed across chains — see Held vs in-flight.

### Leaderboard — `timeDelivered()` / `renewalCount()`

Reads the denormalized columns on `names`, so ranking is an index scan rather than an aggregate over
the ledger:

```sql
select name, renewal_count, total_seconds, total_received
from names order by renewal_count desc limit 15 offset $1;
```

### Search — name → address

`select deposit_address from names where name = $1` after ENSIP-15 normalization. A miss is not an
error: any name can be claimed, and the address is computable without a row.

### Top-level totals

Materialized view refreshed on the reconcile cron — total renewals, total USDC applied, total time
delivered. Cheap to read, expensive to compute live.

### Supabase specifics

All of this is public data, so: **RLS anon-read on the read models only**, writes exclusively via the
service-role key from Vercel functions. Never expose the service-role key to the client. Realtime on
`flows` for live progress.

### The `bigint` boundary

Amounts and durations must cross JSON as **strings** and be parsed back to `BigInt` client-side.
`pricing.ts` is exact to the micro-unit and `JSON.stringify` cannot represent a `bigint` — silently
going through `Number` is how that precision dies at the API layer.

## Trigger policy

The trigger endpoint is open to anyone. That's deliberate and safe: it can only ever spend funds
already committed to that name, every precondition is checked server-side, and the unique index
above makes concurrent calls a constraint violation rather than a double spend.

Auto-trigger fires when the $0.10 gas allowance is at most ~15% of the balance, which puts the floor
around **$0.67**. ENS imposes no minimum renewal duration (the 28-day minimum applies to
registration only), so nothing forces a floor from the protocol side.

**That floor is a placeholder, and the real one is a business decision that hasn't been made.**
Namepass fronts dollars of mainnet gas per flow and rebates ten cents, so every flow runs at a loss
and the question is how much subsidy per renewal is acceptable — not an arithmetic question the
allowance can answer. The ratio was kept rather than replaced with an invented constant.

Worth knowing when setting it: $1 buys **~45 days** on a 5+ character name, ~2.3 days on a
4 character one, ~14 hours on a 3 character one. A flat floor means very different things per tier.

## Operations

**Stuck-flow detection** — `entered_status_at` plus a per-status SLA, with a partial index so the
admin panel stays fast regardless of table size:

```sql
create index flows_active on flows (status, entered_status_at)
  where status not in ('settled','failed','cancelled');
```

`unclaimed` deserves its own SLA and its own admin view — it is not stuck in the usual sense (the
money is safe and the message is replayable) but it needs a human or a scheduled retry to decide
when the name became renewable again.

Auto-retrigger reads the same set with `next_retry_at <= now()` and exponential backoff. Capping
`attempt` stops a name that fails before the burn from retrying forever.

**Reconciliation** — compare each address's on-chain balance against
`Σ deposits − Σ allocations`, independent of webhooks. This is the only defense against a delivery
that never arrives at all, and it's the thing most likely to be skipped and most expensive to skip.

**Ingestion** is **Moralis webhooks**, behind one internal entry point —
`ingestDeposit(chain, txHash, logIndex, to, amount, blockNumber)` — so the source can change without
a rewrite. Address-list webhooks are fine at launch scale; their cost scales with addresses watched.
Past tens of thousands of addresses, filtering USDC `Transfer` events per chain scales with transfer
volume instead, and hosted indexers (Ponder, Envio, Goldsky) do exactly that into Postgres. CREATE2
helps here: the address set is computable, so an indexer can derive it rather than being fed it.

**Hosting** — the webhook receiver is a **Vercel serverless function** alongside the app (same repo,
same env, atomic deploys): verify the signature, write the deposit row, start the flow, return.
Waiting on the attestation is a **Vercel Workflow**, not the request handler — a 13–19 minute poll
is far outside serverless limits.

## Build order

Ordered by how expensive each is to get wrong, not by how visible it is.

1. **Factory + deposit contract, on one testnet.** The addresses are advertised as never changing, so
   the derivation scheme is the one decision that can't be revised after launch. Deploy the factory
   through a deterministic deployer so the addresses match across chains.
2. **Schema + read models.** Validate by writing the six queries above against seeded rows; if
   the leaderboard or explorer query is awkward, the schema is wrong and it's cheap to fix now.
3. **One full flow, end to end, on testnet.** Base → burn → Iris → mainnet mint + renew. This is
   where the unknown-unknowns live (hook encoding, domain IDs, gas on the claim), and everything
   upstream is guesswork until one has actually landed.
4. **Ingestion.** Moralis stream behind the single `ingestDeposit` entry point, plus the reconciler
   from day one — not later.
5. **Frontend swap.** Replace `registry.ts` internals with API calls; the exported function shapes
   stay.
6. **Admin panel.** Stuck flows, `unclaimed` recovery, manual retrigger.

## Open

- **Minimum balance to trigger.** The ~$0.67 floor falls out of the 15% ratio; the real number is a
  subsidy decision (see Trigger policy).
- **Funder identity.** Not tracked. The mock's semantic labels (`community`, `treasury`) aren't
  derivable from an address; `owner` is, by comparison to the ENS owner. Either the UI shows
  addresses/ENS names or the concept goes away.
- **`bigint` across JSON.** Amounts and durations need to serialize as strings and parse back, or
  the precision `pricing.ts` is careful about dies at the API boundary.
- **The `unclaimed` recovery path has no UI.** A flow whose claim reverted holds funds that are not
  at the deposit address, so the pending-balance card can't see them. Gating the burn on
  renewability makes this rare, but "rare" is not "never" — a name can stop being renewable between
  burn and attestation.

Settled, noted here so they don't get reopened as bugs:

- **Custody.** CREATE2 addresses, no third party holding keys. Non-custodial, and the earlier
  CDP-based design that wasn't is superseded — see `docs/DECISIONS.md`.
- **No fee quoting.** Standard CCTP has no Circle fee; the flat $0.10 allowance replaces the whole
  per-chain estimate/buffer approach.
- **The aggregate tiles mix bases on purpose.** `total_received` is lifetime USDC at the address,
  `total_seconds` is what the registry recorded — two different facts, neither derived from the
  other, so there is nothing to reconcile.

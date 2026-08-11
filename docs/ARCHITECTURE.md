# Architecture — contracts (built) and backend (specified)

**This file covers two parts at two different stages. Check which part you are reading.**

- **Contracts: built.** The sections from here to the end of "CCTP at contract level" describe
  `contracts/NamepassFactory.sol` and `contracts/ENSV2RenewalHelper.sol`. Both are **deployed to
  four testnets**. Both have been run against the deployed ENS and Circle contracts.
  `docs/DEPLOYMENTS.md` records the addresses, the configuration, and the transactions that prove
  each claim. **The contracts have no external audit. There is no mainnet deployment.**
- **Backend: specified, not built.** The sections from "Services" to the end of the file describe
  the Goldsky pipeline, the Neon schema, the Vercel functions and Workflow, and the reconcile cron.
  **None of them exist.** There is no code, no database, and no deployment. The UI follows this
  specification. The file also lists the open questions.

  The stack was settled on 2026-08-11: **Goldsky Turbo Pipelines → Vercel Functions → Vercel
  Workflows, over Neon Postgres.** It replaces an earlier Moralis-and-Supabase design. See
  `docs/DECISIONS.md` for why.

A deposit does not start a renewal today, because the service that would detect it is not built.
The on-chain path works. `renew(label)` is permissionless, so any person can push a deposit through
it manually. The testnet flows below were run this way.

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
labelKey = keccak256(utf8(ensip15_normalize(label)))
salt     = keccak256(NAMESPACE ‖ labelKey)
address  = CREATE2(factory, salt, keccak256(initcode))
```

**The key is the label, not the name** — `vitalik`, never `vitalik.eth`. It is a labelhash, not a
namehash: `.eth` is the only TLD in play, so carrying it through the derivation adds bytes to every
call and a second way to get the same address wrong. `NamepassFactory` rejects any label containing
a dot, so a caller that passes a full name fails loudly at prediction time instead of quietly
deriving an address nobody can ever renew against — and which, being USDC, could not be swept back
out either. The frontend still says *name* to users, because that is what users have; *label* is the
on-chain key, and the two should not be conflated in backend code.

`NAMESPACE` is `keccak256("NAMEPASS_DEPOSIT_WALLET_V1")`. It costs one hash and means a future
derivation scheme can coexist with this one instead of colliding with it.

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

The deployed contract needs a deliberately tiny surface: hold USDC, and let **any** caller approve
and burn it to CCTP. Nothing else — every capability added here is custody surface.

Three consequences of that, all decided in `contracts/NamepassFactory.sol`:

- **`renew(label)` is permissionless.** The destination is fixed by a frozen helper address and by
  config, so a caller chooses nothing except to spend their own gas pushing a deposit along the one
  path it can take. This removes the backend as a liveness dependency — a funder can always complete
  their own payment — and it gives the manual escape hatch below an on-chain equivalent that works
  when Namepass is down.
- **The helper address is write-once.** It is the address every dollar routes through, so an owner
  who can change it is an owner who can redirect all funds, and the non-custodial claim would be
  false. `setL1Helper` reverts once set; the single `L1HelperSet` log is the public proof it was
  never moved. It cannot be a constructor immutable because the helper is deployed *second* — it
  hardcodes the factory address to derive deposit addresses itself. Order is factory → helper →
  `setL1Helper`.
- **Everything that can move money is frozen at `initialize`, and there is no sweep.** `usdc`, the
  CCTP `tokenMessenger` a wallet approves, and the Ethereum helper it ultimately pays are all
  set-once. **One** setting remains — the CCTP finality tier — and it does not change *where*
  anything goes, only how long it waits. After initialization the owner cannot move a single
  deposited dollar.

  **Be precise about what that does and doesn't buy.** "Cannot steal" is not "cannot interfere."
  The per-burn cap used to be the setting that could be turned into a pause switch — set one
  micro-unit per burn and an L2 stalls while the owner touches nothing. It is now read live from
  Circle (`TokenMessengerV2.localMinter().burnLimitsPerMessage(usdc)`) rather than stored, so that
  lever no longer exists and the earlier `MIN_MAX_BURN` floor that blunted it is gone with it.

  **The fee ceiling is not a setting at all** — it is a per-call argument, which is what closes the
  other half. `renew(label)` authorizes zero, the right default while Standard is free.
  `renewWithFee(label, maxFeeBps)` lets any caller name their own ceiling. So if Circle ever prices
  the tier this chain is set to, every zero-fee burn starts reverting and *anyone* can immediately
  push their own payment through without waiting for Namepass to notice or act. No owner setting can
  price a transfer, and none can stop one.

  `maxFeeBps` is what Circle is *authorized* to take, not an amount paid: Circle collects its actual
  fee and mints the remainder, which is why the helper reads `feeExecuted`. What the per-call design
  trades is that anyone can authorize a fee on someone else's deposit. They cannot receive it,
  redirect anything, or make Circle take the full ceiling — so the worst case is a funder paying the
  going rate for speed they didn't ask for, and only on a chain set to Fast at all.

  The residual is `setFinality`. Circle documents `<= 1000` as Fast/Confirmed and `> 1000` as Standard/Finalized — 1000 and 2000 are the defined values, and a threshold in between is simply Standard, so
  an owner setting one is an unquantified risk, and unlike the fee there is no per-call override.

  The Ethereum path is immune to all of it — `_executeEthereum` reads only the two frozen addresses,
  and `renew` skips the cap on mainnet. Ethereum-origin deposits cannot be stalled by any owner
  action.

  These are **set-once storage, not `immutable`**. That looks like the weaker choice and isn't:
  constructor arguments are part of the creation code, and these values differ per chain, so an
  `immutable` version would give the factory a different address on every chain and break the
  one-address promise outright.

  A sweep for wrongly-sent tokens was built and then removed. Every version of it is a function
  that moves a deposit wallet's tokens to an owner-chosen address, and the USDC exclusion has to be
  checked against *something* — which was `config.usdc`, which was mutable, which made the whole
  guard a formality: point `usdc` at any other token, then sweep the real one. Freezing `usdc`
  would have closed that, but the remaining shape was still a withdrawal path guarding itself with
  a comparison. **Non-USDC tokens sent to a deposit address are permanently lost**, and the UI is
  responsible for saying so plainly rather than the contract for absorbing it.

### Permanent assumptions

Everything below is baked into deposit addresses. None of it can be changed for an address that has
already been published — a different value means a different factory and a different address set —
so these are worth being explicit about rather than discovering later. Verify each one before the
first address goes out.

| Assumption | Status |
|---|---|
| Circle's `TokenMessengerV2` keeps its address | **Safe** — it sits behind an upgradeable proxy, so implementation changes don't move it. Residual: CCTP V1 → V2 shipped as a *new* deployment rather than an upgrade, so a future major version could do the same. |
| ENS renewal happens on the hub chain | **Safe** for mainnet: ENS v2 stays on Ethereum. The hub is a constructor argument (`hubChainId`), so a testnet set uses 11155111 and a mainnet set uses 1. `HUB_CCTP_DOMAIN = 0` holds for both, since Sepolia is also domain 0. |
| ENS pricing can change | **Handled, and not here** — the L1 helper reads pricing from an external contract it can repoint, so a rent or discount change needs no factory change. |
| Labels never contain a dot | **Safe by domain** — subnames don't pay renewal fees, so there is nothing for a subname deposit address to buy. The rejection in `_labelKey` is correct, not merely in-scope. |
| The most expensive ENS second stays below one cent | `MIN_BURN_AMOUNT` is a constant `110_000`. This value is the $0.10 gas allowance plus a margin. A burn below this value creates a CCTP message that nobody can claim. At the current rates the most expensive second costs 21 base units, against a margin of 10,000. The margin is therefore large. However, ENS governance sets these rates, and the constant cannot follow a change. This is the factory's only ENS pricing assumption. |
| Native USDC keeps its address per chain | Frozen at `initialize`. A Circle token migration would strand deposits in the new token, with no sweep. |
| Ownership is never renounced | `transferOwnership` rejects `address(0)`. `setFinality` is the only owner function after `initialize`, so it cannot become permanently frozen. The transfer uses two steps, so a typing error cannot lose ownership. |

**ENSIP-15 normalization before hashing is a security requirement, not a formatting nicety.** Skip it
and a homoglyph of a well-known name derives a different address while rendering identically in the
Explorer, which turns Namepass's own UI into a credible-looking way to collect payments meant for
someone else. Use `@adraffy/ens-normalize`.

## The flow

**The on-chain steps are built and proven. The service that connects them is not built.** Steps 1,
3, and 5 below are contract behavior. They have been run from all three L2s on testnet; see
`docs/DEPLOYMENTS.md`. Step 2 and the polling in step 4 belong to the unbuilt backend. A person
performs those steps today.

```
  deposit          burn + hook      attestation        mint + renewal
  ───────►   ───────────────►  ──────────────►  ─────────────────►
  (any chain)    Vercel fn         Circle Iris      (mainnet, atomic)
   Goldsky                        Vercel Workflow
```

1. USDC lands at a name's CREATE2 address on Base, Arbitrum, Arc or Ethereum.
2. A **Goldsky Turbo Pipeline** filters that transfer against the Namepass address set and posts it
   to a Vercel serverless function. The function records the deposit and, if the trigger conditions
   are met, starts a flow.
3. The function performs the CCTP **burn with a hook** on the origin chain.
4. A **Vercel Workflow** polls Circle's **Iris API** for the attestation — the slow step, roughly
   half a minute to half an hour depending on the origin chain — see the measured spread under
   "CCTP at contract level".
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

## Two ENS renewers, not one

There is no single canonical renewal contract during the ENS v1 to v2 migration, and the helper
selects between two on every renewal. Confirmed against ENS's `contracts-v2` source
(`1edb1816`), not inferred:

| ENS contract | Renews when | Notes |
|---|---|---|
| `ETHRegistrar` | `REGISTERED`, or in grace with a `latestOwner` | migrated and native v2 names |
| `ETHRenewerV1` | `RESERVED`, or available-with-no-owner inside the v2 grace period | premigrated v1 names; also renews the **v1** registrar via `_onRenew` |

A v1 name that has been premigrated sits in v2 as `RESERVED` with no owner and is renewable only
through `ETHRenewerV1`. When its owner completes migration it becomes `REGISTERED` and only
`ETHRegistrar` will take it. Both predicates live in `_isRenewable` overrides and are disjoint by
construction, and **both populations exist simultaneously for the length of the migration** — so a
helper holding one address silently fails for half of ENS, and repointing it just swaps which half.

Both inherit `AbstractETHRegistrar` and so share `IETHRenewer`: `renew`, `getRenewPrice`,
`isRenewable`, `rentPriceOracle`. One code path drives either.

Selection asks ENS rather than deciding:

```
ethRegistrar.isRenewable(label) ?  → ETHRegistrar
  else ethRenewerV1.isRenewable(label) ? → ETHRenewerV1
    else revert NameNotRenewable
```

Reading registry status and reimplementing `RESERVED` versus `REGISTERED` in the helper would be a
copy that goes stale the moment ENS adjusts it. `isRenewable` is where ENS keeps that logic.

**The oracle must come from the selected renewer, not chosen independently.** Each renewer has its
own `rentPriceOracle()`, and the helper's invariant is that its inverse price, ENS's forward quote
and the amount actually charged all agree — which only holds if all three come from the same
contract. So: select the renewer, read *its* oracle, invert *that* pricing, call *its*
`getRenewPrice`, approve *it*, call *its* `renew`, then verify the balance delta.

Both pointers are moved by `setRenewers`, callable only by `ensGovernanceExecutor` — **the ENS DAO
Timelock (`wallet.ensdao.eth`), not the Governor**. Executable proposals are voted at the Governor
but executed by the Timelock, so the Timelock is the `msg.sender` the helper sees. Passing the
Governor compiles, deploys, and leaves the renewers permanently frozen.

That address is itself reassignable by `setGovernanceExecutor`, callable only by the current
executor. Without it, ENS migrating its own governance would strand these pointers — the same trap
as an immutable registrar, one level up. With it, a governance-migration proposal reassigns the
authority and then migrates, and Namepass is not involved either way. The handover is one-way and
immediate, so it must name an executor that is already live.

**Both branches are confirmed on Sepolia**, against the deployed contracts rather than from
reading the source:

| label | registry state | renewer used | ENS v1 registry | gas |
|---|---|---|---|---|
| `vitalik` | premigrated (`RESERVED`) | `ETHRenewerV1` | **touched** — synced | 297,176 |
| `test123` | native v2 (`REGISTERED`) | `ETHRegistrar` | not touched | 266,889 |

`0x442df555ce134d4af1bd8faf37e7763ceb9f07411cc4316c07276fbbf187dbc2` and
`0x81df99f918f088b24121e3cfc007a479c920868322562cf6e54438c734d88735`.
Addresses for the deployment these ran against are in `docs/DEPLOYMENTS.md`.

The ~30k gas difference is `ETHRenewerV1._onRenew` calling `BASE_REGISTRAR.renew` to keep v1 in
step, which `ETHRegistrar` does not override. Same 7-character label, same price, same duration in
both — the pricing does not depend on which contract executes it.

Worth stating plainly because the two names were picked arbitrarily: a helper holding a single
renewer address would have worked for one of them and reverted on the other, and which one would
have depended on nothing but which name was tried first.

The upshot for a funder is that none of this is visible. They send USDC to the same permanent
address whether or not their name has migrated, and the helper picks the right ENS path on chain.
When migration completes, `ETHRenewerV1` simply stops matching anything, and ENS governance can
retire it by setting it to zero.

## CCTP at contract level

Standard (not Fast) transfers: no Circle fee — `feeExecuted` came back zero on every claim, so the
mint equals the burn.

**Attestation time varies by an order of magnitude across chains**, measured on 2026-08-10 by
burning the same label on all three L2s within two minutes of each other:

| origin | observed |
|---|---|
| Arc Testnet | ~30 seconds |
| Arbitrum Sepolia | ~18 minutes |
| Base Sepolia | ~26 minutes |

Detected inside a 60-second polling window, so treat these as upper bounds rather than precise
figures. Two consequences for the worker, both easy to get wrong:

- **Settlement is not FIFO.** The Arc burn started last and settled first — its $30 landed before
  an $8.11 that had been burning for five minutes already. Anything that assumes ordering, or
  reuses one chain's timing as a global timeout, will mis-handle the other chains.
- **A per-chain backoff beats a global one.** Polling Arc on a Base-shaped schedule wastes twenty
  minutes of latency; polling Base on an Arc-shaped one burns requests for nothing.

The old "13–19 minutes" figure in this document came from Circle's general guidance. It is roughly
right for Arbitrum, pessimistic for Arc and optimistic for Base. Fast Transfer is
near-instant but charges a fee, which would reintroduce the per-chain quoting problem the flat
allowance exists to remove — rejected as the default, see `docs/DECISIONS.md`. Kept reachable
through config rather than compiled out, in case Circle's fee policy changes.

| Step | Contract | Call |
|---|---|---|
| Burn on origin | `TokenMessenger` | `depositForBurn` (v2: the hook-carrying variant) |
| Attest | — | off-chain, Circle's Iris API |
| Mint + renew on mainnet | `MessageTransmitter` | `receiveMessage(message, attestation)` |

CCTP does **not** execute hooks for you. The hook payload is emitted in the message and it is the
integrator's job to act on it. The helper is therefore the `destinationCaller` as well as the
`mintRecipient`, and its `completeCCTP(message, attestation)` calls `receiveMessage` and the renewal
in one transaction — that is what makes it atomic, not anything Circle does. A reverting renewal
reverts the mint, leaving the message attested and replayable.

**The helper never holds a funder's pending balance.** This is the invariant worth stating plainly,
because it is what makes the pending-balance card honest. The Ethereum path transfers and renews in
one transaction; the CCTP path mints and renews in one transaction, spending exactly the amount
carried by the authenticated message rather than the helper's balance. So a payment in flight is
only ever in one of two places:

| Where | How it got there | Recovery |
|---|---|---|
| The deposit address | Renewal reverted on Ethereum, or the flow failed before the burn | `renew(label)` again, by anyone |
| An unclaimed CCTP message | Renewal reverted after the burn | `completeCCTP` again, forever |

Never the helper, and never nowhere.

**The helper does accumulate dust, and that is a different thing.** Renewals buy whole seconds, so
the sub-second remainder of every payment stays behind — a few micro-units at a time, across every
renewal the platform ever does. It is not a funder's money waiting to be delivered and it should
never appear in a pending balance; it's rounding residue with no owner. Two consequences: the helper
needs a withdrawal path or the pile is stuck permanently, and any "is the helper empty?" monitoring
check has to be written against a threshold rather than zero, or it alerts forever.

The hook payload is the **raw UTF-8 label bytes** — `bytes(label)`, read back as
`string(hookData)`. Not `abi.encode`, which would prepend an offset and a length for a value whose
length the message already carries.

Details to pin down against Circle's current docs — treat as directional, not verified:

- **`depositForBurnWithHook` returns nothing in V2.** The `uint64 nonce` return is the V1 signature.
  Declaring a return value makes Solidity enforce a returndata size and revert on *every* burn, so
  the interface declares it `void`; extra returndata, if a future version emits any, is ignored.
  This one is cheap to get wrong and total when you do.
- **Domain IDs** — Ethereum 0, Arbitrum 3, Base 6, **Arc 26**. Confirm each before deploying,
  because getting one wrong sends funds to the right address on the wrong chain.
- **Finality thresholds** — Circle documents **`<= 1000` as Fast/Confirmed** and **`> 1000` as
  Standard/Finalized**, with 1000 and 2000 as the two defined values. A threshold in between is not
  a third tier — 1500 is simply Standard. The factory passes the value through **unvalidated** on
  an L2, because pinning today's tiers would mean a new one could never be used and there is no
  redeploy that repairs a published deposit address — so the owner has to choose it carefully. Note
  a threshold of 0 means *Fast*, not "unset". Switching is a `setFinality` call and moves no
  deposit address, so the Fast Transfer rejection below is a default, not a lock-in.
- **When the burn reverts** — when `maxFee` is under the *applicable* on-chain minimum fee. A
  ceiling too low for Fast need not be fatal: Circle may degrade the transfer to Standard, which
  changes which minimum applies. So the cost of too low a ceiling is usually a silent downgrade
  rather than a failure, but "usually" is doing work — treat a revert as reachable.
- **A single burn is capped per message by Circle** (10,000,000 USDC at the time of writing). Above
  it the burn reverts — and since the retry is the same oversized burn, an over-limit balance would
  sit at the deposit address indefinitely rather than fail once and recover. `renew` therefore
  processes at most Circle's current limit per call and repeated calls drain the rest, with
  `DepositProcessed.remaining` carrying what is still there so the backend knows to call again
  rather than wait for a new deposit. **The limit is read from Circle, not stored**: it is Circle's
  number, it can move, and a stored copy meant an over-limit deposit could wait on somebody at
  Namepass fixing a setting. A zero limit means Circle disabled burns for the token and is refused
  rather than read as "no cap". Ethereum is uncapped; nothing is burned there.

  In principle this means **a flow is no longer one-to-one with a deposit** — a single payment can
  produce several, each with its own CCTP message and its own $0.10 allowance on mainnet, which is
  the argument against setting the cap far below Circle's limit.

  **The UI does not model this, on purpose — don't add it.** 10,000,000 USDC buys around 1.2
  million years on a normal name and ~16,000 years on the most expensive tier there is, so no
  deposit will ever reach the cap. The contract carries it anyway because it is eight lines, packs
  into a spare slot for free, and guards a door that cannot be reopened: wallets delegate to this
  factory permanently, so a cap missing at launch can never be added for an address that has
  already been published. That asymmetry justifies the contract code and does not justify a sixth
  `holdReason`, simulation support, and copy for a state nobody will see. If a remainder ever did
  occur, `flow_in_progress` already describes it accurately. See `docs/DECISIONS.md`.


- **Standard transfers being free is current pricing, not a guarantee.** Circle exposes
  `getMinFeeAmount(amount)` for standard transfers specifically. Nothing in the contract depends on
  the fee being zero — `maxFeeBps` is a per-call argument — but `src/lib/fees.ts` and the flat $0.10
  allowance were built on the assumption, and "no fee quoting" below is a bet on Circle's pricing
  rather than a property of the protocol.

## Services

> **None of this is built.** The sections from here to the end of the file are a specification:
> services, schema, read models, trigger policy, and operations. There is no webhook endpoint, no
> database, no worker, and no cron. `src/lib/registry.ts` simulates the states these services would
> produce. The contract sections above describe the built part.

The plan is to run everything on Vercel with the app: same repository, same environment, atomic
deploys, and no CORS. The database is **Neon**. See "Ingestion — Goldsky Turbo Pipelines" below for
why the pipeline and the database cannot be chosen independently.

### `POST /api/webhooks/goldsky` — deposit ingestion

Thin by design. Authenticate, write the rows, decide, return `200` quickly.

```
check the auth header  →  store raw payload (pipeline_deliveries)
                       →  upsert each deposit, unique on (chain_id, tx_hash, log_index)
                       →  applyPayment per row: park with a reason, or start a flow
                       →  if starting, enqueue the renewal Workflow
                       →  200
```

Four properties of the Goldsky webhook sink shape this handler, and three of them differ from a
normal webhook:

- **The body is an array, not one deposit.** The sink batches, at `batch_size` rows or
  `batch_flush_interval`, whichever comes first. Handle a list.
- **Delivery is at-least-once.** `deposits_onchain_unique` on `(chain_id, tx_hash, log_index)` is
  what makes a repeat delivery a no-op instead of a second renewal. It is not a nicety here.
- **A `4xx` response fails the whole pipeline.** Only `408`, `429` and `5xx` retry. So a row this
  handler cannot parse must be quarantined and answered `200`. A validation bug that returns `400`
  stops ingestion for **every** name, not just the bad row.
- **Authentication is one static header, not an HMAC.** Goldsky's `httpauth` secret injects a single
  header name and value. There is no signature over the body, so compare the value in constant time
  and treat the endpoint path as a second secret. An earlier draft of this file specified HMAC
  verification; that was Moralis's model and does not carry over.

A slow handler does not cause duplicate deliveries here — the sink applies backpressure and slows
the pipeline instead. It must still **not** run the flow: waiting on the attestation runs from
seconds to half an hour depending on origin chain, far outside any serverless limit.

### `POST /api/names/:name/claim` — activation

Normalize (ENSIP-15) → derive address → insert `names` row. A trigger on that insert copies the
address into the pipeline's dynamic table, so the new name is monitored within seconds and no
second system has to be told about it. Idempotent: claiming an existing name returns it.

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
| `awaitAttestation` | Poll Iris until complete | Sleep + retry; back off per origin chain, not globally |
| `claim` | `receiveMessage` on mainnet — mints, renews, takes allowance | Message stays attested + unclaimed → retryable forever |
| `record` | Write `renewals` + `flow_steps`, bump aggregates | Retry; reconciler catches drift |

### Vercel Cron: `reconcile`

The safety net, independent of the pipeline. Compares each address's on-chain balance against
`Σ deposits − Σ allocations`, surfaces flows past their per-status SLA, and refreshes aggregates.
This is the only defence against a delivery that never arrives at all — the thing most likely to be
skipped and most expensive to skip. It is also the only thing that can see a deposit to a name that
was never claimed; see "The unclaimed-name blind spot".

### Environment

| Variable | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | app + functions | Neon **pooled** string. Normal query traffic. |
| `DATABASE_URL_UNPOOLED` | migrations, Workflow | Neon **direct** string. Required for anything with session state. |
| `GOLDSKY_WEBHOOK_HEADER` / `GOLDSKY_WEBHOOK_SECRET` | ingestion endpoint | The header name and value Goldsky injects. |
| `CIRCLE_IRIS_URL` | Workflow | Attestation polling. |
| `RPC_URL_<CHAIN>` | Workflow, reconciler | One per chain. |
| `RENEWAL_SIGNER_KEY` | Workflow | The gas-sponsoring wallet. Never shipped to the client. |

Goldsky holds its own credential for the dynamic table, and it is **not** any of the above — see the
role split under Ingestion.

## Schema

Three layers: an append-only ledger (truth), a state machine (lifecycle), derived read models
(speed). Money is `numeric(78,0)` in base units throughout — never float, never JS `number`.

The frontend already models every shape below. `src/lib/registry.ts` is the reference for what each
one has to carry, and `docs/FRONTEND.md` §4 gives the exported function signatures. Three of its
properties are constraints on this schema, not preferences:

- **Money is `bigint` micro-units end to end.** `numeric(78,0)` in Postgres, and a **string** across
  JSON. `JSON.stringify` cannot represent a `bigint`, and `pricing.ts` is exact to the micro-unit,
  so a value that passes through `Number` loses the precision the tier boundaries turn on.
- **Balances are per chain and never merge.** There is no global balance column anywhere.
- **A renewal carries three amounts**, not one: `amount_in`, `gas_allowance`, `amount_applied`.

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

That constraint is the idempotency key. The Goldsky webhook sink is **at-least-once by
specification**, so a repeat delivery is expected traffic rather than an edge case; this constraint
makes it a no-op instead of a double renewal.

`from_address` is the funder, and the pipeline supplies it on every row. This is what closed the
"funder identity" question that used to sit under Open — see the note there.

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

**Nothing on chain gates a burn on renewability**, and it deliberately doesn't — `renew` is
permissionless, so anyone can push an expired name's balance across. The burn succeeds, the mint is
authenticated, and the renewal reverts on arrival. Raised in audit; the consequences are the
backend's, not the contracts':

- **The flow can sit in `unclaimed` for a very long time.** A name in its premium auction becomes
  renewable again when someone registers it — which may be never. `unclaimed` therefore needs no
  retry budget and no eventual `failed` transition, but it does need a backoff that decays to
  something like daily, or the worker burns gas re-simulating a claim that cannot succeed yet.
- **Retry the claim, don't re-attest, on Standard.** A finalized attestation does not expire, so
  `completeCCTP(message, attestation)` with the stored blob is valid indefinitely. Store the
  message and attestation, not just the nonce.
- **Fast transfers would change that.** `BurnMessageV2` carries an `expirationBlock`, so a Fast
  attestation can lapse while a flow waits in `unclaimed` — and the recovery is re-attestation
  through Iris, not a retry of the stored blob. Nothing uses Fast today (see the finality note
  above), but the worker should branch on the finality tier the flow was burned at rather than
  assume the stored attestation stays good forever.
- **Gate the trigger off-chain instead.** Checking renewability before burning keeps the funds at
  the deposit address, where the pending-balance card can still see them — which is the whole
  argument for "burn only after confirming the name is renewable" above.

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

### renewals

One settled flow. Earlier revisions of this file queried this table in the read models and never
defined it, which is the kind of gap that only shows up when someone writes the migration.

`id`, `flow_id` (unique), `name_id`, `origin_chain_id`, `amount_in`, `gas_allowance`,
`amount_applied`, `duration_seconds`, `discount_bps`, `expiry_after`, `block_time`.

Two columns that look redundant and are not. `expiry_after` is the name's expiry **after this
renewal was applied**, which is what the detail view's runway bar draws from — recomputing it by
summing durations gets a different answer the moment a renewal lands from outside Namepass.
`discount_bps` stores the discount as a number rather than the `"43.75%"` label that
`ActivityEvent.off` renders; the label is a formatting decision and belongs in the UI.

Rows here are the only source for public statistics. **Stats come from finalized renewals, never
from deposits** — that one rule is what stops in-flight or failed money inflating anything public.

### name_balances

The per-chain pending state, materialized. `name_id`, `chain_id`, `amount`, `hold_reason`, primary
key `(name_id, chain_id)`.

`hold_reason` is **not nullable**, and that is a product constraint rather than a data-modelling
one. A deposit address is a pass-through, so money at rest is always either blocked by something or
a failure. A balance with nothing wrong with it tells the funder the automation stalled and needs
them, which is the opposite of the product. See "Held vs in-flight" below for the derivation and the
five reasons.

### flow_steps

Every on-chain transaction belonging to a flow — `deposit`, `burn`, `renewal` — with `chain_id`,
`tx_hash`, `gas_cost_wei`, `gas_payer`, `block_time`, `error`.

The `deposit` step comes from the pipeline; `burn` and `renewal` come from the worker's own
transactions. Three sources, one table.

This is what the Explorer renders when a renewal is expanded — `ActivityEvent.steps` in
`src/lib/registry.ts` already models it. Cross-chain payments produce three (deposit, burn, mint +
renewal); Ethereum-origin payments skip the burn and produce two. The mint and the renewal are one
transaction, not two, because the renewal rides the CCTP hook — and the UI labels that final step
"Renewed" rather than "Minted and renewed" when nothing was bridged.

### flow_events

Append-only audit: `flow_id`, `from_status`, `to_status`, `actor`
(`ingest | worker | reconciler | admin:<id>`), `reason`, `payload`, `created_at`. This is what
answers "why is this stuck and what has already been tried" in the admin panel.

### deposit_allocations

`deposit_id`, `flow_id`, `amount`. N deposits → 1 flow (accumulation), 1 deposit → partial spend.

### pipeline_deliveries

Raw payloads stored **before** parsing — `source`, `auth_ok`, `payload`, `row_count`, `received_at`,
`processed_at`, `error`. This is the replay source when a delivery fails mid-processing.

One batch is one row here, and it can carry many deposits. Store the batch, then parse — a row the
handler cannot read must land here and be answered `200`, because a `4xx` stops the pipeline for
every name.

### streamling.namepass_addresses

Not a Namepass table. Goldsky's dynamic table creates and owns it, in its own schema, in this same
database. It holds one column of lowercase hex addresses and it is what the pipeline filters
against. Keep it in step with `names` from a trigger rather than from application code, so a name
cannot be claimed without being monitored:

```sql
create function sync_namepass_address() returns trigger as $$
begin
  insert into streamling.namepass_addresses (value)
  values (lower('0x' || encode(new.deposit_address, 'hex')))
  on conflict do nothing;
  return new;
end $$ language plpgsql;

create trigger names_sync_address after insert on names
  for each row execute function sync_namepass_address();
```

**One table serves all four chains.** The CREATE2 address is identical everywhere, so there is one
address set and four pipeline sources reading it. Changes take effect in seconds with no pipeline
redeploy.

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

- **The trigger threshold applies per chain.** 50¢ on Base plus 50¢ on Arc means *neither*
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
| `not_detected` | ✅ | The pipeline never delivered the deposit — an anomaly |
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
select r.id, n.name, r.origin_chain_id, r.amount_in, r.gas_allowance,
       r.amount_applied, r.duration_seconds, r.discount_bps, r.block_time
from renewals r join names n on n.id = r.name_id
order by r.block_time desc limit 20;
```

**Poll the in-flight set; do not build a subscription for it.** An earlier revision specified
Supabase Realtime here. Neon has no equivalent, and the feed does not need one: a flow changes
status perhaps four times across a window of 30 seconds to 26 minutes, so a poll every few seconds
shows every transition a viewer can perceive. A websocket would add a persistent connection and a
second failure mode to save latency nobody can see.

The client already keeps one DOM element across settlement — `ActivityEvent.flowKey` in
`src/lib/registry.ts` exists so an in-flight row becomes a settled row rather than being destroyed
and rebuilt. Keep that key stable across the poll boundary and the transition stays smooth without
a push channel.

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

### Neon specifics

**The client never reaches the database.** All reads go through Vercel functions. This is the one
structural difference from the Supabase design this replaced: there is no anon key, no RLS policy,
and no auto-generated REST layer, so the safe default is that nothing is exposed until a function
exposes it. The data is public, but "public" is then a decision each endpoint makes rather than a
policy that has to be right on every table.

Three rules, all of them cheap to get wrong:

- **Pooled for the app, direct for everything with session state.** `DATABASE_URL` (the `-pooler`
  host) serves query traffic. `DATABASE_URL_UNPOOLED` serves migrations, `pg_dump`, and the
  Workflow. PgBouncer runs in transaction mode, so a pooled connection drops `SET` state between
  statements and the failures never name pooling as the cause.
- **Use the HTTP driver in serverless functions.** `@neondatabase/serverless` over HTTP for one-shot
  queries avoids holding a TCP connection for the life of an invocation. Connection exhaustion under
  burst is the standard failure of serverless plus Postgres, and every query in this file is a
  one-shot.
- **Give Goldsky its own role.** It needs DDL on the `streamling` schema and nothing else. Grant it
  `usage`/`create` there and no privileges on `names`, `deposits`, `flows` or `renewals`. The
  pipeline credential is not `DATABASE_URL`.

Neon suspends an idle compute, so the first query after a quiet period pays a cold start of roughly
a few hundred milliseconds. That is acceptable for the read side and irrelevant to the pipeline,
which writes continuously once traffic exists. It would **not** be acceptable to put a cold start in
front of the deposit handler if the pipeline ever became latency-sensitive; it is not today.

### The `bigint` boundary

Amounts and durations must cross JSON as **strings** and be parsed back to `BigInt` client-side.
`pricing.ts` is exact to the micro-unit and `JSON.stringify` cannot represent a `bigint` — silently
going through `Number` is how that precision dies at the API layer.

## Trigger policy

The trigger endpoint is open to anyone. That's deliberate and safe: it can only ever spend funds
already committed to that name, every precondition is checked server-side, and the unique index
above makes concurrent calls a constraint violation rather than a double spend.

`renew(label)` on the factory is open to anyone for the same reasons, minus the server-side checks —
so the endpoint is a convenience and a bookkeeping hook, not the gate. Anything the endpoint refuses
can still be done directly against the contract by whoever wants to pay the gas. That is the
intended property, not a hole: it means the money is not hostage to Namepass being up.

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
`Σ deposits − Σ allocations`, independent of the pipeline. This is the only defense against a
delivery that never arrives at all, and it's the thing most likely to be skipped and most expensive
to skip.

## Ingestion — Goldsky Turbo Pipelines

One pipeline per chain reads USDC `Transfer` events, filters them against the Namepass address set,
and posts the survivors to the Vercel function. Keep it behind one internal entry point —
`ingestDeposit(chain, txHash, logIndex, to, from, amount, blockNumber)` — so the source can change
without a rewrite.

**The filter is a dynamic table, and that is why the database and the pipeline are one decision.**
Goldsky's dynamic table is backed by Postgres, and pointing it at the same Neon database the app
uses means the address set has exactly one writer: the trigger on `names`. A SQL transform then
filters against it:

```yaml
transforms:
  namepass_addresses:
    type: dynamic_table
    backend_type: Postgres
    backend_entity_name: namepass_addresses
    secret_name: NEON_GOLDSKY

  deposits:
    type: sql
    sql: |
      SELECT *
      FROM base_sepolia.erc20_transfers
      WHERE dynamic_table_check('namepass_addresses', to_address)
        AND lower(contract_address) = lower('<USDC on this chain>')
```

The first argument to `dynamic_table_check` is the **transform** name and must be a string literal.
The value column is the primary key, so lookup stays cheap as the set grows.

Two consequences worth stating plainly:

- **The address set is computable, so it never has to be exported.** CREATE2 means the trigger can
  derive and insert the address at claim time, and a lost row is recoverable by recomputation.
- **Scaling is by transfer volume, not by addresses watched.** This is the opposite of an
  address-list webhook, whose cost grows with the watch list. It is why the set can grow without a
  pricing cliff.

### Unclaimed names — read the chain, then self-heal

**A dynamic table only contains addresses that were inserted, and the contract does not require a
name to be claimed before it can be funded.** Any person can compute any name's deposit address and
send USDC to it. If that name was never activated there is no row in `names`, no address in the
dynamic table, and no delivery.

**The app does not need the pipeline to see that money.** The deposit address is derived locally
from the label, and the balance is a `balanceOf` call. So the Explorer reads it directly:

```
depositAddress(label)  →  balanceOf(address) on each of the four chains  →  render
```

**The app does not do this today.** Its only on-chain reads are ENS's pricing configuration and the
gas allowance at boot, plus per-name expiry and renewability — all against Sepolia. There is no
`balanceOf` call anywhere and no RPC endpoint configured for Base, Arbitrum or Arc.

It needs no new dependency, though. `balanceOf(address)` is exactly the fixed-shape call
`src/lib/rpc.ts` was built for — `encodeAddress` and `decodeUint` exist, and `ethCallBatch` already
takes an `rpcUrl`, which no caller passes yet. The work is three RPC endpoints in config beside the
USDC addresses `tokens.ts` already carries per chain, one `usdcBalances(address)` helper, and a call
from the name view. The result maps onto the per-chain shape `PendingBalance.tsx` renders.

It is also the honest read for *every* name, claimed or not: the chain balance is the truth and
`name_balances` is a cache of it.

**This read must fail soft, and that is a different policy from every read the app does today.**
`oracle.ts` and `fees.ts` stop the app when they fail, because a missing price is a wrong price. A
balance is not. One flaky Arc endpoint must degrade that chain's row, not blank the card or block
the page.

**Triggering from that view claims the name as a side effect.** `POST /api/flows/trigger` normalizes
the label, derives the address, and **upserts the `names` row** before starting the flow. The insert
trigger adds the address to the dynamic table, so from that moment the name is monitored like any
other. The blind spot closes itself the first time anybody looks at the name.

Two things this genuinely fixes, and two it does not:

| | |
|---|---|
| ✅ Money at an unclaimed address is visible | Read from chain, not from `deposits` |
| ✅ It can be pushed through, and monitoring starts | Trigger upserts `names`, trigger syncs the table |
| ❌ Discovery is pull-based | Nobody is watching. Funds sit until a person opens that name. |
| ❌ It is absent from aggregates | Leaderboard and totals come from `renewals`, which needs a flow |

**The trigger endpoint sponsors gas, so opening it to any label is a cost surface.** The per-chain
floor is what bounds it: a balance must clear ~$0.67 on its own chain before anything goes out, so
dusting a thousand derived addresses buys an attacker nothing. Keep the floor check server-side and
ahead of the row upsert, or the griefing case becomes "make Namepass write a database row per
address" instead.

The residual — nobody is watching — is acceptable because the funds are never at risk and the
recovery is permissionless. The reconciler could close it by deriving addresses for a candidate
label set and checking balances on a schedule, but that is a cost decision rather than a safety one.

### Hosting

The receiver is a **Vercel serverless function** alongside the app (same repository, same
environment, atomic deploys): authenticate, write the deposit rows, start the flow, return. Waiting
on the attestation is a **Vercel Workflow**, not the request handler — a poll of up to half an hour
is far outside serverless limits.

## Build order

The order follows the cost of an error, not the visibility of the result. Steps 1 and 3 are
**done**. The other steps are not started.

1. ✅ **Factory + deposit contract, on one testnet.** The addresses are advertised as never changing, so
   the derivation scheme is the one decision that can't be revised after launch. Deploy the factory
   through a deterministic deployer so the addresses match across chains, then the helper, then
   `setL1Helper` once per chain.

   **Done.** The factory was deployed on 2026-08-10 to all four testnets through the Safe Singleton
   Factory. The address is the same on every chain. `l1Helper` is frozen on each chain. See
   `docs/DEPLOYMENTS.md`.

   The hub chain is a **constructor argument**
   (`hubChainId`): 11155111 for the Sepolia-based testnet set that ships first, 1 for mainnet. One
   source file serves both, rather than an edit between deployments that has to be remembered. It
   is part of the creation code, so it must be identical across every chain in a set, and the two
   sets land on different factory addresses, which is what separate deployments should do. And
   `foundry.toml` pins `solc_version`, `evm_version`, optimizer runs and
   `bytecode_hash = "none"` because identical creation code across four chains is the whole
   premise; a floating pragma or an embedded metadata hash moves every deposit address the product
   has ever published.
2. **Schema + read models.** Validate by writing the six queries above against seeded rows; if
   the leaderboard or explorer query is awkward, the schema is wrong and it's cheap to fix now.
3. ✅ **One full flow, end to end, on testnet.** Base → burn → Iris → mainnet mint + renew. This is
   where the unknown-unknowns live (hook encoding, domain IDs, gas on the claim), and everything
   upstream is guesswork until one has actually landed.

   **Done, from all three L2s and not only Base.** Arc, Arbitrum, and Base each burned USDC and
   claimed it on Ethereum Sepolia. Both renewer branches ran. The accounting balanced to the base
   unit. The helper kept zero dust. `docs/DEPLOYMENTS.md` lists the transactions. Testnet cannot
   exercise the ENS governance path, because Sepolia has no DAO Timelock.
4. **Ingestion.** One Goldsky pipeline per chain behind the single `ingestDeposit` entry point, plus
   the reconciler from day one — not later. Start with one chain and the `blackhole` sink to see the
   filtered stream before a webhook exists, then point it at the function.
5. **Frontend swap.** Replace `registry.ts` internals with API calls; the exported function shapes
   stay.
6. **Admin panel.** Stuck flows, `unclaimed` recovery, manual retrigger.

## Open

- **Minimum balance to trigger.** The ~$0.67 floor falls out of the 15% ratio; the real number is a
  subsidy decision (see Trigger policy).
- **`bigint` across JSON.** Amounts and durations need to serialize as strings and parse back, or
  the precision `pricing.ts` is careful about dies at the API boundary.
- **Whether the reconciler should hunt for unclaimed deposits.** Reading the chain on view already
  makes the money visible and recoverable (see "Unclaimed names"). Sweeping a candidate label set on
  a schedule would close the last gap — nobody is watching — at a cost in RPC calls. A spend
  decision, not a safety one.
- **The failure policy for a balance read.** It must fail soft, per "Unclaimed names", which no read
  in the app does today. Decide it when the live reads are built, not before: the choice is whether
  a chain with no answer renders as absent, as zero, or as an explicit "couldn't check", and only
  the third is honest.

- **Who owns the helper's dust, and how does it get out.** Renewals buy whole seconds, so a
  sub-second remainder is left behind on every single flow. It needs a withdrawal path or it is
  stuck forever, and "whose money is it" is a real question — it is nobody's individually, but it
  is made of many funders' change. Sweeping it to the treasury is the obvious answer and probably
  the right one; it should be a deliberate decision rather than a default.
- **The `unclaimed` recovery path has no UI.** A flow whose claim reverted holds funds that are not
  at the deposit address, so the pending-balance card can't see them. Gating the burn on
  renewability makes this rare, but "rare" is not "never" — a name can stop being renewable between
  burn and attestation. Note this is now the *only* resting place a funder can't see; atomicity in
  the helper means the funds are never in the helper, and everything pre-burn stays at the deposit
  address where the card already shows it.

Settled, noted here so they don't get reopened as bugs:

- **Custody.** CREATE2 addresses, no third party holding keys. Non-custodial, and the earlier
  CDP-based design that wasn't is superseded — see `docs/DECISIONS.md`.
- **No fee quoting.** Standard CCTP has no Circle fee; the flat $0.10 allowance replaces the whole
  per-chain estimate/buffer approach.
- **The aggregate tiles mix bases on purpose.** `total_received` is lifetime USDC at the address,
  `total_seconds` is what the registry recorded — two different facts, neither derived from the
  other, so there is nothing to reconcile.
- **Funder identity.** Solved by the pipeline. Every delivered row carries the transfer's `from`,
  stored as `deposits.from_address`, so the UI shows the real sender and resolves it to an ENS name
  where one exists. The mock's semantic labels (`community`, `treasury`) were never derivable and
  go away. `owner` stays derivable, by comparison against the ENS owner.
- **The database and the pipeline are one choice, not two.** Goldsky's dynamic table is Postgres, so
  the filter lives in the same Neon database the app reads. Picking a non-Postgres store would mean
  running a second database purely to hold the address set, and keeping two writers in step.

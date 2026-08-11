# Architecture — contracts (built) and production system (specified)

**This file covers two parts at two different stages. Check which part you are reading.**

- **Contracts: built.** The sections from here to the end of "CCTP at contract level" describe
  `contracts/NamepassFactory.sol` and `contracts/ENSV2RenewalHelper.sol`. Both are **deployed to
  four testnets**. Both have been run against the deployed ENS and Circle contracts.
  `docs/DEPLOYMENTS.md` records the addresses, the configuration, and the transactions that prove
  each claim. **The contracts have no external audit. There is no mainnet deployment.**
- **Production system: specified, not built.** The sections from "Production system" to the end
  describe Goldsky Turbo, Neon Postgres, Vercel Functions, Vercel Workflow, the API, the schema,
  and the implementation phases. **None of them exist.** There is no backend code, database, or
  pipeline deployment. The UI follows the domain model in this specification.

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
  deposit         burn + hook      attestation        mint + renewal
  ───────►  ───────────────►  ──────────────►  ─────────────────►
  (any chain)   origin chain      Circle Iris       Ethereum, atomic
                └──────────── Vercel Workflow orchestrates ────────────┘
```

1. USDC lands at a name's CREATE2 address on Base, Arbitrum, Arc or Ethereum.
2. A **Goldsky Turbo webhook** hits a Vercel Function. It records the deposit and starts a durable
   workflow when the trigger conditions are met.
3. The workflow performs the CCTP **burn with a hook** on the origin chain.
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

## Production system

> **This section is a specification. It is not built yet.** The contracts above are deployed to
> four testnets. The frontend still uses simulated activity from `src/lib/registry.ts`. There is no
> API, database, Goldsky pipeline, relayer, or Vercel Workflow in this repository.

The remaining system uses three managed platforms:

- **Goldsky Turbo** detects USDC transfers and Namepass contract events.
- **Neon Postgres** stores application state and is the source of truth for the API.
- **Vercel** hosts the Vite app, API functions, and durable renewal workflows.

Circle Iris remains an external protocol API. Chain RPC endpoints remain necessary for reads,
transaction submission, and receipt checks. These are integrations, not additional application
services.

The first production version does not add a queue, Redis, a WebSocket service, a separate worker
deployment, or a second database. Vercel Workflow supplies durable execution. Neon supplies
transactions and constraints. Goldsky supplies the ordered event stream and retries.

### System map

~~~mermaid
flowchart LR
    U[User or funder] -->|Activate name and read data| V[Vercel app and API]
    U -->|Send native USDC| C[Supported chain]
    C -->|USDC transfers and protocol logs| G[Goldsky Turbo]
    N[(Neon Postgres)] -->|watched addresses| G
    G -->|Authenticated, at-least-once webhook| V
    V -->|Transactions and read models| N
    V -->|Start or resume| W[Vercel Workflow]
    W -->|renew or renewWithFee| C
    W -->|Get message and attestation| I[Circle Iris]
    W -->|completeCCTP| E[Ethereum helper]
    V -->|Read API| F[Vite frontend]
~~~

### Service boundaries

| Component | Owns | Does not own |
|---|---|---|
| Goldsky Turbo | Chain event detection, source checkpoints, delivery retries | Business decisions, flow state, balances, transaction signing |
| Neon Postgres | Names, deposits, flows, transaction intents, constraints, public read data | Chain finality, CCTP attestations, durable code execution |
| Vercel Functions | HTTP validation, database transactions, workflow start, public reads | Long waits, in-memory queues, durable locks |
| Vercel Workflow | Renewal sequence, retry policy, Circle polling, chain writes | Public read models, event indexing |
| Contracts | Deterministic wallets, USDC movement, ENS pricing, atomic mint and renewal | ENS normalization, deposit detection, automation |
| Circle Iris | CCTP message and attestation data | Namepass flow state or retry decisions |

The API never treats Goldsky, Neon, or a workflow result as proof of chain state. It verifies
receipts, contract events, and current contract reads before it moves money.

## One configuration model

The implementation must create one shared chain registry. The frontend, API, workflow, Goldsky
configuration generator, and tests must read it.

Each chain entry contains:

- internal chain key
- display name and logo key
- chain ID
- testnet or mainnet flag
- Goldsky dataset prefix
- native USDC address
- Namepass factory address
- Circle source domain
- block explorer URL
- RPC environment-variable name
- deposit finality policy
- workflow polling policy

The registry contains no secrets. RPC URLs and signer keys stay in Vercel environment variables.
Goldsky dataset versions stay pinned in the committed pipeline definition.

This change removes the current multi-file chain list. A chain is supported only when one registry
entry, its logo asset, its deployed contracts, and its end-to-end test all exist.

### Launch chain sets

The stable testnet and the initial mainnet do not have to contain the same chains.

| Environment | Chains |
|---|---|
| Stable testnet | Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia, Arc Testnet |
| Initial mainnet | Ethereum, Base, Arbitrum |

Arc is testnet-only for this launch plan. As of 2026-08-11, Circle lists Arc Testnet but not Arc
mainnet as a CCTP domain. Goldsky also lists Arc Testnet but not Arc mainnet. Initial mainnet launch
must not wait for Arc.

Support evidence: [Circle CCTP supported domains](https://developers.circle.com/cctp/concepts/supported-chains-and-domains)
and [Goldsky supported networks](https://docs.goldsky.com/chains/supported-networks).

Add Arc mainnet later only when all of these conditions are true:

- Circle supports native USDC, Standard CCTP v2, and hooks on Arc mainnet.
- Goldsky provides the required Arc mainnet `erc20_transfers` and `raw_logs` datasets.
- The shared registry contains reviewed RPC, finality, explorer, token, and CCTP values.
- The Namepass contracts are audited, deployed, verified, and tested on Arc mainnet.
- A low-value canary produces matching Goldsky, Circle, contract, API, and frontend evidence.

The $0.50 trigger floor starts with no per-chain override. A later change needs measured transaction
costs and a reviewed configuration change. It does not need a contract deployment.

## Name activation

A deterministic address can be derived for every valid ENS label. Goldsky cannot infer a label from
an address. It therefore needs an explicit set of addresses to watch.

`POST /api/names/activate` performs this sequence:

1. Accept a single `.eth` name or label.
2. Normalize it with ENSIP-15.
3. Reject invalid, dotted, empty, or over-length labels.
4. Read ENS renewability and expiry from the authoritative renewers.
5. Derive the deposit address with the deployed factory constants.
6. In one Neon transaction, insert the name and insert the lowercase address into
   `goldsky.watched_addresses`.
7. Read the native USDC balance of the address.
8. If the balance is positive, create or find a queued flow. This recovers funds that arrived before
   activation.
9. Return the activated name and address.

The endpoint is idempotent. The normalized label and deposit address both have unique constraints.
A repeated activation returns the existing row.

The frontend must not show a copy button or QR code for a newly entered name until activation
succeeds. This ordering closes the dynamic-table timing window. Goldsky checks the Postgres table
on each batch. A transfer that is mined after the activation response can match the next batch.

A person can still derive and fund an address without activating it. Goldsky cannot detect that
transfer at the time it occurs. The balance check in step 7 is the recovery path. The recovered
flow can renew the name, but the application might not know the original sender or transfer time.
The API marks this source as `balance_recovery` and does not invent contribution metadata.

### Balance reads fail soft

Step 7 reads four chains. A read can fail. **A failed read must not fail the activation**, and it
must not be recorded as a zero balance.

This is the opposite of how the frontend's other chain reads behave. `oracle.ts` and `fees.ts` stop
the application when they fail, deliberately, because a missing price is a wrong price and a
fallback price is an invented one. A missing balance is not the same thing. One unreachable Arc
endpoint must not block an activation or blank a card.

Three rules follow:

- **Activate on partial success.** Record the balances that came back, and write the chains that did
  not answer to `names.unscanned_chain_ids`.
- **Render an unanswered chain as unknown.** Never as zero and never as absent. Both state a fact
  the application does not have, and "no balance on Arc" is the sentence that stops a person
  chasing money they actually sent.
- **The recovery job retries it.** This matters more than it looks. The recovery job does not scan
  deposit addresses, and a failed read creates no queued flow, so nothing else would ever look
  again. Without this retry, a funded chain that was unreachable for one second at activation stays
  invisible to the backend permanently, and the only recovery is a person noticing and pressing the
  manual trigger.

Names remain in the watched set. Deleting them would make later deposits invisible. The table is
therefore small, append-only application data, not an expiring cache.

## Goldsky Turbo

### Pipeline scope

Use one Turbo pipeline for each stable application environment:

- `namepass-testnet` targets the four testnets and the stable testnet Vercel deployment.
- `namepass-mainnet` will target the audited mainnet deployments.
- Pull-request previews do not receive Goldsky webhooks.

Each pipeline has three event families. Two of them read contracts Namepass does not own. That is
required, not optional: without them the Explorer cannot link a renewal to the transactions behind
it, and cannot show the correct expiry after a renewal. See "Why the external events are required".

**Deposit events**

Use each chain's curated `erc20_transfers` dataset. Filter at the source for the native USDC contract.
Then keep rows whose lowercase `recipient` exists in `goldsky.watched_addresses`.

The supported-network check confirms that Goldsky has logs and enriched transaction data for
Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia, and Arc Testnet. The implementation must still run
`goldsky dataset get` for every exact dataset name and pin the returned version before deployment.
Do not guess a dataset slug or use `latest`.

**Namepass protocol events**

Use each chain's `raw_logs` dataset. Filter for the Namepass factory address. On Ethereum, also
filter for the helper address. Decode these events:

- `WalletDeployed`
- `DepositProcessed`
- `CCTPClaimed`
- `Renewed`

Protocol events are necessary even when the workflow records its own receipts. The contracts are
permissionless. A third party can call `renew` or `completeCCTP` without the Namepass API. Goldsky
makes that activity visible and reconciles the public history.

**External protocol events**

Same `raw_logs` mechanism, two more addresses per chain. These are Circle's and ENS's contracts.

| Chain | Contract | Event | Supplies |
|---|---|---|---|
| Every L2 | Circle `MessageTransmitterV2` | `MessageSent(bytes message)` | The CCTP nonce, read from the message at byte offset 12 |
| Ethereum | ENS `ETHRegistrar` and `ETHRenewerV1` | `NameRenewed(...)` | `newExpiry`, and renewals that bypassed Namepass |

`MessageTransmitterV2` is `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` on every testnet chain. The
ENS addresses are in `docs/DEPLOYMENTS.md`. Pin all of them from the shared chain registry, the same
way the factory address is pinned.

### Why the external events are required

Both close a gap that Namepass's own events cannot, and neither needs a contract change.

**The CCTP nonce is the only exact key between a burn and its claim.**

`CCTPClaimed` on Ethereum is indexed by `nonce`. `DepositProcessed` on the origin chain is not, and
cannot be. CCTP v2's `depositForBurnWithHook` returns nothing — the `uint64 nonce` return belongs to
v1, and declaring it in v2 makes Solidity enforce a returndata size and revert on every burn, which
is why the factory's interface declares it `void`. **The factory never learns the nonce, so no
redeploy could make it emit one.**

Circle's `MessageTransmitterV2` emits `MessageSent` in the same transaction as the burn, and the
nonce sits at a fixed offset in that blob. The helper already decodes it the same way
(`MESSAGE_NONCE_OFFSET`). Indexing it gives the join:

~~~text
origin chain:   DepositProcessed  +  MessageSent          (same transaction)
                                            │ nonce
Ethereum:                        CCTPClaimed(nonce)  +  Renewed
~~~

Without `MessageSent`, linking a burn to its claim needs a heuristic on label, source domain and
ordering. That is exact enough for flows the workflow ran, because `transaction_intents` records
them. It is not exact for a renewal a third party pushed, which is the case protocol events exist to
capture.

**ENS reports the expiry after a renewal, so nothing has to derive it.**

`NameRenewed` carries `newExpiry` directly. The alternative is to read the current expiry and
subtract known durations backwards, which is wrong the moment a name is renewed outside Namepass, at
registration, or by the v2 migration's one-time 62-day adjustment. Those are exactly the cases a
funder would notice on the runway bar.

`NameRenewed.referrer` is **indexed**, and the deployed helper sets a Namepass referrer
(`docs/DEPLOYMENTS.md`). Renewals that came through Namepass can therefore be separated from the
rest by an indexed filter, with no join.

**What the Explorer gets from each source.** `Renewed` was written for this — `label` is unindexed
so an indexer can read the string, `labelHash` is indexed so it can be filtered, and the three
amounts are deliberately not collapsed.

| Explorer field | Source |
|---|---|
| name | `Renewed.label`, a readable string |
| duration | `Renewed.duration` |
| deposited, allowance, applied | `Renewed.amountReceived`, `gasAllowance`, `amountApplied` |
| final step label | `Renewed.fromCCTP` picks "Renewed" or "Minted and renewed" |
| who pushed it | `Renewed.executor` |
| origin chain | `CCTPClaimed.sourceDomain`, same transaction; Ethereum when `fromCCTP` is false |
| expiry after this renewal | `NameRenewed.newExpiry` |
| the transactions behind it | `DepositProcessed` + `MessageSent` joined to `CCTPClaimed` by nonce |
| discount label | Not on chain. Computed from the applied amount and label length. |

In-flight rows are not in this table on purpose. No event can express `attesting`, because it is the
gap between two transactions. Live progress comes from `flows` in Neon. Events describe settled
history only.

### Transform output

Every output row uses a stable event ID. It includes:

- event family and event type
- chain ID
- block number and time
- transaction hash
- log index
- contract or token address
- normalized transfer or decoded event fields
- `_gs_op`

Keep `_gs_op` through every transform. Goldsky uses `c` for a canonical create and `d` when a reorg
removes a row.

The pipeline sends one row per webhook request. This reduces partial-batch handling and makes the
event ID the idempotency key.

### Delivery choice

The pipeline uses an authenticated webhook sink. It does not also write the same event to a
Goldsky-managed Postgres sink.

This is intentional:

- Goldsky already checkpoints the source and retries the webhook indefinitely for network errors,
  timeouts, `408`, `429`, and `5xx` responses.
- The Vercel endpoint upserts the event into Neon before it returns `2xx`.
- A second sink would create two writers, a delivery-order race, and a second schema to operate.
- Neon is already the queryable application index.

The webhook has at-least-once delivery. The receiver must expect duplicates. It also must expect a
reorg delete after a create.

Goldsky stores the webhook authorization header as an `httpauth` secret. The pipeline file contains
only the secret name. The Vercel endpoint compares the header in constant time and rejects an
invalid request.

### Goldsky database role

Goldsky reads only `goldsky.watched_addresses` from Neon. Use a dedicated `goldsky_reader` role.

After migrations create the schema and table, grant this role:

- `CONNECT` on the database
- `USAGE` on the `goldsky` schema
- `SELECT` on `goldsky.watched_addresses`

Do not give it application-table write access. Use a direct Neon connection string with
`sslmode=require`. Store that string only in Goldsky Secrets.

### Reorg and finality policy

Detection is not permission to spend.

The webhook records a detected deposit immediately. The workflow then waits for the configured
deposit finality policy before it calls `renew`. Prefer an RPC `finalized` block check when the chain
supports it. Otherwise, use a reviewed confirmation depth in the shared chain registry.

Before the first origin transaction, the workflow verifies all of these facts:

- the deposit transaction is still canonical
- the watched address still has native USDC
- the name is renewable now
- no other active flow owns this name and chain
- the factory and token addresses match the chain registry

If Goldsky sends `_gs_op = d` before a transaction is broadcast, the receiver marks the deposit as
orphaned and cancels a flow that has no origin transaction. If a reorg occurs after the origin
transaction, contract state and transaction receipts control recovery. The webhook alone cannot
reverse a chain action.

## Webhook ingestion

`POST /api/webhooks/goldsky` is a small Vercel Function.

It performs this sequence:

1. Verify the authorization header before JSON parsing.
2. Enforce a body-size limit.
3. Parse the event with a strict schema.
4. Verify that the chain, token, contract, and event signature are allowlisted.
5. Start one Neon transaction.
6. Upsert the chain event by its Goldsky event ID and on-chain position.
7. Apply `_gs_op`.
8. Upsert the domain row, such as a deposit or renewal.
9. Create a queued flow when the trigger policy permits it.
10. Commit.
11. Start or resume the Vercel Workflow when a queued flow exists.
12. Return `2xx` only after the durable database write and workflow-start attempt succeed.

A duplicate create changes no money totals and starts no second flow. A duplicate delete changes no
additional state.

If Neon or Workflow is unavailable, return `503`. Goldsky will retry. Do not return `2xx` and hope a
background callback finishes.

## Trigger policy

### Automatic queueing

Evaluate each name and chain separately. Funds on different chains never combine.

The webhook queues work as soon as it has a canonical detected deposit. The workflow, not the
webhook request, waits for finality.

The first production queueing policy is:

~~~text
eligible =
  canonical deposit exists
  AND on-chain wallet balance > GAS_ALLOWANCE
  AND no active flow exists for (name, chain)
  AND subsidy policy permits the transaction
~~~

The workflow waits for deposit finality and then rechecks name renewability immediately before it
submits the origin transaction. If the name is not renewable, the workflow moves to `held` and
keeps the funds at the deposit address. This split is necessary because Goldsky sends the transfer
event before a later finality transition. Waiting to create a flow would leave no event that starts
the work.

The contract uses the wallet's live balance. The database does not attempt to allocate exact
deposit rows to a flow. Deposits are contribution history. The `DepositProcessed` event is the
authority for the amount a flow actually consumed.

This removes `deposit_allocations` and a derived balance ledger. The public pending balance comes
from the latest chain read plus the active flow state.

### Manual trigger

`POST /api/flows/trigger` is permissionless, as the contract is permissionless. It accepts a
normalized name and chain ID.

The endpoint repeats every server-side check. It does not trust frontend state. It returns:

- `202` when it creates or resumes a queued flow
- `200` when the same flow is already queued
- `409` when a non-resumable active flow already exists, with its current state
- `422` when the name or balance is not eligible

An `unclaimed` flow is the exception to the ordinary balance checks because its origin balance is
already zero. If a fresh ENS read says that the name is renewable, the endpoint returns `202` and
resumes the same message. If the name is not renewable, it returns `409` with the current unclaimed
state. It never creates a replacement burn.

Vercel Firewall rate limits this endpoint. Database constraints provide the concurrency guard.

### Minimum amount

The contracts enforce the technical minimum. The service also needs an economic minimum because it
pays origin and Ethereum gas.

**The threshold is $0.50 on a single chain, decided 2026-08-11.** It is a flat figure, not a ratio.
It replaced "the gas allowance may be at most 15% of the balance", which produced $0.666667 and was
a placeholder for a product decision nobody had made.

Keep the mechanism this section already specifies: store it as server configuration **by chain**, so
a chain with different economics can move without a deployment, and keep it out of the contracts.
$0.50 is the value every chain starts at, not a constant that removes the per-chain setting.

The API returns the configured minimum so the frontend does not copy it. Until the frontend cutover
in Phase 6 the simulation holds it as `MIN_TRIGGER` in `src/lib/registry.ts`, which is the number
the pending-balance card states today. That constant is the thing the API replaces, not a second
source to keep in step.

At a $0.10 allowance the floor is exactly 20%, so a funder sending the minimum spends a fifth of it
on gas and buys about 18 days on a five-character name.

## Durable renewal workflow

One workflow run owns one `flows` row. The workflow function only controls sequence and sleeps. Each
network, database, signing, or parsing operation is a `use step` function.

A step can run more than once. Every step must therefore be idempotent from its input and the Neon
row.

### Common first steps

1. **Load flow.** Stop successfully if the flow is already settled or cancelled.
2. **Confirm deposit.** Wait for canonical finality. Cancel if the deposit is orphaned.
3. **Recheck name.** Read both ENS renewers. Park the flow if neither can renew the label.
4. **Read balance.** Read native USDC `balanceOf` at the deterministic wallet.
5. **Simulate origin call.** Simulate `renew(label)` or `renewWithFee(label, maxFeeBps)`.
6. **Prepare transaction.** Create a durable transaction intent and reserve a relayer nonce.
7. **Broadcast transaction.** Send the stored signed bytes. Re-sending the same bytes is safe.
8. **Confirm receipt.** Wait for the receipt and parse `DepositProcessed`.

The simulation is a safety check, not a guarantee. State can change before inclusion. A revert keeps
the funds at the deposit address and is retryable after classification.

### Ethereum-origin flow

Ethereum has no CCTP leg.

~~~text
confirm deposit
  → verify renewability and balance
  → submit factory.renew(label)
  → confirm DepositProcessed and Renewed in one receipt
  → record settlement
~~~

The helper pulls USDC and renews atomically. A revert leaves the USDC at the deposit address.

### L2-origin flow

Base, Arbitrum, and Arc use CCTP.

~~~text
confirm deposit
  → verify renewability and balance
  → submit factory.renew(label)
  → confirm DepositProcessed and Circle MessageSent
  → query Iris by source domain and origin transaction hash
  → wait for status complete
  → verify returned route, nonce, amount, wallet, label, and attestation status
  → submit helper.completeCCTP(message, attestation) on Ethereum
  → confirm CCTPClaimed and Renewed in one receipt
  → record settlement
~~~

One factory `renew` call burns at most Circle's current per-message limit. It produces at most one
CCTP message. If `DepositProcessed.remaining` is non-zero, the settled workflow queues a new flow
for the same name and chain. It does not add child-message logic to the current flow.

Circle returns messages for a transaction in log-index order. The workflow still verifies that the
selected message has all Namepass route fields:

- expected source domain
- Ethereum destination domain
- Ethereum TokenMessenger recipient
- Namepass helper as destination caller
- Namepass helper as mint recipient
- deterministic wallet as message sender
- normalized label bytes as hook data

The helper repeats these checks on chain. The off-chain checks prevent gas waste and bad records.

### Attestation polling

Use Circle's `GET /v2/messages/{sourceDomainId}` endpoint with the origin transaction hash.

- Use the sandbox host for testnets.
- Use the mainnet host for mainnet.
- Treat `404` or an incomplete status as “not ready.”
- Treat `429` and `5xx` as retryable.
- Use exponential backoff with jitter.
- Respect Circle's published API limit.
- Store the raw message, attestation, nonce, and response status before the claim.

The current deployments use Standard finality. Standard messages are attested at finalized
finality. Fast Transfer is not part of the first backend.

### Unclaimed CCTP state

A burn cannot be reversed. A claim can fail if the name stops being renewable after the burn.

When `completeCCTP` simulation or execution fails for a business reason:

1. Set the flow to `unclaimed`.
2. Keep the message and attestation.
3. Show the state in the public name view.
4. Recheck renewability on a slow backoff.
5. Retry the same claim when the name becomes renewable.

Do not start a new burn for the same USDC. The funds are represented by the unclaimed CCTP message,
not by the origin wallet balance.

The public name view shows an unclaimed flow as a separate card. It must not show zero or imply that
the USDC is still at the origin address. Use this copy:

- **Title:** `Waiting to renew`
- **Body:** `The USDC left {origin chain} and is secured in a Circle message. This name cannot be renewed now. Namepass will retry when renewal is possible.`
- **Evidence:** amount, origin chain, origin transaction, Circle nonce, and the latest retry time
- **Secondary note:** `This transfer cannot return to {origin chain}. A retry uses the same Circle message.`

Show `Retry renewal` only when a fresh ENS read says that the name is renewable. The action calls
`POST /api/flows/trigger`. That endpoint must resume the existing unclaimed flow and return its flow
ID. It must not create a flow or burn USDC again. Hide the action while the name is not renewable.
Automatic retry remains the normal path. The button is an idempotent recovery action, not a required
step.

A Standard attestation is the current path. If the product later enables Fast Transfer, add
re-attestation and expiration handling as a separate architecture decision.

### Workflow error classes

Classify failures before retry.

| Class | Examples | Action |
|---|---|---|
| transient | RPC timeout, Iris `429`, Neon timeout | retry with backoff |
| replacement needed | underpriced or stuck transaction | sign a replacement with the same nonce |
| business hold | name not renewable, amount below policy | park and expose reason |
| terminal configuration | wrong contract, wrong token, invalid route | fail and alert; do not retry |
| already complete | nonce used, receipt already canonical | reconcile from chain and settle |

Use a fatal workflow error only for a permanent input or configuration fault. Do not convert a
business hold into repeated failed steps.

## Relayer and transaction safety

The relayer holds no user funds. It pays gas and receives the fixed helper allowance after a
successful renewal. Its key is still security-sensitive because it can submit transactions and
consume gas.

Use one exclusive relayer account per environment. It can be the same address across chains, but no
other tool or person may send transactions from it.

Vercel serverless functions can run concurrently. An in-memory nonce manager is not safe. Neon
therefore stores nonce state.

### Transaction intent algorithm

1. Build and simulate the call without a nonce.
2. Start a Neon transaction.
3. Lock the `relayer_nonces` row for the chain with `SELECT ... FOR UPDATE`.
4. Read the RPC pending nonce.
5. Reserve `max(database_next_nonce, rpc_pending_nonce)`.
6. Sign the full transaction with the reserved nonce.
7. Insert the raw signed transaction and expected hash.
8. Increment `next_nonce`.
9. Commit.
10. Broadcast the stored raw transaction.
11. Record the receipt or replacement.

If the process stops after step 9, recovery rebroadcasts the same bytes. If the RPC reports “already
known,” continue receipt polling. If a transaction is stuck, sign a higher-fee replacement with the
same nonce and link it to the same intent.

The database never stores the private key. Vercel stores it as a sensitive production environment
variable. Preview deployments receive test-only keys and cannot read production secrets.

### Relayer funding

The production treasury Safe multisignature wallet funds the relayer with native gas tokens. The
operations role owns the refill. The private runbook names one primary operator and one backup
operator. Do not put personal names in the public architecture document.

Do not automate refills in the first version. An automatic treasury signer would add another key
that can move funds. The relayer already has alerts and a manual refill has a long safety window.

Set the initial balance policy from measured testnet and canary transactions:

1. For each chain and transaction kind, record the highest gas cost from the launch test suite.
2. Multiply that cost by two to define one transaction unit.
3. Send a warning when the relayer balance is below 20 transaction units.
4. Send a critical alert when the balance is below 5 transaction units.
5. Refill to 50 transaction units from the production Safe.

Recalculate the unit after a contract change or after seven production days. Then use the greater
of twice the test maximum and twice the observed seven-day 95th-percentile cost. Keep only this
limited gas balance on the relayer. The $0.10 USDC allowance does not refill native gas
automatically. Treasury operations can account for or convert collected allowances outside the
renewal workflow.

## Neon data model

Use Drizzle for schema declarations and migrations. Use `numeric(78,0)` for token amounts. Return
amounts, durations, block numbers, and chain IDs as decimal strings at the JSON boundary when they
can exceed JavaScript's safe integer range.

Vercel Functions use the pooled `DATABASE_URL`. Migrations, Goldsky's dynamic-table connection, and
administrative tools use direct connections. A pooled connection must not be used for session-level
locks. The transaction design uses row locks, which work with transaction pooling.

### `names`

One row per activated label.

- `id`
- `normalized_label`, unique
- `display_name`
- `label_hash`, unique
- `namehash`
- `deposit_address`, unique
- `activated_at`
- `current_expiry`
- `renewable_by`
- `ens_synced_at`
- `unscanned_chain_ids`
- cached public totals

The cached totals are rebuildable. Contract events and deposit rows remain the authority.

`unscanned_chain_ids` holds the chains whose activation balance read did not complete. Activation
writes the chains that failed; the recovery job retries them and removes each one that succeeds. An
empty array means every chain was read. It is a small array on an already-small table, not a new
table. Without it a failed read at activation is unrecoverable — see "Balance reads fail soft".

### `goldsky.watched_addresses`

The dynamic table read by Goldsky.

- `value`, lowercase address primary key
- `updated_at`

The activation transaction writes this table. Application migrations own it. Goldsky does not own
the schema.

### `chain_events`

The event inbox. Event identity and payload are append-only. Reorg handling can change the
canonical flag.

- `event_id`, primary key
- `event_family`
- `event_type`
- `chain_id`
- `tx_hash`
- `log_index`
- `block_number`
- `block_time`
- `gs_op`
- `canonical`
- `payload`, nullable after the retention period
- `payload_expires_at`
- `first_seen_at`
- `last_seen_at`

Add a unique constraint on `(chain_id, tx_hash, log_index, event_type)`. A reorg delete updates
`canonical`.

Keep the raw Goldsky payload for 30 days. Keep the normalized columns, canonical state, domain rows,
and transaction evidence without a time limit. Raw payloads contain public chain data and are useful
for incident diagnosis, but Goldsky can replay them. Permanent duplicate storage has no launch
benefit.

A daily authenticated retention job clears expired payloads in bounded batches. It sets `payload`
to `NULL`; it does not delete the `chain_events` row. The job uses `payload_expires_at`, so it does
not calculate retention from mutable application time. A legal or incident hold can move the expiry
for selected rows before cleanup.

`event_family` is one of `deposit`, `namepass`, `circle`, or `ens`. The last two carry
`MessageSent` and `NameRenewed`, which the Explorer needs to link a renewal to its transactions and
to show the expiry after it. No extra table is required for them. See "Why the external events are
required".

### `deposits`

One domain row per native USDC transfer to a watched address.

- `event_id`, primary key and foreign key to `chain_events`
- `name_id`
- `chain_id`
- `token_address`
- `sender_address`, nullable for balance recovery
- `amount`
- `tx_hash`
- `log_index`
- `block_number`
- `block_time`
- `source`: `goldsky` or `balance_recovery`
- `status`: `detected`, `finalized`, or `orphaned`

Do not store a mutable “available amount” on this row. The wallet's token balance is the authority
for what the contract can process.

### `flows`

One renewal execution.

- `id`
- `name_id`
- `origin_chain_id`
- `trigger`: `automatic`, `manual`, `recovery`, or `external`
- `status`
- `hold_reason`
- `workflow_run_id`
- `origin_tx_intent_id`
- `claim_tx_intent_id`
- `amount_detected`
- `amount_processed`
- `remaining_amount`
- `gas_allowance`
- `amount_applied`
- `duration_seconds`
- `cctp_nonce`
- `cctp_message`
- `cctp_attestation`
- `last_error_code`
- `last_error_detail`
- `next_action_at`
- status timestamps
- `created_at` and `updated_at`

Use this state model:

~~~text
queued
  → confirming_deposit
  → checking_name
  → submitting_origin
  → waiting_origin
  → waiting_attestation
  → submitting_claim
  → waiting_claim
  → settled

checking_name → held
waiting_attestation | submitting_claim | waiting_claim → unclaimed
any pre-broadcast state → cancelled
configuration fault → failed
~~~

Ethereum flows skip the CCTP states.

Use a partial unique index for one active flow per name and chain. Active means every state except
`settled`, `cancelled`, and `failed`. An `unclaimed` flow remains active.

### `flow_transitions`

Append-only state history.

- `id`
- `flow_id`
- `from_status`
- `to_status`
- `actor`
- `reason_code`
- `detail`
- `created_at`

The current status stays on `flows` for fast reads. This table explains why it changed.

### `relayer_nonces`

One row per environment, chain, and relayer address.

- `chain_id`
- `relayer_address`
- `next_nonce`
- `updated_at`

Primary key: `(chain_id, relayer_address)`.

### `transaction_intents`

One durable logical on-chain write. A fee replacement updates the same row and keeps the same
nonce.

- `id`
- `flow_id`
- `kind`: `origin_renew` or `claim`
- `chain_id`
- `from_address`
- `to_address`
- `nonce`
- `call_data`
- `value`
- current gas fields
- `current_raw_transaction`
- `current_tx_hash`
- `attempts`, a JSON array of signed hashes, fee fields, and broadcast times
- `status`
- `broadcast_at`
- `confirmed_at`
- `receipt`
- `error`

Use a unique constraint on `(flow_id, kind)`. Use a second unique constraint on
`(chain_id, from_address, nonce)`. A replacement is another signed attempt inside the same logical
intent, not another nonce owner.

### No extra tables in the first version

Do not add these old draft tables:

- `deposit_allocations`
- `webhook_deliveries`
- a Goldsky copy of the same deposit table
- a running-balance aggregate
- a separate renewal table
- a job queue table

`chain_events` is the replay and audit inbox. `flows` and `flow_transitions` hold workflow state.
`transaction_intents` holds on-chain steps. Public renewal rows come from canonical `Renewed`
events.

## API and frontend reads

All public data is public chain-derived data. The frontend reads it through Vercel APIs. It does not
connect directly to Neon. There is no user account or browser database credential in the first
version.

### Write endpoints

- `POST /api/names/activate`
- `POST /api/flows/trigger`
- `POST /api/webhooks/goldsky`
- `GET /api/cron/recover`, authenticated with `CRON_SECRET`
- `GET /api/cron/retention`, authenticated with `CRON_SECRET`

### Read endpoints

- `GET /api/names/:label`
- `GET /api/names/:label/activity`
- `GET /api/activity`
- `GET /api/leaderboard`
- `GET /api/stats`
- `GET /api/flows/:id`
- `GET /api/config/public`

Use cursor pagination for activity. Cap page sizes. Set short public cache headers for aggregate
reads. Do not cache active flow detail.

### Public sender identity

Show the checksummed transfer sender address as `Funded by` in activity details. Dense feed rows can
shorten it visually, but the detail view, copy action, and accessible label must contain the full
address. Do not resolve ENS names in the first version. Resolution adds another network dependency
and can display an unverified reverse name unless the application also performs forward
verification.

Keep the transfer sender and renewal executor separate:

- `deposits.sender_address` supplies `Funded by`.
- `Renewed.executor` supplies `Processed by`.
- Show `Processed by Namepass` when the executor is the configured relayer, with the full address in
  the detail view.
- Show the raw executor address when a third party called the permissionless function.
- Show `Sender unavailable` for `balance_recovery`. Do not invent a sender from later events.

An address is public chain data. Do not add avatars, profile data, or claims such as “owner” or
“supporter.” Those claims are not present on chain.

### Frontend update model

Use ordinary HTTP polling.

- Poll an active name or flow every 3 to 5 seconds.
- Poll the live feed every 10 to 15 seconds.
- Stop fast polling when no flow is active.
- Refetch on window focus.
- Use exponential backoff after errors.

Do not add WebSockets or Supabase Realtime. The user waits minutes for Standard CCTP on some chains.
Polling is sufficient and has fewer failure modes.

### Read-model rules

- A pending balance is per name and chain.
- The displayed balance comes from a recent native USDC `balanceOf` read.
- An active flow explains funds that have left the origin address.
- An `unclaimed` flow must remain visible even though the origin balance is zero.
- Lifetime received is the sum of canonical native USDC deposit events.
- Time delivered and amount applied come from canonical `Renewed` events.
- A protocol event seen outside a known workflow creates or reconciles an `external` flow.
- Never infer a completed renewal from an empty deposit address.

## Recovery job

Vercel Cron calls `GET /api/cron/recover`. This is a control-plane repair job. It is not a chain
indexer.

It finds bounded batches of:

- queued flows with no workflow run ID
- workflows whose next action time passed
- signed transactions that were never broadcast
- broadcast transactions without a recorded receipt
- attested CCTP messages without a claim
- settled flows whose canonical `Renewed` event has not arrived yet
- names with a non-empty `unscanned_chain_ids`

For each row, it starts or resumes the same idempotent action. For the last one it re-reads the
balance on the listed chains, removes each chain that answers, and queues a flow if the balance is
now eligible.

The job does not scan every deposit address and does not compute balances from deposit arithmetic.
Goldsky source checkpoints recover chain ingestion. Public manual trigger plus activation balance
recovery handle a pre-activation transfer.

**`unscanned_chain_ids` is not an address sweep.** The candidate set is names already activated
whose activation read is recorded as incomplete, so it is bounded by activation volume and empties
itself. It exists because the two mechanisms above have a gap between them: activation balance
recovery only recovers what it managed to read, and the manual trigger needs a person. A chain that
was unreachable for one second during activation would otherwise be invisible forever.

Run the job at a short interval on the Vercel plan that supports it. Protect it with
`CRON_SECRET`. Use a database lease so two invocations do not process the same recovery batch.

## Environments and deployment

### Local development

- Vite and `vercel dev` run the app and API.
- Workflow uses its local development backend.
- A Neon developer branch holds the schema and fixtures.
- Goldsky webhooks are represented by saved fixture payloads.
- Anvil tests transaction logic without public testnet gas.

### Pull-request preview

- Vercel creates a preview deployment.
- Neon creates an isolated preview branch.
- Migrations run against that branch.
- The preview uses fixture ingestion and test relayer keys.
- No production or shared testnet Goldsky pipeline targets the preview URL.
- Closing the PR deletes the preview branch.

### Stable testnet

- One stable Vercel deployment receives the `namepass-testnet` webhook.
- One stable Neon branch stores testnet application state.
- The relayer has testnet native gas only.
- End-to-end tests send test USDC on each of the four chains.

### Production

- One production Vercel deployment receives the mainnet webhook.
- The production Neon branch does not scale to zero if cold-start latency harms webhook handling.
- Goldsky and Vercel secrets are scoped to production.
- The relayer key is production-only and funded with small gas balances.
- Mainnet activation starts only after the contracts are audited, deployed, verified, and proven.

The Goldsky pipeline must point to a stable domain. Do not point it to a Vercel deployment URL that
changes on every build.

### Provider plans for initial production

Use these plans for the first production version. Verify the plan names and limits again before
purchase because providers can change them.

| Provider | Initial plan | Reason |
|---|---|---|
| Vercel | Pro | The recovery cron needs a per-minute schedule. Hobby permits only daily schedules. Pro also supplies usage-based Workflow and Function capacity. |
| Neon | Launch | The expected data and connection load is small. Launch supplies pooled connections, autoscaling, up to a seven-day restore window, and enough branches for the first preview workflow. Disable scale-to-zero on the production compute. |
| Goldsky | Scale | Production and stable testnet require two concurrent pipelines. Scale removes the one-pipeline Starter limit and supplies priority email support with a 24-hour support target. |

Plan evidence: [Vercel Cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing),
[Neon pricing](https://neon.com/pricing), and
[Goldsky pricing](https://docs.goldsky.com/pricing/summary).

Start Goldsky on an `s` pipeline. Increase the resource size only after pipeline lag or transform
metrics prove that it is necessary. Start Neon at its smallest practical compute size and set a cost
ceiling with autoscaling. A plan upgrade is an operational change, not an architecture change.

Move Neon to Scale when the product needs a 30-day restore window, exported metrics, IP allow rules,
or an SLA. Move Goldsky to Enterprise only when the team needs a dedicated source IP, a four-hour
support target, or a custom Arc integration. Move Vercel to Enterprise only when measured limits or
an organizational control require it.

## Environment variables and secrets

Commit an `.env.example` with names only.

Vercel server variables:

- `DATABASE_URL`, pooled
- `DATABASE_URL_UNPOOLED`, migrations only
- one RPC URL per supported chain
- `RELAYER_PRIVATE_KEY`
- `GOLDSKY_WEBHOOK_SECRET`
- `CRON_SECRET`
- `CIRCLE_IRIS_URL`
- trigger-policy values
- public deployment environment name

Goldsky secrets:

- Neon direct connection for `goldsky_reader`
- webhook authorization header

Never expose a secret through a `VITE_*` variable. The browser receives only the public chain
registry and public API URLs.

## Security controls

### Input and API controls

- Normalize labels once in the shared domain module.
- Validate every request with strict schemas.
- Allowlist chain IDs, token addresses, contract addresses, and event signatures.
- Compare webhook secrets in constant time.
- Limit request bodies and page sizes.
- Apply Vercel Firewall rate limits to activation and trigger endpoints.
- Return generic public errors. Store exact internal errors on the flow.

### Database controls

- Use separate Neon roles for migrations, the Vercel application, and Goldsky.
- Give the application role only the table privileges it needs.
- Keep all writes server-side.
- Use parameterized queries through Drizzle.
- Test every unique and partial index with concurrent requests.
- Use Neon point-in-time restore and branches for recovery drills.

### Chain controls

- Simulate before every transaction.
- Verify chain ID from the RPC response.
- Verify deployed bytecode or a pinned code hash at process start.
- Verify every receipt status and expected event.
- Never mark a flow settled from a submitted transaction hash.
- Keep the relayer key exclusive to this service.
- Alert on low relayer gas before transactions fail.
- Default to Standard CCTP finality.

### Mainnet gates

Mainnet remains blocked until all of these are complete:

- independent contract audit
- exact mainnet deployment configuration review
- deterministic address derivation parity test
- Goldsky dataset and event-decoder validation
- four-chain stable testnet end-to-end run
- duplicate and reorg ingestion tests
- workflow crash and retry tests
- relayer nonce and replacement tests
- unclaimed-message recovery drill
- runbook and alert review

## Observability and alerts

Use Vercel Workflow observability for step execution. Use Vercel function logs for APIs. Use Goldsky
pipeline health for source lag and webhook backpressure. Use Neon metrics for connections, query
latency, and storage.

Log structured fields:

- environment
- request or workflow ID
- flow ID
- normalized label hash, not a free-form label where it is not needed
- chain ID
- event ID
- transaction hash
- workflow step
- error code
- retry count

Do not log private keys, raw authorization headers, database URLs, or signed raw transactions.

Alert on:

- Goldsky pipeline failure or increasing lag
- webhook `5xx` rate
- queued flow without a workflow run
- flow past its state service-level objective
- repeated Iris `429` responses
- unclaimed CCTP growth
- stuck or replaced transaction
- relayer gas below threshold
- database connection saturation
- mismatch between workflow receipts and canonical protocol events

Initial service-level objectives are operational targets, not user guarantees:

- webhook accepted within 10 seconds of Goldsky delivery
- finalized eligible deposit queued within 30 seconds
- Ethereum renewal submitted within 60 seconds after eligibility
- L2 claim submitted within 60 seconds after Iris reports a complete attestation
- recovery job repairs an orphaned queued action within its next two runs

## Testing strategy

### Unit tests

Cover:

- ENSIP-15 normalization and label rejection
- chain registry completeness
- Goldsky event schemas
- `_gs_op` create and delete handling
- trigger policy
- state transitions
- Circle message route validation
- receipt event parsing
- JSON bigint serialization
- retry classification

### Database integration tests

Run against a disposable Neon branch.

Cover:

- duplicate webhook delivery
- out-of-order create and delete
- concurrent activation
- concurrent manual and automatic trigger
- one active flow per name and chain
- nonce reservation under concurrency
- crash after signing and before broadcast
- transaction replacement
- external permissionless renewal reconciliation

### Workflow tests

Use the Workflow test integration.

Cover:

- Ethereum happy path
- each L2 happy path
- Iris not ready, `429`, and `5xx`
- restart after every durable step
- origin transaction revert
- claim transaction revert
- name becomes unrenewable after burn
- duplicate workflow start
- Circle burn-limit remainder creates the next flow

### End-to-end testnet tests

For each supported testnet:

1. Activate a normalized ENS label.
2. Confirm the address entered the watched table.
3. Send native test USDC.
4. Confirm Goldsky detects it.
5. Confirm the workflow starts once.
6. Confirm the expected origin transaction.
7. For L2, confirm Iris attestation and Ethereum claim.
8. Confirm the ENS expiry increased.
9. Confirm the API and frontend show the canonical events.
10. Repeat one webhook and confirm no duplicate renewal occurs.

Keep transaction hashes in the deployment evidence log.

## Implementation plan

Each phase ends with a mergeable PR and an explicit verification gate.

### Phase 0 — settle configuration and access

- Configure the $0.50 trigger floor on every launch chain.
- Purchase Vercel Pro, Neon Launch, and Goldsky Scale for production.
- Create stable testnet Vercel, Neon, and Goldsky environments.
- Create least-privilege database roles.
- Create test relayer accounts and gas them.
- Verify exact Goldsky dataset names and versions.
- Record the commands and owners in a runbook.

**Gate:** all CLIs authenticate, secrets exist outside git, and no production credential is in a
preview environment.

### Phase 1 — shared chain registry

- Create the shared registry.
- Move tokens, fees, explorers, tags, assets, and deployment references to it.
- Add completeness tests.
- Generate public and server views from the same data.

**Gate:** removing a required field fails a test, and the current frontend output does not change.

### Phase 2 — Neon schema and API foundation

- Add Drizzle, `pg`, and `@vercel/functions`.
- Add migrations and roles.
- Add structured errors and request validation.
- Add activation and public read endpoints.
- Add fixture data for previews.
- Add database integration tests.

**Gate:** a preview deployment uses its own Neon branch and cannot reach production data.

### Phase 3 — Goldsky ingestion

- Add the pinned Turbo pipeline definition.
- Add deposit and protocol-event transforms.
- Add the authenticated webhook receiver.
- Add create, duplicate, delete, and replay tests.
- Deploy to the stable testnet endpoint.

**Gate:** all four testnets deliver a real event exactly once at the domain level after duplicate
delivery.

### Phase 4 — Ethereum workflow

- Add Workflow to the Vite project.
- Add the flow state machine.
- Add nonce reservation and transaction intents.
- Implement the Ethereum origin path.
- Add recovery cron and workflow tests.

**Gate:** a real Sepolia deposit renews once after forced webhook and workflow retries.

### Phase 5 — CCTP workflow

- Add origin burn receipt parsing.
- Add Circle Iris polling.
- Add message route validation.
- Add Ethereum claim transaction.
- Add unclaimed state and recovery.
- Test Base Sepolia, Arbitrum Sepolia, and Arc Testnet.

**Gate:** every L2 completes a real burn, attestation, mint, and ENS renewal. A forced claim failure
remains recoverable.

### Phase 6 — frontend cutover

- Replace `registry.ts` reads with API adapters.
- Keep mock fixtures only for local and preview demonstration modes.
- Activate a name before showing its funding controls.
- Poll active flows.
- Render held, in-flight, unclaimed, failed, and settled states from API data.
- Add the unclaimed-flow card, evidence links, and idempotent retry action.
- Show raw sender and executor addresses with distinct labels.
- Keep amounts as strings or `bigint` through the adapter boundary.

**Gate:** no production screen imports simulated activity.

### Phase 7 — operations and hardening

- Add dashboards and alerts.
- Add recovery and restore drills.
- Add low-gas monitoring.
- Configure the 20-unit warning, 5-unit critical alert, and Safe refill runbook.
- Add the 30-day raw-payload retention job and verify that normalized history remains.
- Add load and concurrency tests.
- Add operator runbooks.
- Complete an independent security review of the backend.

**Gate:** the team can recover a stuck transaction, an unstarted flow, an Iris outage, and a Neon
restore without editing production rows by hand.

### Phase 8 — audited mainnet launch

- Audit and deploy contracts.
- Record verified addresses and hashes in `docs/DEPLOYMENTS.md`.
- Create and validate the mainnet Goldsky pipeline.
- Run a low-value canary on Ethereum, Base, and Arbitrum.
- Move public configuration from testnet to mainnet in one reviewed change.

**Gate:** every canary has matching deposit, flow, Circle, helper, ENS, API, and frontend evidence.

## Rejected additions

These can be reconsidered only when measured load or a required feature proves the need.

- Supabase and Supabase Realtime
- Moralis streams
- Redis or a separate message queue
- a standalone worker deployment
- WebSockets for the public UI
- a Goldsky Postgres sink that copies webhook data
- a database-derived token balance
- per-request background work after a `2xx` response
- Fast CCTP in the first production version
- direct browser access to Neon
- user accounts for public chain data
- a custom admin panel before the provider dashboards and runbooks are insufficient

## Launch decisions

No backend architecture question in this document remains open for the initial implementation.
Provider limits and chain support still require verification at deployment time. A failed check
removes the affected chain or requires a plan upgrade; it does not permit an unreviewed substitute.

Settled points:

- Balances stay separate by chain.
- Standard CCTP is the default.
- One active flow exists per name and chain.
- Goldsky detects events. Neon stores application state. Vercel executes workflows.
- The frontend polls the API.
- The chain is the authority for balances, receipts, and renewals.
- The trigger threshold is $0.50 per chain.
- The initial mainnet supports Ethereum, Base, and Arbitrum. Arc remains testnet-only until its
  mainnet dependencies exist and pass a canary.
- The production relayer is manually funded from the treasury Safe. Balance alerts use transaction
  units derived from measured gas costs.
- Public activity shows raw sender and executor addresses. It does not resolve ENS names initially.
- Raw Goldsky payloads remain for 30 days. Normalized event facts remain without a time limit.
- An unclaimed flow has explicit public copy, evidence links, automatic retry, and an idempotent
  manual retry action when the name becomes renewable.
- Initial production uses Vercel Pro, Neon Launch, and Goldsky Scale.
- **Helper dust is the deployer's responsibility and is handled contract-side.** Renewals buy whole
  seconds, so a sub-second remainder stays in the helper on every flow. `DustWithdrawn` records the
  owner withdrawal. **No UI, and nothing in the schema.** It is rounding residue with no individual
  owner; it is not a funder's pending balance and must never be shown as one. One consequence for
  operations: an "is the helper empty" check must use a threshold rather than zero, or it alerts
  forever.
- A balance read fails soft. Show the chains that answered and render the rest as unknown.

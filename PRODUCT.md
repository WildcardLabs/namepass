# Namepass — product notes

This is the detailed "what and why" behind the product, consolidated from how it's been described
and designed across development. It's distinct from `CLAUDE.md` (which guides how to work in this
codebase) and the `README.md` (which pitches the repo to a visitor).

## The problem

ENS names expire. Renewal is a manual, easy-to-forget action — miss it, and a name you've built
identity/reputation/a project around can be re-registered by someone else.

Renewal itself is *permissionless* — anyone can call `renew()` and pay for any name, no ownership
required. So the problem isn't permission, it's friction and coordination: to help a name today you
need ETH on mainnet, you need to go find the name, you need to do it manually, and someone has to
remember. There's no durable, shareable thing a name's community can point at to keep it alive.

## The core mechanic

Every ENS name gets its own **permanent, chain-agnostic USDC deposit address** — a "Namepass."
Anyone can send USDC to that address, from any supported chain, and it's automatically converted
into renewal time at the exact on-chain rate. Ownership of the underlying ENS name is
**not** required to fund its Namepass — a name's biggest supporter, its community, or a project's
treasury can keep it alive without ever holding the keys. The Namepass address itself never
changes, so it can be shared once, publicly, permanently.

**One deduction, and it isn't a markup on the rate:** a flat **$0.10 gas allowance** comes off each
flow, taken by the mainnet contract in the transaction that renews. It's a partial rebate on gas
Namepass fronts — a mainnet renewal costs dollars, not cents — so the ENS price itself is never
marked up. Avoid claiming "no fees" in copy; "no markup on the ENS rate" is the accurate version.

**Balances are per chain and never merge.** The address is identical on every chain, but $5 on Base
and $8 on Arbitrum are two separate pots that each have to clear the minimum ($0.50) on their own.
This surprises people and the UI has to say it out loud.

**Automation, as designed.** CREATE2 derives each name's address deterministically. The address
exists, and any person can verify it before someone claims the name. An indexing pipeline detects an
inbound payment. Circle's CCTP moves the funds to Ethereum. The renewal executes in the transaction
that completes the transfer. No person intervenes.

The contracts and automation code for this path are built. The stable-testnet automation is
deployed and has completed a verified end-to-end renewal. Read the next section before you
describe it as a production system.

## Current status

The product has three parts. Each part is at a different stage. An earlier version of this document
gave them one status and became inaccurate. Keep them separate.

- **The contracts are built, on testnet only.** The factory and the Ethereum renewal helper run on
  four test networks. The full on-chain path has been run against the deployed ENS and Circle
  contracts: deposit, CCTP burn on each L2, attestation, and one transaction that mints and renews
  together. `docs/DEPLOYMENTS.md` records the addresses and the results. **The contracts have no
  external audit and no mainnet deployment.** Neither is scheduled.
- **The automation backend is deployed to stable testnet.** Neon, Vercel API and Workflow, the
  Goldsky pipeline, and the relayer have completed a verified end-to-end renewal. This does not
  satisfy the audit or mainnet gates. `docs/ARCHITECTURE.md` defines the remaining gates.
- **The frontend is a stable-testnet prototype.** The addresses and pricing math are exact. The
  Explorer and Leaderboard read the deployed public API. See `docs/FRONTEND.md`.

Do not write copy that says the contracts are hypothetical. Do not describe the stable-testnet
automation as a production or mainnet service.

## Supported chains

The stable testnet supports Base Sepolia, Arbitrum Sepolia, Arc Testnet, and Ethereum Sepolia. The
initial mainnet plan supports Base, Arbitrum, and Ethereum. Arc remains testnet-only until Circle
and Goldsky support Arc mainnet and a low-value canary passes. Arc does not block the other three
chains from launching.

**Not** Optimism — deliberately excluded (no brand asset, not part of the current chain set); don't
reintroduce it without an explicit decision to add support. Arc is Circle's chain. It replaced
Polygon on 2026-08-05. See `docs/DECISIONS.md`.

## Positioning and tone

Current-state summary — see `docs/DECISIONS.md` for the full dated history of *why* each of these
was decided, including alternatives that were tried and rejected:

- **Trust / financial-infrastructure aesthetic — not a playful startup.** Navy-on-white, minimal
  motion, restrained use of "shine"/shimmer effects (present, but subtle — reused consistently
  rather than novel per-instance). Rejected framing that leaned "AI agent" as the primary noun
  (e.g. "your name gets its own agent") because it introduces a custody question a security-minded
  crypto audience is likely to interpret negatively — "address" stays the trust anchor; "agent" is
  fine as a description of the automation *behind* the address.
- **Avoid the word "permanent" in user-facing copy**, even though the underlying property (the
  deposit address never changes) is genuinely permanent. Alternate phrasing established: "deposit
  address for name extensions," "auto renewal address," "never changes."
- **Precision as a trust signal.** Pricing math is exact ENS v2 contract math, not approximate —
  this is treated as a feature (see `CLAUDE.md` → Architecture). Deposit addresses are always
  shown in full, never truncated, for the same reason (truncation is where an address-swap attack
  would hide).
- **Public by default.** All renewal activity is visible in the Explorer/Leaderboard — the pitch
  is "anyone can verify this is working," not a private dashboard.

## What's explicitly *not* defined yet

This document only captures what's actually been discussed. The following have **not** been
decided and shouldn't be assumed or invented in copy, code, or future planning:

- Business model / monetization (is Namepass free to activate, does it take a fee on renewals,
  who funds the automation infra?)
- Target launch timeline or rollout plan
- **The mainnet date.** The CREATE2 factory and the CCTP integration are built and proven on
  testnet. There is no audit, no mainnet deployment, and no date for either. The technical launch
  gates and the initial three-chain scope are decided in `docs/ARCHITECTURE.md`. The business model,
  audit schedule, and release date remain open.
- **The end of the prototype stage.** The frontend and automation run on stable testnet, and one
  end-to-end renewal is verified. No date defines when audit and mainnet readiness change the
  product status.
- Governance and legal structure. **Custody is now settled, not open:** moving to CREATE2-derived
  addresses removed the custodial step. No third party holds keys on Namepass's behalf, and each
  address is computable and verifiable from the name alone. This reversed an earlier CDP
  server-wallet design that was custodial — see `docs/DECISIONS.md` for both entries.

If you want these captured, the next step is talking through them and I'll add a section here —
better to leave this doc honest about gaps than to fill them with guesses.

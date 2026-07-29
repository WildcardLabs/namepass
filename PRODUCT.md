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
and $8 on Arbitrum are two separate pots that each have to clear the minimum (~$0.67) on their own.
This surprises people and the UI has to say it out loud.

**Automation (the real product, not this prototype):** each name's address is derived
deterministically with CREATE2, so it exists and is verifiable before anyone claims it. A webhook
detects inbound payments, the funds move to Ethereum over Circle's CCTP, and the renewal executes
in the same transaction that completes the transfer — end to end, no manual intervention. See
`docs/ARCHITECTURE.md`.

## Supported chains

Base, Arbitrum, Polygon, Ethereum. **Not** Optimism — deliberately excluded (no brand asset, not
part of the current chain set); don't reintroduce it without an explicit decision to add support.

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
- Whether/how this connects to real ENS v2 contracts and a live backend — the CREATE2 factory and
  the CCTP integration are designed but unbuilt (current repo is frontend-only, see `CLAUDE.md`)
- Governance and legal structure. **Custody is now settled, not open:** moving to CREATE2-derived
  addresses removed the custodial step. No third party holds keys on Namepass's behalf, and each
  address is computable and verifiable from the name alone. This reversed an earlier CDP
  server-wallet design that was custodial — see `docs/DECISIONS.md` for both entries.

If you want these captured, the next step is talking through them and I'll add a section here —
better to leave this doc honest about gaps than to fill them with guesses.

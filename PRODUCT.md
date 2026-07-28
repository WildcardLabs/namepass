# Namepass — product notes

This is the detailed "what and why" behind the product, consolidated from how it's been described
and designed across development. It's distinct from `CLAUDE.md` (which guides how to work in this
codebase) and the `README.md` (which pitches the repo to a visitor).

## The problem

ENS names expire. Renewal is a manual, easy-to-forget action — miss it, and a name you've built
identity/reputation/a project around can be re-registered by someone else. There's no built-in
mechanism for a name's community, fans, or supporters to help keep it alive; only the owner can
renew it, and only if they remember to.

## The core mechanic

Every ENS name gets its own **permanent, chain-agnostic USDC deposit address** — a "Namepass."
Anyone can send USDC to that address, from any supported chain, and it's automatically converted
into renewal time at the exact on-chain rate (no markup). Ownership of the underlying ENS name is
**not** required to fund its Namepass — a name's biggest supporter, its community, or a project's
treasury can keep it alive without ever holding the keys. The Namepass address itself never
changes, so it can be shared once, publicly, permanently.

**Automation (the real product, not this prototype):** Coinbase CDP Agentic Wallets watch each
deposit address, detect inbound payments via webhook, calculate the maximum renewal time the funds
can buy, bridge cross-chain if needed, and submit the on-chain renewal — end to end, no manual
intervention.

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
- Whether/how this connects to real ENS v2 contracts and a real CDP Agentic Wallet backend
  (current repo is frontend-only, see `CLAUDE.md`)
- Governance, custody, or legal structure questions beyond "non-custodial, ownership not required
  to fund"

If you want these captured, the next step is talking through them and I'll add a section here —
better to leave this doc honest about gaps than to fill them with guesses.

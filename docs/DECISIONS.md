# Design rationale

This reference records current design choices. Implementation history and superseded plans
remain in Git history.

## Deterministic wallets

CREATE2 wallets let anyone derive a payment address without trusting the website. Each chain
uses the same factory within a deployment set. A factory replacement changes addresses; it is
not a transparent upgrade. ENSIP-15 normalization happens before hashing the label.

## Fixed gateway and replaceable ENS adapter

A stable gateway preserves the wallet destination and CCTP route while ENS integrations change.
The governance pointer selects an immutable helper instead of mutating ENS addresses inside it.
The governance authority remains a trust assumption: interface checks cannot prove that arbitrary
replacement code performs an ENS renewal. Testnet timelock control does not prove ENS DAO control.

## Permissionless execution without a sweep

Anyone can start a renewal or complete an attested claim. The gateway pays a fixed executor
allowance after settlement. There is no owner-selected recovery destination for wallet funds;
adding one would change the custody model. Unsupported tokens can be unrecoverable.

## Exact oracle arithmetic

ENS prices duration; Namepass calculates duration from a budget. Tests use ENS's oracle arithmetic
rather than a second mock implementation. A year is 31,536,000 seconds, and token conversion uses
both the numerator and denominator. Intermediate rounding and micro-USDC boundaries affect results.

Quick-select payments correspond to discount tiers. A displayed annual rate does not guarantee
that the same rounded payment buys a full year: in the oracle fixture, 8 USDC buys 31,535,917
seconds for a five-character label. Payment suggestions round up sufficiently to reach the tier.

## Indexed reads and durable execution

Public polling uses stored snapshots and canonical events to bound RPC demand. Reads that decide
whether funds can move still verify chain state. The existing event ledger and durable workflow
provide reconciliation; an additional queue or balance ledger would introduce another consistency
boundary. Recovery cadence must still be sized against database compute limits.

Flow identity uses exact events and Circle nonces. Durable intents and one nonce queue per
sender/chain preserve replacement history. Unknown outcomes are reconciled before another
broadcast; an unclaimed CCTP message is retried without a second burn.

## Explorer rendering and deposit identifiers

Keep the Explorer card mounted during pricing refreshes. The 22 September change in `080cd1a`
reused the initial loading state on selection and window focus. This removed the whole Explorer
and moved the page. View animations could not fix that parent-state defect.
Mount only the active view. Keep the last feed response and page in the parent so Back does not
empty the feed before a fresh read. Use the existing detail entrance animation and inline profile
skeletons. Keep the explicit ENS refresh before the activity refresh.
Static QR codes use one SVG path; callers can still request the animated QR.

Show the resolving Namepass subdomain as a separate copy target. Keep the full deposit address
visible and encode that address in the QR for wallet compatibility.

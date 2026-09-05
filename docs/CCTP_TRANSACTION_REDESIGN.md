# CCTP and relayer transaction redesign

Date: 2026-09-04
Branch: `codex/fix-cctp-duplicate-flow`

## Decision

Do not ship the four-wallet relayer pool, same-nonce cancellation transactions, or heuristic flow
selection from the earlier branch design.

Use one exclusive relayer account. Store one durable transaction intent for each business call.
Reserve nonces in one database queue for each sender and chain. Let the lowest unresolved nonce run
first. Use exact event identity for origin and settlement reconciliation.

This design accepts one explicit tradeoff. A signed call that becomes obsolete can still consume
gas. The service keeps that call until it gets a receipt. It does not replace the call with a
self-transfer. Terminal flow guards prevent the late receipt from reopening a completed flow.

## Problems in the earlier branch design

### 1. Four relayer wallets hid the queue instead of fixing it

The branch added four private keys and four public addresses for Ethereum. It selected a wallet
that had no unresolved transaction intent. A fifth request entered a synthetic
`relayer_pool_saturated` retry state.

This design introduced these costs:

- Four hot keys required funding, secret rotation, monitoring, and incident response.
- Each key had an independent nonce history.
- Recovery had to find and keep the key that signed each old intent.
- Capacity stopped at four unresolved calls. It did not use valid later nonces.
- The pool treated normal queue pressure as an application error.
- There was no production measurement that required parallel senders.

An EOA already has a strict nonce queue. PostgreSQL can reserve that sequence safely. The new
design models the real chain rule instead of adding more senders.

### 2. Cancellation created a second transaction state machine

The branch changed duplicate intents to `cancellation_requested`. Recovery then signed a
higher-fee, same-nonce, zero-value self-transfer and moved the intent through `cancelling` and
`cancelled`.

This introduced a race between two valid signed transactions:

1. The business call was broadcast.
2. An external event made the flow look complete.
3. The service signed a cancellation with the same nonce.
4. Either transaction could win.
5. The database had to interpret a receipt after the intent purpose had changed.

The cancellation could also remove useful recovery work. If a settlement later reorged, the
original business bytes were no longer the active intent. The service then needed another branch
to reconstruct the operation. The cancellation also spent gas and added statuses, receipt rules,
recovery rules, migration rules, and UI filtering.

The new design never changes the purpose of signed bytes. Same-nonce replacement changes only the
fees. The destination, value, call data, gas limit, sender, chain, and nonce stay the same.

### 3. A transaction hash was treated as an origin identity

The branch added a unique index on `(origin_chain_id, origin_evidence_tx_hash)`. This is not a valid
flow identity. A permissionless contract can call `renew` more than once in one transaction. Each
call can emit a valid `DepositProcessed` event and a valid Circle message.

The old migration ranked same-transaction rows and cancelled every row after the first row. It
could therefore cancel valid work.

The new origin identity is the exact `DepositProcessed.event_id`. The transaction hash remains
evidence. It is not unique. The flow also stores the zero-based Circle `MessageSent` index from the
same helper-call segment.

### 4. Amount-based matching could join unrelated flows

Equal USDC amounts are common. The earlier merge logic used combinations of chain, name, amount,
nonce, and transaction hash to choose a flow. These fields validate a match. They do not identify
an event.

The new final CCTP identity is `(origin_chain_id, cctp_nonce)`. A full unique index enforces this
identity across all flow statuses. A cancelled row cannot keep the identity and allow a second
owner.

### 5. Destination transaction batching was ambiguous

One Ethereum transaction can call `completeCCTP` more than once. It can contain this event order:

```text
CCTPClaimed A
ENS NameRenewed A
Renewed A
CCTPClaimed B
ENS NameRenewed B
Renewed B
```

A transaction-hash query can join claim A to renewal B. It can also assign the wrong ENS expiry.
This remains possible when both calls use the same name and amount.

The new code splits the transaction by helper-event order. `CCTPClaimed` starts one CCTP segment.
`Renewed` ends the segment. The matching ENS event must be inside that segment and must match the
label, duration, and applied amount. The code also validates the wallet and the complete Circle
accounting equation.

Goldsky can deliver these three event rows concurrently. Each handler now stores its row and then
takes one transaction-scoped lock for `(chain ID, transaction hash)`. The handler that gets the lock
second sees the first committed row and completes reconciliation. This also prevents a concurrent
ENS event from leaving `expiry_after` empty.

### 6. Status-dependent identity indexes allowed identity reuse

The earlier CCTP index excluded cancelled flows. A row could keep a permanent Circle nonce after
cancellation. A second row could then use the same nonce. Later recovery or replay had two possible
owners.

The new CCTP index includes every non-null nonce. A row must clear the nonce before it stops owning
the Circle message.

### 7. Late asynchronous writes could move state backwards

Several checks read the chain before they changed the database. A flow could advance while the RPC
request was in progress. The stale result could then cancel, hold, or fail a flow that already had
signed bytes.

The new code checks the row again after RPC work. It locks the flow and uses compare-and-set writes.
A pre-origin validation can stop a flow only when the expected status still exists and
`origin_tx_intent_id` is null. A workflow error cannot mark a flow failed while an intent is
`prepared`, `broadcast`, or `mined`.

### 8. A retry could accept a receipt from an old nonce

A reverted transaction consumes its nonce. A manual retry must use a new nonce. The intent keeps
its historical attempts for audit. Receipt lookup must not accept a successful receipt from the
old nonce after the retry starts.

The new receipt lookup filters attempt history by the intent's current nonce. Receipt writers lock
the flow and intent, and then verify the receipt hash again.

### 9. Duplicate repair selected a winner without enough proof

The earlier migration ranked rows by status, trigger, deposit presence, creation time, and ID. This
was deterministic, but it was not proof that the selected row owned the Circle message. It could
discard richer or conflicting evidence.

The new repair accepts only one exact shape:

- One source row has the Circle message, attestation, and origin evidence.
- One bare external row has the canonical destination renewal.
- Both rows have the same exact Circle nonce, name, origin chain, and processed amount.
- No row has a Workflow owner.
- No row has unresolved transaction work.

The migration aborts for every other shape. It does not rank ambiguous rows.

## Implemented model

### Transaction ownership

One `transaction_intent` owns one business call. It can have many same-nonce fee attempts. A mined
revert can create one new-nonce attempt for the same logical intent.

The preparation sequence is:

1. Verify the RPC chain ID.
2. Read the gas estimate, fee quote, and pending nonce.
3. Start a database transaction.
4. Lock the flow.
5. Verify the expected flow status and linked intent.
6. Lock the relayer nonce row.
7. Reserve `max(database_next_nonce, rpc_pending_nonce)`.
8. Sign and store the bytes.
9. Increment the database nonce.
10. Link the intent and commit.

RPC calls do not run while the nonce row is locked.

Only the lowest `prepared` or `broadcast` nonce for one sender and chain can broadcast or replace.
Later prepared intents remain durable in PostgreSQL. Recovery advances them when earlier nonces get
receipts.

### Unknown nonce consumption

If the confirmed account nonce advances but no stored current-nonce attempt has a receipt, the
service keeps the queue blocked and emits `transaction.nonce_consumed_receipt_pending`.

The service does not skip the nonce. An unknown transaction from the exclusive relayer is a key
integrity incident. An RPC can also have a temporary receipt gap. Both cases require proof before
the queue advances.

### Exact origin ownership

`flows.origin_event_id` references the exact canonical `DepositProcessed` chain event. The full
unique index permits only one owner. `flows.origin_evidence_tx_hash` remains non-unique evidence.

`flows.cctp_message_index` selects the exact Circle message for Iris when one transaction emits
more than one message. Circle specifies that transaction-hash results use ascending log-index
order in the [CCTP V2 messages API](https://developers.circle.com/api-reference/cctp/all/get-messages-v2).

### Exact settlement ownership

`(flows.origin_chain_id, flows.cctp_nonce)` is the final Circle identity. An advisory transaction
lock serializes source-Iris and destination-Goldsky ownership changes before the full index exists.
Flow rows then lock in stable ID order.

A separate Goldsky transaction lock serializes bundle assembly for one chain transaction. Each
handler inserts its own chain event before it waits for this lock. At least the final handler then
sees all committed bundle members.

Goldsky can see a destination settlement before Iris returns the final source message. Goldsky
creates a bare external projection. When Iris returns the same nonce, the source row receives the
settlement event and settlement facts. The bare row clears the nonce and renewal identity, and then
becomes cancelled. Source trigger data, detected amount, and origin-wallet remainder do not change.

Before Iris moves the settlement facts, it loads all indexed events for the renewal transaction. It
selects the exact helper-call segment by log order. Both `Renewed` and its preceding `CCTPClaimed`
must be canonical. The claim source domain, nonce, wallet, and burn amount must match the validated
source message. The Circle accounting values must also match the renewal. A mismatch stops the
merge. A legacy row with `origin_evidence_tx_hash` or `cctp_message_index` is not a bare projection.

### Reorg handling

A settlement delete resolves the current renewal-event owner again after it gets the CCTP identity
lock. This handles a concurrent Iris merge that moves the renewal event to the source row.

A recoverable source row clears destination settlement facts and resumes from its stored message or
transaction intent. A bare external row has no source evidence, so it clears the nonce and becomes
cancelled.

An origin delete cannot silently remove a final CCTP claim. The reconciliation fails when final
claim evidence conflicts with the deleted origin event.

## Database rollout

This change requires two release points. Do not deploy both commits in one automatic migration run.

- Release 1 target commit: `1f6f88a`.
- Release 2 migration target: `ceacbd0`.

Commit `1f6f88a` is the last commit that does not contain migration `0007`. Use this exact commit for
the first release. Commit `2041990` adds migration `0007`. Commit `ceacbd0` adds its guarded
historical split-evidence repair and is the second release target.

### Release 1

1. Deploy the first commit and migration `0006_transaction_identity_support.sql`.
2. Configure only `RELAYER_PRIVATE_KEY` and its matching optional `RELAYER_ADDRESS`.
3. Confirm that no unresolved intent belongs to a relayer key that is no longer configured.
4. Let existing workflows and Goldsky replays write exact origin identity and merge safe duplicate
   rows.
5. Inspect external flows that still have `origin_evidence_tx_hash` but no `origin_event_id`.

Migration `0006` adds nullable identity and monitor fields. It backfills an origin event only for a
one-flow-to-one-event match. It adds the exact origin-event unique index. It does not add the final
CCTP nonce index.

### Release 2

1. Pause Goldsky delivery.
2. Pause recovery.
3. Pause new workflow starts.
4. Confirm that target duplicate groups have no unresolved intent. A Workflow owner normally stops
   the migration. For the split-evidence repair only, confirm that the canonical settled Workflow
   run is complete.
5. Apply `0007_exact_cctp_identity.sql`.
6. If the migration aborts, inspect the reported invariant. Do not weaken the guard.
7. Resume the services after the migration commits.

Migration `0007` locks the affected tables for the repair transaction. It repeats safe origin
backfill and rejects ambiguous external origins. It also verifies the exact preceding
`CCTPClaimed` event by log order. The source domain, full 256-bit nonce, wallet, burn amount, and
Circle accounting must match before the migration moves evidence. A historical split-evidence row
also requires matching deposit, origin-intent, claim-intent, Circle message, attestation, and
renewal facts. It merges only the two guarded duplicate shapes and creates the full Circle nonce
unique index.

## Accepted limits

- One stuck nonce blocks later transactions from the same account on that chain. This is the real
  EOA rule. Same-nonce fee replacement is the normal repair.
- One obsolete business call can spend gas. This is safer than changing transaction purpose after
  signing.
- Fee replacement has no attempt limit or configured fee ceiling. This is an explicit policy for
  this branch. Change this policy before you add either limit.
- An unknown consumed nonce requires operator action. The service fails closed.
- The migration intentionally stops on ambiguous historical data. It does not guess.
- Database tests in this repository validate decision functions and generated SQL shape. The final
  migration must also run on a disposable Neon branch before stable-testnet rollout.

## Verification

The completed local verification covers:

- Production TypeScript and Vite build.
- Server TypeScript check.
- 121 server unit tests, including nonce, retry, race, exact identity, batch, and migration guards.
- 32 frontend tests.
- One Workflow test.
- Drizzle migration validation.

The branch is not deployed or pushed by this work.

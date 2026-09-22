# Stress-test latency review: 2026-09-10

## Evidence and limits

The reviewed sample contains 52 settled flows and 52 completed Workflow runs. It includes four
canaries and 48 later stress-test flows. The stress-test flows were queued from 11:12:39 to
11:14:36 UTC. All sampled flows settled by 11:32:48 UTC. This sample shows a latency problem;
it does not show a lost renewal.

The sample includes 25 Ethereum origins, 25 Arc origins, one Base origin, and one Arbitrum origin.
Ethereum renewals and CCTP claims share the Ethereum relayer queue. Source-chain burns use their
own chain queues. Circle attestation and destination queue time are separate waits.

One representative Arc flow is `51def3c8-5236-4106-8f8f-123d5a070bd6`. Its public evidence is
available from the [stable-testnet flow API](https://demo-five-gray-37.vercel.app/api/flows/51def3c8-5236-4106-8f8f-123d5a070bd6).
Its Workflow run was `wrun_01M25GDNFTRD6BXBYY21KB6KDW`.

| Event | UTC |
| --- | --- |
| Flow queued | 11:14:36.124 |
| Origin submission stage | 11:14:38.811 |
| Origin receipt block time | 11:16:53 |
| Attestation stage | 11:17:00.184 |
| Claim submission stage | 11:17:03.945 |
| Claim broadcast recorded | 11:31:27.089 |
| Settlement block time | 11:31:36 |

The claim submission-to-broadcast interval was about 14 minutes 23 seconds. The inspected run
had 82 steps, including 51 claim polls. Those polls took a median of 6.185 seconds to execute and
310.596 seconds in total. They completed without step retries. The actual Iris request completed
in about 0.179 seconds. Circle was not the main delay for this flow. The Base and Arbitrum canaries
had substantial attestation-stage waits as well as destination queue waits.

Stage timestamps are not per-RPC traces. Receipt block times are not broadcast timestamps.
The evidence cannot assign every second to queue serialization, RPC execution, Workflow sleep,
or chain inclusion. Runtime logs also contained duplicate entries across fetched pages, so raw
log counts are not transaction counts.

## Cause and recovery timing

Only the lowest unresolved nonce can broadcast. This is an intentional safety rule. Each later
intent waits until the preceding work has a recorded receipt or canonical event. A delayed head
therefore delays every intent behind it.

The confirmation steps previously read receipts before they called `replaceStaleTransaction`.
That function already broadcasts a fresh prepared intent when it reaches the head. The active
workflow therefore did not depend solely on the minute recovery cron to advance the queue.

Two avoidable costs occurred before broadcast:

1. Each queued intent made a missing-receipt RPC call before checking its queue position.
2. Queue waits advanced the receipt counter. The existing five-second delay became 15 seconds
   after 24 polls and 30 seconds after 56 polls. A long queue therefore slowed its own progress.

A faster recovery schedule could reduce fallback delay for an abandoned run or stalled intent.
It would also add overlapping checks. It would not remove the active workflow's receipt RPC calls
or distinguish queue waits from mining waits. The measured flow had an active, progressing run.

## Prior failures that the fix must not restore

| History | Failure addressed | Requirement retained |
| --- | --- | --- |
| [PR 57](https://github.com/stevegachau/namepass-v2/pull/57) | Post-burn flows blocked later deposits; resumed work could repeat origin work; replacement receipts and workflow errors needed safe recovery | Release origin-wallet ownership after the burn. Resume the existing intent or external evidence. Check every current-nonce attempt. Preserve signed work after workflow errors. |
| [PR 58](https://github.com/stevegachau/namepass-v2/pull/58) | Duplicate or split settlement evidence; stale transaction writes; sender and cancellation complexity | Keep one exclusive sender and head-only nonce queue. Use exact origin-event and CCTP nonce identity. Keep guarded receipt writes. Resolve signed bytes without cancellation transactions. Stop on an unknown consumed nonce. |
| [PR 59](https://github.com/stevegachau/namepass-v2/pull/59) | A late deposit could already have been spent by an earlier full-wallet execution, leaving a duplicate flow with no live balance | Keep the shared origin-wallet lock, exact zero-remainder origin-block evidence, pre-sign absorption check, and versioned balance-scan watermark. |

The review also covered `docs/CCTP_TRANSACTION_REDESIGN.md`, the transaction and recovery sections
of `docs/ARCHITECTURE.md`, `docs/RUNBOOK.md`, and the related entries in `docs/DECISIONS.md`.
PR 58's intermediate sender-pool and cancellation changes were reverted before merge. They are
not the intended architecture.

## Local change

All three transaction waits use `pollTransactionReceipt`: Ethereum renewal, CCTP origin, and CCTP
claim. A fresh prepared intent returns `queued` when a lower unresolved nonce exists. This is a
step result, not a new database status. The workflow sleeps five seconds and resets its receipt
counter. These queue checks use Postgres only.

When the intent reaches the head, the helper calls the existing broadcaster before receipt lookup.
The broadcaster repeats the queue check and sends the stored bytes. Its handling of an already
known transaction, consumed nonce, and concurrent database write remains in place.

The optimization requires exactly one current-nonce attempt and no recorded broadcast attempt.
Prepared replacements and uncertain history keep receipt lookup first. A previous replacement may
already have mined. Attempts from an earlier, reverted nonce remain excluded from receipt lookup.
All existing business receipt validation and settlement writers remain in place.

No schema migration, key change, replacement timing change, recovery schedule change, or identity
change is required. Serial chain inclusion remains a throughput limit. More frequent queue checks
increase Workflow steps and database reads during a backlog while removing queued receipt RPCs.

## Verification and release checks

`npm run test:transactions` covers queue release, a changed head, old replacement receipts,
uncertain history, an unrecorded send, rejected broadcasts, unknown consumed nonces, late broadcast
writes, and mined reverts. Workflow composition tests cover long queues on all three paths,
resuming prepared intents, terminal flows, external origin evidence, absorbed deposits, and workflow
failure persistence. CI runs this suite in addition to the existing server and Workflow tests.

These tests mock database and RPC boundaries. They do not prove real PostgreSQL lock behavior or
production throughput. Existing server tests retain coverage of the historical identity, receipt,
reorg, absorption, and balance-scan rules. The separate Workflow runtime test checks durable step
and sleep execution.

After a reviewed deployment, use a controlled stable-testnet batch to check:

1. Every funded flow resolves without a duplicate burn or renewal. Every claim retains its exact
   source message and canonical settlement evidence.
2. Prepared-to-broadcast and broadcast-to-receipt times are measured separately. For queued fresh
   intents, receipt RPCs occur only after eligibility for broadcast. `transaction.queued` marks
   a deferred initial broadcast; it is not a periodic queue-depth metric.
3. Queue handoff delay, Workflow step counts, database usage, and RPC usage improve or remain
   acceptable under the same workload. Five seconds is the sleep interval, not an end-to-end SLA.
4. A stopped run resumes its stored intent through recovery. An active run keeps its owner.
5. A later deposit during an earlier full-wallet origin execution is either absorbed with exact
   evidence or remains available for a new flow. A concurrent balance-scan request is retained.

The local change has not been deployed or validated with another funded stress test.

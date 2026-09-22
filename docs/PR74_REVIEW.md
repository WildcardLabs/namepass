# PR 74 and the contract overhaul — 2026-09-21

Reviewed PR [74](https://github.com/stevegachau/namepass-v2/pull/74), head
`c81b9f0321ec3013104f274a532a97b565fae49f`, against issues
[70](https://github.com/stevegachau/namepass-v2/issues/70) and
[71](https://github.com/stevegachau/namepass-v2/issues/71).
The PR is open. GitHub reports successful CI and preview deployment checks.
This review did not merge, close, edit, or post to the PR or issues.

## Fit

Issue 70 remains a valid requirement. The old live system still reads separate ENS `NameRenewed`
events and has the reported stale-expiry path. PR 74 targets that path. The local overhaul now
stores receipt-verified expiry on the fixed gateway's `Renewed` fact and recomputes the name
projection from canonical gateway facts. Port the acceptance cases to that path; do not copy the
old ENS-event projection as the solution for the new pipeline. The old expiry handler remains in
source during this work, but the new generated pipeline does not send that event family.

Issue 71 is independent of contract addresses. Its operational evidence, alert, and replay needs
remain relevant. The local overhaul still has the minimal rejection log. Preserve the intent of
PR 74's logging changes, with the correction below. Update its replay instructions to use
`namepass-testnet-v2` and the new source names and gateway receipt-enrichment requirements.

## Findings

- P2: Unknown JSON fields bypass rejection evidence. At PR head, `readObject(request, ALL_FIELDS)`
  runs on line 483, before the new try/catch on lines 485–501. `readObject` rejects unknown fields
  with HTTP 400. A pipeline schema addition therefore bypasses the new warning, payload hash, and
  safe 200 acknowledgement. The same applies to malformed JSON. Authenticate first, then put
  bounded body decoding and semantic validation under the rejection-evidence path. Test an extra
  field followed by a valid event. Keep body size limits and do not record raw payloads or headers.
- P2: Remaining-expiry selection is ambiguous within a block. Lines 1331–1340 select one canonical
  ENS renewal using only descending `blockTime`. Two renewals for the same name in one block have
  the same timestamp. After a delete, either can be selected, including the lower expiry. Use an
  authoritative projection with an explicit rule and test multiple same-block renewals. The new
  local gateway projection uses the maximum remaining canonical expiry for this generation.

The expiry test in the PR tests a pure projection helper. It does not exercise the database
selection, clearing the linked flow, replay, or concurrent webhook delivery. Those acceptance
checks are still needed for the replacement projection before cutover.

The PR describes a Vercel alert but does not configure or prove delivery. It also does not state a
log retention/access policy sufficient for the operator replay window. Treat these as deployment
gates before closing issue 71; a structured warning by itself is not proof of durable alerting.

## Recommendation

Keep the two issues open until their behavior is verified on the replacement system. PR 74 is not
obsolete, but it is not sufficient to close both issues as written. Preserve and adapt the
rejection-evidence changes. Replace or retire the old ENS-expiry implementation when the overhaul
lands. If the legacy service needs a fix before cutover, a corrected PR 74 can still serve as that
interim fix. Do not merge the current patch into this dirty overhaul branch without resolving its
projection overlap and updating its tests and runbook.

## Follow-up — PR updated at the user's request

PR 74 was converted to draft and updated in isolated checkout `/private/tmp/namepass-pr74`.
Commit `b6a0ddf` fixes the rejected-body validation gap and deterministic ENS event ordering. It
adds a per-name projection lock and a database regression for deletion, linked-flow evidence,
replay, and same-block ordering. Local validation passed: build, server type check, 140 server
 tests, 39 frontend tests, 25 transaction tests, and one Workflow test. The database test does not
simulate multi-connection contention. External alert delivery and retention still need verification.

The coordination plan and implementation status were posted to the PR. It remains draft and was
not merged. Finish review of this focused fix first. After it merges, adapt the rejection handling
and expiry regression cases to the gateway migration before cutover. The migration work remains
on its separate branch and was not included in the PR commit.

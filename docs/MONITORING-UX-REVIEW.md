# Monitoring use-case review — 2026-09-14

## Assessment

The dashboard supports public usage analysis and read-only flow triage. It does not yet establish
end-to-end platform health. A successful database read and an empty review queue cannot verify
Goldsky, Vercel Workflow, cron delivery, Neon capacity, or gas alert delivery.

## Fixes in this review

- Give the sidebar more space. Keep queue labels on one line and prevent count badges from shrinking.
- Make Review queues open the attention filter. Use a separate labelled chevron to expand or collapse its submenu.
- Use buttons for queue actions. Support keyboard activation and indicate the selected queue.
- Close the mobile sidebar when the user selects a destination or queue.
- Show real metric definitions under the existing Metric definitions destination.
- Label held flows separately from active step review budgets.
- Add origin transaction explorer links. Wrap full transaction hashes and disable absent evidence.
- Show the relayer address and timestamp with gas results.
- Limit selected-row counts and exports to the currently loaded rows.
- Give the flow search and filters accessible names.
- Replace the overview's claim of a complete operational view with a bounded description.

## Remaining gaps by operator task

| Operator question | Current support | Missing capability |
|---|---|---|
| Is intervention required? | Review count, active state budgets, held and unclaimed queues | Provider incidents, failed Workflow runs, missed recovery invocations, tested alert delivery |
| How much is awaiting execution? | Open flow counts and per-flow recorded amounts | Clearly scoped amount totals by state and oldest-step summary. Recorded amounts must not be called wallet balances |
| Why is a transfer stuck? | Origin transaction, reason code, stage-entry time, next action | Full deposit, origin, attestation and claim evidence sequence with exact links and identity |
| Can the relayer keep operating? | Manual balances, public address, check timestamp | Receipt-based gas costs, per-chain thresholds and delivered low-balance alerts. No fixed balance alone proves runway |
| Which names or scans need action? | Expiry and recovery counts | Per-name expiry list and per-request recovery backlog, including age and reason. Current watchlist destinations are summaries, not drill-downs |
| Is activity growing? | Names, depositors, renewals, deposit and renewal charts | Historical new-name and depositor series if growth analysis is needed. Do not infer them from the current totals |
| Can I share an investigation? | JSON export and flow evidence drawer | URL-backed view, queue filters and flow selection; browser back/refresh currently returns to the default workspace |
| What does this metric mean? | Metric definitions and source limits | Direct contextual links from each metric to its definition |

## Visual and interaction assessment

The opaque sidebar, consistent shadcn controls, labelled cards, and responsive tables provide a
coherent structure. The left navigation and horizontal tabs duplicate destinations. On mobile,
the tab strip needs horizontal scrolling and is less discoverable than the menu.
Small metadata text remains dense. A later hierarchy pass should prioritize review queues and
freshness above lifetime usage metrics for an operator-focused view. A separate analytics view
can prioritize volume and growth.

The operational watchlist must not imply that every row opens actionable records. Recovery and
expiry drill-downs should be built from bounded server queries before those items become full
investigation paths. Provider integrations need their own access and delivery verification.

## Verification

Production build passed. Browser regression checks cover the unclaimed label width, keyboard
activation, selected queue, mobile menu dismissal, held-state copy, definitions, and filtered exports.
Local browser checks use real read-only API responses from stable testnet. No test data is written.

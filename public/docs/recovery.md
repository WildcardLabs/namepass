# Recover a flow

## Recover without sending twice

A held flow means funds can still be at the source wallet. `unclaimed` means a source burn needs its existing Circle message completed. A failed or cancelled execution does not prove a refund. Follow the reason code and evidence before taking action.

## Resume the same flow

`POST /flows/{id}/retry` revalidates and resumes that same safe flow. It does not ask the bank to send another payment. Unsupported recovery returns a conflict and needs operator reconciliation. If a flow was absorbed or merged, its lookup remains available with `supersededBy`.

## Restore missing activity

For receiver outages, resume from the last committed event cursor. For missed indexing, report the exact transaction hash. For older transactions, archive receipt availability determines recovery coverage. Keep the transfer unresolved when evidence is incomplete.

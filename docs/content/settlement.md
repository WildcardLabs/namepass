## Know what completed means

| Fact | What it proves |
| --- | --- |
| Deposit verified | The exact transfer occurred in a successful canonical receipt. |
| Consumption consumed | A verified full drain and complete processing coverage prove the funds left the source wallet. |
| Flow settled | The selected Namepass renewal receipt has been verified. |
| Settlement observed | The gateway and ENS receipt prove the renewal and its exact amounts. |
| Settlement finalized | The hub block is canonical and at or below the finalized head. |
| Transfer completed | Consumption is proven and every candidate settlement is finalized. |

## Pooled deposits

For example, deposits of 3 and 7 USDC can fund one 10 USDC renewal. Both deposits reference the same flow totals. Neither receives an invented share of renewal time. If a wallet is processed in slices, every subsequent flow that could have consumed the deposit remains a candidate until a full drain is verified. Completion waits for all those renewals.

## Read amounts separately

Read `amountProcessed`, `bridgeFee`, `amountReceivedOnHub`, `executorAllowance`, `amountApplied`, `roundingResidue` and `originWalletRemainder` separately. The gateway retains rounding residue. It is not a refundable source-wallet balance. Per-deposit allocations remain unknown for pooled funds.

## Finality and corrections

Source finality, Circle attestation and hub finality are different facts. Reorgs produce new resource versions and can invalidate settlement evidence. Persist revisions and correction events; do not infer finality from the legacy deposit observation status or elapsed time.

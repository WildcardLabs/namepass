Call `GET /api/v1/status/{chainId}?transactionHash={hash}` after sending USDC. No authorization header or transfer registration is needed.

## Statuses

| Status | Meaning | What to do |
| --- | --- | --- |
| `pending` | The deposit is indexed and verification is pending. | Poll again. |
| `processing` | The deposit is verified and is awaiting processing or renewal confirmation. | Poll again. |
| `complete` | The funds were processed and the renewal is finalized. | Show completion. |
| `failed` | The source deposit was invalidated, such as by a chain reorganization. | Inspect the transaction before taking further action. |

A `404` means no Namepass deposit has been indexed for this transaction yet. Retry the same URL. A `429` or `503` is temporary; honor `Retry-After`. Invalid chain IDs or malformed transaction hashes return `400`.

Deposits below the returned `minimumAmount` wait for enough USDC to accumulate at the address. A pending status alone does not mean another payment is needed.

## The result

The response includes `chainId`, `transactionHash`, `status` and `deposits`. A transaction can contain several deposits, so each entry has its own name, amount, log index and status. The top-level status is `complete` only when all entries are complete.

Completed entries include `renewals` with their transaction hashes, seconds added and resulting expiry. Renewal totals can include other deposits into the same name's address; they are not a per-deposit allocation.

## Polling

Poll about every five seconds. Respect the `Retry-After` header. Pending progress does not require another payment. Resume later using the same chain ID and transaction hash; you do not need a session or cursor.

# Poll status

Track a USDC deposit using its transaction hash and source chain ID.

## Request

```bash
curl 'https://beta.namepass.com/api/v1/status/84532?transactionHash={hash}'
```

Replace `{hash}` with the transaction hash returned by the wallet. Use the source chain ID from the [address response](/docs/addresses).

## Statuses

| Status | Meaning | What to do |
| --- | --- | --- |
| `pending` | The deposit is indexed and verification is pending. | Poll again. |
| `processing` | The deposit is verified and is awaiting processing or renewal confirmation. | Poll again. |
| `complete` | The funds were processed and the renewal is finalized. | Show completion. |
| `failed` | The source deposit was invalidated, such as by a chain reorganization. | Inspect the transaction before taking further action. |

Deposits below `minimumAmount` remain pending until the address has enough USDC to process a renewal.

## Response

The response includes `chainId`, `transactionHash`, `status` and `deposits`. Each deposit has a name, amount, log index and status. The transaction status is `complete` when all indexed deposits are complete.

Completed entries include `renewals` with transaction hashes, duration added and resulting expiry. A renewal can include multiple deposits; its duration is the total renewal duration, not an allocation to an individual deposit.

## Polling

Poll every five seconds, or after the delay specified by `Retry-After`. Resume polling with the same chain ID and transaction hash. Do not repeat a transfer to resolve a pending status.

## Errors

| HTTP status | Meaning | Action |
| --- | --- | --- |
| `400` | Invalid chain ID or transaction hash. | Correct the request. |
| `404` | No matching deposit has been indexed. | Retry the same URL. |
| `429` | Request rate limit reached. | Wait for `Retry-After`. |
| `503` | Service temporarily unavailable. | Wait for `Retry-After`. |

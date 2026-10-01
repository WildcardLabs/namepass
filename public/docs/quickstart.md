# Quickstart

## 1. Get a deposit address

```bash
curl -X POST 'https://beta.namepass.com/api/v1/address' \
  -H 'Content-Type: application/json' \
  -d '{"name":"example.eth"}'
```

The response contains `depositAddress`, `subname` and supported `chains`. This request activates deposit monitoring for the name. Send payments to `depositAddress`; the subname is safe to use when `subnameVerified` is `true`.

To calculate renewal duration before funding, [request a quote](/docs/quotes).

## 2. Send USDC

Choose a chain from `chains` and transfer USDC from its `tokenAddress` contract to `depositAddress`. Use an amount at least equal to `minimumAmount`. USDC amounts use six decimal places: `1000000` represents 1 USDC.

Save the transfer's transaction hash and source chain ID for status requests.

## 3. Poll until complete

```javascript
async function waitForRenewal(baseUrl, chainId, transactionHash, signal) {
  const url = `${baseUrl}/api/v1/status/${chainId}?transactionHash=${transactionHash}`;
  for (;;) {
    signal?.throwIfAborted();
    const response = await fetch(url, { signal });
    if (response.ok) {
      const result = await response.json();
      if (result.status === "complete") return result;
      if (result.status === "failed") throw new Error("The source transaction was invalidated. Inspect it before retrying.");
    } else if (![404, 429, 503].includes(response.status)) {
      throw new Error(`Namepass returned ${response.status}`);
    }
    const seconds = Number(response.headers.get("Retry-After") ?? 5);
    await new Promise(resolve => setTimeout(resolve, Number.isFinite(seconds) ? Math.max(5, seconds) * 1000 : 5000));
  }
}
```

Poll every five seconds, or after the delay specified by `Retry-After`. A `404` means no matching deposit has been indexed; retry the same URL. Cancel polling when the user leaves the flow.

When `status` is `complete`, the renewal is verified and finalized. `deposits[].renewals` contains the renewal transaction hashes, duration added and resulting expiry. See [status responses](/docs/status) for other states and retry behavior.

Use [name history](/docs/history) to retrieve past renewals and the recorded expiry.

# Quickstart

The flow is like CCTP: submit the source transaction, then poll by its hash and source chain. With Namepass, you send USDC to a deposit address and Namepass performs the bridge and renewal.

## 1. Get a deposit address

```bash
curl -X POST 'https://beta.namepass.com/api/v1/address' \
  -H 'Content-Type: application/json' \
  -d '{"name":"example.eth"}'
```

The response contains `depositAddress`, `subname` and supported `chains`. The name is activated automatically. Use the full address for payments. Use the subname only when `subnameVerified` is true.

Before sending, you can [request a quote](/docs/quotes) to preview how much renewal time your amount buys.

## 2. Send USDC

Choose a chain from `chains`. Send its `tokenAddress` USDC to `depositAddress` using your existing wallet or agent. Use an amount at least as large as `minimumAmount`. Amounts are six-decimal USDC integers: `1000000` means one USDC.

Save the transaction hash and the chain ID. Nothing needs to be registered with Namepass. A USDC transfer is the source transaction; Namepass handles any CCTP burn, claim and ENS renewal.

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

Poll about every five seconds and honor `Retry-After`. A `404` means the deposit is not indexed yet; retry the same URL. Stop or cancel polling when your app no longer needs it.

`complete` means Namepass verified the source funds were processed and the renewal was finalized. Read the returned `deposits[].renewals` for renewal transaction hashes and seconds added.

Use [name history](/docs/history) to show past renewals and the recorded expiry in your app.

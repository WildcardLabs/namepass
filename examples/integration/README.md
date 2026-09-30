# Get an address, send USDC, poll

> The public integration API is not available. This example describes the planned API.

Node.js 22 or later. No package installation or Namepass API key is required.
Use a deployment where the public API is enabled.

```bash
node examples/integration/namepass.mjs address https://beta.namepass.com example.eth
```

Send USDC with your existing wallet to the returned `depositAddress`, on a returned chain and
using its `tokenAddress`. Use six-decimal integer amounts and the returned `minimumAmount`.
Save the actual transaction hash and EVM chain ID, then:

```bash
node examples/integration/namepass.mjs poll https://beta.namepass.com 84532 YOUR_TRANSACTION_HASH
```

The poll command retries indexing delays and temporary responses, honors `Retry-After`, and
prints the completed result. It stops after 30 minutes; resume with the same transaction hash
and chain ID. The module exports `getDepositAddress`, `estimateRenewal`, `waitForRenewal` and
`getRenewalHistory` for your app. History accepts an optional cursor from the preceding page.
Sending funds remains your wallet's job. The current deployment uses testnets.

# Introduction

Namepass turns USDC into ENS renewal time. Any app, wallet, script or agent can use it.

## Three steps

1. **Get the address.** Call `POST /api/v1/address` with an ENS name.
2. **Send USDC.** Transfer supported USDC to the returned `depositAddress` using your wallet.
3. **Poll the result.** Call `GET /api/v1/status/{chainId}?transactionHash=...` until `status` is `complete`.

No Namepass API key or account is required. You do not register the transaction or run a relayer. Namepass detects the deposit and handles the renewal.

## Start building

Follow the [quickstart](/docs/quickstart), or give your agent the [integration skill](/docs/skills). Use a [quote](/docs/quotes) to preview the renewal time and [name history](/docs/history) to show past renewals. The [API reference](/docs/reference) describes all four endpoints.

```text
Use Namepass to fund ENS renewals.
Read https://beta.namepass.com/docs/quickstart.md and
https://beta.namepass.com/docs/skills/namepass-integration/SKILL.md.
Get the deposit address for the requested ENS name, send supported
USDC with my existing wallet, and poll by transaction hash and chain ID.
Ask for my approval before sending funds unless I already authorized it.
```

## Current networks

The current deployment uses testnets. The address response lists supported chains, USDC contracts and minimum amounts. Use those values. Mainnet funding is not enabled.

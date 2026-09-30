Retrieve the deposit address and supported funding networks for an ENS name.

## Request

```bash
curl -X POST '{{DOCS_ORIGIN}}/api/v1/address' \
  -H 'Content-Type: application/json' \
  -d '{"name":"example.eth"}'
```

## Response

- `name`: the normalized ENS name.
- `depositAddress`: the payment address, shared across supported chains.
- `subname`: the corresponding `namepass.eth` subname.
- `subnameVerified`: whether the subname resolves to the deposit address on this deployment.
- `chains`: supported chain IDs, USDC token addresses and minimum funding amounts.

The request activates deposit monitoring. Repeated requests for the same name return the same address. Use the returned chain configuration for funding.

## Send the payment

Transfer USDC to `depositAddress` on a returned chain. Use the subname only when `subnameVerified` is `true`. Save the transaction hash and source chain ID to [track the renewal](/docs/status).

## Errors

`422` indicates that the name cannot currently be renewed. `503` indicates that ENS data is unavailable; retry the address request before funding.

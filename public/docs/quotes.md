# Estimate renewal time

Estimate the renewal duration and fees for a USDC deposit.

## Request a quote

```bash
curl -X POST 'https://beta.namepass.com/api/v1/quote' \
  -H 'Content-Type: application/json' \
  -d '{"name":"example.eth","chainId":"84532","amount":"1000000"}'
```

Use a chain ID from the [address response](/docs/addresses). Send `amount` as an integer string in USDC's smallest unit: `1000000` represents 1 USDC.

## Response

| Field | Description |
| --- | --- |
| `secondsAdded` | Estimated renewal duration in seconds. |
| `amountApplied` | USDC applied to the ENS renewal. |
| `renewalFee` | Processing allowance for one renewal flow. |
| `bridgeFee` | Bridge fee. Currently zero for supported routes. |
| `roundingRemainder` | USDC remaining after duration rounding, retained by the renewal gateway. |
| `pricingBlock` | Block number used to calculate the estimate. |

All USDC values are integer strings in six-decimal token units.

## Estimate limits

A quote assumes one processing flow and no existing balance at the deposit address. Deposits may be combined. The renewal uses the pricing and fees in effect when funds are processed. Use [transaction status](/docs/status) for the final renewal result.

## Errors

`422` indicates an unrenewable name, an amount below the minimum, or an amount above the source chain's single-flow limit. For amounts above the limit, `error.details.maximumAmount` gives the maximum quote amount. Larger deposits require multiple processing flows.

`503` indicates unavailable pricing or an unsupported bridge fee configuration. Retry the quote request before funding.

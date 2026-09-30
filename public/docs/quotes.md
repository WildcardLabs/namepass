# Estimate renewal time

Call `POST /api/v1/quote` to see what an amount of USDC buys before sending it.

## Request a quote

```bash
curl -X POST 'https://beta.namepass.com/api/v1/quote' \
  -H 'Content-Type: application/json' \
  -d '{"name":"example.eth","chainId":"84532","amount":"1000000"}'
```

Use a funding chain from the [address response](/docs/addresses). Amounts use six-decimal USDC integer strings: `1000000` is one USDC.

## What it tells you

`secondsAdded` is the estimated renewal time. `amountApplied` goes toward ENS renewal, `renewalFee` is the allowance for one processing flow, and `bridgeFee` is zero for the current standard CCTP route. `roundingRemainder` is the amount left after rounding; it is retained by the renewal gateway.

The API reads the active helper at `pricingBlock`, using the same pricing algorithm as the frontend. `expiresAt` is 60 seconds after the quote. Send an amount at least as large as the returned chain's `minimumAmount`.

## Estimate limits

A quote assumes one processing flow and no existing wallet balance. Deposits can accumulate together, pricing can change, and the final receipt can differ. Use [transaction status](/docs/status) for the actual result.

An amount above the source chain's live Circle burn limit returns `422` with `error.details.maximumAmount`. Larger deposits need multiple flows and allowances, so a single-flow quote would overstate their renewal time. A name that cannot renew or an amount below the minimum also returns `422`. Disabled burns, a nonzero Circle minimum fee, or unavailable or unverified pricing return `503`; the API does not invent a fallback price.

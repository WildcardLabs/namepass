# Estimate a renewal

`POST /api/v1/quote`

Estimate renewal duration and fees for an ENS name, funding chain and USDC amount. Quotes expire after 60 seconds and assume one processing flow with no existing balance at the deposit address.

## Request body

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `name` | string | Yes |  |
| `chainId` | string | Yes | Exact integer encoded as a decimal string. |
| `amount` | string | Yes | Exact integer encoded as a decimal string. |

```json
{
  "name": "example.eth",
  "chainId": "84532",
  "amount": "1000000"
}
```

## Responses

| Status | Description |
| --- | --- |
| `200` | Estimated renewal time and fee breakdown. |
| `400` | Invalid name, chain ID, transaction hash or request. |
| `422` | Name cannot currently renew, amount is below the minimum, or amount exceeds the single-flow quote limit. |
| `500` | Server error. |
| `503` | Temporarily unavailable. Retry after the indicated delay. |

## Response fields

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `name` | string | Yes |  |
| `chainId` | string | Yes | Exact integer encoded as a decimal string. |
| `amount` | string | Yes | Exact integer encoded as a decimal string. |
| `secondsAdded` | string | Yes | Exact integer encoded as a decimal string. |
| `amountApplied` | string | Yes | Exact integer encoded as a decimal string. |
| `renewalFee` | string | Yes | Exact integer encoded as a decimal string. |
| `bridgeFee` | string | Yes | Exact integer encoded as a decimal string. |
| `roundingRemainder` | string | Yes | Exact integer encoded as a decimal string. |
| `pricingBlock` | string | Yes | Exact integer encoded as a decimal string. |
| `expiresAt` | string | Yes | Format: date-time. |
| `estimate` | boolean | Yes |  |

## Full contract

[Download OpenAPI](/openapi.json) for referenced schemas and complete response fields.

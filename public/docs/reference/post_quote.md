# Estimate a renewal

Estimate how much renewal time an amount of USDC buys for one name and funding chain. Reads the active helper at one block, using the same pricing algorithm as the frontend. The estimate expires after 60 seconds and assumes one processing flow without an existing wallet balance.

## Endpoint

`POST /api/v1/quote`

## Authentication

No API key or authorization header is required.

## Request body

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `name` | string | Yes |  |
| `chainId` | string | Yes | Exact integer encoded as a decimal string. |
| `amount` | string | Yes | Exact integer encoded as a decimal string. |

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string"
    },
    "chainId": {
      "type": "string",
      "pattern": "^(0|[1-9][0-9]*)$",
      "description": "Exact integer encoded as a decimal string."
    },
    "amount": {
      "type": "string",
      "pattern": "^(0|[1-9][0-9]*)$",
      "description": "Exact integer encoded as a decimal string."
    }
  },
  "required": [
    "name",
    "chainId",
    "amount"
  ],
  "additionalProperties": false
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

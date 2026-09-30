# Get a deposit address

Activate an ENS name and return its payment address, subname and supported chains. No API key or authorization header is required.

## Endpoint

`POST /api/v1/address`

## Authentication

No API key or authorization header is required.

## Request body

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `name` | string | Yes |  |

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string"
    }
  },
  "required": [
    "name"
  ],
  "additionalProperties": false
}
```

## Responses

| Status | Description |
| --- | --- |
| `200` | Address activated and ready for funding. |
| `400` | Invalid name, chain ID, transaction hash or request. |
| `422` | Name cannot currently renew, amount is below the minimum, or amount exceeds the single-flow quote limit. |
| `500` | Server error. |
| `503` | Temporarily unavailable. Retry after the indicated delay. |

## Response fields

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `name` | string | Yes |  |
| `depositAddress` | string | Yes |  |
| `subname` | string | Yes |  |
| `subnameVerified` | boolean | Yes |  |
| `chains` | array | Yes |  |

## Full contract

[Download OpenAPI](/openapi.json) for referenced schemas and complete response fields.

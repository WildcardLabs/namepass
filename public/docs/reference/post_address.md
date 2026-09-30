# Get a deposit address

> The public API launches with mainnet. It is not available yet.

`POST /api/v1/address`

Activate deposit monitoring for an ENS name and return its deposit address, subname and supported funding chains.

## Request body

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `name` | string | Yes |  |

```json
{
  "name": "example.eth"
}
```

## Responses

| Status | Description |
| --- | --- |
| `200` | Address activated and ready for funding. |
| `400` | Invalid name, chain ID, transaction hash or request. |
| `422` | The ENS name cannot currently be renewed. |
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

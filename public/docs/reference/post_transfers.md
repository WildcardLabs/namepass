# Register a transaction attempt with a private stable reference

Required scope: `transfers:write`.

## Endpoint

`POST /api/v1/transfers`

## Authentication

Use a backend-only bearer key. See [Authentication & conventions](/docs/contract).

## Parameters

| Name | Location | Required | Description |
| --- | --- | --- | --- |
| `Idempotency-Key` | header | Yes | Reuse the same key and exact body on retries. Cached for seven days. |

## Request body

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `name` | string | Yes |  |
| `chainId` | string | Yes | Exact non-negative integer encoded as a decimal string. The field name specifies its unit. |
| `txHash` | string | Yes |  |
| `reference` | string | Yes |  |
| `transferKind` | string | No | Values: `erc20`, `native`. Default: `"erc20"`. |
| `logIndex` | integer or null | No |  |

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
      "description": "Exact non-negative integer encoded as a decimal string. The field name specifies its unit."
    },
    "txHash": {
      "type": "string",
      "pattern": "^0x[0-9a-f]{64}$"
    },
    "reference": {
      "type": "string",
      "minLength": 1,
      "maxLength": 255
    },
    "transferKind": {
      "type": "string",
      "enum": [
        "erc20",
        "native"
      ],
      "default": "erc20"
    },
    "logIndex": {
      "type": [
        "integer",
        "null"
      ],
      "minimum": 0
    }
  },
  "required": [
    "name",
    "chainId",
    "txHash",
    "reference"
  ],
  "additionalProperties": false
}
```

## Responses

| Status | Description |
| --- | --- |
| `200` | Success. |
| `201` | Success. |
| `202` | Durably accepted; continue with the returned resource ID. |
| `400` | Structured error. |
| `401` | Structured error. |
| `403` | Structured error. |
| `404` | Structured error. |
| `409` | Structured error. |
| `410` | Cursor expired; create a new snapshot. |
| `413` | Structured error. |
| `415` | Structured error. |
| `422` | Structured error. |
| `429` | Rate limited. Honor Retry-After. |
| `500` | Structured error. |
| `503` | Structured error. |

## Response fields

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `transferId` | string | Yes | Format: uuid. |

## Full contract

[Download OpenAPI](/openapi.json) for referenced schemas and complete response fields. Use `get_api_operation` in the [docs MCP](/docs/mcp) to retrieve the operation with its schema definitions.

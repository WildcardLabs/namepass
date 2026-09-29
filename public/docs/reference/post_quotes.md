# Quote an exact input amount at a verified hub block

Required scope: `read`.

## Endpoint

`POST /api/v1/quotes`

## Authentication

Use a backend-only bearer key. See [Authentication & conventions](/docs/contract).

## Request body

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `name` | string | Yes |  |
| `chainId` | string | Yes | Exact non-negative integer encoded as a decimal string. The field name specifies its unit. |
| `amount` | string | Yes | Exact non-negative integer encoded as a decimal string. The field name specifies its unit. |

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
    "amount": {
      "type": "string",
      "pattern": "^(0|[1-9][0-9]*)$",
      "description": "Exact non-negative integer encoded as a decimal string. The field name specifies its unit."
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
| `name` | string | Yes |  |
| `chainId` | string | Yes | Exact non-negative integer encoded as a decimal string. The field name specifies its unit. |
| `deploymentId` | string | Yes |  |
| `amount` | string | Yes | Exact non-negative integer encoded as a decimal string. The field name specifies its unit. |
| `executorAllowance` | string | Yes | Exact non-negative integer encoded as a decimal string. The field name specifies its unit. |
| `bridgeFee` | string | Yes | Exact non-negative integer encoded as a decimal string. The field name specifies its unit. |
| `amountApplied` | string | Yes | Exact non-negative integer encoded as a decimal string. The field name specifies its unit. |
| `roundingResidue` | string | Yes | Exact non-negative integer encoded as a decimal string. The field name specifies its unit. |
| `durationSeconds` | string | Yes | Exact non-negative integer encoded as a decimal string. The field name specifies its unit. |
| `helperAddress` | string | Yes |  |
| `blockNumber` | string | Yes | Exact non-negative integer encoded as a decimal string. The field name specifies its unit. |
| `blockHash` | string | Yes |  |
| `expiresAt` | string | Yes | Format: date-time. |
| `estimate` | boolean | Yes |  |
| `assumptions` | array | Yes |  |

## Full contract

[Download OpenAPI](/openapi.json) for referenced schemas and complete response fields. Use `get_api_operation` in the [docs MCP](/docs/mcp) to retrieve the operation with its schema definitions.

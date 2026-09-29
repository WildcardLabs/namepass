# Create a consistent snapshot and matching event cursor

Required scope: `read`.

## Endpoint

`POST /api/v1/sync`

## Authentication

Use a backend-only bearer key. See [Authentication & conventions](/docs/contract).

## Request body

| Field | Type | Required | Details |
| --- | --- | --- | --- |


```json
{
  "type": "object",
  "properties": {},
  "required": [],
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
| `id` | string | Yes | Format: uuid. |
| `expiresAt` | string | Yes | Format: date-time. |
| `eventsCursor` | string | Yes |  |
| `nextCursor` | string | Yes |  |

## Full contract

[Download OpenAPI](/openapi.json) for referenced schemas and complete response fields. Use `get_api_operation` in the [docs MCP](/docs/mcp) to retrieve the operation with its schema definitions.

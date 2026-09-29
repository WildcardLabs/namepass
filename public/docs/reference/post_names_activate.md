# Activate a name and create the caller’s watch

Required scope: `names:write`.

## Endpoint

`POST /api/v1/names/activate`

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
| `operationId` | string or null | Yes | Format: uuid. |
| `nameId` | string | Yes | Format: uuid. |
| `name` | string | Yes |  |
| `depositAddress` | string | Yes |  |
| `alias` | string | Yes |  |
| `deploymentId` | string | Yes |  |
| `status` | string | Yes | Values: `ready`, `initializing`. |
| `snapshotRequired` | boolean | Yes |  |

## Full contract

[Download OpenAPI](/openapi.json) for referenced schemas and complete response fields. Use `get_api_operation` in the [docs MCP](/docs/mcp) to retrieve the operation with its schema definitions.

# Edit destination or subscription; pending deliveries pause

Required scope: `webhooks:manage`.

## Endpoint

`PATCH /api/v1/webhook-endpoints/{id}`

## Authentication

Use a backend-only bearer key. See [Authentication & conventions](/docs/contract).

## Parameters

| Name | Location | Required | Description |
| --- | --- | --- | --- |
| `id` | path | Yes |  |
| `Idempotency-Key` | header | Yes | Reuse the same key and exact body on retries. Cached for seven days. |

## Request body

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `url` | string | No | Format: uri. |
| `eventTypes` | array | No |  |
| `enabled` | boolean | No |  |

```json
{
  "type": "object",
  "properties": {
    "url": {
      "type": "string",
      "format": "uri"
    },
    "eventTypes": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "enabled": {
      "type": "boolean"
    }
  },
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
| `url` | string | Yes | Format: uri. |
| `status` | string | Yes | Values: `unverified`, `active`, `disabled`. |
| `configurationVersion` | integer | Yes |  |
| `eventTypes` | array | Yes |  |
| `signingSecret` | string | No |  |

## Full contract

[Download OpenAPI](/openapi.json) for referenced schemas and complete response fields. Use `get_api_operation` in the [docs MCP](/docs/mcp) to retrieve the operation with its schema definitions.

# Read a delivery and its recent attempts

Required scope: `webhooks:manage`.

## Endpoint

`GET /api/v1/webhook-deliveries/{id}`

## Authentication

Use a backend-only bearer key. See [Authentication & conventions](/docs/contract).

## Parameters

| Name | Location | Required | Description |
| --- | --- | --- | --- |
| `id` | path | Yes |  |

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
| `endpointId` | string | Yes | Format: uuid. |
| `eventId` | string | Yes | Format: uuid. |
| `status` | string | Yes | Values: `pending`, `running`, `succeeded`, `paused`, `exhausted`. |
| `attempts` | integer | Yes |  |
| `nextAttemptAt` | string | Yes | Format: date-time. |
| `reasonCode` | string or null | Yes |  |
| `createdAt` | string | Yes | Format: date-time. |
| `attemptHistory` | array | No |  |

## Full contract

[Download OpenAPI](/openapi.json) for referenced schemas and complete response fields. Use `get_api_operation` in the [docs MCP](/docs/mcp) to retrieve the operation with its schema definitions.

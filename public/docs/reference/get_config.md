# Discover the active deployment and supported funding modes

Required scope: `read`.

## Endpoint

`GET /api/v1/config`

## Authentication

Use a backend-only bearer key. See [Authentication & conventions](/docs/contract).

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
| `apiVersion` | string | Yes |  |
| `environment` | string | Yes |  |
| `deploymentId` | string | Yes |  |
| `enabled` | boolean | Yes |  |
| `eventTypes` | array | Yes |  |
| `eventRetentionDays` | integer | Yes |  |
| `snapshotLifetimeSeconds` | integer | Yes |  |
| `maxPageSize` | integer | Yes |  |
| `alias` | object | Yes |  |
| `chains` | array | Yes |  |

## Full contract

[Download OpenAPI](/openapi.json) for referenced schemas and complete response fields. Use `get_api_operation` in the [docs MCP](/docs/mcp) to retrieve the operation with its schema definitions.

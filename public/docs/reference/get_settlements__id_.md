# Read one settlement

Required scope: `read`.

## Endpoint

`GET /api/v1/settlements/{id}`

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
| `id` | string | Yes |  |
| `version` | string | Yes | Exact non-negative integer encoded as a decimal string. The field name specifies its unit. |
| `resourceType` | string | Yes |  |
| `environment` | string | Yes | Values: `testnet`, `mainnet`. |
| `deploymentId` | string | Yes |  |
| `flowId` | string | Yes | Format: uuid. |
| `nameId` | string | Yes | Format: uuid. |
| `status` | string | Yes | Values: `observed`, `finalized`, `invalidated`. |
| `evidence` | object | Yes |  |
| `amounts` | object | Yes |  |
| `durationSeconds` | string | Yes | Exact non-negative integer encoded as a decimal string. The field name specifies its unit. |
| `expiryAfter` | string or null | Yes |  |
| `observedAt` | string | Yes | Format: date-time. |
| `finalizedAt` | string or null | Yes |  |

## Full contract

[Download OpenAPI](/openapi.json) for referenced schemas and complete response fields. Use `get_api_operation` in the [docs MCP](/docs/mcp) to retrieve the operation with its schema definitions.

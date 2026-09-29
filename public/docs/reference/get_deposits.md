# List complete deposits at a fixed publication position

Required scope: `read`.

## Endpoint

`GET /api/v1/deposits`

## Authentication

Use a backend-only bearer key. See [Authentication & conventions](/docs/contract).

## Parameters

| Name | Location | Required | Description |
| --- | --- | --- | --- |
| `limit` | query | No |  |
| `cursor` | query | No |  |
| `name` | query | No |  |
| `chainId` | query | No |  |
| `status` | query | No |  |
| `txHash` | query | No |  |
| `reference` | query | No |  |
| `createdFrom` | query | No |  |
| `updatedFrom` | query | No |  |

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
| `items` | array | Yes |  |
| `asOf` | string | Yes | Format: date-time. |
| `hasMore` | boolean | Yes |  |
| `nextCursor` | string or null | Yes |  |

## Full contract

[Download OpenAPI](/openapi.json) for referenced schemas and complete response fields. Use `get_api_operation` in the [docs MCP](/docs/mcp) to retrieve the operation with its schema definitions.

# Read stored name, alias verification, balance snapshots and history coverage

Required scope: `read`.

## Endpoint

`GET /api/v1/names/{name}`

## Authentication

Use a backend-only bearer key. See [Authentication & conventions](/docs/contract).

## Parameters

| Name | Location | Required | Description |
| --- | --- | --- | --- |
| `name` | path | Yes |  |

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
| `label` | string | Yes |  |
| `name` | string | Yes |  |
| `depositAddress` | string | Yes |  |
| `activatedAt` | string | Yes | Format: date-time. |
| `currentExpiry` | string or null | Yes |  |
| `renewableBy` | string or null | Yes |  |
| `ensSyncedAt` | string | Yes | Format: date-time. |
| `unscannedChainIds` | array | Yes |  |
| `lifetimeReceived` | string | Yes | Exact non-negative integer encoded as a decimal string. The field name specifies its unit. |
| `lifetimeApplied` | string | Yes | Exact non-negative integer encoded as a decimal string. The field name specifies its unit. |
| `timeDeliveredSeconds` | string | Yes | Exact non-negative integer encoded as a decimal string. The field name specifies its unit. |
| `renewalCount` | string | Yes | Exact non-negative integer encoded as a decimal string. The field name specifies its unit. |
| `alias` | object | Yes |  |
| `historyCoverage` | array | Yes |  |
| `balances` | array | Yes |  |
| `fundingStatus` | string | Yes | Values: `ready`, `initializing`. |

## Full contract

[Download OpenAPI](/openapi.json) for referenced schemas and complete response fields. Use `get_api_operation` in the [docs MCP](/docs/mcp) to retrieve the operation with its schema definitions.

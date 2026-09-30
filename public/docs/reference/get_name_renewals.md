# List a name's renewals

Past renewal flows for the requested ENS name, with its recorded expiry. Returns canonical renewals newest first. Complete indicates verified hub finality; processing means verification is pending. This is public name-scoped data and does not prove caller ownership.

## Endpoint

`GET /api/v1/names/{name}/renewals`

## Authentication

No API key or authorization header is required.

## Parameters

| Name | Location | Required | Description |
| --- | --- | --- | --- |
| `name` | path | Yes | ENS name, such as example.eth. |
| `limit` | query | No | Items per page; defaults to 20. |
| `cursor` | query | No | nextCursor from the previous page. Keep the same name. |

## Responses

| Status | Description |
| --- | --- |
| `200` | Name expiry and renewal history. |
| `400` | Invalid name, chain ID, transaction hash or request. |
| `404` | This name has not been activated. Get its deposit address first. |
| `500` | Server error. |
| `503` | Temporarily unavailable. Retry after the indicated delay. |

## Response fields

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `name` | string | Yes |  |
| `currentExpiry` | string or null | Yes | Format: date-time. |
| `expiryUpdatedAt` | string or null | Yes | Format: date-time. |
| `items` | array | Yes |  |
| `nextCursor` | string or null | Yes |  |

## Full contract

[Download OpenAPI](/openapi.json) for referenced schemas and complete response fields.

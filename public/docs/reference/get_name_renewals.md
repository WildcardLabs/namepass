# List a name's renewals

`GET /api/v1/names/{name}/renewals`

Retrieve public renewal history and the recorded expiry for an ENS name. Renewals are ordered newest first. Complete indicates a verified, finalized renewal; processing indicates pending verification.

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

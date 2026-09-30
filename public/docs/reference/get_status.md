# Poll a transaction

Poll an already-sent USDC transaction using its source chain ID and hash. No API key, registration or session is required. Complete means every indexed deposit in this transaction has a verified, finalized renewal.

## Endpoint

`GET /api/v1/status/{chainId}`

## Authentication

No API key or authorization header is required.

## Parameters

| Name | Location | Required | Description |
| --- | --- | --- | --- |
| `chainId` | path | Yes | Source blockchain chain ID, from the address response. This is a chain ID, not a CCTP domain. |
| `transactionHash` | query | Yes | The USDC deposit transaction hash returned by your wallet. |

## Responses

| Status | Description |
| --- | --- |
| `200` | Current progress. Poll pending or processing; stop at complete. |
| `400` | Invalid name, chain ID, transaction hash or request. |
| `404` | Deposit not indexed yet. Retry the same URL. |
| `500` | Server error. |
| `503` | Temporarily unavailable. Retry after the indicated delay. |

## Response fields

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `chainId` | string | Yes | Exact integer encoded as a decimal string. |
| `transactionHash` | string | Yes |  |
| `status` | string | Yes | Values: `pending`, `processing`, `complete`, `failed`. |
| `deposits` | array | Yes |  |

## Full contract

[Download OpenAPI](/openapi.json) for referenced schemas and complete response fields.

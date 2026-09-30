# Poll a transaction

`GET /api/v1/status/{chainId}`

Retrieve renewal status for a USDC deposit transaction. The transaction is complete when every indexed deposit has a verified, finalized renewal.

## Parameters

| Name | Location | Required | Description |
| --- | --- | --- | --- |
| `chainId` | path | Yes | Source EVM chain ID from the address response. |
| `transactionHash` | query | Yes | The USDC deposit transaction hash returned by your wallet. |

## Responses

| Status | Description |
| --- | --- |
| `200` | Current progress. Poll pending or processing; stop at complete. |
| `400` | Invalid name, chain ID, transaction hash or request. |
| `404` | No matching deposit has been indexed. Retry the same URL. |
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

# API reference

> The public integration API is not available. These pages describe the planned API.

Base URL: `https://beta.namepass.com/api/v1`

| Endpoint | Purpose |
| --- | --- |
| `POST /api/v1/address` | Get a name's deposit address and supported networks. |
| `POST /api/v1/quote` | Estimate renewal time from a USDC amount. |
| `GET /api/v1/status/{chainId}?transactionHash={hash}` | Track a deposit through renewal. |
| `GET /api/v1/names/{name}/renewals` | Read a name's past renewals and recorded expiry. |

## Authentication

All endpoints are public. Authentication is not required.

## Requests and responses

Request and response bodies use JSON. Browser requests are supported through CORS. USDC amounts are integer strings in six-decimal token units; `1000000` represents 1 USDC.

Download the [OpenAPI specification](/openapi.json) for request schemas, response fields and error codes.

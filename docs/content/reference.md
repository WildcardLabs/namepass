The public API has four endpoints:

| Endpoint | Purpose |
| --- | --- |
| `POST /api/v1/address` | Get a name's deposit address and supported networks. |
| `POST /api/v1/quote` | Estimate renewal time from a USDC amount. |
| `GET /api/v1/status/{chainId}?transactionHash={hash}` | Track a deposit through renewal. |
| `GET /api/v1/names/{name}/renewals` | Read a name's past renewals and recorded expiry. |

All work without an API key. Browser requests are supported through CORS. Download [OpenAPI](/openapi.json) for exact schemas.

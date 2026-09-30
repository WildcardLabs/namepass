Call `POST /api/v1/address` with `{"name":"example.eth"}`. No authorization header is needed.

## What you get

- `name`: the normalized ENS name.
- `depositAddress`: the full payment address, shared across the supported chains.
- `subname`: the corresponding `namepass.eth` subname.
- `subnameVerified`: whether this deployment has verified subname resolution.
- `chains`: supported chain IDs, USDC token addresses and minimum funding amounts.

Use the returned values instead of hardcoding addresses or networks. The call activates monitoring for the name. Calling it again returns the same deposit address.

## Send the payment

Use your existing wallet to transfer the supported USDC token. Namepass does not hold your wallet keys. Keep the transaction hash and source chain ID, then [poll the status](/docs/status).

A name that cannot currently be renewed returns `422`. Unavailable ENS reads return `503`; retry without sending funds.

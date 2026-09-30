---
name: namepass-integration
description: Fund an ENS renewal with Namepass from an app, wallet or agent using get-address, send-USDC and transaction polling.
---

# Namepass

Use the configured Namepass origin. Read `<origin>/docs/quickstart.md` when needed. No Namepass API key is required.

1. Call `POST <origin>/api/v1/address` with `{"name":"example.eth"}` for the requested name.
2. Use its `depositAddress`, supported chain, `tokenAddress` and `minimumAmount`. Send USDC using the existing wallet or agent. Get approval before sending unless already authorized. Use the full address; use `subname` only when `subnameVerified` is true.
3. Save the transaction hash and chain ID. Poll `GET <origin>/api/v1/status/{chainId}?transactionHash={hash}` about every five seconds. Honor `Retry-After`. Retry 404, 429 and 503. Stop when `status` is `complete`; inspect `failed` before taking further action.

When a user wants a price estimate, call `POST <origin>/api/v1/quote` with `name`, `chainId` and a six-decimal integer-string `amount`. It returns `secondsAdded`, fees and a 60-second expiry; it assumes one flow and no existing balance. For past renewals or recorded expiry, call `GET <origin>/api/v1/names/{name}/renewals`, using `nextCursor` to load more for that name.

A pending result does not require another payment. Resume using the same hash and chain ID. `complete` confirms the renewal is finalized. Read `deposits[].renewals` for renewal receipts. Their totals may include other deposits, so do not invent a per-deposit allocation.

USDC token amounts use six decimals and integer arithmetic. Use the networks returned by the address API; the current deployment is testnet. Never expose wallet keys or broadcast funds without authorization.

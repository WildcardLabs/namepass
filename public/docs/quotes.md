# Funding estimates

## Quote before funding

`POST /quotes` accepts a name, chain ID and amount in micro-USDC. It reads the selected ENS helper and its quote at one verified hub block. Quotes expire after 60 seconds. They are estimates for one renewal flow with standard CCTP, unchanged pricing and no existing wallet balance.

```json
{"name":"alice.eth","chainId":"84532","amount":"10000000"}
```

## Exact amounts and assumptions

Keep arithmetic in integers. Ten USDC is `"10000000"`. Fees are charged per renewal flow; pooled deposits share the result. A quote is not a payment instruction, reservation, or settlement guarantee.

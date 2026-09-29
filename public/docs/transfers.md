# Track a transfer

## Give each bank transfer a durable identity

```bash
curl "$NAMEPASS_API/transfers" \
  -H "Authorization: Bearer $NAMEPASS_API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: bank-transfer-1001' \
  -d '{
    "name":"alice.eth",
    "chainId":"84532",
    "txHash":"0x…64 hexadecimal characters…",
    "transferKind":"erc20",
    "reference":"bank-transfer-1001"
  }'
```

Keep the returned `transferId`. The reference is private to your integration and remains unique beyond the seven-day idempotency window. A report is accepted before mining or indexing. Namepass verifies chain identity, successful receipt, recipient, token, value and the canonical block.

## Select a log or replace a transaction

If one receipt contains several matching transfers, the result becomes `selection_required`. Submit the chosen `logIndex` to `POST /transfers/{id}/transactions`. Use that same endpoint for replacement hashes. One bank transfer must not silently become several mined payments. Native Arc uses `transferKind: "native"` without a log index.

## Map the transfer state

Transfer statuses are `reported`, `selection_required`, `verified`, `rejected`, `orphaned` and `completed`. Verified means the deposit receipt is valid. Completed means the conservative consumption rule below has passed. A missing receipt stays pending; it is not a failed payment.

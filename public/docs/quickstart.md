# Quickstart

## A bank integration in five steps

1. Obtain a scoped server-side API key from your Namepass operator.
2. Activate the ENS name and wait for initialization to finish.
3. Send supported USDC to the returned address using your existing payment system.
4. Register the transaction hash and your private transfer reference.
5. Consume webhooks or the event feed. Mark the customer transfer complete only after consumption is proven and all candidate renewals are finalized.

```bash
# Keep the key on your server. Read GET /config first.
export NAMEPASS_API="https://your-deployment.example/api/v1"
curl "$NAMEPASS_API/names/activate" \
  -H "Authorization: Bearer $NAMEPASS_API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: customer-42-activate-alice' \
  -d '{"name":"alice.eth"}'
```

An initialization response is `202` with `operationId`, `nameId`, the full `depositAddress` and the alias. Poll `GET /activations/{id}` or follow `activation.updated`. Publication is asynchronous; a newly returned ID can briefly be unavailable in the read projection. Retry with backoff.

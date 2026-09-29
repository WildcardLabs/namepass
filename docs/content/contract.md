## API conventions

- Keep API keys on your backend. Scopes are `read`, `names:write`, `transfers:write`, `flows:retry` and `webhooks:manage`.
- All creation and action writes require `Idempotency-Key`, except read-only quotes and snapshot creation. Reuse the exact body. Different bodies with the same key return `409`.
- Amounts, chain IDs, block numbers and resource versions use decimal strings. Resource versions may skip numbers. JSON bodies are limited to 8 KiB.
- Default limits are 10 reads/second (burst 20), 60 writes/minute and 10 activation, refresh or quote requests/minute. Honor `Retry-After` on `429`.
- Pages default to 50 items and allow at most 100. Cursors are opaque and bound to your partner, deployment and query.
- Errors contain `error.code`, `error.message` and `requestId`. Include the request ID when asking the operator for help.
- Read projections and notifications are asynchronous. Do not interpret temporary absence immediately after a write as rejection.

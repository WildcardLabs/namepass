---
name: namepass-integration
description: Build or review Namepass ENS renewal funding integrations, including activated addresses, USDC transfer references, signed webhooks and settlement reconciliation in an existing application.
---

# Namepass integration

Inspect the application's backend, payment flow and ledger. Keep its chosen stack and custody model. Obtain the Namepass docs origin, API deployment URL and required scopes from the developer or existing configuration. The public docs MCP provides documentation only; it cannot access partner data or execute payments.

Use the documentation at `<docs-origin>/llms.txt` to find current guides. Read the OpenAPI contract at `<docs-origin>/openapi.json` for request and response fields. If docs MCP is connected, use `search_docs`, `read_doc` and `get_api_operation`. The API contract version is 2026-09-28; verify deployment configuration before funding.

## Integration workflow

1. Read `GET /api/v1/config` with a backend-only scoped key. Use its deployment, chains, tokens, minimums and alias verification. Do not hardcode mainnet support.
2. Activate the ENS name. Preserve the returned full address, name ID and operation ID. Wait for activation state and evidence coverage appropriate to the application's task. Display an ENS alias as verified only when config permits it and resolution matches the full address.
3. Let the existing payment system authorize and send funds. Report an already-sent transaction with a private, stable reference. Preserve the transfer ID; use replacement attempts and explicit log selection where required. API reporting does not broadcast funds.
4. Map statuses using the settlement guide at `<docs-origin>/docs/settlement.md`. A verified deposit proves a canonical receipt. It does not prove renewal completion. Pooled deposits cannot be assigned invented renewal seconds or individual fee shares. A completed transfer requires proven consumption and finalized settlement for every candidate flow.
5. Use `<docs-origin>/docs/sync.md` for reconciliation. Establish watches, create a snapshot, page it, then consume the matching event cursor. Commit resource updates and the returned cursor in one local transaction. Upsert only newer decimal-string resource versions. Handle tombstones and canonicality corrections; bootstrap again after replay expires with 410.
6. Use `<docs-origin>/docs/webhooks.md` for notifications. Verify the exact raw body against Standard Webhooks headers, enforce timestamp tolerance, compare in constant time and deduplicate by event ID. Persist before acknowledging. Webhooks may duplicate or arrive out of order; the cursor feed remains the recovery authority.

Use integer arithmetic for six-decimal USDC and preserve string amounts, chain IDs, block numbers and resource versions. Reuse exact request bodies with stable idempotency keys. Honor Retry-After. Read projections are asynchronous; temporary absence after a committed command is not a rejection.

For recovery, inspect evidence and reason codes and resume the same safe flow. Do not respond to a pending or failed flow by sending another payment. Read `<docs-origin>/docs/recovery.md`. Do not expose API keys, signing secrets or signed transaction bytes in prompts, logs or browser code.

## Verify the application

Test activation polling, receipt ambiguity, duplicate and out-of-order events, webhook signatures, atomic checkpointing, expired cursors and correction of an earlier completed state. Reuse the repository examples under `examples/integration` as reference implementations. Validate the application's behavior against independent examples and the wire contract.

Payment broadcasting and production deployment need the developer's existing authorization. Do not infer that authorization from a request to implement the integration.

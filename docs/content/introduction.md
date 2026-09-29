Namepass turns USDC funding into ENS renewal time. Give your users one deposit address for their name, then follow the funds through to a verified renewal.

## Start with your coding agent

Connect the [docs MCP server](/docs/mcp) and install the [integration skill](/docs/skills). Your agent can search the documentation, inspect the API contract and implement a workflow that fits your application.

```text
Help me add Namepass ENS renewal funding to this application.
Read the Namepass docs at {{DOCS_ORIGIN}}/llms.txt and the OpenAPI
contract at {{DOCS_ORIGIN}}/openapi.json. Use the integration skill
at {{DOCS_ORIGIN}}/docs/skills/namepass-integration/SKILL.md.

Inspect my existing backend, USDC payment flow and database first.
Implement activation, a private transfer reference, verified webhooks,
and snapshot-plus-cursor reconciliation. Keep credentials on the server.
Distinguish a verified deposit from a finalized settlement; never
allocate invented renewal time to a pooled deposit. Do not send funds.
Ask me for the deployment URL and scoped API key when they are needed.
```

Prefer to work directly? Follow the [quickstart](/docs/quickstart), then explore the [API reference](/docs/reference).

## Your app. Their name. One address.

A neobank can add **Fund ENS renewal** next to an existing USDC payment flow. A wallet can help users keep their names active. Your app handles the payment; Namepass handles renewal execution and exposes the evidence you need to reconcile it.

1. **Activate a name.** Retrieve its universal deposit address and ENS alias.
2. **Report the payment.** Attach the transaction hash to your private transfer reference.
3. **Follow the result.** Read ongoing activity, consume signed events and confirm finalized settlement.

The same name has the same deposit address on the supported chains in a deployment. Supported tokens, networks and alias verification come from the authenticated configuration endpoint.

## Settlement you can explain

A successful USDC transaction proves a deposit. It does not yet prove a renewal. Namepass keeps deposit verification, wallet consumption and ENS settlement separate so your app can show an accurate status at every stage.

Multiple deposits can fund the same renewal. Completion requires evidence of consumption and finalized settlement for every candidate flow. Read [Understand settlement](/docs/settlement) before mapping these states to your customer ledger.

## Choose your next step

- [Connect a neobank or wallet](/docs/quickstart): activate a name and report an existing payment.
- [Build a reliable ledger](/docs/sync): bootstrap history and capture changes to ongoing flows.
- [Receive signed notifications](/docs/webhooks): verify, persist and replay events.
- [Give your agent context](/docs/agents): use Markdown, MCP and the integration skill together.

## Current availability

The integration contract is **2026-09-28** and targets the configured testnet deployment. Documentation availability does not imply that API access or mainnet funding is enabled. Obtain deployment details and a scoped key from your Namepass operator. See [Availability & support](/docs/release).

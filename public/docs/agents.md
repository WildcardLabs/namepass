# Build with your agent

Use your coding agent to implement the integration in the language, framework and database your app already uses. Give it current documentation and the settlement rules before asking it to write code.

## Connect the documentation

The public [docs MCP server](/docs/mcp) gives your agent three tools: search documentation, read a complete page and inspect an API operation. It requires no API key and has no access to partner data or payment execution.

```json
{
  "mcpServers": {
    "namepass-docs": {
      "type": "http",
      "url": "https://beta.namepass.com/api/docs/mcp"
    }
  }
}
```

Use your client's remote HTTP MCP configuration. The [MCP guide](/docs/mcp) includes client-specific setup and tool details.

## Install the integration skill

The [Namepass integration skill](/docs/skills) teaches your agent the API workflow, ledger rules and evidence boundaries. It is a standard `SKILL.md` file that you can inspect before installation.

```bash
mkdir -p .agents/skills/namepass-integration
curl -fsSL 'https://beta.namepass.com/docs/skills/namepass-integration/SKILL.md' \
  -o .agents/skills/namepass-integration/SKILL.md
```

If your client uses a different skill directory, save the same file there. Keep the skill in your project when you want the whole team to share the integration guidance.

## Give it a concrete task

```text
Use the Namepass integration skill and docs MCP to add ENS renewal
funding to our app. Inspect our payment and ledger code first.

Build these pieces using our existing stack:
- Backend-only scoped API authentication and stable idempotency keys.
- ENS name activation and display of the full returned deposit address.
- Registration of an already-sent USDC transaction with a private reference.
- A raw-body webhook receiver that verifies signatures and persists events
  before acknowledging them.
- A snapshot bootstrap and event poller that commits resource updates and
  the returned cursor in one database transaction.

Use the generated OpenAPI contract. Keep amounts and versions exact.
Only show completion after consumption is proven and all candidate
settlements are finalized. Handle correction events and expired cursors.
Use a test deployment; do not broadcast a payment or deploy to production.
```

## Use Markdown without MCP

Each page has **Copy page** and **View as Markdown** actions. The [documentation index](/llms.txt) lists every guide and API operation. The [full documentation](/llms-full.txt) is useful when your tool can ingest a larger context. Prefer individual pages when the question is narrow.

The [OpenAPI contract](/openapi.json) defines request and response schemas. Markdown explains behavior; OpenAPI defines the wire contract. Both are generated from the same checked sources used by this site.

## Review the result

Check that the agent preserves your existing payment authorization and custody model. The docs MCP does not verify live transfers or supply credentials. Your operator provides the deployment and scopes; your payment system controls broadcasting.

Review signature verification, duplicate events, out-of-order versions, replay after an outage and canonicality corrections. The [runnable examples](https://github.com/wildcardlabs/namepass/tree/codex/integration-api-plan/examples/integration) are reference implementations, not a replacement for your app's ledger design.

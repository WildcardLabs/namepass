# Docs MCP server

Connect your editor or agent to the Namepass documentation through Model Context Protocol. This server provides public documentation and API schemas over stateless Streamable HTTP.

## Server URL

```text
https://beta.namepass.com/api/docs/mcp
```

No Namepass API key is required. The server reads a versioned, bundled documentation catalog. It never reads your account, starts a renewal, registers a transfer, or calls a chain RPC.

## Client setup

In Cursor, add a remote server to your project's `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "namepass-docs": {
      "url": "https://beta.namepass.com/api/docs/mcp"
    }
  }
}
```

In VS Code with MCP support, use `.vscode/mcp.json`:

```json
{
  "servers": {
    "namepass-docs": {
      "type": "http",
      "url": "https://beta.namepass.com/api/docs/mcp"
    }
  }
}
```

See the [Cursor MCP documentation](https://prod.cursor.com/help/customization/mcp) and [VS Code MCP configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration) for client settings.

For other clients, select remote HTTP transport and enter the server URL. Review your client's trust prompt before enabling it. No bearer credential belongs in this configuration.

## Available tools

| Tool | Use it for |
| --- | --- |
| `search_docs` | Find guides and API operations by a phrase or keyword. Returns ranked excerpts and page URLs. |
| `read_doc` | Retrieve one complete Markdown page by its slug. |
| `get_api_operation` | Read the exact method, path, parameters, request schema and response schemas for an operation. |

The server also exposes documentation pages, the integration skill and OpenAPI as resources. The `integrate_namepass` prompt assembles an implementation brief for your agent.

## Example questions

- “How should our neobank decide a transfer is completed?”
- “Find the activation request and its required scopes.”
- “How do we recover a webhook outage without missing ongoing flows?”
- “Read the schema for reporting a transaction with a private reference.”

## Scope and version

The MCP server shares the website's generated catalog and OpenAPI contract. It provides API version **2026-09-28** context. It is a documentation server; authenticated integration actions remain in `/api/v1`.

The transport accepts bounded JSON requests. There are no long-lived sessions or required SSE subscriptions. If your client cannot connect, confirm that it supports Streamable HTTP and can reach the URL. Test locally with the same URL on your development origin.

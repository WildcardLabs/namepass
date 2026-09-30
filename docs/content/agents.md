Use the [integration skill](/docs/skills) to add ENS renewal funding to a wallet or coding agent.

## Example prompt

```text
Renew [name] with [amount] USDC on [chain] using Namepass.
Follow the integration skill:
{{DOCS_ORIGIN}}/docs/skills/namepass-integration/SKILL.md
```

The agent retrieves the deposit address, submits the transfer through its wallet and polls the renewal status. Payment authorization stays with the wallet.

## Resources

- [Quickstart as Markdown](/docs/quickstart.md)
- [OpenAPI specification](/openapi.json)
- [Documentation index](/llms.txt)
- [Full documentation](/llms-full.txt)

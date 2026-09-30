# Use an agent

An agent such as Bankr uses the same flow as an app: get an address, send USDC, then poll the transaction. No Namepass MCP server or API key is needed.

## Give it the task

```text
Fund the ENS renewal for [name] with [amount] USDC on [chain].
Read https://beta.namepass.com/docs/quickstart.md and the integration skill at
https://beta.namepass.com/docs/skills/namepass-integration/SKILL.md.
Get the address from Namepass. Use the returned chain and USDC token.
Send with my existing wallet after checking my authorization.
Save the transaction hash and chain ID, then poll until complete.
Do not send a second payment because polling is pending.
```

Your wallet or agent manages its own wallet access and payment approvals. Namepass only needs the ENS name, then the source transaction hash and chain ID.

## Read the contract

Use [Markdown](/docs/quickstart.md), [OpenAPI](/openapi.json) or the [integration skill](/docs/skills). The [documentation index](/llms.txt) lists these resources as plain text.

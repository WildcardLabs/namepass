# Integration skill

The `namepass-integration` skill gives coding agents focused guidance for activation, transfer registration and settlement reconciliation. It works alongside the docs MCP server and generated OpenAPI contract.

## Install in your project

```bash
mkdir -p .agents/skills/namepass-integration
curl -fsSL 'https://beta.namepass.com/docs/skills/namepass-integration/SKILL.md' \
  -o .agents/skills/namepass-integration/SKILL.md
```

Use your client's skill directory if it differs. [Read the skill](/docs/skills/namepass-integration/SKILL.md) before saving it. The download is a plain Markdown file; it does not execute a script or install a package.

## What it teaches

- Inspect the app's existing payment flow and ledger before proposing changes.
- Read deployment configuration and use backend-only scoped credentials.
- Preserve exact amounts, stable references and idempotency.
- Distinguish deposits, pooled consumption, observed settlement and finality.
- Verify raw-body webhook signatures, deduplicate events and apply only newer versions.
- Commit snapshot and cursor reconciliation atomically; recover a `410` by bootstrapping again.
- Use correction events and evidence coverage instead of elapsed time to infer completion.

## Invoke it

```text
Use the namepass-integration skill to add ENS renewal funding to our
existing USDC payment flow. Connect the docs MCP, inspect our backend
and propose the ledger mapping before implementing it.
```

Clients with automatic skill discovery can load it when a Namepass integration task applies. You can also name it directly in your prompt.

## Keep context current

The skill points your agent to [the documentation index](/llms.txt), [settlement rules](/docs/settlement), [sync guide](/docs/sync), and [OpenAPI](/openapi.json). Read these current sources for field names and behavior instead of retaining a copied schema in the skill.

The skill grants no payment or production deployment authorization. Your existing application permissions and the user's instructions still control those actions.

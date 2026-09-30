# Integration skill

[Download the skill](/docs/skills/namepass-integration/SKILL.md) or give its URL to your agent.

## Install in a project

```bash
mkdir -p .agents/skills/namepass-integration
curl -fsSL 'https://beta.namepass.com/docs/skills/namepass-integration/SKILL.md' \
  -o .agents/skills/namepass-integration/SKILL.md
```

If your agent does not load project skills, ask it to read the file directly. The skill describes the same three steps as the quickstart and adds payment authorization, polling and duplicate-payment rules.

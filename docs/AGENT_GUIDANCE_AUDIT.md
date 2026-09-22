# Agent guidance audit — 2026-09-22

## Sources and scope

Read both requested official pages in full, using their Markdown versions:

- [Using GPT-6 Astra](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra)
- [Rethinking skills and prompts for GPT-6 Astra](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra)

The model guide covers autonomy, instruction sensitivity, writing, delegation, verification,
and API migration. The blog emphasizes selective skill loading, narrow triggers, minimal entry
points, contextual documentation, decision boundaries and completion. Those are related but
separate concerns; simply shortening answers would not address this repository's problems.

Reviewed the complete root instructions, instruction/skill inventory, local handover, CI,
package scripts, documentation headings and the relevant status/verification sections. This is
an instruction audit, not a fresh contract audit or a claim to have validated every historical
architecture paragraph. No production data or runtime behavior changes are part of this audit.

## Findings and changes

| Finding in this repository | Effect | Change |
| --- | --- | --- |
| `AGENTS.md` imports a 3,776-word `CLAUDE.md`, mixing workflow, subsystem detail and old milestones | Every task inherits unrelated details | Root reduced to 736 words; targeted technical constraints moved to a 741-word reference |
| Earlier root guidance required broad frontend/backend reading; those two references total 20,008 words | Small fixes can cause large context loads | Task-to-document map; select headings rather than reading the entire set |
| The 22,316-word decision log mixes dates and obsolete choices | Historical decisions can be mistaken for current instructions | Search it for a specific rationale; do not load it as startup context or use its order as proof of currency |
| Root claimed both real API data and that surrounding UI data was not real | Contradictory instructions undermine source selection | Removed obsolete demo-era claims; preserved public API and evidence boundaries |
| Contract docs said the factory was unchanged and the app still used the previous deployment | Could trigger another migration or wrong address selection | Corrected native Arc factory description; removed old hash from the active description; linked verified manifest |
| Architecture and frontend status still called the cutover pending/local | Could repeat completed deployment work | Current-state links replace stale status; original rollout checklist explicitly historical |
| Root and frontend repeated broad test instructions | Extra local suites and live checks without a relevant change | One scoped command map; focused regression tests; required CI retained |
| Ignored `.claude/HANDOVER.md` claimed no tests, no GitHub CLI, Polygon support and demo balances | A second contradictory instruction source existed outside the PR | Local handover replaced with current references; previous text saved temporarily outside the repo |
| That local handover also required approval for every push and PR | Extra approval pauses despite existing authorization | Removed obsolete local approval rule; kept branch, release and wallet boundaries |
| Root repeated detailed writing rules and fragile implementation counts | Context cost and maintenance drift | Kept the user's Simplified Technical English preference concisely; removed fixed test counts and incidental timings |

Critical constraints remain: ENS normalization, deterministic address inputs, contract execution
contexts, immutable payment boundaries, exact amounts, canonical evidence, flow identity,
versioned recovery, no invented balances, and full payment addresses. These are repository-specific
requirements, not generic encouragement to be careful.

## Recommendations considered but not applied blindly

- **Skills:** no repository `SKILL.md` files were found. The visible installed skills belong to
  the user's tooling. Do not create a new skill just to repeat this root guidance, or edit bundled
  plugins as part of a repository fix. Broad installed descriptions may merit a separate audit;
  their size alone does not prove they caused this session's usage.
- **Delegation:** parallel agents can help independent work, but add context and coordination.
  This bounded audit used one agent. No instruction was added to spawn agents on every task.
- **Autonomy and completion:** local authorized work should proceed; a requested full review must
  cover its stated scope. Permission for code edits still does not authorize arbitrary hosted
  resets, wallet signatures or production changes. The root now states both sides explicitly.
- **Writing:** preserve necessary evidence and user-requested depth. Short answers that leave the
  work incomplete are not a useful cost optimization.
- **API migration and new capabilities:** no OpenAI API integration was found in the inspected
  app/server/tooling surfaces or package dependencies. Model parameters, Responses tool support,
  async calling, steering, cache settings and reasoning updates are therefore not Namepass code
  changes. This PR does not change Codex's model, reasoning effort, pricing, cache or quota.
- **Runtime cost:** the Neon recovery cadence is a separate application efficiency problem.
  Reducing instruction context does not fix database compute consumption.

## Verification and remaining limits

For these documentation edits, check the diff, referenced paths and links, and preservation of
critical constraints. Do not repeat contract canaries or application tests for the documentation
changes. The existing monitoring-code change in this PR has its own regression and type checks.

The root word count fell by 80.5% relative to the previous PR revision. This measures instruction
size, not token savings or total cost per task. A better completion check is whether the next
small fix loads only its relevant references, runs relevant tests once, and reaches its authorized
end state without avoidable approval turns. Use actual session usage if available; do not invent
a savings percentage.

The large architecture and decision references remain. They contain historical material and are
now explicitly outside mandatory startup reading. Consolidate an affected section when future
work touches it; a wholesale rewrite is not required for this audit. Tool retries, oversized
outputs and repeated investigation also contributed to waste in this conversation and remain
execution problems that document edits alone cannot solve.

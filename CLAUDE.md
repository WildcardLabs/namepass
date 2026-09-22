# Repository guidance

Namepass turns USDC deposits at deterministic ENS-name addresses into renewal time.
The application uses Goldsky Turbo, Neon, Vercel Functions and Vercel Workflow.
Deployment status and remaining wallet steps belong in `docs/SYSTEM_CUTOVER_STATUS.md`.

## Working agreement

Carry the requested work through implementation and relevant verification. Routine read-only
inspection, local edits and disposable-fixture tests do not need repeated confirmation.
Use existing authorization; ask only when a missing decision changes the outcome or an action
falls outside it. User instructions take precedence over repository workflow preferences.
Wallet transactions require the user's signature. Do not infer permission to reset hosted data,
merge, or change production from permission to edit code.

Use a `codex/` branch. Commit and push changes there, never directly to `main`. Production
releases use the GitHub-connected PR flow: inspect remote main, complete required CI and
deployment checks, merge when authorized, then verify the deployed commit. A local production
deploy or alias promotion requires an explicit exception from the user.

Completion means the requested result is implemented, relevant checks pass, and any authorized
publication is handled. State remaining blockers precisely. For a review, give concrete findings
and recommendations; do not substitute a first impression for a requested full audit.

## Find the relevant context

Read the source and document sections needed for this task. These are references, not a startup
reading list. Search headings or symbols before opening a large file.

| Task | Reference |
| --- | --- |
| Product scope, wording | `PRODUCT.md` |
| Frontend state, components, data boundaries | `docs/FRONTEND.md` |
| Backend flows, schema, service boundaries | Relevant section of `docs/ARCHITECTURE.md` |
| Payment, pricing, concurrency or contract constraints | Relevant section of `docs/ENGINEERING_CONSTRAINTS.md` |
| Contract design | `docs/CONTRACTS_V2.md` |
| Deployment or migration | Current handoff in `docs/SYSTEM_CUTOVER_STATUS.md`; referenced manifest/evidence |
| Address history | `docs/DEPLOYMENTS.md` |
| Rainbow deployment console | `tools/deployment-console/README.md` |
| Monitoring metrics | `docs/MONITORING.md` |
| Rationale for a specific past choice | Search `docs/DECISIONS.md` by topic/date |

Dated plans and historical notes are not instructions to repeat completed work. Use current code
for implementation facts and dated receipts/manifests for deployment facts. Update the document
that owns a changed fact; add decision history only for a durable tradeoff. Do not copy status
into every document or grow this file into an implementation diary.

## Verification

Choose checks for the behavior changed. Use a focused regression when it can catch the defect;
do not add tests that merely restate a cosmetic edit. Expand checks for affected boundaries or
unresolved failures. After relevant checks pass, finish the task rather than repeat them.
Documentation-only edits need link/content and diff checks, not wallet transactions or app builds.
Preserve CI; its required full suite is defined in `.github/workflows/ci.yml`.

| Change | Applicable checks |
| --- | --- |
| Frontend logic | `npm run test:frontend`; `npx tsc --noEmit` |
| Server logic | `node --import tsx --test server/<file>.test.ts`; `npm run check:server` |
| Transaction/workflow logic | `npm run test:transactions`; `npm run test:workflow` |
| Build/routing integration | `npm run build` |
| Chain registry | `node scripts/check-chains.mjs` |
| Generated Goldsky definition | `node goldsky/generate-testnet.mjs --check` |
| Solidity | Relevant Foundry tests; full `forge test` for pricing, settlement or CCTP parser changes |

These are options by scope, not a checklist for every task. There is no lint script or `npm test`
alias. `npm run build` does not compile Solidity. Read-only fork tests require explicit RPC
configuration. Live canaries are separate from local tests: reuse completed evidence unless a
changed contract, route or unresolved failure makes it insufficient.

## Essential boundaries

- `src/lib/chains.ts` owns chain configuration. Normalize ENS labels through `namepass.ts` before
  address derivation. Show payment addresses in full.
- Use public API adapters in components. Do not invent prices, balances, events or transaction
  evidence. Keep USDC arithmetic exact and pending funds separate from completed renewals.
- Backend routes belong in `routes/api/`. Do not add a root `api/` tree or catch-all Vercel rewrite.
- Use `goldsky turbo` for the Turbo pipeline. Do not add background health RPC polling.
- Keep credentials out of output, git and PRs. Preserve contract compiler settings and payment
  trust boundaries; see the targeted engineering reference before changing them.

Use ASD-STE100-style technical English: short, direct sentences, consistent terms and exact code
identifiers. Preserve necessary detail and approved product copy. Report what changed, the
relevant evidence, and remaining work without a tool-by-tool transcript.

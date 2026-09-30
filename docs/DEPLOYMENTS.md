# Testnet deployments

## Current release — 2026-09-22

The replacement contracts and hosted testnet services are deployed. The application uses the
addresses below. The September 22 cutover cleared the previous application's data; old deposit
addresses are not part of the current release.

| Contract | Address | Network |
| --- | --- | --- |
| Factory | `0x2dCB5CA6b21372b43e37C35Da8D5D15160423150` | All four testnets |
| Gateway | `0x39351C9f9eAb6093eFB4e865a6330ECd2a756F0f` | Ethereum Sepolia |
| Helper pointer | `0x774f942194d612e126A05Ce40a3A4D88AfBB6ae6` | Ethereum Sepolia |
| Initial helper | `0x7Bfee7c257ff48f8D787A61F15925e24743C8F88` | Ethereum Sepolia |
| Test timelock | `0x996cbd179f361B1043Ad1999864eD41496C633c8` | Ethereum Sepolia |

The test timelock is wallet-controlled with a 60-second delay. It is not the ENS DAO timelock.
The active helper can change through the pointer; read `currentHelper()` for live selection.

| Network | Chain ID | Factory deployment block |
| --- | --- | --- |
| Ethereum Sepolia | 11155111 | 11754050 |
| Base Sepolia | 84532 | 47132212 |
| Arbitrum Sepolia | 421614 | 311365500 |
| Arc Testnet | 5042002 | 63326249 |

Token addresses, Circle domains, RPC configuration names and explorer links are maintained in
[`src/lib/chains.ts`](../src/lib/chains.ts). Exact deployment parameters and hashes are in the
[manifest](deployments/2026-09-22/manifest.json).

## Verification evidence

| Record | What it establishes |
| --- | --- |
| [Deployment verification](deployments/2026-09-22/verification.json) | Replacement transaction receipts, runtime and configuration checks |
| [Source verification](deployments/2026-09-22/source-verification.json) | Published source and deployed bytecode matches |
| [Canary inputs](deployments/2026-09-22/canaries.json) and [verification](deployments/2026-09-22/canary-verification.json) | Direct Sepolia renewal and two native Arc deposit/claim rounds, including funding after wallet deployment |
| [Application preflight](deployments/2026-09-22/system-preflight.json) | Helper compatibility, address derivation and receipt enrichment |
| [Indexed cutover results](deployments/2026-09-22/system-cutover.json) | Three renewals projected into the replacement application |

These records are point-in-time evidence, not a security audit. A fresh automated deposit on
every source chain was not repeated after the reset. Older evidence must not be presented as a
new-generation live test.

## Resolver and mainnet limits

The replacement `namepass.eth` wildcard resolver is live, and its subnames appear in Name View.
This September 22 release record does not contain its mainnet deployment and parent-record
transaction receipts. The configured testing use case resolves to testnet deposit addresses even
though the parent ENS record is on Ethereum mainnet. That does not enable mainnet USDC funding or
mainnet renewal contracts.

No audited mainnet protocol release is recorded. Ethereum, Base, Arbitrum, and Arc are planned for
the initial mainnet release; none has a recorded Namepass mainnet deployment. Requirements are in
[RUNBOOK.md](RUNBOOK.md#mainnet-release-requirements).

## Beta recovery — 2026-09-30

`beta.namepass.com` was restored with Vercel Instant Rollback to production deployment
`dpl_AW7ffYsDGvEzSuE2AvsxyMLg48Jy`, commit
`e5b0704e3967bf30a12fa10b5950f8cc057083d3` (September 28, 18:26 London).
The live activity endpoint returned HTTP 200 after rollback. No beta database migration or
credential change was made. The rollback paused Vercel production domain auto-assignment.
Restore it only after verifying and promoting the reviewed recovery deployment.

PR #116 deployed shared ORM fields `chain_events.evidence_kind` and `deposits.transfer_kind`
while beta had only migrations `0000`–`0008`. Explorer reads and Goldsky writes depended on
these fields even with the integration feature disabled. PostgreSQL rejected the explorer query
with error `42703` (`chain_events.evidence_kind` does not exist).

The [recovery release](https://github.com/wildcardlabs/namepass/pull/118) restores the pre-integration backend and removes migration `0009`, the
unreleased `/api/v1` routes and their evidence worker. It preserves the documentation design,
marks the API contract as unreleased, and tests real explorer queries and Goldsky writes against
the deployed `0008` schema.

## Integration release gate

The public integration API remains unreleased until mainnet launch. Its planned base URL is
`https://namepass.com/api/v1`; public docs, agent resources and examples use `namepass.com`.
Integration development is retained on
`codex/integration-rollout` and draft [PR #117](https://github.com/wildcardlabs/namepass/pull/117).
Documentation and OpenAPI describe the planned contract; they are not evidence of availability.

Before resuming the API rollout, require:

- Core explorer, name history and Goldsky ingestion checks on the currently deployed schema,
  with the integration disabled. A feature flag must not add schema dependencies to core paths.
- An isolated hosted environment with separate database, RPC and relayer configuration. Its
  writers must not target beta. Schema changes need a reviewed migration and rollback plan.
- Address activation, quotes, source-transaction polling and name history on the hosted preview,
  including anonymous limits and measured latency.
- A fresh direct renewal and CCTP renewal that reach `complete`, with indexed evidence and
  receipt-confirmed ENS expiry. Historical receipt replay does not establish fresh flow readiness.

The original 1 USDC Sepolia deposit
`0x2d0353ea98ae0debd85bd7854fb2f7daef03d4479c07d516c5cad90e1b594958`
was ingested and renewed after rollback. Beta's explorer and name history agree on flow
`ee8dc126-d340-4afb-a2ae-447c306f44ea`, 0.90 USDC applied and 3,547,790 seconds added.
The successful canonical renewal receipt is
`0xd74aefa074c58a218117dd77730b3f75b0915edc8ee1738e46db3f3d7cb35409`,
block `11815826`. Its exact ENS receipt records expiry `2029-09-22T10:16:06.000Z`.
The hub finalized block had not reached that receipt at verification time. This confirms beta
renewal recovery, not completion through the unreleased public integration API. Do not request
a duplicate deposit. See the [recovery verification](deployments/2026-09-30-beta-recovery.json).
Mainnet funding remains disabled.

## Historical evidence

The [September 18 manifest](deployments/2026-09-18/manifest.json) and accompanying receipts are
retained for contract provenance and test fixtures. That factory is superseded: it rejected native
Arc funding after wallet deployment. Its helper-replacement rehearsal and canaries apply to that
older generation. Do not derive current deposit addresses from it.

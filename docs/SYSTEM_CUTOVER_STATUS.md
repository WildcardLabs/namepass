# System cutover status — 2026-09-22

## Current handoff

The September 22 testnet service cutover is live at https://demo-five-gray-37.vercel.app.
Deployment that performed the cutover: `namepass-v2-bi7eu2rhr-wildcard-labs.vercel.app`.
Later Git deployments can supersede it; this identifier is cutover evidence, not a live alias lookup.

- Neon access was restored. All ten application/watch tables were cleared on testnet branch
  `br-noisy-bird-avey45an`; schemas, roles and migrations remain. See `reset.json`.
- Before reset, Workflow listed zero running and zero pending runs. All 222 old transaction
  intents were terminal (221 confirmed, one reverted). No transaction needed rebroadcast.
- The application DB password and webhook authorization were rotated. Old deployments cannot
  authenticate with the database password. New secret values are stored in Vercel/Goldsky.
- Maintenance deployment blocked API requests and hid funding during cutover. The final build
  enables the migrated app. The every-minute recovery cadence is unchanged at the user's request;
  compute efficiency is separate follow-up work.
- Goldsky **Turbo** pipeline `namepass-testnet-v2` is active. The older `pipeline list` command
  queried a different service and did not show the old Turbo pipeline. The old Turbo pipeline was
  paused and deleted with its state. Credential rotation and maintenance preceded the reset;
  the Turbo pause followed it. The final database check contains only new contract events.
- New steve activation returned `0x5B7516768eD0b04E212041265BB1f11af71841d7`. The pipeline
  indexed all three verified renewals, three burns/renewal deposits, two wallet deployments and
  two claims. The new DB has three settled flows and two cancelled reconciliation rows. See
  `system-cutover.json`. These are new-generation events, not copied old application records.
- All seven replacement source verifications match. Existing wallet canaries, application build,
  server types, frontend/server/database tests and real receipt enrichment passed. Do not repeat
  the completed wallet tests. A fresh automated deposit workflow on each source chain has not
  been re-tested after this reset; the indexed evidence is from the supplied canary transactions.
- Main through `ba77888381f7ece611964655cdfaddedd4279497` is incorporated, including PR #74.

Remaining user-signed step: deploy the replacement mainnet wildcard resolver using the console,
then use its new `Review namepass.eth resolver update in Rainbow` button. Export resolver evidence.
Both steps use real mainnet gas. Only the user signs. The parent resolver is unchanged so far.
Afterward, verify standard ENS/CCIP resolution and publish the resolver source.

## Historical implementation notes (superseded by the handoff above)

The application migration is local. No hosted service has switched. No database reset has run.
The resolver source has changed, but the replacement resolver is not deployed.

### Implemented locally

- The shared registry uses the new factory, fixed gateway, pointer, and deployment blocks.
- Wallet renewal and CCTP transaction builders and receipt filters use the fixed gateway.
- Each ENS state read discovers the active helper through the pointer. Discovery checks the
  pointer/gateway binding, interface version, factory, and payment token at one block.
- The server reads expiry and eligibility through `nameState`. The current database still uses
  the registrar/V1 classification, so the server also reads immutable ENS V2 metadata. An adapter
  that removes these metadata getters needs an application/schema change before activation.
- Pricing discovers the helper and renewers at one block. The browser verifies a compiled-code
  fingerprint with immutable slots masked. New addresses with the same algorithm are supported.
  Unknown code stops pricing. Do not treat `interfaceVersion() == 1` as proof of pricing math.
- Pricing reloads on initial load, name selection, and window focus. These are explicit reads.
  No scheduled RPC polling was added. The UI still shows a snapshot; it is not a binding quote.
- Receipt validation obtains the helper from the fixed gateway's `HelperUsed` event. It reads
  that helper's metadata at the receipt block, even if the pointer changed later in the block.
- The generated pipeline is `namepass-testnet-v2`. Its source identifiers are new. Protocol log
  filters start at the new factory deployment blocks. USDC sources start at pipeline creation.
- Goldsky indexes gateway events. It no longer needs an ENS-emitter list or ENS-referrer filter.
  A canonical `Renewed` webhook loads the exact receipt and validates every settlement field.
  It separates multiple renewals in one transaction by gateway log index, then reads the ENS
  expiry from that segment. It stores expiry on the canonical renewal fact. Public activity reads
  that fact without a transaction-wide ENS-event join.
- A webhook with unavailable receipt evidence fails and retries. It must not invent an expiry.
  Deleted renewals do not require RPC and remove their expiry from the canonical projection.
- Resolver callbacks derive the new deposit addresses. Independent CREATE2 vectors cover this.

### Remaining work before reset

1. Complete the live historical-receipt check in `tools/verify-system-migration.ts`.
   Current-state reads for steve and vitalik and the active helper fingerprint pass on PublicNode.
   PublicNode returns the recorded canonical block and includes the saved helper-B claim hash,
   but returns null for its transaction receipt and block receipts, and no gateway logs for that
   block. This does not invalidate the earlier saved verification. It blocks a fresh check of the
   new receipt-enrichment path. The dRPC public endpoint reports that Sepolia requires a paid plan.
   The testnet-maintainer-listed `rpc.sepolia.org` endpoint returns HTTP 404.
2. Review and test the new event-driven receipt enrichment against a historical-capable RPC.
   Current enrichment supports the deployed ENS `NameRenewed` ABI. A future adapter with another
   receipt ABI needs a reviewed decoder. Stable gateway execution alone does not prove that a new
   adapter is compatible with the price simulator or all read models.
3. Complete the replacement-resolver deployment through the new Rainbow panel and verify the
   exported evidence. The separate artifact preserves existing manifests. Mainnet preparation
   and simulation passed for resolver `0x896cDD71c0A7FAb0c497A2A97c9043540AFB99AF`.
   The ENS resolver-update transaction must wait for the backend cutover.
4. Prepare and verify the service maintenance gates and old Workflow cancellation procedure.
   Stop all writers and reconcile broadcast transactions before truncating data.
5. Follow `TESTNET_RESET.md` on the testnet Neon branch only. Rotate webhook credentials, deploy
   the new services and pipeline, then prove new database-backed end-to-end canaries.
6. Enable normal funding and activation only after the cutover checks pass.

### Local checks

Application and deployment-console builds, server type checking, frontend tests, server tests,
Workflow tests, Foundry tests, registry checks, and generated-pipeline checks passed during this
change. Re-run affected checks after any further edits. No commit or push was made.

### Mainnet ENS decision and related review

The user confirmed that the mainnet resolver should expose the testnet deposit addresses during
this testing period. Mainnet `namepass.eth` is owned by the deployment wallet. Its current resolver
is `0xF29100983E058B709F3D539b0c765937B804AC15`; its apex address is
`0xf80E70eBC4184850f9fBCDC8De7CB4C86C46abF6`. The new console panel preserves the apex address and
supported text records. It prepares and verifies a mainnet resolver deployment. It does not send
the ENS resolver-update transaction before the backend cutover. The resolver artifact is separate
from the original manifest fingerprint.

Issues 70 and 71 and PR 74 were reviewed at the user's request. See `PR74_REVIEW.md`. No GitHub
write action was taken. Carry the rejection-evidence requirement and adapted expiry-reorg tests
into the cutover gates.

### Arc correction — 2026-09-22

Issue #69 blocks cutover. The September 18 factory does not accept native Arc deposits after
wallet deployment. Source now accepts empty native calls only through wallets on Arc testnet,
with Sepolia as the hub. Direct factory deposits, other networks, unknown calldata, and
unauthorized execution remain rejected. Foundry covers two deposits around actual proxy
creation and two mocked burns. Arc native/ERC20 balance mapping requires the live checks.

`deployments/2026-09-22/replacement-plan.json` is an unsigned plan, not deployment evidence.
It reuses the existing timelock and replaces all four factories, the pointer, gateway, and
helper. Predicted factory: `0x2dCB5CA6b21372b43e37C35Da8D5D15160423150`.
The console uses separate storage for this build and preserves the old progress. Import the
replacement plan, verify on-chain state, and sign the remaining steps through Rainbow.
Arc canaries now send native USDC and require two rounds per name. Receipt checks verify the
ERC20 balance increase and whether the wallet existed before funding. Goldsky observation and
system renewal remain cutover gates. Do not publish the new addresses until the deployment,
client registry, backend and watched addresses agree. The application registry still refers to
the September 18 deployment; update it from verified replacement receipts, including blocks.
The resolver source now targets the replacement factory. Do not deploy it before this plan passes.
PR #74 merged as ba77888381f7ece611964655cdfaddedd4279497; migration integration is still pending.

Replacement deployment verification completed from the user's exported manifest. All 13 new
transaction receipts, inputs, canonical blocks, and all 14 current step states passed. The reused
timelock passed exact runtime and configuration checks; its old receipt was unavailable from
PublicNode and was not rechecked. Evidence: `deployments/2026-09-22/manifest.json` and
`deployments/2026-09-22/verification.json`. Live renewal canaries, source publication for this
replacement set, registry/service cutover, and Goldsky native-deposit checks remain pending.

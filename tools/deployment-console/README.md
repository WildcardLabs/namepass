# Temporary testnet deployment console

Run `npm run deploy:ui` from the repository root. Open http://127.0.0.1:4177 in the
browser that has the Rainbow extension. Keep this terminal running. This console is
separate from the public application. It does not require a private key or API secret.

## Deployment sequence

1. Connect Rainbow. Use the same account for all four chains. Fund it with test gas:
   ETH on Sepolia, Base Sepolia, and Arbitrum Sepolia; USDC on Arc Testnet.
2. Review the residue recipient, referrer, deployment label, and test timelock delay.
   Lock the plan. The default delay is 60 seconds.
3. Deploy the Sepolia factory, test timelock, pointer, gateway, and immutable helper.
4. Schedule helper activation through the timelock.
5. Deploy the same factory on the three source chains while the delay runs.
6. Refresh status after the delay. Execute helper activation.
7. Initialize each factory. The gateway is the fixed renewal target.
8. Export the deployment manifest. Download Standard JSON inputs and constructor
   arguments from the verification section. Verify all contracts on their explorers.

Each transaction requires a separate wallet signature. The console checks the account,
network, dependencies, runtime bytecode, and fixed configuration. It simulates the
transaction before opening the review dialog and again before requesting a signature.
Progress persists in this browser. Export the manifest before changing browsers.
Import restores the plan; chain reads determine completion. Check a pending receipt
before submitting another transaction. Do not change the build during deployment.

The connected account controls the **test** timelock. This is not ENS DAO governance.
Mainnet requires the actual ENS governance executor and a separate deployment plan.

The console does not clear databases, stop workflows, or update the public application.
After explorer verification, run renewal and CCTP canaries. Then follow
`docs/TESTNET_RESET.md` and `docs/CONTRACTS_OVERHAUL_PLAN.md` for the complete reset
and system cutover. The resolver also requires the new factory before cutover.

## Live renewal tests

The console now includes section 04 for `steve.eth` and `vitalik.eth`. The first uses
the new registrar; the second uses the V1 adapter. Refresh the page in the same Rainbow
browser, connect the deployment wallet, and click **Verify on-chain state**.

Select a name and funding chain. Check its balance. Review a 1 test-USDC deposit,
then review the renewal. On source chains, the renewal burns through Circle. Wait for
the attestation, then review the Sepolia claim. Do not repeat a burn while waiting.
Run both names on all four chains. On Arc, use native deposits and complete round 2 after round 1. This uses 10 test USDC plus gas across ten tests.

Each step has a separate review and wallet signature. The panel checks exact CCTP
route and message identity, renewal accounting, expiry growth, and cleared allowances.
Progress stays in this browser. Keep the page open if storage fails. Check any pending
receipt before continuing. Export `namepass-canaries.json` after the tests. The panel
does not yet test a helper replacement during an in-flight transfer; that remains a
separate gate in the overhaul plan. No live canary result is implied by local tests.

If a completed source burn is missing from browser progress, select its name and source
chain. Expand **Recover a missing source burn**, enter its hash, and click
**Verify & restore burn**. This checks the sender, factory call, canonical receipt,
deposit event, and Circle message. It only restores local progress. Then review the
claim for that existing burn. Never fund or burn again to recover a missing record.

## Helper replacement during a transfer

Section 05 rehearses the final contract gate with `steve.eth`, Arc, and 1 test USDC.
It deploys helper B with the same code and immutable settings as A, using a distinct salt.
The planned B address for the saved deployment is
`0xFF4F3a9a416a51b8A2b601F5e17c94635b5aaCf4`.

1. Connect Rainbow and click **Check rehearsal state / receipts**.
2. Deploy helper B. Click **Publish helper B source to Sourcify**, then check its status.
3. Schedule B through the existing timelock.
4. Fund the Arc deposit wallet with 1 test USDC.
5. Burn on Arc while A is still selected.
6. After the timelock delay, activate B.
7. Wait for Circle and claim the same transfer through the fixed Sepolia gateway.
8. Schedule restoration of A. After the second delay, execute restoration.
9. Export `namepass-helper-rehearsal.json`.

There are eight wallet transactions. The source publication is a separate HTTP request.
Use section 05 until restoration is complete: the original deployment and canary checks
expect A and will report the temporary B selection as a configuration change.
The rehearsal checks canonical receipts, exact calldata, pointer events, burn-before-switch
timing, claim-after-switch timing, helper B use, CCTP message identity, expiry growth,
accounting, and restoration after the claim. Both factory and gateway remain fixed.
Use receipt recovery if a mined transaction is missing from local progress. Import merges
saved evidence and rechecks it against the chain. No rehearsal transaction is automatic.

This proves replacement routing with identical compatible helper code. It does not establish
compatibility with a future ENS release. That release will need its own adapter and tests.
After the wallet steps, independently verify the export with:

```bash
npx tsx tools/deployment-console/verify-upgrade.ts docs/deployments/2026-09-18/manifest.json /path/to/namepass-helper-rehearsal.json /tmp/namepass-upgrade-check.json
```

## Checks and source verification

- `npm run deploy:ui:build`: regenerate artifacts, check types, and build the console.
- `npm run test:deploy-ui`: check manifests, wallet guards, compiler reproduction,
  and all 14 transactions on four local Anvil chains. Requires Foundry and solc 0.8.24.
  Set `NAMEPASS_SOLC` if the compiler is outside the usual SVM directories.

Serve with `deploy:ui`, not a static file server: RPC routes use the Vite development
proxy. Generated artifacts contain only public contract sources and bytecode.
The test chain suite uses dummy external-contract code; live ENS behavior is covered
separately by the opt-in Foundry fork tests. No browser test signs with a real wallet.

`verify.ts MANIFEST REPORT` checks the deployed state and transaction receipts through
read-only RPC calls. `verify-source.mjs MANIFEST REPORT status` checks Sourcify results.
Its `submit` mode publishes Solidity source and compiler settings to Sourcify; use it
only with explicit publication authorization. The user approved the 2026-09-18 set.

## Mainnet wildcard resolver for this test period

The user approved serving the new testnet deposit addresses from `namepass.eth` on Ethereum
mainnet. The resolver panel deploys only the resolver and uses real mainnet gas through Rainbow.
It reads the current ENS owner, apex address, and supported text records before preparing the
transaction. It checks the singleton runtime, exact deployed resolver runtime, stored strings,
and steve/vitalik callback addresses. Its separate artifact leaves completed testnet manifests
valid. Export `namepass-resolver.json` after verification.

This panel does not update the parent ENS resolver record. That update must follow the service
cutover. The mainnet deployment does not enable mainnet renewals or mainnet USDC funding.

## Final ENS update after the September 22 cutover

The backend is live on the replacement deployment. Prepare and deploy the mainnet resolver,
then click **Review namepass.eth resolver update in Rainbow**. This sends `setResolver` to the
ENS registry only after checking ownership, exact resolver code, configuration, and derivation.
Each transaction is signed by the user. Export the resolver evidence after both steps.

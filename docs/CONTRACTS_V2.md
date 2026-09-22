# Contract replacement implementation

Status: deployed and initialized on testnet on 2026-09-18. Runtime, receipts, and configuration
checks passed; see `DEPLOYMENTS.md`. All eight direct/CCTP canaries passed on 2026-09-19. The in-flight helper replacement rehearsal also passed; helper A is restored. Not externally audited. The application
still targets the previous deployment. Do not replace its addresses until the new contracts have
completed the deployment gates in `CONTRACTS_OVERHAUL_PLAN.md`.

## Contract boundary

`NamepassFactory` is unchanged. Its creation-code hash remains
`0x810529be6f75680bc17e9770c73c070b0585056518868b722be84f6ed600f476`.
Deploy it with a new salt on each chain. Initialize its fixed `l1Helper` value to the new gateway.
Its wallet interface, source-chain CCTP encoding, token addresses, and initialization rules remain
unchanged. New factory addresses produce new deposit addresses.

`RenewalHelperPointer` stores the active helper. Its constructor fixes the factory and payment
token. Only the governance executor can activate a helper. The executor must be an ENS Timelock
on mainnet. The code check is only a configuration check; it cannot prove DAO control. Use an
explicit test timelock on Sepolia.

On first activation, the pointer binds permanently to the helper's gateway. It verifies that
the gateway points back to this pointer and uses the same factory and token. Later helpers must
use that gateway. Each helper must report interface version 1 and the same factory and token.
`HelperUpdated` includes the previous helper, new helper, and new runtime code hash. Executor
handover requires nomination by the current executor and acceptance by the successor. The current
executor can cancel a pending handover. There is no Namepass bypass or immediate rollback role.

`NamepassL1Gateway` fixes its pointer, factory, USDC, Circle MessageTransmitter, Circle
TokenMessenger, and residue recipient at construction. It deploys only on Ethereum or Sepolia.
It has no owner. Its public payment entrypoints remain `renewFromWallet` and `completeCCTP`.
Both have a reentrancy guard. Each call snapshots the selected helper before funds arrive.

The gateway authenticates each payment and approves only its renewal budget to that helper. It
checks the actual token balance change against the returned charge. It clears the allowance.
It pays the original executor `100_000` USDC base units after successful settlement. Rounding
residue increments `earnedResidue`. Anyone can call `withdrawDust()` to send only that recorded
amount to the fixed residue recipient. Direct donations do not become withdrawable residue.

For CCTP, the gateway verifies message and burn-body version 1, Ethereum destination domain 0,
a non-Ethereum source domain, Circle TokenMessenger as recipient, and itself as destination
caller and mint recipient. It rejects a noncanonical source-wallet encoding. The label must be
nonempty, at most 255 bytes, and contain no dot. The factory binds the label to its wallet.
Circle authenticates the attestation, remote route, token mapping, and nonce. The gateway verifies
that the observed mint equals the authenticated burn amount minus the executed Circle fee.

`ENSV2RenewalHelper` fixes its gateway, factory, USDC, registrar, V1 renewer, and referrer at
construction. It has no owner, ENS setters, CCTP entrypoint, fee setting, or sweep. Only the gateway
can call `execute`. It pulls the supplied budget, checks the received amount, selects the ENS
renewer, computes the duration, checks ENS's forward quote, and uses the new `RenewData` ABI.
It verifies the actual charge, clears the ENS allowance, and returns unused budget to the gateway.
Any pre-existing helper balance stays outside settlement.

The stable helper interface exposes `quote`, `renewableBy`, and `nameState` for read operations.
`nameState` returns expiry and the selected renewer. If neither renewer accepts the label, it
returns zero as renewer and reads expiry from the registrar's registry. Registry-specific expiry
calls therefore remain inside replaceable code. The concrete helper also exposes its immutable
ENS addresses and referrer. The oracle is still read from the selected ENS contract on each quote.

The gateway emits `CCTPClaimed` before ENS executes and `Renewed` after settlement. `HelperUsed`
identifies the adapter immediately before `Renewed`. Existing settlement event signatures remain
unchanged. Event emitters move from the old helper to the new gateway. Failed settlement reverts
all events and the mint. Circle can then accept the same message on retry.

## Verified ENS compatibility

The supplied registrar and V1 renewer both use the tuple renewal ABI. Both point to oracle
`0x9B0b9C65BDAf9794Ff7697E4dCFb1f50581072BB`. At the inspected deployment, that oracle supports
Sepolia USDC with ratio `(1, 1000000)`. The registry used in the fork is
`0x657eA849311d3D5823348ddEd7C2AaAFb3EDE09E`.

The published oracle source differs from the vendored pricing implementation in its compiler
pragma, StringUtils import path, and interface documentation. Its pricing function bodies are
unchanged. The deployed source pins Solidity 0.8.25. Keep the vendored 0.8.24-compatible fixture
for deterministic pricing tests and use the deployed oracle in fork tests. Do not change the
factory compiler to compile the new ENS source.

The V1 path also runs the new renewer's real wrapper synchronization on the fork. It is not a
mock of the new renewal selector alone.

Run deterministic tests:

```sh
forge build
forge test
```

Run the opt-in, read-only deployment tests:

```sh
NAMEPASS_FORK_RPC=https://ethereum-sepolia-rpc.publicnode.com \
  forge test --match-contract SepoliaForkTest -vv
```

The fork block is `11730389`. Tests create a native V2 registration locally and renew the live
premigrated `vitalik` reservation. They check expiry growth, exact charges, fee payment, residue,
and cleared allowances through the real factory-wallet-gateway-helper path. They set the test
execution EVM to Cancun because deployed ENS uses Cancun opcodes. The compilation target stays
Shanghai. No test broadcasts a transaction. Without the RPC variable, these two tests are marked
skipped rather than reported as deployment verification.

## Remaining release gates

- Review the new fund and governance boundaries. Interface checks and accounting do not prove that
  arbitrary governance-selected code renews a name. ENS governance controls replacement logic.
- Verify the exact timelock, residue recipient, referrer, and new factory salt before deployment.
- Deploy and verify the new set. Exercise a real delayed pointer change.
- Run actual CCTP burns and claims from every supported source chain. The current local CCTP tests
  use a mock transmitter. They prove parser, accounting, retry, replay, and helper-change behavior;
  they are not evidence of a new live Circle route.
- Execute the clean data reset only with old services stopped and the replacement system ready.
- Update application discovery, pricing, receipts, indexing, and address publication afterward.

Source contracts and local tests are a contract milestone. They do not mean that deployment,
testnet reset, application cutover, or a security audit is complete.

# Deployments

## Replacement testnet set — 2026-09-18

All 14 deployment, activation, and initialization transactions were independently checked on
2026-09-18. Canonical successful receipts, transaction sender and calldata, exact runtime
bytecode including immutable values, governance configuration, factory routes, and deposit
derivation match the saved plan. The application still uses the previous set below.

| Contract | Address |
|---|---|
| Factory — all four testnets | `0xfe41CCe685c6F2317B387FBFbe2132073181626d` |
| Sepolia test timelock | `0x996cbd179f361B1043Ad1999864eD41496C633c8` |
| Sepolia helper pointer | `0x59200a0f65D11A25A9CC2322CB63F3bBCd27156A` |
| Sepolia L1 gateway | `0x3ef9C6B1b8023AcBe13173A187F78eaA14C2b0f6` |
| Sepolia immutable helper | `0x24A88f2Cb4B1dd833e0745C1A71209B6b077bc40` |

The test timelock delay is **60 seconds**. The deployment wallet
`0x1208a26FAa0F4AC65B42098419EB4dAA5e580AC6` has proposer, executor, and canceller roles.
The timelock administers itself. This is not ENS DAO governance. The helper is active and the
pointer is permanently bound to the gateway. All four factories are initialized.

| Chain | Factory deployment block | Initialization block |
|---|---:|---:|
| Sepolia | 11732565 | 11732628 |
| Base Sepolia | 46994775 | 46995127 |
| Arbitrum Sepolia | 310278371 | 310281137 |
| Arc Testnet | 62789380 | 62789899 |

Evidence: [wallet manifest](deployments/2026-09-18/manifest.json) and
[independent chain checks](deployments/2026-09-18/verification.json).
Repeat the read-only checks with:

```bash
npx tsx tools/deployment-console/verify.ts docs/deployments/2026-09-18/manifest.json /tmp/namepass-verification.json
```

All eight deployments have matching creation and runtime bytecode verified on Sourcify.
See [source verification results](deployments/2026-09-18/source-verification.json) and
[the helper source](https://repo.sourcify.dev/11155111/0x24A88f2Cb4B1dd833e0745C1A71209B6b077bc40).
Sourcify's automatic Etherscan forwarding hit rate/daily limits, and Arc explorer forwarding
returned an error. Do not infer Etherscan or Arc explorer badges from the Sourcify result.
### Live canary results — 2026-09-19

Independent RPC checks verified all 22 transactions in the completed canary export.
All eight name-and-chain tests are complete. Both ENS paths work directly on Sepolia
and through CCTP from Base Sepolia, Arbitrum Sepolia, and Arc Testnet.
Every completed renewal applied 0.9 test USDC, paid the 0.1 USDC executor allowance,
left zero residue, added 3,547,790 seconds, and cleared the checked allowances.
All eight deposit balances are zero. The six claims are bound to their exact source burns.

| Name | Sepolia | Base Sepolia | Arbitrum Sepolia | Arc Testnet |
|---|---|---|---|---|
| `steve.eth` | Complete | Complete | Complete | Complete |
| `vitalik.eth` | Complete | Complete | Complete | Complete |

The first export omitted the `vitalik.eth` Arc burn. It was recovered from the factory event
at Arc block 62828380, transaction
`0x8ed795443a251a76d9f5ce774fe1fbfac172d2e0ab095dbcf17d1365eb5cf4ca`.
The user restored that receipt and completed the existing transfer with Sepolia claim
`0x98ac0d31f178f76b2e844a07aa3410350fc9d9617ac4e6ecc48a45d564db52a4`.
No second funding or burn was needed.

Evidence: [completed export](deployments/2026-09-18/canaries-complete.json) and
[independent completed-set checks](deployments/2026-09-18/canary-verification-complete.json).
The original export and recovery report remain in the same directory as historical evidence.
### In-flight helper replacement — passed 2026-09-19

All eight rehearsal transactions passed independent receipt and state checks. Helper B
`0xFF4F3a9a416a51b8A2b601F5e17c94635b5aaCf4` has the same reviewed code and immutable
settings as A, with a distinct CREATE2 address. Its source is verified on Sourcify.

| Step | Chain | Block |
|---|---|---:|
| Deploy B | Sepolia | 11737171 |
| Schedule B | Sepolia | 11737176 |
| Fund `steve.eth` | Arc | 62901811 |
| Burn with A active | Arc | 62902154 |
| Activate B | Sepolia | 11737256 |
| Claim through B | Sepolia | 11737261 |
| Schedule A | Sepolia | 11737266 |
| Restore A | Sepolia | 11737287 |

The source burn preceded activation. The claim followed activation and emitted `HelperUsed`
for B. The exact attested message matched the Arc burn. The renewal applied 0.9 test USDC,
paid 0.1 USDC to the executor, left zero residue, cleared allowances, and extended expiry
by 3,547,790 seconds. Restoration followed the claim. The pointer currently selects A:
`0x24A88f2Cb4B1dd833e0745C1A71209B6b077bc40`. The factory, gateway, and deposit addresses
remain unchanged. This proves replacement routing, not compatibility with an untested future
ENS release.

Evidence: [rehearsal export](deployments/2026-09-18/helper-rehearsal.json),
[independent verification](deployments/2026-09-18/helper-rehearsal-verification.json), and
[helper B source verification](deployments/2026-09-18/helper-b-source-verification.json).

The resolver, application, and services have not switched. No data reset has run.
Follow `CONTRACTS_OVERHAUL_PLAN.md` for the remaining gates.

## Previous deployment — still used by the application

Live contract addresses. Every value here was read back off the chain rather than copied from a
deployment script.

**Testnet only. Not audited.** Everything below belongs to one testnet set with a Sepolia hub. 61
Foundry tests cover the contracts, and several review passes examined them. **No external audit has
been done.** The words "proven on chain" in this file mean only what the listed transaction hashes
show.

**There is no mainnet deployment.** `hubChainId` is part of the factory's creation code, so a
mainnet set produces a different factory address and therefore a different deposit address for
every name. The two sets are permanently separate, and the factory only accepts `1` or `11155111`.

---

## Testnet set — Sepolia hub

Deployed 2026-08-10 from commit `a3affde`.

### Factory

Same address on all four chains, deployed through the Safe Singleton Factory at
`0x914d7Fec6aaC8cd542e72Bca78B30650d45643d7`.

```
0xe0b155Fdb1104824d7E0568aeAFCC52823EDD00F
```

| | |
|---|---|
| salt | `0xe9cc90d595d428aa07c91e6ff64a1eb5ccd8cb9490ebba9e4d30eb20e822c443` = `keccak256("namepass")` |
| constructor | `(0x1208a26FAa0F4AC65B42098419EB4dAA5e580AC6, 11155111)` |
| creation code hash | `0x810529be6f75680bc17e9770c73c070b0585056518868b722be84f6ed600f476` (no args) |
| init code hash | `0xeb03f46c9aded62ee093bdb5ceab440cb78f75c54a8afe3f06452304f61a0e8c` (with args) |
| runtime size | 6,742 bytes |
| owner | `0x1208a26FAa0F4AC65B42098419EB4dAA5e580AC6` |

### Helper

Ethereum Sepolia only. Not deterministic — nothing derives from its address.

```
0xf1b51552098ffa7dc2cd83d0fb6508e57db8acc1
```

| | |
|---|---|
| runtime size | 9,101 bytes |
| owner | `0x1208a26FAa0F4AC65B42098419EB4dAA5e580AC6` |
| `ensGovernanceExecutor` | `0x1208a26FAa0F4AC65B42098419EB4dAA5e580AC6` — **placeholder** |
| `referrer` | `0x0000000000000000000000001208a26faa0f4ac65b42098419eb4daa5e580ac6` |
| `GAS_ALLOWANCE` | `100000` ($0.10) |

`ensGovernanceExecutor` is a Namepass address here because Sepolia has no ENS DAO Timelock. On
mainnet it must be the **Timelock** (`wallet.ensdao.eth`), not the Governor — the Governor votes,
the Timelock executes, and passing the wrong one leaves the renewer pointers frozen forever. The
testnet deployment therefore does not exercise the governance path at all.

### Per chain

All four initialized; `l1Helper` is frozen everywhere.

| chain | chainId | CCTP domain | USDC | TokenMessengerV2 | finality |
|---|---|---|---|---|---|
| Ethereum Sepolia | 11155111 | 0 | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | — (hub, must be zero) | 0 |
| Base Sepolia | 84532 | 6 | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | 2000 |
| Arbitrum Sepolia | 421614 | 3 | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | 2000 |
| Arc Testnet | 5042002 | 26 | `0x3600000000000000000000000000000000000000` | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | 2000 |

`MessageTransmitterV2` is `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` on every chain, and the
TokenMessenger address is the same everywhere too — that is Circle's doing, not a copy-paste error.

Arc's USDC is a predeploy at `0x36…00`. It has code; the initialization checked.

### ENS v2 on Sepolia

| | |
|---|---|
| `ETHRegistrar` | `0xa88553F454b77203B0D036A05c894d555EAAa2Cc` |
| `ETHRenewerV1` | `0x4ad56feb5Fc7B8298db06E88fd5CBc41D64602Fa` |
| shared `StandardRentPriceOracle` | `0x8914b66260EB8C4fff795650c3AE8Cd335958987` |

Both renewers point at the same oracle. The helper reads it from whichever renewer it selects
rather than storing it — see the two-renewer section in `ARCHITECTURE.md`.

Live oracle configuration. **The frontend reads these at boot rather than holding a copy**
(`src/lib/oracle.ts`), so the values below are a snapshot for reference, not a second source of
truth to keep in sync. Note the app doesn't pin the oracle's address either — it reads
`rentPriceOracle()` off the two renewers above, exactly as the helper does.

```
DISCOUNT_DENOMINATOR      1e38
getBaseRates()            [0, 0, 20294267, 5073567, 253679]
getDiscountPoints()       (63072000, 8.75e37) (94608000, 6.875e37) (189216000, 5.625e37)
getPaymentTokenRatio()    (1, 1000000)
```

---

## Verifying a deployment

Nothing below needs a key.

```bash
export SEPOLIA=https://ethereum-sepolia-rpc.publicnode.com
FACTORY=0xe0b155Fdb1104824d7E0568aeAFCC52823EDD00F
HELPER=0xf1b51552098ffa7dc2cd83d0fb6508e57db8acc1

# the factory is the same code on every chain
cast code $FACTORY --rpc-url $SEPOLIA | wc -c          # 6742 bytes

# the deposit address matches everywhere — the whole product promise
cast call $FACTORY 'predictWallet(string)(address)' vitalik --rpc-url $SEPOLIA

# the helper agrees with ENS on price
cast call $HELPER 'quote(string,uint256)(uint64,uint256)' vitalik 8000000 --rpc-url $SEPOLIA
```

`predictWallet("vitalik")` is `0x043c184003266644372bA5fA4946777b3f1cFC3D` on all four chains.
`quote("vitalik", 8000000)` is `31535917` seconds — 83 short of a year, which is the shortfall
`CLAUDE.md` describes.

**The frontend derives the same addresses without an RPC.** `src/lib/namepass.ts` reimplements
`predictWallet` in TypeScript — same salt namespace, same ERC-1167 creation code, factory as both
implementation and deployer. It is a duplicate of what's deployed, so it's checked the same way:
the `cast call` above against `depositAddress("vitalik")`. Anything in this file that changes the
factory address changes that module too.

## Proven on chain

| | |
|---|---|
| premigrated name via `ETHRenewerV1` | `0x442df555ce134d4af1bd8faf37e7763ceb9f07411cc4316c07276fbbf187dbc2` |
| native v2 name via `ETHRegistrar` | `0x81df99f918f088b24121e3cfc007a479c920868322562cf6e54438c734d88735` |

Both settled at $8.01 for 31,575,337 seconds with the accounting balancing exactly and no residue
left in the helper.

### CCTP, all three L2s

Burned on each L2 and claimed on Ethereum. Claim transactions:

| origin | domain | burned | Circle fee | duration bought | charged | claim tx |
|---|---|---|---|---|---|---|
| Arc Testnet | 26 | $30.00 | $0.00 | 209,538,651 s | $29.90 | `0xd456158bf99f9dddd3dbefb5560e703e227ee652e751214d91390850f5a81645` |
| Arbitrum Sepolia | 3 | $25.00 | $0.00 | 142,771,698 s | $24.90 | `0xd3e5903b0b97276602e146605fb4433d45a5b428c2334daa40c6945f1c5dd40a` |
| Base Sepolia | 6 | $8.11 | $0.00 | 31,575,337 s | $8.01 | `0x5bc835210cf587117f7f0fe0cefe2d984b6add7485468b9bf3837dcc28de2b28` |

`fromCCTP` true on all three, `$0.10` to the claimer each time, accounting balancing exactly, and
ENS's own `getRenewPrice` agreeing with what was charged to the base unit. Claims cost ~345–347k
gas. Standard transfers really do carry no Circle fee — `feeExecuted` was zero every time, so
`mintedAmount` equalled the burn.

This is what exercises the nine hand-derived CCTP offsets: `sourceDomain` decoded as 26, 3 and 6
respectively, and `amount`, `feeExecuted` and `messageSender` all landed on the right fields
against real Circle messages. It also puts the mint assertion into production — the authenticated
`burn - feeExecuted` matched the observed balance delta on every claim.

Helper dust after all four renewals: **zero**.

Everything the contracts do is now proven on chain. What remains untested is the governance path,
which testnet cannot exercise — see the note on `ensGovernanceExecutor` above.

### Local system migration — 2026-09-21

The shared application registry now contains the verified replacement factory, gateway, pointer,
and factory deployment blocks. The resolver source also derives replacement deposit addresses.
These are local changes. The hosted app, database, old workflows, and Goldsky pipeline have not
switched. The replacement resolver is not deployed. Follow `SYSTEM_CUTOVER_STATUS.md` and
`TESTNET_RESET.md` before deploying the changed application.

## Replacement deployment — 2026-09-22

The Arc native-deposit correction is deployed on all four testnets. Factory:
`0x2dCB5CA6b21372b43e37C35Da8D5D15160423150`. Sepolia pointer:
`0x774f942194d612e126A05Ce40a3A4D88AfBB6ae6`; gateway:
`0x39351C9f9eAb6093eFB4e865a6330ECd2a756F0f`; active helper:
`0x7Bfee7c257ff48f8D787A61F15925e24743C8F88`. The test timelock is reused.
See `deployments/2026-09-22/` for verified receipts and source matches. The reduced live checks
passed: Sepolia steve renewal, then two native Arc deposits and completed claims, including a
deposit after wallet deployment. Service cutover remains blocked by Neon quota; these addresses
are not yet published by the hosted application.

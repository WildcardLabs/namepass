# Deployments

Live contract addresses. Every value here was read back off the chain rather than copied from a
deployment script.

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

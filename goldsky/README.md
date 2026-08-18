# Goldsky Turbo

`namepass-testnet.yaml` is the stable testnet pipeline. It starts at the latest block when Goldsky
first deploys it. Source names must not change after deployment because Goldsky binds checkpoints
to those names.

The pipeline preserves `_gs_op`. Goldsky documents inserts as `i`, while some CDC delivery paths
use `c`. The webhook accepts both forms as create operations and accepts `d` as delete. It rejects
`u` because chain event rows are immutable.

The pipeline has one token-transfer and raw-log source for each testnet chain. Arc also has one
enriched-transaction source because a direct Arc USDC payment is a native-value transaction and
does not emit an ERC-20 `Transfer` log.

| Chain | Deposit dataset | Raw-log dataset |
|---|---|---|
| Ethereum Sepolia | `ethereum_sepolia.erc20_transfers` `1.2.0` | `ethereum_sepolia.raw_logs` `1.0.0` |
| Base Sepolia | `base_sepolia.erc20_transfers` `1.2.0` | `base_sepolia.raw_logs` `1.0.0` |
| Arbitrum Sepolia | `arbitrum_sepolia.erc20_transfers` `1.2.0` | `arbitrum_sepolia.raw_logs` `1.0.0` |
| Arc Testnet | `arc_testnet.erc20_transfers` `1.1.0` and `arc_testnet.receipt_transactions` `1.0.0` | `arc_testnet.raw_logs` `1.1.0` |

Goldsky verified all nine dataset names, versions, and schemas. The current Turbo CLI validated
the full pipeline. The `namepass-testnet` pipeline runs in the active `Namepass` project.

Arc transaction `value` has 18 decimals. The Arc USDC system contract uses 6 decimals. The
pipeline divides native transaction value by `10^12` before it emits the normalized deposit row.
The workflow then verifies the mined transaction recipient and the same conversion before it uses
the deposit. Circle applies the configured finality requirement after the origin burn.

The raw-log sources include only Namepass contract addresses and the two Ethereum ENS renewers.
The ENS transform keeps `NameRenewed` only when it has the Namepass referrer from the shared
deployment registry. The pipeline does not index Circle `MessageSent`. CCTP v2 assigns the final
nonce off chain, so the workflow gets the final message, nonce, and attestation from Circle Iris.

The pipeline needs two Goldsky secrets:

- `NAMEPASS_GOLDSKY_READER` contains the direct Neon connection string for the read-only
  `goldsky_reader` role.
- `NAMEPASS_TESTNET_WEBHOOK_AUTH` is an `httpauth` secret. It sends the authorization header that
  the Vercel webhook checks.

The Neon migration owns `goldsky.watched_addresses`. The table must contain a lowercase `value`
primary key and an `updated_at` time column. Goldsky only reads this table.

Generate the committed pipeline after a testnet registry change, then check it in CI:

```bash
node goldsky/generate-testnet.mjs
node goldsky/generate-testnet.mjs --check
```

Validate the pipeline before deployment:

```bash
goldsky turbo validate goldsky/namepass-testnet.yaml
```

Deploy only after the Neon table, both secrets, and the stable webhook exist:

```bash
goldsky turbo apply goldsky/namepass-testnet.yaml
```

Do not deploy this pipeline to a Vercel preview URL. Do not add a Postgres sink. The authenticated
webhook is the only event writer.

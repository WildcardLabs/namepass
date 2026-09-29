# Deposit addresses

## Activation and deposit addresses

The same ENS label derives the same deposit address on the supported chains in this deployment. Always use the chain and token addresses from `GET /config`. A watch is a subscription to public name activity; it does not establish ownership of the ENS name or a deposit.

## ENS alias verification

The alias has the form `alice.namepass.eth`. Its resolution chain is Ethereum mainnet, even for the current testnet payment deployment. Only use alias resolution when `config.alias.verified` is true and the resolved address matches the returned full deposit address. Activation can return an address before history repair finishes.

## Stored state and history

`GET /names/{name}` reads stored state without making RPC calls or starting renewals. Its balances are block-tagged snapshots, not spendable balance promises. Native Arc discovery has a separate bounded activation range in the coverage fields; later native transfers are discovered by the live indexer or exact transaction registration. `historyCoverage` gives explicit per-chain block ranges. A balance snapshot does not recover historical senders. Use `POST /names/{name}/refresh` to request a new scan.

## Supported funding modes

ERC-20 USDC transfers are supported on every configured chain. Arc additionally supports top-level native USDC transfers: native value uses 18 decimals and must convert exactly to six-decimal USDC. Internal native transfers are outside this funding contract.

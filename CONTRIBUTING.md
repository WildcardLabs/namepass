# Development

## Requirements

Use Node.js 22, npm and Foundry. CI pins the Foundry version and test dependency in
[the workflow](.github/workflows/ci.yml). Solidity compiler settings are in `foundry.toml` and
must remain consistent with deterministic deployment requirements.

```sh
npm ci
forge install foundry-rs/forge-std@bf647bd6046f2f7da30d0c2bf435e5c76a780c1b --no-git
```

OpenZeppelin is installed through npm. Vendored ENS test-source provenance is recorded in
[test/ens/README.md](test/ens/README.md).

## Local application

Use an ignored local environment file for the services needed for your work. Never commit
credentials. Browser-exposed `VITE_` variables must not contain secrets. A local or disposable
database is appropriate for development; do not use production credentials.

```sh
npm run dev
npm run build
npm run preview
```

Vite serves the frontend. Live balances and activity require the HTTP API and its configured
services. `VITE_API_BASE_URL` selects a separate API origin; leave it blank for same-origin hosting.
Backend routes live in `routes/api/` and are built with Nitro and Vercel Workflow.

## Verification

Run checks relevant to the change; CI defines the complete required suite.

| Area | Command |
| --- | --- |
| Browser types | `npx tsc --noEmit` |
| Server and workflow types | `npm run check:server` |
| Frontend adapters | `npm run test:frontend` |
| Server logic and database fixtures | `npm run test:server` |
| Single server regression | `node --import tsx --test server/<file>.test.ts` |
| Transaction and workflow behavior | `npm run test:transactions` |
| Workflow runtime | `npm run test:workflow` |
| Contracts | `forge test` |
| Chain registry | `node scripts/check-chains.mjs` |
| Goldsky definition | `node goldsky/generate-testnet.mjs --check` |
| Helper fingerprint | `node scripts/generate-helper-adapter.mjs --check` |

`npm run build` does not compile Solidity. Fork tests are opt-in through `NAMEPASS_FORK_RPC`;
see [contract verification](docs/CONTRACTS_V2.md#verified-ens-compatibility). Local fixtures and
fork tests are distinct from signed live canaries. Documentation-only changes do not need them.

## Changes

Use a feature branch and pull request. Explain the resulting behavior and relevant verification.
Preserve exact amounts, canonical evidence and contract trust boundaries described in
[engineering constraints](docs/ENGINEERING_CONSTRAINTS.md). Update the reference that owns a
changed fact rather than adding a session log. Keep deployment manifests and third-party notices.

Production deployment follows the GitHub-connected release process. Changes to deployed addresses,
provider state or wallet transactions require an explicit release scope; opening a PR does not
itself authorize those actions.

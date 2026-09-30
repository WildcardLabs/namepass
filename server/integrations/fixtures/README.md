`ens-v2-helper-runtime.hex` is the runtime produced by the repository's pinned Solidity build
for `ENSV2RenewalHelper`. Immutable addresses remain unfilled; the adapter fingerprint excludes
those ranges. The HTTP quote test uses it to exercise real runtime verification, then checks
block-pinned RPC calls and fee subtraction. `test/Pricing.t.sol` separately checks the helper's
pricing against ENS's forward oracle. Regenerate this fixture after a reviewed helper change
with `forge build` and `forge inspect ENSV2RenewalHelper deployedBytecode`.

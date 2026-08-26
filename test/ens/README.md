# Vendored ENS v2 source

Copied verbatim from `ensdomains/contracts-v2` at commit **`1edb1816cf66bec1ce3c86cc2b12aae0a0b9416f`**.
Do not edit these files. If they need updating, re-copy them from that repository and note the new
commit here.

They are here so the pricing tests run against **ENS's own arithmetic** rather than a
reimplementation of it. `StandardRentPriceOracle` is the contract the helper inverts, and two real
bugs have already come from guessing at its behaviour instead of reading it:

- rates derived from a Julian year rather than the oracle's 365-day one (`docs/DECISIONS.md`,
  2026-08-06);
- `getPaymentTokenRatio` treated as a single divisor when it returns `(numer, denom)`, which agreed
  with the live configuration only because `numer` happens to be 1.

A test that mocks the oracle cannot catch either. One that compiles ENS's source can.

Only what `StandardRentPriceOracle` transitively needs is here — the two `ETHRenewer`
implementations are not, because they pull in `NameWrapper` and `BaseRegistrarImplementation` from
ENS v1 and their renewability predicates are small enough to reproduce exactly in
`test/mocks/MockRenewer.sol`. Those predicates are copied from `ETHRegistrar._isRenewable` and
`ETHRenewerV1._isRenewable`; check them against the source if ENS changes them.

`utils/StringUtils.sol` is copied verbatim from `ensdomains/ens-contracts` tag **`v1.7.0`**. It is
stored here because the oracle only needs this standalone helper; installing the full package adds
unrelated contracts and dependencies to the test environment.

**This is still not a substitute for a fork test** against deployed Sepolia contracts, which is the
only thing that confirms the addresses and the ABI as actually deployed.

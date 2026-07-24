# Namepass — Renewal Infrastructure Hero

A single full-screen hero for **Namepass**: a permanent renewal address for every ENS name.
Stablecoins in from any chain, renewal time out, always at the best available rate.

Adapted from the RIVR DeFi hero. The layout, glassmorphism, corner cutout, type scale, and
motion timings are preserved exactly — only the content and the bottom-left card's behaviour
have changed.

## The live renewal ticker

The bottom-left card (previously a static "5.2K Active Yielders" metric) now cycles inbound
payments and shows the name's expiry moving out in response:

```
+$8  Base       →  +1.0y  (full price)    Renewed Until  Mar 2030
+$27 Arbitrum   →  +6.0y  (43.75% off)    Renewed Until  Mar 2036
+$14 Optimism   →  +2.0y  (12.5% off)     Renewed Until  Mar 2038
```

Each figure is computed at render time from the deployed pricing oracle — the card is a
demonstration of the product, not a marketing number.

## Explorer name detail — two panels, no overlap

- **Left · The ENS name.** Expiry date, days remaining, a runway bar splitting the expiry that
  existed at activation from the time Namepass has added since, and the name's **resolver
  records** — resolved address, owner, and text records (avatar, description, url, twitter,
  github). This is name identity, not payment history.
- **Right · The Namepass.** QR, accepted token, supported chains, and the two copy targets.

The activity table below carries the full payment history. The left panel deliberately does not
repeat it — an earlier version listed recent renewals there, which was a strict subset of the
table directly beneath it.

## Threshold rounding — important

Tier thresholds are not round numbers. The 3-year rate for a 5+ char name starts at exactly
`$16.500020`, so a payment of `$16.50` falls **20 micro-units short** and silently drops to the
previous tier (buying 2y 4mo instead of 3y).

`ceilToCent()` rounds a threshold up to the next payable cent, and `payableThresholds()` returns
those values. All quick-select buttons use them, at every name length:

| Tier | Exact threshold | Button shows | Result |
| --- | --- | --- | --- |
| 2 years | `$14.000017` | `$14.01` | 2y, 1d · 12.5% off |
| 3 years | `$16.500020` | `$16.51` | 3y, 1d · 31.25% off |
| 6 years | `$27.000032` | `$27.01` | 6y, 2d · 43.75% off |

The same applies to 3-char (`$1120.01` / `$1320.01` / `$2160.01`) and 4-char (`$280.01` /
`$330.01` / `$540.01`) names — `payableThresholds(labelLength)` derives them from the rate for
that length, so nothing is hardcoded per tier.

`nextTierHint()` surfaces a top-up prompt when a small addition crosses into a much better rate
— e.g. at `$26.00` it offers "Add $1.01 to get 1.3 more years". It stays silent once the best
rate is reached, or when the gap is large relative to the amount already entered.

## Pricing math (`src/lib/pricing.ts`)

Exact ENS v2 `StandardRentPriceOracle` pricing for 5+ character names, BigInt end to end.
`divCeil` mirrors the contract's `Math.Rounding.Ceil`, so results match on-chain to the
micro-unit.

| Duration | Threshold | Discount |
| --- | --- | --- |
| 1 year | `$8.000010` | — |
| 2 years | `$14.000017` | 12.5% off |
| 3 years | `$16.500020` | 31.25% off |
| 6 years | `$27.000032` | 43.75% off |

In `BottomLeftCard`, `INBOUND[].label` is the display string (`$27`) and `INBOUND[].amount`
is the exact charge (`27_000032n`). Keep the pair in sync if you edit either.

## What changed from the reference

| | RIVR | Namepass |
| --- | --- | --- |
| Headline | Fluid Asset Streams | Renewal Infrastructure |
| Badge | Sparkles · Fluid Staking | ShieldCheck · Live at ENS v2 launch |
| Nav | Ecosystem · Economics · Developers · Governance | Protocol · Pricing · Developers · Treasury |
| Nav CTA | Book Demo | Talk to us |
| Bottom-left | 5.2K Active Yielders · Join Discord | Live renewal ticker · Claim address |
| Bottom-right | Documentation · Library | Documentation · Integrate |

Unchanged: `#f0f0f0` page, `#5E6470` headline, `rgba(30,50,90,*)` accent, the rounded card
shell, video treatment, glass surfaces, both SVG corner masks, and every motion delay
(0.2s / 0.4s / 0.6s).

## Run

```sh
npm install
npm run dev
npm run build
npm run preview
```

## Note on the video

`public/assets/hf_20260428_193507_*.mp4` is carried over from the reference. Replacing it is
the single highest-impact change you can make — the footage is what sells the "billion dollar
company" register. Anything slow, abstract, and desaturated will work with this palette.

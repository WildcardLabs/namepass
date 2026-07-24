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

## ENS profiles are live (`src/lib/ens.ts`)

Profiles are fetched from `https://api.resolvio.xyz/ens/v2/profile/<name>` — in-memory cached,
request-deduplicated, and aborted on unmount.

The API returns every slot it knows about, most with `exists: false`. We keep only what a person
reads: **description, url, com.twitter, com.github, org.telegram, location, email**, plus the
avatar and contenthash. Two things are deliberately dropped:

- **`addresses`** — mostly `exists: false`, and coin types like `2147492101` mean nothing to a
  reader. The one exception is coin 60 (ETH), lifted out as `addr`.
- **`header`, `name`, `com.discord`, `com.youtube`** — rarely set, and not identity-defining.

## Layout invariants

Two rules that broke in earlier revisions and are worth preserving:

- **A grid header and its rows must declare the same `grid-cols-[…]` string.** Editing one
  without the other silently misaligns every column. Both tables in `Explorer.tsx` now share
  their definition between header and row.
- **`truncate` inside a flex row needs `min-w-0` on the same element.** Without it the element
  refuses to shrink and pushes its siblings out — long ENS names were doing exactly this.

On mobile the detail pairs use a **fixed** column template
(`grid-cols-[5.5rem_4.5rem_5rem_1fr]`), not equal fractions and not flex. Two failure modes to
avoid:

- `grid-cols-4` gives equal columns, which leaves dead space on the right because content widths
  differ ("Base" vs "43.75% off").
- `flex justify-between` sizes each column to its content, so a longer chain name ("Arbitrum"
  vs "Base") shifts every column after it — rows stop lining up with each other.

A third failure mode: fixed widths plus a trailing `1fr` column. The Time value needs ~41px but
`1fr` hands it 64–118px depending on viewport, and all of it becomes dead space on the right.

The working combination is `minmax(<floor>, auto)` on the first three columns with
`justify-between` on the grid, and `text-right` on the trailing cell. Minimum widths stop chain
names from shifting later columns; `auto` keeps each column at its content size; and
`justify-between` distributes the leftover into the gaps so the row ends flush at both edges.
`ChainTag` uses `items-baseline` with a `self-center` dot so it sits level with plain-text
siblings; `items-center` would raise it above their baseline.

## Mobile: tables become cards

Following Etherscan's pattern, the live feed and activity table drop their grid below `md` and
render each row as a card: name and time-added on the headline row, then labelled
From / Received / Rate pairs beneath, with the timestamp last. Column headers hide entirely —
they carry no meaning once the grid is gone.

## Explorer name detail — two panels, no overlap

- **Left · The ENS name.** Expiry date, days remaining, a runway bar splitting the expiry that
  existed at activation from the time Namepass has added since, and the name's live **profile**
  fetched from the resolver API — avatar, description, resolved address, and icon-labelled links,
  plus a "Serves a site" marker when a contenthash is set. Skeleton-loads while fetching.
- **Right · The Namepass.** QR, accepted token, supported chains, and the two copy targets.

The activity table below carries the full payment history. The left panel deliberately does not
repeat it — an earlier version listed recent renewals there, which was a strict subset of the
table directly beneath it.

## Search behaviour

Typing a complete `.eth` name auto-searches after a 350ms debounce — no Enter required.
Partial input waits. If the name has no Namepass, the result is not a dead end: an
**Activate now** button appears and activates inline, showing the same spinner state as the
modal before revealing the new profile. Anyone can activate any name; ownership is not
required, and the copy says so.

## Address display

The Namepass deposit address is shown **in full**, never truncated. Truncation hides the middle
of an address — exactly where an address-swap attack would land — so a sender cannot verify what
they are about to pay. The ENS profile's *resolved* address is still truncated, since it is
informational rather than a payment target.

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

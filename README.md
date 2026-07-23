# Namepass — Nokia Renewal Hero (React 19 + Tailwind CSS v4 + Motion)

A single-screen landing page for **Namepass**: a permanent renewal address for your ENS name.
Anyone sends stablecoins from any chain; the name gains time.

Adapted from the `dot.` Nokia typing hero. Same architecture, same stack, same visual system —
the phone screen now runs a **live renewal ledger** instead of a message cycle.

## What the phone screen does

A payment types itself in, resolves into renewal time, and the expiry line steps forward:

```
+$5 base            ->  +228d   (full price)   alive till Nov 2029
+$27 arbitrum       ->  +6.0y   (44% off)      alive till Nov 2035
+$14 an agent       ->  +2.0y   (12% off)      alive till Nov 2037
```

The expiry accumulates across the loop, so the name visibly gains years while you watch.
Money in. Time out — demonstrated, not described.

### The math is real

`solve()` in `src/App.tsx` is the deployed ENS v2 `StandardRentPriceOracle` pricing for
5+ character names, BigInt end to end:

- rate `253505` wei-equivalent per second
- discount numerators `56.25e36` / `68.75e36` / `87.5e36` over a `1e38` denominator
- `divCeil` matching the contract's `Math.Rounding.Ceil`

Verified tier thresholds (these are the exact minimums, not rounded marketing numbers):

| Duration | Threshold | Discount |
| --- | --- | --- |
| 2 years | `$14.000017` | 12% off |
| 3 years | `$16.500020` | 31% off |
| 6 years | `$27.000032` | 44% off |

`PAYMENTS[].label` is what the screen displays (`+$27`); `PAYMENTS[].amount` is what it
actually charges (`27_000032n`). Keep them in sync if you edit either.

## What changed from the reference

| | `dot.` | Namepass |
| --- | --- | --- |
| Screen content | 3 looping messages | payments → time, with running expiry |
| Headline | Short notes. / Daily calm. | Money in. / Time out. |
| Logo | `dot.` | `namepass` |
| Nav | Philosophy · Trust · Access · Tribe | How it works · Pricing · Teams · Docs |
| CTA | Link up | Get yours |

Unchanged: `#F3F4ED` canvas, `#1a1a1a` ink, `#0871E7` CTA with its inset shadow and top glint,
glass pill navbar, Instrument Serif + Inter pairing, Nokia Cellphone FC font, the typewriter
timing constants (100ms type / 2000ms pause / 50ms delete), the blinking cursor, and both
entrance animations with `ease: [0.16, 1, 0.3, 1]`.

## Run

```sh
npm install
npm run dev
npm run build
npm run preview
```

## Note on the video

`public/assets/hf_20260427_054418_*.mp4` is carried over from the reference project — it shows
a hand holding a Nokia-style phone, and the screen overlay is positioned against it. If you
shoot your own footage, re-tune the `RenewalScreen` wrapper offsets
(`left-[48.5%] md:left-[47.5%] lg:left-[48.5%] bottom-[32%]`) to sit on the new screen.

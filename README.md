<div align="center">

<img src="public/favicon.svg" width="56" height="56" alt="Namepass" />

# Namepass

**Every ENS name gets its own renewal address.**
Send USDC from any chain, the name gets more time — automatically, at the best rate available.

[![React](https://img.shields.io/badge/React-18-149ECA?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)](https://vite.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Motion](https://img.shields.io/badge/Motion-12-0055FF?logo=framer&logoColor=white)](https://motion.dev)
[![ENS](https://img.shields.io/badge/ENS-v2_pricing-5298FF?logo=ethereum&logoColor=white)](https://ens.domains)
[![Status](https://img.shields.io/badge/status-prototype-orange)](#-a-note-on-what-this-is)

<img src=".github/assets/hero.png" width="100%" alt="Namepass hero — Keep your name alive" />

</div>

<br />

<details>
<summary><strong>📋 Table of contents</strong></summary>

- [What it does](#-what-it-does)
- [A note on what this is](#-a-note-on-what-this-is)
- [Feature tour](#-feature-tour)
- [Tech stack](#-tech-stack)
- [Getting started](#-getting-started)
- [Project structure](#-project-structure)
- [Under the hood](#-under-the-hood)
- [CI — Claude Code Action](#-ci--claude-code-action)
- [License](#license)

</details>

## 🪪 What it does

Every ENS name expires. Namepass gives it a **permanent, chain-agnostic deposit address** —
anyone can send USDC to it, from Base, Arbitrum, Polygon, or Ethereum, and it's converted into
renewal time at the exact on-chain rate, no middleman markup. Ownership isn't required to fund
one: a name's biggest supporter can keep it alive without ever holding the keys.

Under the hood, [Coinbase CDP Agentic Wallets](https://www.coinbase.com/developer-platform)
watch each deposit address, detect inbound payments, calculate the maximum renewal time the
funds can buy, bridge if needed, and submit the on-chain renewal — no manual intervention.

## 🎬 A note on what this is

This repo is a **frontend prototype** — a fully interactive design exploration of the Namepass
product surface, built to demo the experience end to end. The UI, pricing math, and interaction
model are real and exact (see [Under the hood](#-under-the-hood)); the on-chain activity,
balances, and ENS ecosystem stats you'll see are **seeded/simulated client-side** for
demonstration, not pulled from a live indexer or contract. Treat it as a high-fidelity prototype,
not a production financial product.

## ✨ Feature tour

| | |
|---|---|
| 🏠 **Hero + live renewal ticker** | The bottom-left card cycles real inbound-payment math — chain, amount, discount tier, and the resulting expiry — computed from the actual pricing oracle, not hardcoded copy. |
| 🧮 **Cost simulator** | Drag a slider or type any amount and watch it resolve into exact renewal time, live, for 3/4/5+ character names — including the "you're 1 dollar from a better rate" nudge. |
| 📡 **Explorer** | A public, Etherscan-style live feed of every renewal across every name, plus a full per-name detail view: expiry runway, ENS profile (avatar, links, socials), and complete payment history. |
| 🏆 **Leaderboard** | Every Namepass ranked by renewals or time delivered, with inline-expandable rows (no page navigation) showing the QR code and deposit address on the spot. |
| 🖼️ **ENS avatars everywhere** | Real ENS avatars via the [resolvio](https://api.resolvio.xyz) profile API, gracefully falling back to a deterministic [Dicebear](https://dicebear.com) avatar seeded by name. |
| 🔎 **Instant search** | Type a complete `.eth` name and it auto-searches after a debounce — no Enter required. No Namepass yet? Activate it inline, right there in the empty state. |
| 💎 **Shine & shimmer UI** | Hand-ported [Magic UI](https://magicui.design)–style primitives (`ShineBorder`, `AnimatedShinyText`, `NumberTicker`, `DotPattern`) restyled to a single navy accent — restrained, not confetti. |
| 🪟 **One consistent shell** | Every page — home, leaderboard, terms, privacy — renders inside the same rounded card with the same header, so navigating between them never feels like leaving the app. |

<div align="center">
<table>
<tr>
<td width="50%"><img src=".github/assets/leaderboard.png" width="100%" alt="Leaderboard" /></td>
<td width="50%"><img src=".github/assets/leaderboard-expand.png" width="100%" alt="Leaderboard row expanded with QR code" /></td>
</tr>
<tr>
<td width="50%"><img src=".github/assets/simulator.png" width="100%" alt="Cost simulator" /></td>
<td width="50%"><img src=".github/assets/explorer.png" width="100%" alt="Explorer live feed" /></td>
</tr>
</table>
</div>

## 🧱 Tech stack

| Layer | Choice |
|---|---|
| Framework | React 18 + TypeScript, bundled with Vite 6 |
| Styling | Tailwind CSS v4 (`@theme`, no config file) |
| Motion | [`motion`](https://motion.dev) (Framer Motion's successor) for every transition, layout animation, and gesture |
| Icons | [lucide-react](https://lucide.dev) |
| ENS data | [resolvio](https://api.resolvio.xyz) profile API — cached, deduplicated, abort-on-unmount |
| Automation (product, not this demo) | Coinbase CDP Agentic Wallets |
| Routing | ~40 lines of hand-rolled `history.pushState` — no router dependency for four pages |

## 🚀 Getting started

```bash
git clone git@github.com:stevegachau/demo.git namepass
cd namepass
npm install
npm run dev
```

```bash
npm run build     # tsc --noEmit && vite build
npm run preview   # serve the production build locally
```

## 📁 Project structure

```
src/
├── components/
│   ├── magicui/          ShineBorder, AnimatedShinyText, NumberTicker, DotPattern
│   ├── Hero.tsx           Home hero content (badge, headline, CTA cards)
│   ├── Navbar.tsx         Shared header — logo, glass menu, CTA
│   ├── PageShell.tsx      The rounded card every page renders inside
│   ├── Explorer.tsx       Live feed + per-name detail view
│   ├── Leaderboard.tsx    Ranked list with inline-expandable rows
│   ├── Simulator.tsx      Cost simulator
│   ├── PassCard.tsx       QR + deposit address + supported chains
│   └── Footer.tsx / Terms.tsx / Privacy.tsx
├── lib/
│   ├── pricing.ts         Exact ENS v2 StandardRentPriceOracle math, BigInt end to end
│   ├── registry.ts        Seeded mock activity data (see note above)
│   ├── ens.ts              resolvio profile client
│   ├── qr.ts               QR matrix encoder
│   └── format.ts           Date/currency/duration formatting
└── App.tsx                 ~150 lines of state + routing tying it together
```

## 🔬 Under the hood

A few decisions worth knowing about before you touch the code:

<details>
<summary><strong>Pricing math is exact, not approximate</strong></summary>

<br />

`src/lib/pricing.ts` mirrors ENS v2's `StandardRentPriceOracle` for 5+ character names, in
`BigInt` end to end. `divCeil` matches the contract's `Math.Rounding.Ceil`, so every number
shown matches on-chain to the micro-unit.

| Duration | Threshold | Discount |
|---|---|---|
| 1 year | `$8.000010` | — |
| 2 years | `$14.000017` | 12.5% off |
| 3 years | `$16.500020` | 31.25% off |
| 6 years | `$27.000032` | 43.75% off |

Thresholds aren't round numbers — the 3-year rate starts at exactly `$16.500020`, so a payment
of `$16.50` falls **20 micro-units short** and silently drops to the previous tier.
`ceilToCent()` rounds every threshold up to the next payable cent so the UI's quick-select
buttons never suggest an amount that under-shoots.

</details>

<details>
<summary><strong>Deposit addresses are never truncated</strong></summary>

<br />

The Namepass deposit address is always shown **in full**. Truncation hides the middle of an
address — exactly where an address-swap attack would land — so a sender can't verify what
they're actually paying. The ENS profile's *resolved* address is still truncated, since it's
informational rather than a payment target.

</details>

<details>
<summary><strong>The header lives inside the page, not above it</strong></summary>

<br />

`PageShell` renders the same rounded card (video background on Home, white elsewhere) with
`Navbar` as its first child on every route. That's what makes switching between Home,
Leaderboard, Terms, and Privacy feel like one app instead of four stitched-together pages.

</details>

## 🤖 CI — Claude Code Action

Pull requests and issues on this repo can be reviewed by Claude directly — mention `@claude` in
a comment, review, or issue and [`.github/workflows/claude.yml`](.github/workflows/claude.yml)
picks it up.

## License

No license file yet — all rights reserved by default. Ask before reusing.


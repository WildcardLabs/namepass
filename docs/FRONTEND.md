# Web client

The React application derives deposit addresses, displays ENS pricing, and reads activity and
flow state through the public API. Executors can use the renewal contracts without this client.

## Module boundaries

| Module | Responsibility |
| --- | --- |
| `src/App.tsx` | Page state, browser history and shared page shell |
| `src/lib/namepass.ts` | ENS normalization and universal wallet derivation |
| `src/lib/chains.ts` | Shared chain and deployment registry |
| `src/lib/publicApi.ts` | Typed HTTP reads and activation |
| `src/lib/readModel.ts` | Presentation adapters for stored facts |
| `src/lib/flowPresentation.ts` | Flow labels that preserve origin-chain meaning |
| `src/lib/oracle.ts`, `pricing.ts`, `fees.ts` | Validated chain configuration and exact pricing |
| `src/lib/ens.ts` | Shared, cached ENS profile requests |

Components do not query Neon or perform public balance polling through RPC.

## Pricing and addresses

Normalize labels before derivation and show payment addresses in full. Helper selection and
configuration reads use one block. Unknown helper code or invalid oracle configuration prevents
pricing. The gateway provides the fixed executor allowance. Only price-dependent content waits
for these reads; the rest of the page can render immediately.

Use integer arithmetic and exact amount formatting where rounding would hide a discount boundary.
There are no default oracle rates. See [ENGINEERING_CONSTRAINTS.md](ENGINEERING_CONSTRAINTS.md)
for pricing and shared-request constraints.

## Activity and flow state

Balances stay separate by chain. Missing data remains unavailable. Canonical renewals supply
completed totals; a deposit is not a renewal. Sender and executor are distinct evidence fields.
The browser renders server flow identity without merging rows by name, amount or transaction hash.
After a source-chain burn, an unclaimed payment is not a spendable source-wallet balance.

## Interface conventions

`/docs` is a standalone, lazy documentation application with its own header and responsive navigation
in `src/components/docs.css`. It shares font, text, action and border tokens with the homepage in
`src/styles/site.css`. The documentation landing page has a resource directory and
copyable API examples. Guides use a persistent sidebar and table of contents. The four endpoint
pages come from OpenAPI. Search, page navigation and focus
changes do not read pricing, account or chain state.

`docs/content/` owns guide Markdown and navigation. `npm run generate:docs` produces the shared
catalog, public Markdown, downloadable skill, `llms.txt` and `llms-full.txt`. `npm run check:docs`
checks freshness and links. Page actions copy Markdown, open plain text and prepare context for
an existing agent. Examples, copied prompts and Markdown use the published `docsOrigin` from the
generated catalog (`https://beta.namepass.com`), including in local previews. In-page navigation
uses relative paths. The skill uses the public HTTP flow.

The footer, navigation and integration call-to-action open `/docs`. Homepage navigation
uses `Rates` for the pricing simulator. The 64px sticky header has Product and Resources
dropdowns, a direct Docs link and Get Started. Product opens Protocol, Rates and Explorer.
Resources opens Supported networks and Leaderboard. Mobile navigation uses the existing shadcn
Sheet with focus management and closes after choosing a destination. The footer also lists
these destinations and the legal pages. Public activity labels identify the testnet deployment.

The public pages share `Navbar` and the `public-ui` theme in `src/styles/site.css`.
The theme uses a near-white canvas, neutral text, green actions, fine framing lines,
6px control corners and 12px panel corners. Protocol and docs resource cards use 16px corners. Content is capped at 1180px; the surrounding frame
and header are capped at 1280px. Reading columns stay narrower. The text-only hero uses the
existing heading and description with Get Started and Read the docs. The video, illustrative
renewal overlay and hero Explorer shortcut are removed. Leaderboard remains available through
Resources and the footer. The protocol keeps its four-card bento arrangement and existing beam. The other three cards
contain text with a slow, neutral background fade. The fade stops outside the viewport, in
a hidden tab and for reduced-motion preferences. No additional protocol graphics are present.
Explorer, pricing, secondary pages and the integration CTA share the surface treatment. The
Explorer section has a white canvas. Protocol cards are white with fine neutral borders. The activity table
has a quiet toolbar and 14px column labels. The name-view heading and back icon share a
centered row. The pricing calculator groups name length, amount and discount controls in its
left panel. Renewal time and the cost breakdown occupy the white right panel. The result uses
a 32px time value and consistent 14px label/value rows with light dividers. The panels stack
below 1024px. The loading state uses the same layout.
Existing controls and exact math are retained.
The next-tier suggestion sits to the right of the payment amount, with a tooltip and shortcut.
All docs tabs use the same 1280px outer frame, header and tab bar. Guide pages retain
their sidebar, sticky table of contents and readable article width. Horizontal overflow is
clipped without creating an ancestor scroll container, so navigation sticks to the viewport.
All routes, including docs and monitoring, render the shared footer with working product and
legal navigation. Docs also show the existing live testnet renewal strip above their header.
The strip scrolls away with the page; the header and navigation then stick beneath the viewport top.
The docs logo returns home through the app router. Route transitions keep the current view
visible while a lazy page loads, preventing an intermediate header disappearance.
Legal sections use fine dividers.

All application surfaces use self-hosted Geist Variable from `@fontsource-variable/geist`.
Public section descriptions use 18px/28px at weight 400. Docs prose uses 16px/26px. The
integration CTA paragraph uses 14px/22px. Footer link rows use a compact 4px gap. Controls use 14px/500,
and card headings use 24px/32px at weight 600 with normal tracking. Compact protocol paragraphs
use 14–14.5px/24px on desktop and 18px/28px when the cards stack; the desktop alias paragraph
fits three lines. Body and table text remain 16px
and 14px where density matters. Text uses neutral #171717 and #737373, with green action roles. Code and contract
addresses retain monospace. The documentation flow labels `alice.eth` and `alice.namepass.eth`
share one font family, size and weight. No premium template source or assets are included.
Reuse existing visual primitives, tooltips and chain labels. Keep keyboard focus indicators
visible. The public shell and portaled navigation controls override shadcn primary, accent and
focus colors to green; monitoring retains its separate semantic palette.

Use `surface-selected` for pricing selections and `surface-table` for Explorer headers.
Use `inset-panel` for shaded information, address fields, renewal hints and transaction rows.
It owns the opaque `surface-inset` fill, 8px corners and 12px/16px padding. Add `inset-action`
only when the whole panel is a button or link. Keep its fill steady on hover and press.
Use `primary-action` for filled public actions. These controls share a fine border and inset
highlight; keyboard focus stays visible. Error and warning surfaces retain their meaning.
Reserve the green `savings` and `savings-soft` pair for discount badges.
Text colors use the shared `ink-*` theme roles in `src/index.css`: `primary` for headings
and key values, `secondary` for descriptions and supporting data, `label` for small labels,
and `action` for links and controls. Public pages map these roles to the shared `site-*` tokens.
Use `decorative` only for nonessential numbering. Dark surfaces use `inverse` and
`inverse-secondary`. Section labels use `tracking-section`.
Keep error, warning, chart-series and network-brand colors distinct where they convey meaning.
Monitoring is a separately loaded, GitHub-authenticated page built with the existing shadcn
components. Its snapshot and manual gas-read behavior are defined in [MONITORING.md](MONITORING.md).

The deposit card shows separate copy targets for `<label>.namepass.eth` and the full deposit
address. Its QR encodes the address. Static QR codes use one SVG path. Full address values wrap
at a readable font size on narrow screens; do not shrink them to fit one line. Public copy actions
use `useCopyFeedback`: show success only after the clipboard write succeeds, report failures,
keep icon geometry stable, and clear obsolete feedback timers.

The amount slider keeps a native range input for touch and keyboard behavior. `amount-slider`
owns the track and thumb styles for WebKit/Blink and Firefox; do not replace it with
`accent-color`. The thumb and filled track keep one opaque color in every interaction state.
The range has a 44px interaction area and exposes the actual USDC amount through `aria-valuetext`.
Update renewal results in place during dragging. Public tooltip triggers support focus, touch
toggle, outside dismissal and Escape, and link to their description with `aria-describedby`.

The Explorer keeps its card in place and renders only the active view. The detail view fades and
slides in over 400 ms; its ENS profile fields show inline loading skeletons. The parent retains the
last feed response and page so Back restores them immediately and resumes polling.
Pricing refreshes keep validated views mounted. Only the initial load and a retry after failed
validation use the loading state. A validation failure still disables pricing. Price calculations
must update when the validated configuration changes, without resetting user input.
The explicit ENS refresh still precedes the activity refresh. The CTA effect runs only while
visible in an active tab. Reduced-motion users do not start the CTA effect.

Build and verification commands are in [CONTRIBUTING.md](../CONTRIBUTING.md). Deployment facts
belong in [DEPLOYMENTS.md](DEPLOYMENTS.md).

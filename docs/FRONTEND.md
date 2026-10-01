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
uses `Rates` for the pricing simulator. The desktop menu is centered between the brand and
`Get Started`. On mobile, it stays visible in a centered row. The footer lists Explorer,
Rates, Supported networks, Docs, and the legal pages.
Public activity labels identify the testnet deployment.

Main-site pages share `PageShell` and `Navbar`. The homepage places `Navbar` above its hero.
Its `homepage-ui` theme uses a white canvas, neutral text, green actions, fine panel borders,
6px control corners and 8px panel corners. Section headings use a compact semibold hierarchy.
The existing landscape video is contained below the hero copy. Its illustrative ticker and
Explorer actions remain inside regular overlay panels. The protocol retains its four-card bento.
Explorer, pricing and the integration CTA use the same aligned content width and panel treatment.
The homepage theme is scoped: secondary public pages and monitoring retain their existing styles.
Reuse existing visual primitives, tooltips and chain labels. Secondary public pages keep borderless
filled cards on the cool gray `surface-canvas`. Keep keyboard focus indicators visible.
The hero video uses reduced saturation and multiplies over its cool gray backing.
Use `surface-selected` for pricing selections and `surface-table` for Explorer headers.
Use `inset-panel` for shaded information, address fields, renewal hints and transaction rows.
It owns the opaque `surface-inset` fill, 8px corners and 12px/16px padding. Add `inset-action`
only when the whole panel is a button or link. Keep its fill steady on hover and press.
Do not add local opacity, radius or padding variants for the same role. Glass parent cards
use the same opaque inset panels.
Use `primary-action` for filled public actions. The `public-ui` shell supplies keyboard focus
outlines; dark actions use a white inset outline. Error and warning surfaces retain their meaning.
Reserve the green `savings` and `savings-soft` pair for discount badges; actions, time values and status
keep their existing green roles. Small white controls use a soft shadow for separation.
Text colors use the shared `ink-*` theme roles in `src/index.css`: `primary` for headings
and key values, `secondary` for descriptions and supporting data, `label` for small labels,
and `action` for links and controls. The homepage maps these roles to the shared `site-*` tokens:
neutral primary and supporting text with green links and controls. Other public surfaces retain
their brand-green text roles. Use `decorative` only for nonessential numbering.
Dark surfaces use `inverse` and `inverse-secondary`. Section labels use `tracking-section`.
Monitoring foreground tokens map to these same roles, including content rendered in portals.
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
The explicit ENS refresh still precedes the activity refresh. The homepage video and CTA
effect run only while visible in an active tab. Reduced-motion users do not start the CTA effect.

Build and verification commands are in [CONTRIBUTING.md](../CONTRIBUTING.md). Deployment facts
belong in [DEPLOYMENTS.md](DEPLOYMENTS.md).

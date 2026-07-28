# Decisions

A running, dated log of non-obvious architecture and product calls, and why they were made.
Append new entries at the top. Skip this for anything that's just "the obvious way to do it" —
this is for decisions someone could reasonably have made differently, where the *why* would
otherwise only live in a PR conversation or a chat transcript.

---

### 2026-07-28 — Started this log instead of growing PRODUCT.md indefinitely

`PRODUCT.md`'s "positioning and tone" section was accumulating decision rationale as prose that
would need rewriting every time something new was decided. Splitting decisions out here means new
ones are appended, not edited-in. `PRODUCT.md` stays the current-state summary; this file is the
history of how it got that way.

---

### 2026-07-27 — Client-side routing is hand-rolled, not a router library

Four pages (home, leaderboard, terms, privacy), `history.pushState` + `popstate` is ~40 lines.
A router dependency would be more ceremony than the problem warrants at this size. Revisit if the
page count grows significantly or nested/dynamic routes show up.

### 2026-07-27 — Auto-review on every PR, not just `@claude` mentions

`.github/workflows/claude.yml` was originally mention-only (`@claude` in a comment/review/issue).
Changed to also trigger on `pull_request: [opened, synchronize]` per explicit request for
automatic review. Tradeoff accepted knowingly: this runs (and bills, against the user's Claude
subscription via `CLAUDE_CODE_OAUTH_TOKEN`) on *every* PR automatically, not just when asked.

### 2026-07-27 — `CLAUDE_CODE_OAUTH_TOKEN` over `ANTHROPIC_API_KEY` for CI

A plain API key from console.anthropic.com bills separately from the user's existing Claude
subscription. `claude setup-token` generates a long-lived (~1yr) OAuth token scoped to the
subscription instead. Tradeoff: the token is personal, tied to whoever ran `setup-token` — if that
person leaves/loses access, CI breaks. Acceptable for a solo-owned repo now; revisit (probably back
to an org-level API key) if this becomes a team repo.

### 2026-07-27 — Repo renamed `demo` → `namepass-v2`

No functional reason beyond naming clarity — flagging only because it required updating the local
git remote and any hardcoded clone URLs (README.md had one that went stale and was missed until
caught later — worth grepping for the old name if this ever needs doing again).

### 2026-07-27 — Deposit addresses are always shown in full, never truncated

Truncation hides the middle of an address, which is exactly where an address-swap/homograph attack
would land — a sender couldn't verify what they're actually paying. The ENS profile's *resolved*
address (informational, not a payment target) is still truncated elsewhere, since that tradeoff
doesn't apply the same way.

### 2026-07-27 — Leaderboard rows expand inline, not a separate page/route

Originally clicking a row navigated to that name's detail view on the Explorer page. Changed to an
inline accordion (chevron rotates, `PassCard` renders in place) per explicit request — keeps the
leaderboard self-contained rather than bouncing the user between pages for what's fundamentally a
"peek at this address" action.

### 2026-07-27 — The header lives inside `PageShell`, not above it

Tried a version where `Navbar` was a fixed/floating bar spanning all pages independent of page
content — rejected as looking like "a section bolted on top" rather than part of the page. Settled
on `PageShell` rendering `Navbar` as its first child on every route (video card on Home, white
card elsewhere), so the header is structurally part of whatever page it's on.

### 2026-07-27 — Reuse shine/shimmer effects exactly, don't approximate

Added a custom straight-line shimmer sweep to the Leaderboard button/toggle instead of reusing the
`ShineBorder`/`AnimatedShinyText` combo already established on the hero badge. Visually similar,
not identical — caught immediately. Standing rule now: "match X" means reuse the same
component/props, not a new implementation that looks similar.

### 2026-07-27 — Optimism excluded from supported chains

Appeared in mock/demo data (rotating chain preview, live activity feed) despite having no logo
asset and not being in the actual supported-chains list shown on `PassCard`. Removed everywhere —
`lib/registry.ts`'s chain pool, `Explorer.tsx`'s color/ping maps, `BottomLeftCard`'s rotation.
Chain support is Base, Arbitrum, Polygon, Ethereum only unless explicitly revisited.

### 2026-07-27 — Avoid the word "permanent" in user-facing copy

The underlying property (deposit address never changes) is genuinely permanent, but the word
itself was flagged for removal from copy — likely brand/liability-tone reasons, not stated
explicitly beyond "we want to avoid using the term 'permanent' anywhere on the app." Alternate
phrasing in use: "deposit address for name extensions," "auto renewal address," "never changes."

### 2026-07-27 — "Address," not "agent," as the primary framing

Considered leading with "Every name gets its own agent" instead of "Your name gets its own
address," since the real backend genuinely is agent-automated (CDP Agentic Wallets). Rejected:
for a security-conscious crypto audience, "agent" raises a custody question ("is the agent holding
my funds?") that "address" doesn't — deterministic, non-custodial, no third party in the loop.
Automation is still described, just as what happens *behind* the address, not the headline noun.

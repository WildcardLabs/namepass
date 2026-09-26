# UI consistency audit — 26 September 2026

## Scope and findings

This audit follows the amount control through all input states and compares repeated public UI
roles across the simulator, deposit card, supported contracts, Explorer and leaderboard. The
shared page shell, navigation, footer, legal pages, pricing failure view, pending balances and
monitoring component boundary were also inspected in source.

| Finding | User effect | Resolution |
| --- | --- | --- |
| The amount slider relied on native `accent-color` | Browsers could change the thumb and track colors on hover or press | Explicit track and thumb styles, one opaque green, native input semantics, 44px interaction area |
| Each slider value mounted a new animated result | Rapid dragging repeatedly restarted the result transition | Update the result text in place |
| Inset fills used 1.5%, 2.5%, 3%, 3.5%, 4% and glass opacity variants | The same type of panel appeared different between screens and parent surfaces | One opaque `inset-panel` style with shared corners and spacing |
| Pending and settled transaction rows had separate markup and styles | Different tint, typography, numbering and small link targets | One `TransactionRow`, with the whole row linked to its transaction |
| Deposit values scaled down to fit one line | Small screens could display very small addresses | Wrap full addresses at a fixed readable size, as on Supported |
| Copy failures were reported as success in deposit and contract fields | Users could act on a false “Copied” signal | Shared clipboard feedback with explicit failure, consistent timing and stale request protection |
| Supported contract copy feedback added a text label beside the address | The address could rewrap when copied | Replace the icon without changing its dimensions; announce success in a live region |
| Name-length selection had only a visual state; typed amount had no label | Assistive technology could not identify selection and input purpose | `aria-pressed`, named text input and amount-valued range description |
| Public focus indicators were inconsistent, and the tooltip removed its outline | Keyboard users could lose their position | Shared public focus treatment and a visible tooltip focus outline |
| Tooltips had no description association or explicit touch/Escape handling | Touch and keyboard behavior differed | Description IDs, touch toggle, outside dismissal and Escape |
| Search used 14px input text on mobile | iOS could zoom when focusing search | 16px mobile search text |
| Back/search and retry controls had small touch targets | Small controls were harder to operate on mobile | 44px back/search controls and retry actions; larger inline copy and tooltip targets |
| Filled public actions used several green and hover values | Similar actions looked different across navigation, activation and retries | Shared `primary-action` style and inverse keyboard focus indicator |
| Deposit, ENS profile and supported network cards retained perimeter borders | These cards contradicted the documented filled-card convention | Shared white-card separation with a soft shadow |
| Leaderboard expansion and row hover used additional local tints | Repeated neutral interactions drifted from the public palette | Shared inset and hover color roles |

## Roles that remain distinct

Canvas, inset, selected state and table-header tokens serve different roles. Discount badges,
network logos, live status, error and warning colors retain their semantic meaning. Hero glass,
QR modules, illustration circles and dark tooltips are separate visual elements. Monitoring uses
its existing shadcn component system and scoped public text roles; the public action and range
rules do not target it. Terms and Privacy already share `LegalPage`.

## Verification

Local component fixtures use explicit pricing and activity data and block external requests.
They test presentation only; fixture values are not claims about current prices or transactions.

- Rendered the simulator, deposit card and Supported at 320, 390, 768 and 1440px. Compared
  computed inset fills, corners and padding, inspected screenshots and checked document overflow.
- Rendered expanded Explorer transaction details on desktop and mobile, and a full name profile
  at 320px, with no document overflow.
- Exercised native Chromium mouse dragging, Home/End/arrow keys and emulated touch dragging.
  Screenshot pixels at the thumb center were RGB(39, 67, 51) in idle, hover, pressed and dragged
  states. Touch moved the native range from 0.625 to 0.95.
- Checked tooltip touch open/close, description association and Escape dismissal.
- Frontend regressions cover truthful clipboard feedback, stable copy content and timer reset,
  plus the existing pricing refresh, full-address/QR and navigation behavior.
- TypeScript and the production build check component and routing integration.

Chromium was used for the rendered and interaction checks. Mobile emulation does not replace
an on-device Safari check. The authenticated monitoring page was inspected in source, not through
a live session. This audit does not claim a full accessibility certification or exercise payments.

## Maintaining the result

The owning rules are in [FRONTEND.md](FRONTEND.md#interface-conventions). Reuse `inset-panel`,
`inset-action`, `primary-action`, `TransactionRow` and `useCopyFeedback` before adding another
local implementation. When changing an interaction, compare default, hover, pressed, keyboard
focus, success and failure states at the narrowest supported width. Check the complete rendered
card; document-wide overflow can miss content clipped by a parent.

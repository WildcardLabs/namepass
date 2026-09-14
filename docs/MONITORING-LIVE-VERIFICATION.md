# Monitoring release verification — 2026-09-14

Live dashboard: https://demo-five-gray-37.vercel.app/monitoring

Vercel deployment: `dpl_u71Dq34u6KAxZsnvd8JKrLNG9SEp` (`READY`).
This deploys the stable-testnet application through the existing Vercel production target.

## Local checks

- Production build and server type check passed.
- 133 server tests, 37 frontend tests, and 1 Workflow runtime test passed.
- `git diff --check` passed.

## Live checks

Headless Chrome tested the deployed site at 1440, 768, and 390 pixel viewport widths.
All 43 checks passed. No browser JavaScript errors were recorded.
The in-app browser service was unavailable, so the checks used the bundled Playwright runtime.

- Snapshot and sidebar — passed.
- Window 7 — passed.
- Window 90 — passed.
- Window 30 — passed.
- Deposit chart label — passed.
- Snapshot export — passed.
- Display settings — passed.
- Flow evidence — passed.
- Selection and export — passed.
- Column controls and sorting — passed.
- Search no matches — passed.
- Networks — passed.
- Relayer gas on four chains — passed.
- Coverage — passed.
- Command palette — passed.
- Sidebar collapse — passed.
- Responsive 390 — passed.
- Responsive 768 — passed.
- Failed refresh preserves data — passed.
- Initial API error remains unknown — passed.
- Route / — passed.
- Route /leaderboard — passed.
- Route /supported — passed.
- Route /terms — passed.
- Route /privacy — passed.
- API days=7 — passed.
- API days=90 — passed.
- API status=attention — passed.
- API status=held — passed.
- API status=active — passed.
- API status=failed — passed.
- API status=unclaimed — passed.
- API chain=84532 — passed.
- API page=2 — passed.
- API search=nomatchingname — passed.
- API rejects days=1 — passed.
- API rejects page=0 — passed.
- API rejects status=invalid — passed.
- API rejects chain=bad — passed.
- Public endpoint /api/config/public — passed.
- Public endpoint /api/activity — passed.
- Public endpoint /api/leaderboard — passed.
- No JavaScript errors — passed.

## Fixes made during verification

- Missing or failed snapshots cannot show a healthy platform state. A successful snapshot describes
  flow review flags only; provider health remains explicitly unverified.
- The deposit chart now shows the deposit total and caption when Deposit count is selected.
- Sidebar queue links have enough height for wrapped labels.

## Scope

Gas checks returned balances without errors on all four configured chains. The snapshot showed
65 names, 7 known depositors, 149 completed renewals, no active or flagged flows, and 1 held flow.
These are observations at test time, not ongoing guarantees.

Browser error tests intercepted requests inside the test browser only. They did not disrupt the service.
No deposits, renewal transactions, workflow retries, or external alert-delivery tests were performed.
Existing contract deployments, Goldsky configuration, and database schema did not require changes.

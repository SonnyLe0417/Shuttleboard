# Dashboard performance implementation notes

## Request and cache changes

The essential request returns the profile, saved dashboard preferences (including
its goal), and five projected recent matches. It runs three database reads in
parallel. The summary request starts alongside it and returns aggregates,
progress, the current quest and one insight. Its five reads include a separate
completed-match existence check, preserving behavior when an older completed
match falls outside the latest 100 unfinished matches.

The dashboard no longer downloads the full History response. History retains its
existing request and limit. Server-side aggregates preserve the old formulas and
latest-100 window, including the existing deciding-game formula. A validated UTC
instant computed from browser-local Monday preserves weekly boundaries and DST.
No SQL migration, RLS change, privileged client, or inference-setting change was
introduced.

Shared query options deduplicate loaders and components. Data is fresh for 60
seconds and retained for five minutes. Stale cached data remains usable while
refreshing. Dashboard-family invalidation covers every week key after matches,
profile/preferences and progress changes; auth account changes still clear the
entire client cache. Detailed progress and its DOM render only when details open,
including automatic opening for the saved statistics-heavy layout.

Saved goals load with essentials. Editing a goal protects its draft from a
background refresh; failed saves keep the editor and explain the error. Saves
send only a dashboard goal patch. The existing preference writer now preserves
an omitted public-profile flag instead of defaulting it to false, and its merge
is covered by regression tests. Other saved settings remain intact.

## Startup size

Both requests start directly in the route loader without an extra module-fetch
round trip. The root 404 home control now uses the
existing styled Link directly, removing its initial dependency on the generic
button/slot/variant wrapper. The action remains an accessible home link.

Production entry: 192,272 → 161,045 bytes. Its static import closure:
612,295 → 581,068 bytes. These are uncompressed bundle measurements, not measured
page-load percentages. Dynamic route and intent-preload assets are separate.

## Verification

- 114 JavaScript tests passed after the data changes, including ten focused
  dashboard tests. They cover viewer-relative results, projection limits,
  statistical parity, old completed matches, browser-local weeks/DST, query
  deduplication, stale returns, invalidation and unrelated preference retention.
- Typecheck and production build passed. Lint passed with the three pre-existing
  Fast Refresh warnings.
- Browser fixture checks exercise all saved layouts, pending summaries, saved
  goals, draft preservation, failure/retry and stale cached data. Expanded
  first-load-failure and empty-account checks passed too: seven browser checks
  passed in total, including the 360 px layout.
- No benchmark fixture strings, fake account IDs or browser-control globals were
  found in production JavaScript during the bundle check.

See [benchmark protocol](README.md), [comparison](dashboard-comparison.md) and raw
JSON for the final timing evidence. Early driver-timed samples are explicitly
named preliminary; they are excluded from acceptance because scrolling and query
settlement were not measured consistently.

Eighty measured real-account development checks are recorded in
[live verification](dashboard-live-verification.md); the complete production
real-account benchmark remains pending.
Do not infer its completion from the fixture interaction suite. Nothing has been
committed, pushed, deployed or published by this pass.

# Combined startup and diagnostic review

This review follows the earlier bug-fix/offline-only release selection. The
combined review includes the remaining startup changes and bounded diagnostics;
it supersedes the earlier instruction to exclude those source changes. Earlier
measurements remain historical observations, not new measurements of this release.

## Reviewed behavior

- Session-dependent routes preload the saved build's SDK graph. The homepage
  retains deferred session loading. Session/onboarding guards remain in place.
- Shared startup router/icon chunks reduce fragmentation without a new runtime
  dependency. Auth navigation handles duplicate initial callbacks once, retaining
  pending invitations. Existing job and match controllers stay mounted.
- Development-only summary timing emits fixed labels and durations around auth,
  module loading, parallel data calls and aggregation. Browser captures export
  allowlisted numeric fields, not account content or credentials. Collection is
  bounded at 60 samples and 30 minutes and adds no account polling.
- The signed-in production collector keeps its separate shared 20-minute and
  80-navigation caps, invalidation, explicit resume and fixed-viewport rules.
  No signed-in benchmark was repeated in this review.

The remaining startup/diagnostic code passed the complete combined regression
suite. This is correctness/build validation, not evidence of a production speedup.
The historical synthetic matrix missed its populated-dashboard 20% target and
included a desktop LCP regression observation; those limitations are retained.
A separate synthetic homepage confirmation does not establish signed-in speed.
The historical 28.6-second summary stall was not reproduced or retrospectively
explained, so no speculative database/index/auth optimization was added.

## Confirmed fixes during this review

Older synthetic runner/report scripts could overwrite previous default outputs.
They now refuse existing outputs; report generators accept new prefixes. Explicit
resume requires the exact output, matching version and run count. Warmup records
are kept separately from measured samples. The legacy account summarizer rejects
modern records so it cannot bypass the current foreground eligibility checks.
The older comparison generator also treated a missing optimized median as zero,
which could claim a 100% improvement when all optimized samples failed. Missing
medians now produce no percentage, and meeting the target requires ten measured
timings per build with no failures. Regression tests cover this failure case.

The expanded 71-rally singles fixture had a trailing comma and was invalid JSON.
Only that syntax was corrected; labels and timestamps were retained. A regression
test checks strict JSON, winners and rally time ranges. This does not establish
the annotations' visual accuracy; no private video was loaded or added.

## Publication and retained local evidence

Raw account exports, collector attempts, baseline source/lockfile snapshots and
the large full baseline/optimized matrices are ignored and retained locally.
Historical startup Markdown remains local because it links those raw exports and
records incomplete attempts. Smaller synthetic numeric summaries, budgets,
confirmations and the bounded dashboard reports are included after review.

The source archive contained three email-like strings; an old collector trace
contained local user paths. Neither is published. No token, private-key or secret
key pattern was detected in the new reports selected for publication. Pattern
scanning is supplemented by field/content review and does not prove that an
arbitrary future export is safe. Generated builds, cached dependency/runtime
files, CLI state, environment files and account storage are excluded.

## Validation and rollout

The complete combined JavaScript suite passed 191 tests with no failures/skips,
including a real isolated production-browser offline sequence and both saved-build
switching directions. The Python suite passed 99 tests, with one existing
Starlette deprecation warning; standalone live transport/frame-pump checks passed.
Normal production build, typecheck and seven route/bundle smoke checks passed.
Lint has zero errors and three existing Fast Refresh warnings. The test runtime
review copy is now excluded from lint to avoid linting duplicate generated files.

Actual local Supabase roles/concurrency/transactions passed earlier on the same
unchanged migration and database-test sources. Advisors reported zero errors,
37 performance warnings and 34 informational findings, documented in the release
review. No production database was inspected or changed. Saved comparison build
hashes and all historical measurement files were preserved.

Commits are grouped into application fixes/offline scoring, startup tooling and
publication controls, bounded dashboard diagnostics, annotation-fixture completion,
and this combined validation record. Push these to a review branch; no merge or
deployment is included. The migration and private notification scheduler header
must still be coordinated through the separately authorized rollout in
`docs/bugfix-rollout.md`. No production configuration, data or scheduler was changed.

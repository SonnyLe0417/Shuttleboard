# Bounded signed-in summary capture

Local development, unthrottled desktop Chrome. No production speedup is claimed.

| Scenario      | Timed requests | Median ms | p90 ms | Maximum ms | Failures | Visibility flagged |
| ------------- | -------------: | --------: | -----: | ---------: | -------: | -----------------: |
| document-load |             10 |     161.1 |  278.5 |      331.5 |        0 |                  9 |
| stale-return  |             20 |     322.5 |  460.9 |      894.7 |        0 |                  0 |

0 measured requests exceeded the 2,000 ms diagnostic threshold. Missing timing is preserved as null; failed, unknown and interrupted counts appear separately in the machine-readable summary. Parallel server spans overlap and must not be summed. Supabase spans combine transport, gateway and database work; they are not SQL execution times.

The historical 28.6-second request was uninstrumented. This session cannot retrospectively identify its cause. No request exceeded the two-second threshold, so no slow request was available for log correlation. Supabase project-log access was not established; SQL execution time remains unmeasured.

Protocol: One initial warmup excluded; ten document reloads; twenty stale returns after waits of at least 65 seconds. Account requests stopped after final export, within 30 minutes of measured-session start and below 60 summary requests. Cache expiry was not manipulated.

Collection notes: Raw entries retain the warmup and two setup duplicates from development hot reload before resource deduplication was fixed; those three entries are explicitly excluded from statistics, not deleted. The first stale-return helper read the prior reload ID 3395662584 before the new response finished. A proposed helper-ID overwrite was rejected and not performed. The actual response remains separately recorded as 3395662585; no request was repeated. The second helper waited for an attribute absent from an already-mounted module and timed out. Its response remains recorded as 3395662586; no request was repeated. Visibility flags include initially hidden tabs as well as visibility changes. Nine measured reloads are flagged and retained; all twenty measured stale returns are unflagged. Instrumentation was refined during preparation/early collection; summary queries and server timing spans were unchanged throughout measured requests. No measured requests failed, lacked timing spans, or remained pending at export. The historical 28.6-second stall was not reproduced.

Raw session: [dashboard-summary-capture.json](dashboard-summary-capture.json). Computed results: [dashboard-summary-capture-summary.json](dashboard-summary-capture-summary.json). Nothing was deployed, pushed, or changed in the account.

# Dashboard performance comparison

Production-built isolated dashboard harness with fixed synthetic data; 10 samples per scenario after one discarded warm-up. Browser: 155.0.4283.62. See [protocol](README.md) and raw baseline/optimized JSON for reproducible settings.

## Results

| Profile | Matches | Scenario | Before median ms | After median ms | Improvement |          p90 ms |    API bytes | API requests |
| ------- | ------: | -------- | ---------------: | --------------: | ----------: | --------------: | -----------: | -----------: |
| mobile  |       0 | cold     |           6487.5 |          4783.6 |       26.3% | 6935.2 → 5404.5 |    311 → 515 |        2 → 2 |
| mobile  |       0 | cached   |            243.5 |           193.3 |       20.6% |   409.4 → 269.2 |        0 → 0 |        0 → 0 |
| mobile  |       0 | stale    |            278.4 |           196.8 |       29.3% |   378.8 → 356.4 |    309 → 515 |        1 → 2 |
| mobile  |       0 | details  |            538.8 |           477.7 |       11.3% |   733.8 → 675.8 |    281 → 127 |        2 → 1 |
| mobile  |      20 | cold     |           7138.6 |          5907.0 |       17.3% | 7678.2 → 6268.1 | 16744 → 1943 |        2 → 2 |
| mobile  |      20 | cached   |            270.3 |           186.9 |       30.9% |   325.7 → 226.9 |        0 → 0 |        0 → 0 |
| mobile  |      20 | stale    |            385.3 |           402.7 |       -4.5% |   555.5 → 487.3 |   646 → 1943 |        1 → 2 |
| mobile  |      20 | details  |            903.9 |           663.2 |       26.6% |  1398.2 → 934.1 |    281 → 127 |        2 → 1 |
| mobile  |     100 | cold     |           6740.2 |          5364.6 |       20.4% | 7302.5 → 6305.6 | 81132 → 1945 |        2 → 2 |
| mobile  |     100 | cached   |            426.8 |           225.6 |       47.1% |   640.2 → 278.4 |        0 → 0 |        0 → 0 |
| mobile  |     100 | stale    |            237.7 |           255.0 |       -7.3% |   344.8 → 452.2 |   646 → 1945 |        1 → 2 |
| mobile  |     100 | details  |            669.6 |           404.7 |       39.5% |  1150.8 → 599.0 |    281 → 127 |        2 → 1 |
| desktop |       0 | cold     |            274.8 |           233.4 |       15.1% |   298.6 → 243.9 |    311 → 515 |        2 → 2 |
| desktop |       0 | cached   |             62.2 |            51.7 |       16.9% |     86.0 → 58.2 |        0 → 0 |        0 → 0 |
| desktop |       0 | stale    |             54.7 |            51.6 |        5.6% |     79.3 → 75.5 |    309 → 515 |        1 → 2 |
| desktop |       0 | details  |             83.9 |            80.2 |        4.5% |   131.4 → 115.7 |    281 → 127 |        2 → 1 |
| desktop |      20 | cold     |            276.2 |           217.7 |       21.2% |   298.8 → 242.6 | 16744 → 1943 |        2 → 2 |
| desktop |      20 | cached   |             68.4 |            65.1 |        4.8% |    100.0 → 84.9 |        0 → 0 |        0 → 0 |
| desktop |      20 | stale    |             73.3 |            76.9 |       -4.9% |   100.0 → 101.9 |   646 → 1943 |        1 → 2 |
| desktop |      20 | details  |             88.0 |            87.7 |        0.4% |   140.1 → 145.7 |    281 → 127 |        2 → 1 |
| desktop |     100 | cold     |            309.6 |           253.9 |       18.0% |   420.2 → 322.8 | 81132 → 1945 |        2 → 2 |
| desktop |     100 | cached   |             64.9 |            62.7 |        3.5% |     86.6 → 73.5 |        0 → 0 |        0 → 0 |
| desktop |     100 | stale    |             59.9 |            53.1 |       11.4% |     73.2 → 57.6 |   646 → 1945 |        1 → 2 |
| desktop |     100 | details  |            120.1 |           107.0 |       10.9% |   150.3 → 136.3 |    281 → 127 |        2 → 1 |

Positive percentages are faster; negative percentages are slower. Cached/stale readiness means usable cached content, not completion of its background refresh. The raw JSON also records summary readiness and response completion.

## Request pipeline (supplementary)

From the first dashboard API request to primary-content paint; excludes document/module startup. This helps explain the request optimization, and does not replace the full-navigation acceptance target above.

| Profile | Matches | Before data-ready ms | After data-ready ms |
| ------- | ------: | -------------------: | ------------------: |
| mobile  |       0 |               3239.6 |              1313.5 |
| mobile  |      20 |               3670.5 |              2283.5 |
| mobile  |     100 |               3062.1 |              2043.1 |
| desktop |       0 |                143.8 |                81.0 |
| desktop |      20 |                145.2 |                78.4 |
| desktop |     100 |                168.3 |               101.6 |

## Acceptance

- completeMatrix: **PASS**
- twentyPercentEveryPopulatedMobileScenario: **NOT MET**
- smallerPopulatedColdPayloads: **PASS**
- entryNotIncreased: **PASS**
- staticInitialJavascriptNotIncreased: **PASS**

Main entry: 192,272 → 161,045 bytes. Static initial import closure: 612,295 → 581,068 bytes. These uncompressed counts exclude dynamic route/intent loads. Harness JavaScript transfer is recorded separately and is not the main-app bundle.

## Timing regressions and limits

No scenario regressed more than 10% in this comparison.

Fixture timing covers the real dashboard component, query orchestration, browser execution and controlled response transfer. It excludes the production app shell, real database execution, auth checks, and internet variability; it is not a measured percentage improvement for real accounts. Server requests remain authenticated and RLS-protected. No TrackNet settings or database migrations changed.

## Live verification

Signed-in development-server observations are recorded in
[live verification](dashboard-live-verification.md), including ten genuine stale
returns per viewport and a retained latency spike. The controlled production
real-account matrix remains unverified. No synthetic run is counted as account verification.

## Correctness

114 unit tests, including statistical parity, viewer orientation, latest-100 limits, saved preference patches, cache reuse and timezone boundaries. Browser fixture interaction results are in dashboard-interactions.json; all three layout preferences, independent retries and protected goal drafts are exercised. See the implementation notes for final build/typecheck/lint status. Nothing was pushed or deployed.

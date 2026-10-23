# Real-account dashboard observations

Signed-in Chrome on the local **development** server at port 5173. Phone viewport:
390 × 900; desktop: 1440 × 900. Both are unthrottled desktop-browser emulations.
These results are separate from the controlled production-built fixture comparison.

## Results

| Viewport | Scenario | Samples | Median ms | p90 ms | API resources | Decoded API bytes |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| desktop | warm-reload | 10 | 1381.5 | 1746.6 | 3–4 | 4525 |
| desktop | cached-return | 10 | 5.7 | 9.2 | 0–0 | 0 |
| desktop | open-details | 10 | 392.6 | 449.5 | 4–4 | 10637 |
| phone | warm-reload | 10 | 879.5 | 1032.6 | 3–3 | 4525 |
| phone | cached-return | 10 | 4.9 | 7.4 | 0–0 | 0 |
| phone | open-details | 10 | 401.4 | 419.6 | 4–5 | 10637 |
| phone | stale-return | 10 | 14.4 | 40.3 | 2–2 | 4340 |
| desktop | stale-return | 10 | 28.3 | 48.9 | 2–2 | 4340 |

Reloads retain the browser HTTP cache but recreate the page query cache. They are
**not cold browser-context loads**. Readiness means DOM availability of the primary
controls/profile/preferences/recent-match state, or progress details after clicking
its control; it is not paint, INP, or verified interaction latency. Summary timing
is recorded separately in the raw data. Cached and stale readiness permits existing
content while background refresh continues. API counts include onboarding and
expanded progress when applicable. Bytes are decoded bodies, not wire bytes.

Reload timing starts at document navigation. Return timing starts at **route-loader
entry**, after route guards, and can follow intent prefetch; it is not a complete
navigation-click-to-ready measurement. Stale request windows use explicit route
leave and query-start marks to include both completed prefetches and in-flight
refreshes. Negative request offsets mean a request began before the loader.

One warm-up is discarded per scenario. Medians average the middle two values;
p90 uses nearest rank. Phone and desktop runs happened sequentially on the same
computer, so their differences must not be interpreted as device-speed comparisons.

## Behavior and limitations

- All 20 fresh cached-return samples made zero dashboard requests.
- Expanded progress loaded with one deferred progress request per opening in all
  20 detail samples. The account's existing saved layout was used unchanged.
- The 390 px viewport had no document-level horizontal overflow.
- Three reload/detail samples included an extra core resource with no response
  timing or byte information. These are retained in resource counts; their outcome
  is unknown, and request deduplication is not claimed for those reloads.
- No account preferences, match records or scoring controls were changed.
- The diagnostic HMR cleanup was repaired after measurement: observers now watch
  only main content, excluding their own output, and dispose on hot reload. A
  synthetic fixture passed ten successive hot reloads with exactly one panel and
  functioning summary/detail readiness. Synthetic results are not account timings.

## Latency spike retained

The slowest observed summary response took **28643.9 ms**. There was
1 measurement wait deadline exceedance; the same response was later
collected successfully, without reissuing the request. Cached primary content stayed
available. This outlier is retained in the raw data and maximum request statistic;
with ten samples, nearest-rank p90 alone can hide the single slowest response.
The cause is not isolated: network, authentication and database work are combined.

Genuine stale-cache observations are included above; their raw wait durations and request timings are in dashboard-live-stale.json.

The full production real-account matrix, fixed mobile network/CPU throttling,
initial JavaScript transfer measurement, and isolated authentication/database
spans remain unverified. Browser resource duration combines transport and server
work; onboarding request duration is not isolated authentication latency. No
matching pre-change real-account baseline exists, so no live-account percentage
speedup is claimed. Existing fixture acceptance targets remain unchanged.

Raw data: [current observations](dashboard-live-current.json),
[computed summary](dashboard-live-summary.json). Older frame-based observations
remain in dashboard-live-observations.json and are excluded from this comparison.
Reports contain timing/size/count metadata only, without credentials, account
identifiers, match content or account screenshots. Nothing was published.

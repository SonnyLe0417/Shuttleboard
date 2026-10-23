# Performance work

## App loading and playback

The production main entry chunk decreased from 306,080 to 194,301 bytes
(36.5%; gzip 95,974 to 61,794 bytes). This is an entry-chunk measurement,
not a measured reduction in total page-load time. Navigation dropdown code is
loaded separately, and the toast host is deferred. All menu destinations remain.

Route intent preloading starts after 100 ms. Dashboard data prefetching starts
with its route loader and shares the React Query cache with the page. Browser
session consumers share one auth subscription. Server authorization is unchanged.
TrackNet progress updates render the progress banner without making the whole
root layout consume the changing analysis context.

Playback trails cache visible positions per immutable coordinate array and use
binary search for each playback position. A local benchmark of 1,000 lookups on
54,000 positions took 1,390 ms before and 1.37 ms after, with equal result counts.
This measures warm trail lookup only, not AI inference or total rendering time.
Replace coordinate arrays when editing results; do not mutate cached arrays.

## TrackNet V3

These engine changes apply to the optional V3 service. The launcher still defaults
to the existing engine, which also supplies live tracking. Frontend improvements
apply to either engine. No frame-stride, resolution, precision, confidence, or
repair defaults were lowered to achieve these changes.

- Normalize each decoded frame once and reuse it in overlapping windows.
- Optionally prepare frames on a bounded background queue while inference runs.
- Retain only the selected heatmap accumulation instead of both averaging modes.
- Compute the background median in its private sample buffer.
- Skip repair-model windows containing no positions needing repair.
- Reuse compatible compiled models when evaluation/repair options change;
  retain at most three recent settings variants in addition to the base engine.
- Persist progress at most every two seconds; in-memory progress and terminal
  updates remain immediate. Stream uploads in larger chunks and return stored
  result JSON without walking and re-encoding every coordinate through FastAPI.

`TRACKNET_PREFETCH_WINDOWS` defaults to `0` (synchronous), accepts `0` through `8`,
and can be set to `2` to test overlapping decoding. A larger queue consumes more memory
and is not automatically faster. Restart the service after environment changes.

Results include `background_seconds`, `tracking_seconds`, `repair_seconds`, and
`encoding_seconds` to identify the actual bottleneck. These exclude model loading;
the existing benchmark script also records model-loading time separately.

Use `scripts/benchmark-tracknet.py --help` for repeatable runs on a fixed clip.
Compare identical backend, device, thread count, precision, evaluation mode,
resolution, repair option, and output-video setting. Compare coordinates as well
as time, and measure several runs without other CPU-heavy tasks. A short clip is
not evidence of accuracy across full matches.

A 119-frame, 640x360 clip tested with OpenVINO CPU, eight inference threads,
weighted evaluation, stride one, FP32, no repair, and encoded video produced
exactly identical coordinate JSON before and after these changes, including
confidence values. Original elapsed times were 349.83 and 533.52 seconds; the
optimized run with prefetch depth two took 698.72 seconds (690.86 tracking,
7.35 background, 0.51 encoding). These variable timings do not demonstrate an
end-to-end speedup. Prefetch was therefore left opt-in, and the second optimized
run was cancelled. The final synchronous default has not had a full-video timing
comparison; unit tests exercise both synchronous and queued frame delivery.

The local Intel GPU has previously produced OpenVINO kernel compilation errors.
GPU selection was not made the default. Successful device validation and output
parity are prerequisites to measuring it as a faster option. Non-overlap mode,
lower precision, and increased frame stride can change detections; they remain
explicit tradeoffs rather than automatic performance changes.

## Verification

- Production build, TypeScript checks, and ESLint (three existing refresh warnings).
- 102 JavaScript tests and 82 Python tests, including session subscription
  lifecycle, seek parity, prefetch order/errors/shutdown, and model reuse.
- Local HTTP response and browser checks for landing, scoreboard, and More menu.
  Signed-in workflows were not exercised with a real account.
- Direct unsigned navigation to `/video` redirects to `/auth`, but the development
  browser logs a hydration mismatch during that redirect. This remains unresolved;
  the interactive sign-in page renders after React regenerates the affected tree.

## Dashboard request follow-up

The dashboard request split, saved-goal fix, cache behavior and repeatable browser
benchmark are documented in [the dashboard performance notes](performance/dashboard-implementation.md).
Their before/after results are separate from the earlier entry-chunk and TrackNet measurements above.


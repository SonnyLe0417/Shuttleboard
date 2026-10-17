# TrackNet V3: measured results and running instructions

V3 is installed and available for uploaded videos. Both official models have
been converted to full-precision OpenVINO. The old engine is still the default:
it was faster on this computer. Nothing has been committed or published.

## Comparison on this computer

Measured September 19, 2026 (local time), on an Intel i7-1255U laptop. To keep
the first comparison short, we used three four-second clips starting at 60,
430, and 840 seconds from `C:\Users\Sonny\Downloads\tracknet_predict.mp4`
(also present as `public/tracknet_predict.mp4`). Each engine processed the same
358 frames, including creation of its output video. This is a sample comparison,
not a completed benchmark of all 26,284 frames in the source video.

| Engine | Processing time | With loading | Frames/second | Visible output frames | Missing frames | Peak memory |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Current TrackNet, OpenVINO CPU | 65.25 s | 75.06 s | 5.49 | 278 | 80 | 634 MiB |
| V3, PyTorch CPU | 247.89 s | 273.14 s | 1.44 | 330 | 28 | 798 MiB |
| V3, OpenVINO CPU | 198.39 s | 201.66 s | 1.80 | 330 | 28 | 762 MiB |

Times are summed across three separate runs per engine. FPS is total frames
divided by processing time, excluding loading. Memory is the largest sampled
process-tree RSS, including the encoder, not GPU memory.

OpenVINO gave V3 about 25% more frames per second than PyTorch in these runs.
The old engine was about three times faster than V3 OpenVINO. These are the
selected application settings, not a controlled comparison of model operations:
the old service uses its normal stride 4 and default OpenVINO CPU thread policy.
V3 used two CPU threads, batch 1, 512 x 288 input, full precision, repair enabled,
and `nonoverlap` mode (one prediction per eight-frame group). V3's normal
overlapping `weight` mode was not speed-benchmarked and does more work.

V3 directly detected positions in 279 frames and filled in another 51, leaving
28 missing. The old service's visible count includes its own interpolation and
is not a direct-detection count. More filled positions do **not** prove better
accuracy. The source already contains tracking marks, and there are no manually
checked shuttle positions to score against. Neither model can be called the
accuracy winner from this test. Use an original, unmarked video and human labels
before trusting automatic scoring or deciding that V3 is more accurate.

### Conversion and service checks

- On all 358 comparison frames, PyTorch and OpenVINO agreed on visibility.
  Their biggest position difference was less than 0.0002 source-video pixels.
- The export check tested 32 real frame heatmaps: all decoded positions matched;
  maximum heatmap difference was 0.00000785. The repair-model maximum difference
  was 0.000000149. No INT8 quantization or compressed weights were used.
- Original upstream prediction ran successfully on a four-second clip. Our
  PyTorch adapter matched its visibility on all 119 frames; positions differed
  by at most 1.42 pixels, including rounding and repair handling differences.
- A real model API check passed health/loading, upload, job result, playable
  H.264 output, preview, invalid-video rejection, and cancellation.
- 93 Python tests, 62 application tests, the existing live wire-format check,
  TypeScript checking, and the production build passed. The Python run reported
  one dependency deprecation warning; the build reported bundler warnings.
  See commands below.

In the real API check, eight CPU threads processed the first 119-frame clip in
45.27 seconds (2.63 FPS), compared with 68.10 seconds (1.75 FPS) at two threads
in the suite. This is a separate one-clip tuning check, not a repeated three-clip
result. It still does not make V3 as fast as the old model.
All 119 visibility results and output positions matched the two-thread run.

Intel GPU is detected, and `AUTO`/`GPU` are supported settings. Local GPU trials
were very slow and produced an Intel compiler error; they were stopped and are
not counted as benchmark results. Use `CPU` here for now. The compiler log is
`.tracknet-v3/data/gpu-kernel-errors.txt`. No graphics drivers were changed.

## Run the app

Open PowerShell and run:

```powershell
Set-Location 'C:\Users\Sonny\OneDrive\Codex Projects\ShuttleBoard'
$env:TRACKNET_ENGINE = 'current'
$env:TRACKNET_BACKEND = 'openvino'
$env:TRACKNET_DEVICE = 'CPU'
npm run shuttleboard
```

Stop with Ctrl+C before switching. To try V3 for uploaded videos:

```powershell
$env:TRACKNET_ENGINE = 'v3'
$env:TRACKNET_BACKEND = 'openvino'
$env:TRACKNET_DEVICE = 'CPU'
$env:TRACKNET_EVAL_MODE = 'nonoverlap'
$env:TRACKNET_INTRA_THREADS = '8'
npm run shuttleboard
```

After choosing TrackNet AI in the video analyzer, the processing panel lets you
pick OpenVINO or PyTorch, CPU/AUTO/GPU, accurate overlap or faster non-overlap,
whether to fill missing path sections, and the CPU thread count. These choices
apply to the next uploaded job; they no longer require typing every setting into
PowerShell. The app must still be started with `TRACKNET_ENGINE=v3` to run V3.

To return to the old model, stop the app, set
`$env:TRACKNET_ENGINE = 'current'`, and run `npm run shuttleboard` again.
Use the old engine for live camera tracking. V3 currently supports uploads only;
the live camera sends three grayscale frames, whereas this V3 checkpoint needs
eight color frames plus a background. Its live endpoint explains the limitation.

No further model-file setup is needed on this computer. On another computer,
follow [runtime setup](tracknet-v3-reproducibility.md), then convert both models.
The large runtime folder is intentionally excluded from Git. An original video
and checked shuttle labels are still needed for a real accuracy comparison.
See [engine settings](tracknet-engines.md) for batch size, image size, sequence
stride, repair, device selection, and cancellation details.

## Reproduce the short comparison

```powershell
& '.tracknet-v3/.venv/Scripts/python.exe' scripts/compare-tracknet-v3.py `
  --device CPU --output-dir '.tracknet-v3/comparison-repeat'
```

Choose a fresh output directory each time. The completed local record is
`.tracknet-v3/comparison/suite.json`, with per-run coordinates, videos, settings,
hashes and timing reports below that directory. The real API record is
`.tracknet-v3/api-verification/verification.json`. All work stays local.

## Individual or full-video benchmarks

The runner below processes the whole supplied video unless sample extraction
is explicitly requested. A full comparison could take hours; it was not run.

Run one benchmark at a time after model setup is ready, using each engine's Python
environment. The runner takes an OS lock shared across output directories so two
invocations cannot benchmark concurrently. Stop other inference workloads manually;
the lock cannot prevent model setup, conversion, or independently launched services.

```powershell
# Current full service baseline (OpenVINO).
& '.tracknet-v3/.venv/Scripts/python.exe' `
  scripts/benchmark-tracknet.py --engine current --backend openvino `
  --video 'C:/videos/match.mp4' --output-dir '.tracknet-v3/benchmarks' --device CPU

# V3 full service processing; run after the baseline finishes.
& '.tracknet-v3/.venv/Scripts/python.exe' scripts/benchmark-tracknet.py `
  --engine v3 --backend openvino --video 'C:/videos/match.mp4' `
  --output-dir '.tracknet-v3/benchmarks' --device CPU

# PyTorch V3; choose AUTO, CPU, or GPU as supported by the engine.
& '.tracknet-v3/.venv/Scripts/python.exe' scripts/benchmark-tracknet.py `
  --engine v3 --backend pytorch --video 'C:/videos/match.mp4' `
  --output-dir '.tracknet-v3/benchmarks' --device CPU
```

`--current-dir` overrides the sibling current repository. Current has no PyTorch
backend, so `--engine current --backend pytorch` is rejected. Current OpenVINO
fallback to TensorFlow also fails the run rather than publishing mislabeled data.
`psutil` must be installed in the selected Python environment.

Video output defaults to **true** to compare full service processing consistently.
Use `--output-video` explicitly or `--no-output-video` to disable it for V3. The
current service's `_process_job` always encodes video; its report records effective
video output as true even when false was requested. Do not compare that timing with
a V3 run that disables video. The runner calls the existing current service loop,
including its drawing, interpolation, file writing and optional H.264 transcode.
It copies the input into the run directory first so the service does not create
outputs beside the original video.

Each invocation creates a unique child directory under `--output-dir`, containing
`benchmark.json`, `coordinates.json`, and engine output artifacts. Failures after
measurement starts also write `benchmark.json` with the error and sampled memory.
The runner uses V3's constructor followed by
`analyze(video_path, output_dir, progress=..., cancelled=..., output_video=...)`.

Reported timing includes engine import, constructor/model loading, and processing;
the second elapsed value excludes import and constructor/model loading. Both use
monotonic wall time. Processing includes decode, preprocess, inference, postprocess,
serialization performed by the service, and encoding when enabled. The current
adapter also reads its service coordinates file during processing. Input staging,
input/source hashes, report writing, and the runner's final coordinates serialization
are outside timing. No warm-up is excluded: first-inference lazy compilation remains
in processing time. V3 must load its model during construction for the constructor
interval to represent complete model loading.

Memory is sampled with psutil every 50 ms from import through processing. Reports
contain process RSS and summed process-tree RSS, including observed encoder children.
These are sampled peaks, may miss short-lived spikes, may double-count shared pages,
and do not measure GPU memory. The environment, requested backend/device, current
effective settings, engine-returned metrics, input path and content SHA-256 hashes,
source file hashes, Git revisions, and tracked changes are retained for traceability.
An uncommitted engine source is identified by its file hash; a revision alone does
not identify worktree changes.

V3 defaults to stride 1 unless `TRACKNET_FRAME_STRIDE` is explicitly set. Evaluation
mode and checkpoint-derived sequence length are owned by V3; the runner preserves
its defaults (expected: weight evaluation and sequence length from the checkpoint)
and saves the returned metrics. Current retains its service defaults, including
stride 4; record this difference when interpreting throughput and visibility.

`visible` counts coordinate rows whose `visible` field is true; `missing` is the
remaining frame count. These are coverage statistics, **not accuracy**. They may
include warm-up frames, interpolation, skipped inference frames, and model misses.
Accuracy requires independently labeled ground truth.

Benchmark contract tests do not load models or benchmark video:

```powershell
& '.tracknet-v3/.venv/Scripts/python.exe' scripts/test_tracknet_v3.py
```

Run all V3 tests and the existing application checks:

```powershell
& '.tracknet-v3/.venv/Scripts/python.exe' -m pytest scripts/test_tracknet_v3.py scripts/test_tracknet_v3_setup.py tests/test_tracknet_v3_service.py -q
& '.tracknet-v3/.venv/Scripts/python.exe' scripts/test_tracknet_live.py
npm test
npm run build
```

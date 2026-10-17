"""Run one local TrackNet service benchmark; never a detection-accuracy test."""

from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CURRENT_DIR = ROOT.parent / "TrackNet-Badminton-Tracking-tensorflow2-main"
LOCK_PATH = Path(tempfile.gettempdir()) / "shuttleboard-tracknet-benchmark.lock"


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--engine", choices=("current", "v3"))
    result.add_argument("--backend", choices=("pytorch", "openvino"), default="openvino")
    result.add_argument("--video", type=Path, required=True)
    result.add_argument("--output-dir", type=Path, required=True)
    result.add_argument("--device", choices=("AUTO", "CPU", "GPU"), default="AUTO")
    result.add_argument("--current-dir", type=Path, default=DEFAULT_CURRENT_DIR)
    result.add_argument("--eval-mode", choices=("weight", "average", "nonoverlap"),
                        help="V3 temporal aggregation; default TRACKNET_EVAL_MODE or weight. "
                        "nonoverlap trades overlapping predictions for speed, with unmeasured accuracy impact")
    result.add_argument("--extract-sample-only", action="store_true",
                        help="extract an H.264 sample with FFmpeg; do not import or run a model")
    result.add_argument("--sample-start", type=float, default=0.0, help="sample start in seconds (default: 0)")
    result.add_argument("--sample-seconds", type=float, default=30.0, help="sample duration (default: 30)")
    result.add_argument(
        "--output-video", action=argparse.BooleanOptionalAction, default=True,
        help="encode the result video (default: true for service comparisons); "
        "the current service always encodes, even with --no-output-video",
    )
    return result


@contextmanager
def exclusive_benchmark(lock_path: Path = LOCK_PATH):
    """OS-held lock survives the lock file and is released even after a crash."""
    with lock_path.open("a+b") as handle:
        handle.seek(0, os.SEEK_END)
        if handle.tell() == 0:
            handle.write(b"0")
            handle.flush()
        handle.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            raise RuntimeError("Another TrackNet benchmark is running; run benchmarks sequentially.") from exc
        try:
            yield
        finally:
            handle.seek(0)
            if os.name == "nt":
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle, fcntl.LOCK_UN)


class MemorySampler:
    """Sample process-tree RSS, including encoder children; not GPU memory."""

    def __init__(self, interval: float = 0.05):
        try:
            import psutil
        except ImportError as exc:
            raise RuntimeError("Install psutil in the selected engine's Python environment.") from exc
        self.psutil = psutil
        self.process = psutil.Process()
        self.interval = interval
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.peak = 0
        self.peak_tree = 0
        self.samples = 0
        self.errors = 0

    def _sample(self):
        try:
            rss = self.process.memory_info().rss
            total = rss
            for child in self.process.children(recursive=True):
                try:
                    total += child.memory_info().rss
                except self.psutil.Error:
                    self.errors += 1
            self.peak = max(self.peak, rss)
            self.peak_tree = max(self.peak_tree, total)
            self.samples += 1
        except self.psutil.Error:
            self.errors += 1

    def _run(self):
        while not self.stop_event.wait(self.interval):
            self._sample()

    def __enter__(self):
        self._sample()
        self.baseline = self.peak
        self.thread.start()
        return self

    def __exit__(self, *_):
        self.stop_event.set()
        self.thread.join()
        self._sample()

    def report(self):
        return {
            "method": "psutil sampled RSS; child RSS summed (shared pages may be counted twice)",
            "sample_interval_seconds": self.interval,
            "samples": self.samples,
            "sampling_errors": self.errors,
            "baseline_rss_bytes": self.baseline,
            "peak_process_rss_bytes": self.peak,
            "peak_process_tree_rss_bytes": self.peak_tree,
            "scope": "engine import, model loading, analysis and encoding; excludes GPU memory",
        }


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def source_info(directory: Path, source: Path | None = None) -> dict:
    def git(*args):
        try:
            run = subprocess.run(
                ["git", "-C", str(directory), *args], capture_output=True,
                text=True, timeout=15, check=True,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            return run.stdout.strip()
        except (OSError, subprocess.SubprocessError):
            return None

    revision = git("rev-parse", "HEAD")
    status = git("status", "--porcelain", "--untracked-files=no") if revision else None
    result = {"directory": str(directory), "revision": revision,
              "tracked_changes": status, "dirty": bool(status) if status is not None else None}
    if source is not None:
        result.update(source_path=str(source), source_sha256=sha256_file(source))
    return result


def load_module(name: str, path: Path):
    if not path.is_file():
        raise FileNotFoundError(f"Engine module is not ready: {path}")
    sys.path.insert(0, str(path.parent))
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot import {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def validate_result(result: dict) -> tuple[int, int, int]:
    frames = result["frames"]
    coordinates = result["coordinates"]
    if isinstance(frames, bool) or not isinstance(frames, int) or frames <= 0:
        raise ValueError("Engine did not return a positive integer frame count.")
    if not isinstance(coordinates, list) or len(coordinates) != frames:
        raise ValueError("Engine frame count does not match its coordinate list.")
    if any(not isinstance(row, dict) or not isinstance(row.get("visible"), (bool, int))
           or row["visible"] not in (False, True) for row in coordinates):
        raise ValueError("Every coordinate must explicitly report visible as a boolean or 0/1.")
    visible = sum(bool(row["visible"]) for row in coordinates)
    return frames, visible, frames - visible


def run_current(module, input_path: Path) -> dict:
    job_id = uuid.uuid4().hex
    with module._jobs_lock:
        module._jobs[job_id] = {"status": "queued", "frames": 0}
    try:
        module._process_job(job_id, input_path)
        with module._jobs_lock:
            job = dict(module._jobs[job_id])
        if job.get("status") != "completed":
            raise RuntimeError(job.get("error", "Current service did not complete the job."))
        return {
            "frames": job["frames"],
            "coordinates": json.loads(Path(job["coordinates_path"]).read_text(encoding="utf-8")),
            "video_path": job["video_path"],
            "metrics": {"service_elapsed_seconds": job.get("elapsed_seconds")},
        }
    finally:
        with module._jobs_lock:
            module._jobs.pop(job_id, None)


def write_json(path: Path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    temporary.replace(path)


def extract_sample(args) -> Path:
    """Accurate seek plus re-encode; a separate, non-benchmark preparation step."""
    if not math.isfinite(args.sample_start) or args.sample_start < 0:
        raise ValueError("--sample-start must be finite and nonnegative.")
    if not math.isfinite(args.sample_seconds) or args.sample_seconds <= 0:
        raise ValueError("--sample-seconds must be finite and positive.")
    source = args.video.expanduser().resolve(strict=True)
    if not source.is_file():
        raise ValueError("--video must be a regular file.")
    candidates = [os.getenv("TRACKNET_FFMPEG"), "ffmpeg",
                  r"C:\Program Files\obs-studio\bin\64bit\ffmpeg.exe",
                  r"C:\Program Files\Streamlabs OBS\resources\app.asar.unpacked\node_modules\obs-studio-node\ffmpeg.exe"]
    executable = next((resolved for candidate in candidates if candidate
                       for resolved in [shutil.which(candidate)] if resolved), None)
    if executable is None:
        raise RuntimeError("FFmpeg not found. Set TRACKNET_FFMPEG to its executable.")
    directory = args.output_dir.expanduser().resolve() / ("sample-" + uuid.uuid4().hex[:12])
    directory.mkdir(parents=True, exist_ok=False)
    output = directory / "sample.mp4"
    command = [executable, "-hide_banner", "-v", "error", "-nostdin", "-n",
               "-ss", str(args.sample_start), "-i", str(source), "-t", str(args.sample_seconds),
               "-map", "0:v:0", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
               "-pix_fmt", "yuv420p", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2",
               "-movflags", "+faststart", "-progress", "pipe:1", str(output)]
    completed = subprocess.run(command, capture_output=True, text=True, check=True,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    frame_counts = [int(line.split("=", 1)[1]) for line in completed.stdout.splitlines() if line.startswith("frame=")]
    if not frame_counts or max(frame_counts) <= 0 or not output.is_file():
        raise ValueError("FFmpeg extracted no frames; check the sample start and source duration.")
    write_json(directory / "sample.json", {
        "source_path": str(source), "source_content_sha256": sha256_file(source),
        "sample_path": str(output), "sample_content_sha256": sha256_file(output),
        "start_seconds": args.sample_start, "requested_duration_seconds": args.sample_seconds,
        "frames": max(frame_counts), "command": command,
        "note": "Re-encoded preparation sample; not a benchmark or an accuracy/parity result. "
                "Use the same sample file for both engines. A clip is not representative of all match conditions.",
    })
    return output


def benchmark(args) -> tuple[dict, Path]:
    if not args.engine:
        raise ValueError("--engine is required for benchmarks.")
    video = args.video.expanduser().resolve(strict=True)
    if not video.is_file():
        raise ValueError(f"Video is not a regular file: {video}")
    if args.engine == "current" and args.backend != "openvino":
        raise ValueError("The current engine has no PyTorch backend; use current/openvino or v3/pytorch.")
    if args.engine == "current" and args.eval_mode is not None:
        raise ValueError("--eval-mode applies only to V3.")
    current_dir = args.current_dir.expanduser().resolve()
    source = current_dir / "tracknet_service.py" if args.engine == "current" else ROOT / "scripts/tracknet_v3.py"
    if not source.is_file():
        raise FileNotFoundError(f"Engine module is not ready: {source}")
    run_name = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + args.engine + "-" + uuid.uuid4().hex[:8]
    output_dir = args.output_dir.expanduser().resolve() / run_name
    output_dir.mkdir(parents=True, exist_ok=False)
    report_path = output_dir / "benchmark.json"
    effective_output_video = args.output_video or args.engine == "current"
    notes = [
        "Visible/missing are output visibility counts, NOT accuracy; no ground truth is evaluated.",
        "Elapsed analysis is service processing, not isolated model inference; it includes decoding, "
        "pre/postprocessing, and any requested or forced video encoding.",
        "No warm-up is excluded. First-inference compilation/tracing remains in analysis time.",
    ]
    if args.engine == "current" and not args.output_video:
        notes.append("Current _process_job always writes video: encoding is INCLUDED despite --no-output-video; "
                     "do not compare this timing to V3 with video disabled.")
    os.environ.update(TRACKNET_ENGINE=args.engine, TRACKNET_BACKEND=args.backend,
                      TRACKNET_DEVICE=args.device, TRACKNET_DATA_DIR=str(output_dir / "service_data"))
    if args.engine == "v3":
        os.environ.setdefault("TRACKNET_FRAME_STRIDE", "1")
        if args.eval_mode is not None:
            os.environ["TRACKNET_EVAL_MODE"] = args.eval_mode
        if args.backend == "pytorch" and args.device == "GPU":
            os.environ["TRACKNET_DEVICE"] = "CUDA"
        if os.getenv("TRACKNET_EVAL_MODE", "weight") == "nonoverlap":
            notes.append("NONOVERLAP speed configuration: uses disjoint sequence windows rather than "
                         "weighted overlapping predictions. Accuracy may differ; this run does not measure that tradeoff.")
    report = {
        "schema_version": 1, "status": "running", "started_at_utc": datetime.now(timezone.utc).isoformat(),
        "engine": args.engine,
        "input": {"path": str(video), "path_sha256": hashlib.sha256(str(video).encode("utf-8")).hexdigest(),
                  "content_sha256": sha256_file(video), "size_bytes": video.stat().st_size},
        "settings": {"backend_requested": args.backend, "device_requested": args.device,
                     "output_video_requested": args.output_video, "output_video_effective": effective_output_video,
                     "environment": {key: value for key, value in sorted(os.environ.items())
                                     if key.startswith(("TRACKNET_", "OMP_NUM_THREADS", "MKL_NUM_THREADS", "TF_NUM_"))}},
        "runtime": {"python": sys.version, "executable": sys.executable, "platform": platform.platform(),
                    "cpu_count": os.cpu_count()},
        "sources": {"runner": source_info(ROOT, Path(__file__).resolve()),
                    "engine": source_info(source.parent, source)},
        "notes": notes,
    }
    if args.engine == "v3":
        report["sources"]["upstream"] = source_info(Path(os.getenv("TRACKNET_V3_DIR", ROOT / ".tracknet-v3/repo")).resolve())
    # Current service chooses its output directory from input_path.parent. Stage the
    # input without changing the service or allowing it to write beside the original.
    input_path = video
    if args.engine == "current":
        input_path = output_dir / ("input" + video.suffix)
        shutil.copyfile(video, input_path)
        notes.append("Input staging and input/source hashing are outside elapsed and memory measurements.")
    memory = MemorySampler()
    timer = time.perf_counter()
    try:
        with memory:
            module = load_module("tracknet_service" if args.engine == "current" else "tracknet_v3", source)
            import_done = time.perf_counter()
            if args.engine == "current":
                module._load_model()
                if module._active_backend != args.backend:
                    raise RuntimeError(f"Requested {args.backend}, but current service fell back to {module._active_backend}.")
                engine = None
                report["settings"].update(
                    backend_actual=module._active_backend, device_actual=module._active_device,
                    frame_stride=module.FRAME_STRIDE, batch_size=module.INFERENCE_BATCH_SIZE,
                    sequence_length=module.FRAME_STACK, threshold=module.THRESHOLD,
                    input_height=module.HEIGHT, input_width=module.WIDTH,
                    model_path=str(module.OPENVINO_MODEL_PATH),
                )
            else:
                engine = module.V3Engine()
                report["settings"].update({key: getattr(engine, attribute) for key, attribute in {
                    "backend_actual": "backend", "device_actual": "device", "frame_stride": "stride",
                    "sequence_length": "seq_len", "inpaint_sequence_length": "inpaint_seq_len",
                    "eval_mode": "eval_mode", "batch_size": "batch_size", "background_mode": "bg_mode",
                    "background_samples": "samples", "inpaint": "inpaint", "input_width": "width",
                    "input_height": "height",
                }.items() if hasattr(engine, attribute)})
            load_done = time.perf_counter()
            print(f"Model ready in {load_done - timer:.1f}s: {report['settings'].get('device_actual')}", flush=True)
            last_percent = [-10]
            def report_progress(fraction, frames, total):
                percent = int(fraction * 100)
                if percent >= last_percent[0] + 10:
                    print(f"{percent}%: {frames}/{total} frames", flush=True)
                    last_percent[0] = percent
            result = run_current(module, input_path) if engine is None else engine.analyze(
                video_path=str(video), output_dir=str(output_dir),
                progress=report_progress,
                cancelled=lambda: False, output_video=args.output_video,
            )
            analysis_done = time.perf_counter()
        frames, visible, missing = validate_result(result)
        report["timing"] = {
            "engine_import_seconds": import_done - timer,
            "model_load_seconds": load_done - import_done,
            "elapsed_including_model_load_seconds": analysis_done - timer,
            "elapsed_excluding_model_load_seconds": analysis_done - load_done,
            "frames_per_second_including_model_load": frames / (analysis_done - timer),
            "frames_per_second_excluding_model_load": frames / (analysis_done - load_done),
            "definition": "including = engine import + model init/load + analysis; excluding = analyze/_process_job call",
        }
        report.update(status="completed", frames=frames, visible=visible, missing=missing,
                      video_path=result.get("video_path"), engine_metrics=result.get("metrics", {}))
        write_json(output_dir / "coordinates.json", result["coordinates"])
    except BaseException as exc:
        report.update(status="failed", error=f"{type(exc).__name__}: {exc}",
                      elapsed_until_failure_seconds=time.perf_counter() - timer)
        raise
    finally:
        if hasattr(memory, "baseline"):
            report["memory"] = memory.report()
        write_json(report_path, report)
        print(f"Benchmark report: {report_path}", file=sys.stderr)
    return report, report_path


def main(argv=None) -> int:
    args = parser().parse_args(argv)
    try:
        with exclusive_benchmark():
            if args.extract_sample_only:
                print(f"Sample: {extract_sample(args)}")
                return 0
            report, path = benchmark(args)
        print(json.dumps({key: report[key] for key in ("status", "frames", "visible", "missing", "timing")}, indent=2))
        return 0
    except (Exception, KeyboardInterrupt) as exc:
        print(f"Benchmark failed: {exc}", file=sys.stderr)
        return 130 if isinstance(exc, KeyboardInterrupt) else 1


if __name__ == "__main__":
    raise SystemExit(main())

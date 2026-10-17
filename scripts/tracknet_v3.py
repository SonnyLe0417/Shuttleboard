"""TrackNetV3 video inference, sharing preprocessing across PyTorch and OpenVINO.

Models and mask rules come from qaz812345/TrackNetV3 (MIT, see runtime repo).
Frame stride moves the sequence window; it never drops frames within a sequence.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from collections import deque
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / ".tracknet-v3"


def check_cancel(cancelled):
    if cancelled():
        raise InterruptedError("Analysis cancelled.")


def upstream():
    repo = Path(os.getenv("TRACKNET_V3_DIR", RUNTIME / "repo")).resolve()
    if not (repo / "model.py").is_file():
        raise FileNotFoundError("TrackNetV3 source missing. Run scripts/setup-tracknet-v3.ps1.")
    if str(repo) not in sys.path:
        sys.path.insert(0, str(repo))
    return repo


def load_torch_models(checkpoints=None):
    upstream()
    import torch
    from utils.general import get_model
    checkpoints = Path(checkpoints or os.getenv("TRACKNET_V3_CKPTS", RUNTIME / "ckpts"))
    # Official files contain state dictionaries and primitive settings, not executable models.
    track = torch.load(checkpoints / "TrackNet_best.pt", map_location="cpu", weights_only=True)
    paint = torch.load(checkpoints / "InpaintNet_best.pt", map_location="cpu", weights_only=True)
    seq_len = int(track["param_dict"]["seq_len"])
    bg_mode = track["param_dict"]["bg_mode"]
    model = get_model("TrackNet", seq_len, bg_mode).eval()
    model.load_state_dict(track["model"])
    repair = get_model("InpaintNet").eval()
    repair.load_state_dict(paint["model"])
    metadata = dict(seq_len=seq_len, bg_mode=bg_mode,
                    inpaint_seq_len=int(paint["param_dict"]["seq_len"]))
    return model, repair, metadata


def read_video_info(path):
    cap = cv2.VideoCapture(str(path))
    try:
        ok, frame = cap.read()
        if not ok:
            raise ValueError("The video contains no readable frames.")
        fps = float(cap.get(cv2.CAP_PROP_FPS))
        if not np.isfinite(fps) or fps <= 0:
            raise ValueError("The video has an invalid frame rate.")
        return dict(fps=fps, frames=int(cap.get(cv2.CAP_PROP_FRAME_COUNT)),
                    width=frame.shape[1], height=frame.shape[0])
    finally:
        cap.release()


def background(path, info, samples, width, height, mode, cancelled):
    cap = cv2.VideoCapture(str(path))
    frames = []
    try:
        # Same median-before-resize and RGB order as the upstream iterable dataset.
        step = max(1, info["frames"] // samples)
        for i in range(0, info["frames"], step):
            check_cancel(cancelled)
            cap.set(cv2.CAP_PROP_POS_FRAMES, i)
            ok, frame = cap.read()
            if not ok:
                break
            frames.append(frame)
        if not frames:
            raise ValueError("Cannot read video background.")
        median = np.median(np.asarray(frames), axis=0)[..., ::-1]
        if mode == "concat":
            median = np.asarray(Image.fromarray(median.astype("uint8")).resize((width, height)))
            median = np.moveaxis(median, -1, 0)
        return median
    finally:
        cap.release()


def prepare_frame(bgr, median, width, height, mode):
    rgb = bgr[..., ::-1]
    pil = Image.fromarray(rgb)
    color = np.moveaxis(np.asarray(pil.resize((width, height))), -1, 0)
    if mode in {"subtract", "subtract_concat"}:
        diff = np.sum(np.abs(rgb.astype(float) - median), axis=2).astype("uint8")
        diff = np.asarray(Image.fromarray(diff).resize((width, height)))[None]
        return diff if mode == "subtract" else np.concatenate([color, diff])
    return color


def frame_windows(path, length, stride, median, width, height, mode, cancelled):
    cap = cv2.VideoCapture(str(path))
    history = deque(maxlen=length)
    index = -1
    last_start = -1
    try:
        while True:
            check_cancel(cancelled)
            ok, frame = cap.read()
            if not ok:
                break
            index += 1
            history.append(prepare_frame(frame, median, width, height, mode))
            start = index - length + 1
            if len(history) == length and start % stride == 0:
                items = list(history)
                if mode == "concat":
                    items.insert(0, median)
                yield start, np.concatenate(items).astype("float32") / 255.0, length
                last_start = start
        count = index + 1
        if not count:
            raise ValueError("The video contains no readable frames.")
        # Cover short clips and trailing frames without duplicate output indices.
        if count < length:
            items = list(history) + [history[-1]] * (length - count)
            if mode == "concat":
                items.insert(0, median)
            yield 0, np.concatenate(items).astype("float32") / 255.0, count
        elif last_start + length < count:
            start = last_start + stride
            valid = count - start
            items = list(history)[-valid:] + [history[-1]] * (length - valid)
            if mode == "concat":
                items.insert(0, median)
            yield start, np.concatenate(items).astype("float32") / 255.0, valid
    finally:
        cap.release()


def decode_heatmap(heatmap, width, height):
    """Upstream uses largest bounding-box area, not largest contour area."""
    mask = (heatmap > 0.5).astype("uint8") * 255
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    confidence = float(np.max(heatmap))
    if not contours:
        return 0, 0, confidence
    x, y, w, h = max((cv2.boundingRect(c) for c in contours), key=lambda r: r[2] * r[3])
    # Match upstream's integer model-space center before scaling to source pixels.
    return int(int(x + w / 2) * width / heatmap.shape[1]), int(int(y + h / 2) * height / heatmap.shape[0]), confidence


def ffmpeg_path():
    for candidate in [os.getenv("TRACKNET_FFMPEG"), shutil.which("ffmpeg"),
                      r"C:\Program Files\obs-studio\bin\64bit\ffmpeg.exe",
                      r"C:\Program Files\Streamlabs OBS\resources\app.asar.unpacked\node_modules\obs-studio-node\ffmpeg.exe"]:
        if candidate and Path(candidate).is_file():
            return str(candidate)
    raise RuntimeError("FFmpeg is required for browser-compatible video. Set TRACKNET_FFMPEG.")


def encode_video(path, coordinates, output, info, cancelled, progress):
    command = [ffmpeg_path(), "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "bgr24",
               "-s", f"{info['width']}x{info['height']}", "-r", str(info["fps"]), "-i", "pipe:0",
               "-an", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
               "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-movflags", "+faststart", str(output)]
    cap = cv2.VideoCapture(str(path))
    error_path = output.with_suffix(".ffmpeg.log")
    try:
        with error_path.open("wb") as errors:
            process = subprocess.Popen(command, stdin=subprocess.PIPE, stderr=errors,
                                       stdout=subprocess.DEVNULL,
                                       creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            try:
                for i, point in enumerate(coordinates):
                    check_cancel(cancelled)
                    ok, frame = cap.read()
                    if not ok:
                        raise ValueError("Video ended before all coordinates were rendered.")
                    if point["visible"]:
                        center = (int(point["x"] * info["width"]), int(point["y"] * info["height"]))
                        color = (0, 165, 255) if point.get("repaired") else (0, 0, 255)
                        cv2.circle(frame, center, 4, color, -1)
                    process.stdin.write(frame.tobytes())
                    if i % 60 == 0:
                        progress(0.9 + 0.099 * (i + 1) / len(coordinates), len(coordinates), len(coordinates))
                process.stdin.close()
                while process.poll() is None:
                    check_cancel(cancelled)
                    time.sleep(0.05)
                if process.returncode:
                    raise RuntimeError(f"FFmpeg failed. See {error_path.name}.")
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
    finally:
        cap.release()


class V3Engine:
    def __init__(self, settings=None):
        upstream()
        settings = settings or {}
        self.backend = str(settings.get("backend", os.getenv("TRACKNET_BACKEND", "openvino"))).lower()
        self.device = str(settings.get("device", os.getenv("TRACKNET_DEVICE", "AUTO"))).upper()
        if self.backend == "pytorch" and self.device == "GPU":
            self.device = "CUDA"
        self.width = int(os.getenv("TRACKNET_WIDTH", "512"))
        self.height = int(os.getenv("TRACKNET_HEIGHT", "288"))
        self.batch_size = int(os.getenv("TRACKNET_BATCH_SIZE", "1"))
        self.stride = int(os.getenv("TRACKNET_FRAME_STRIDE", "1"))
        self.eval_mode = str(settings.get("evalMode", os.getenv("TRACKNET_EVAL_MODE", "weight")))
        inpaint_value = settings.get("inpaint", os.getenv("TRACKNET_INPAINT", "1"))
        self.inpaint = inpaint_value if isinstance(inpaint_value, bool) else str(inpaint_value).lower() not in {"0", "false", "off"}
        self.samples = int(os.getenv("TRACKNET_BACKGROUND_SAMPLES", "120"))
        self.precision = os.getenv("TRACKNET_PRECISION", "f32")
        if self.precision not in {"f32", "f16"}:
            raise ValueError("TRACKNET_PRECISION must be f32 or f16.")
        if self.width < 32 or self.height < 32 or self.width % 8 or self.height % 8:
            raise ValueError("V3 width and height must be multiples of 8 and at least 32.")
        if self.batch_size < 1 or self.stride < 1 or self.samples < 1:
            raise ValueError("Batch size, frame stride, and background samples must be positive.")
        if self.eval_mode not in {"weight", "average", "nonoverlap"}:
            raise ValueError("TRACKNET_EVAL_MODE must be weight, average, or nonoverlap.")
        if self.backend == "pytorch":
            import torch
            torch.set_num_threads(int(settings.get("intraThreads", os.getenv("TRACKNET_INTRA_THREADS", "2"))))
            self.track, self.repair, meta = load_torch_models()
            target = "cuda" if self.device == "AUTO" and torch.cuda.is_available() else "cpu"
            if self.device not in {"AUTO", "CPU", "CUDA"}:
                raise ValueError("PyTorch supports CPU/CUDA here; use OpenVINO for Intel GPU.")
            if self.device == "CUDA":
                target = "cuda"
            self.device = target
            self.track.to(target)
            self.repair.to(target)
        elif self.backend == "openvino":
            import openvino as ov
            directory = Path(os.getenv("TRACKNET_V3_OPENVINO_DIR", RUNTIME / "openvino"))
            meta = json.loads((directory / "metadata.json").read_text())
            verification = json.loads((directory / "conversion-check.json").read_text())
            if not verification.get("passed"):
                raise ValueError("OpenVINO conversion check did not pass. Re-run export-tracknet-v3.py.")
            if (self.width, self.height) != (meta["width"], meta["height"]):
                raise ValueError("Requested size differs from exported V3 models. Re-export at this size first.")
            core = ov.Core()
            config = {"PERFORMANCE_HINT": "LATENCY", "INFERENCE_PRECISION_HINT": self.precision}
            if self.device == "CPU":
                config["INFERENCE_NUM_THREADS"] = int(settings.get("intraThreads", os.getenv("TRACKNET_INTRA_THREADS", "2")))
            cache = directory / "cache"
            cache.mkdir(exist_ok=True)
            config["CACHE_DIR"] = str(cache)
            def compile_model(name):
                model = core.read_model(directory / f"{name}.xml")
                shapes = {}
                for port in model.inputs:
                    shape = port.partial_shape
                    shape[0] = self.batch_size
                    shapes[port] = shape
                model.reshape(shapes)
                print(f"Loading OpenVINO {name} on {self.device}...", flush=True)
                return core.compile_model(model, self.device, config)
            self.track = compile_model("tracknet")
            self.repair = compile_model("inpaintnet") if self.inpaint else None
            self.device = ",".join(self.track.get_property("EXECUTION_DEVICES"))
        else:
            raise ValueError("TRACKNET_BACKEND must be openvino or pytorch for V3.")
        self.seq_len = int(meta["seq_len"])
        self.bg_mode = meta["bg_mode"]
        self.inpaint_seq_len = int(meta["inpaint_seq_len"])
        if self.stride > self.seq_len:
            raise ValueError("V3 frame stride cannot exceed its sequence length (would leave gaps).")
        if self.eval_mode == "nonoverlap":
            self.stride = self.seq_len

    def infer(self, inputs, repair=False):
        model = self.repair if repair else self.track
        arrays = [np.ascontiguousarray(x, dtype="float32") for x in inputs]
        if self.backend == "openvino":
            count = len(arrays[0])
            if count < self.batch_size:
                arrays = [np.concatenate([x, np.repeat(x[-1:], self.batch_size - count, axis=0)]) for x in arrays]
            return np.asarray(model(arrays)[model.output(0)])[:count].copy()
        import torch
        with torch.inference_mode():
            return model(*(torch.from_numpy(x).to(self.device) for x in arrays)).cpu().numpy()

    def analyze(self, video_path, output_dir, progress=lambda *_: None,
                cancelled=lambda: False, output_video=True):
        start_time = time.perf_counter()
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        check_cancel(cancelled)
        info = read_video_info(video_path)
        if info["frames"] < 1:
            raise ValueError("Cannot determine the video's frame count.")
        median = background(video_path, info, self.samples, self.width, self.height,
                            self.bg_mode, cancelled) if self.bg_mode else None
        progress(0.05, 0, info["frames"])
        predictions = []
        pending = {}
        weights = np.minimum(np.arange(self.seq_len) + 1, np.arange(self.seq_len, 0, -1)).astype("float32")
        weights /= weights.sum()

        def finish(until):
            for index in sorted(k for k in pending if k < until):
                plain, weighted, count, total_weight = pending.pop(index)
                # Upstream averages uniformly at the beginning and end of a clip.
                interior = self.seq_len - 1 <= index <= info["frames"] - self.seq_len
                heatmap = weighted / total_weight if self.eval_mode == "weight" and interior else plain / count
                x, y, confidence = decode_heatmap(heatmap, info["width"], info["height"])
                if index != len(predictions):
                    raise RuntimeError("Unexpected gap in V3 frame output.")
                predictions.append((x, y, confidence))

        def run_batch(batch):
            check_cancel(cancelled)
            outputs = self.infer([np.stack([b[1] for b in batch])])
            for (start, _, valid), maps in zip(batch, outputs):
                finish(start)
                for offset in range(valid):
                    index = start + offset
                    heatmap = maps[offset]
                    weight = float(weights[offset])
                    if index not in pending:
                        pending[index] = [heatmap.copy(), heatmap * weight, 1, weight]
                    else:
                        item = pending[index]
                        item[0] += heatmap
                        item[1] += heatmap * weight
                        item[2] += 1
                        item[3] += weight
                progress(0.05 + 0.75 * min((start + valid) / info["frames"], 1), start + valid, info["frames"])

        batch = []
        for item in frame_windows(video_path, self.seq_len, self.stride, median,
                                  self.width, self.height, self.bg_mode, cancelled):
            batch.append(item)
            if len(batch) == self.batch_size:
                run_batch(batch)
                batch = []
        if batch:
            run_batch(batch)
        finish(float("inf"))
        points = np.asarray(predictions, dtype="float32")
        xy = points[:, :2] / np.array([info["width"], info["height"]], dtype="float32")
        original_visible = np.any(points[:, :2] != 0, axis=1)
        repaired = np.zeros(len(xy), dtype=bool)
        if self.inpaint:
            xy, repaired = self.repair_trajectory(xy, info, cancelled)
        coordinates = []
        for i, (x, y) in enumerate(xy):
            px, py = int(float(x) * info["width"]), int(float(y) * info["height"])
            visible = bool(px or py)
            coordinates.append(dict(frame=i, time=i / info["fps"],
                                    x=float(x) if visible else None, y=float(y) if visible else None,
                                    confidence=0.0 if repaired[i] else float(points[i, 2]),
                                    visible=visible, repaired=bool(repaired[i]),
                                    detected=bool(original_visible[i])))
        inference_seconds = time.perf_counter() - start_time
        progress(0.9, len(coordinates), len(coordinates))
        output = output_dir / "tracknet_predict.mp4"
        if output_video:
            encode_video(video_path, coordinates, output, info, cancelled, progress)
        check_cancel(cancelled)
        if self.backend == "openvino":
            self.device = ",".join(self.track.get_property("EXECUTION_DEVICES"))
        metrics = dict(backend=self.backend, device=self.device, seq_len=self.seq_len,
                       precision=getattr(self, "precision", "f32"),
                       frame_stride=self.stride, eval_mode=self.eval_mode, inpaint=self.inpaint,
                       width=self.width, height=self.height, batch_size=self.batch_size,
                       background_samples=self.samples, inference_seconds=inference_seconds,
                       elapsed_seconds=time.perf_counter() - start_time,
                       direct_detected_frames=int(original_visible.sum()), repaired_frames=int(repaired.sum()))
        (output_dir / "coordinates.json").write_text(json.dumps(coordinates), encoding="utf-8")
        progress(1.0, len(coordinates), len(coordinates))
        return dict(frames=len(coordinates), coordinates=coordinates,
                    video_path=str(output) if output_video else None, metrics=metrics)

    def repair_trajectory(self, xy, info, cancelled):
        from test import generate_inpaint_mask
        count = len(xy)
        pixels = np.rint(xy * [info["width"], info["height"]]).astype(int)
        mask = np.asarray(generate_inpaint_mask(dict(Y=pixels[:, 1], Visibility=np.any(pixels != 0, axis=1).astype(int)),
                                               th_h=info["height"] * 0.05), dtype="float32")
        if not mask.any():
            return xy.copy(), mask.astype(bool)
        length = self.inpaint_seq_len
        stride = length if self.eval_mode == "nonoverlap" else 1
        starts = list(range(0, max(1, count - length + 1), stride))
        if starts[-1] + length < count:
            starts.append(starts[-1] + stride)
        sums = np.zeros_like(xy)
        totals = np.zeros(count, dtype="float32")
        weights = np.minimum(np.arange(length) + 1, np.arange(length, 0, -1)).astype("float32")
        weights /= weights.sum()
        for offset in range(0, len(starts), self.batch_size):
            check_cancel(cancelled)
            group = starts[offset:offset + self.batch_size]
            indices = np.minimum(np.asarray(group)[:, None] + np.arange(length), count - 1)
            batch_xy = xy[indices]
            batch_mask = mask[indices, None]
            predicted = self.infer([batch_xy, batch_mask], repair=True)
            predicted = predicted * batch_mask + batch_xy * (1 - batch_mask)
            predicted[np.all(predicted < 50 / np.hypot(288, 512), axis=2)] = 0
            for start, sequence in zip(group, predicted):
                valid = min(length, count - start)
                for j in range(valid):
                    index = start + j
                    weight = float(weights[j]) if self.eval_mode == "weight" and length - 1 <= index <= count - length else 1.0
                    sums[index] += sequence[j] * weight
                    totals[index] += weight
        result = sums / totals[:, None]
        result[np.all(result < 50 / np.hypot(288, 512), axis=1)] = 0
        # Leave observed positions intact. InpaintNet estimates are not measured confidence.
        result[mask == 0] = xy[mask == 0]
        return result, (mask > 0) & np.any(result != 0, axis=1)

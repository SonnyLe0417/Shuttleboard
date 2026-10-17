"""Model-free benchmark contracts and V3 inference pipeline tests.

Real checkpoint/backend parity is intentionally a separate readiness-gated run.
"""

import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import types
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("benchmark-tracknet.py")
SPEC = importlib.util.spec_from_file_location("benchmark_tracknet", SCRIPT)
benchmark = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(benchmark)


class StubMemory:
    def __enter__(self):
        self.baseline = 1
        return self

    def __exit__(self, *_):
        pass

    def report(self):
        return {"peak_process_rss_bytes": 42}


class BenchmarkTests(unittest.TestCase):
    def args(self, root, *extra):
        return benchmark.parser().parse_args([
            "--engine", "v3", "--video", str(root / "sample.mp4"),
            "--output-dir", str(root / "results"), *extra,
        ])

    def test_video_default_and_opt_out(self):
        self.assertTrue(self.args(Path(".")).output_video)
        self.assertFalse(self.args(Path("."), "--no-output-video").output_video)

    def test_eval_mode_and_extraction_cli(self):
        self.assertEqual(self.args(Path("."), "--eval-mode", "nonoverlap").eval_mode, "nonoverlap")
        args = benchmark.parser().parse_args([
            "--extract-sample-only", "--video", "clip.mp4", "--output-dir", "samples",
            "--sample-start", "120", "--sample-seconds", "10",
        ])
        self.assertIsNone(args.engine)
        self.assertTrue(args.extract_sample_only)
        self.assertEqual((args.sample_start, args.sample_seconds), (120, 10))

    def test_sample_helper_uses_ffmpeg_without_loading_engine(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "sample.mp4").write_bytes(b"source video")
            args = self.args(root, "--extract-sample-only", "--sample-start", "120", "--sample-seconds", "10")
            def ffmpeg(command, **kwargs):
                Path(command[-1]).write_bytes(b"encoded clip")
                self.assertIn("-n", command)
                self.assertEqual(command[command.index("-ss") + 1], "120.0")
                self.assertTrue(kwargs["check"])
                return types.SimpleNamespace(stdout="frame=300\nprogress=end\n")
            with patch.object(benchmark.shutil, "which", return_value="ffmpeg"), \
                 patch.object(benchmark.subprocess, "run", side_effect=ffmpeg), \
                 patch.object(benchmark, "load_module") as load:
                output = benchmark.extract_sample(args)
                load.assert_not_called()
            manifest = json.loads(output.with_suffix(".json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["frames"], 300)
            self.assertEqual(manifest["source_content_sha256"], benchmark.sha256_file(root / "sample.mp4"))

    def test_sample_rejects_invalid_time_ranges(self):
        for values in (("--sample-start", "-1"), ("--sample-seconds", "0"), ("--sample-seconds", "nan")):
            with self.assertRaises(ValueError):
                benchmark.extract_sample(self.args(Path("."), *values))

    def test_visibility_is_counted_and_contract_validated(self):
        self.assertEqual(benchmark.validate_result({"frames": 3, "coordinates": [
            {"visible": True}, {"visible": False}, {"visible": 1},
        ]}), (3, 2, 1))
        for result in (
            {"frames": 0, "coordinates": []},
            {"frames": 2, "coordinates": [{"visible": True}]},
            {"frames": 1, "coordinates": [{}]},
            {"frames": 1, "coordinates": [{"visible": "false"}]},
        ):
            with self.assertRaises(ValueError):
                benchmark.validate_result(result)

    def test_current_rejects_pytorch_before_creating_outputs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "sample.mp4").write_bytes(b"fixture")
            with self.assertRaisesRegex(ValueError, "no PyTorch backend"):
                benchmark.benchmark(self.args(root, "--engine", "current", "--backend", "pytorch"))
            self.assertFalse((root / "results").exists())

    def test_lock_excludes_other_process_and_releases(self):
        with tempfile.TemporaryDirectory() as directory:
            lock = Path(directory) / "benchmark.lock"
            code = (
                "import importlib.util, pathlib, sys; "
                "s=importlib.util.spec_from_file_location('bench', sys.argv[1]); "
                "m=importlib.util.module_from_spec(s); s.loader.exec_module(m); "
                "c=m.exclusive_benchmark(pathlib.Path(sys.argv[2])); c.__enter__(); c.__exit__(None,None,None)"
            )
            def child():
                return subprocess.run([sys.executable, "-c", code, str(SCRIPT), str(lock)],
                                      capture_output=True, text=True, timeout=15)
            with benchmark.exclusive_benchmark(lock):
                blocked = child()
                self.assertNotEqual(blocked.returncode, 0)
                self.assertIn("Another TrackNet benchmark", blocked.stderr)
            self.assertEqual(child().returncode, 0)

    def exercise(self, *, current=False, failure=False, fallback=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_dir = root / "scripts"
            source_dir.mkdir()
            (source_dir / "tracknet_v3.py").write_text("# fixture", encoding="utf-8")
            (source_dir / "tracknet_service.py").write_text("# fixture", encoding="utf-8")
            (root / "sample.mp4").write_bytes(b"fixture video")
            calls = []
            result = {"frames": 2, "coordinates": [{"visible": True}, {"visible": False}],
                      "video_path": "", "metrics": {"eval_mode": "weight", "sequence_length": 8}}

            class Engine:
                def __init__(self):
                    calls.append(("init", os.environ["TRACKNET_BACKEND"], os.environ["TRACKNET_DEVICE"]))

                def analyze(self, **kwargs):
                    calls.append(kwargs)
                    if failure:
                        raise RuntimeError("fixture engine failure")
                    return result

            module = types.SimpleNamespace(V3Engine=Engine)
            if current:
                module = types.SimpleNamespace(
                    _jobs={}, _jobs_lock=threading.Lock(), _load_model=lambda: object(),
                    _active_backend="tensorflow" if fallback else "openvino", _active_device="CPU",
                    FRAME_STRIDE=4, INFERENCE_BATCH_SIZE=1, FRAME_STACK=3, THRESHOLD=0.5,
                    HEIGHT=288, WIDTH=512, OPENVINO_MODEL_PATH=source_dir / "model.xml",
                )

                def process(job_id, input_path):
                    calls.append(input_path)
                    coordinates_path = input_path.parent / "coordinates.json"
                    coordinates_path.write_text(json.dumps(result["coordinates"]), encoding="utf-8")
                    module._jobs[job_id].update(status="completed", frames=2,
                                               coordinates_path=str(coordinates_path),
                                               video_path=str(input_path.parent / "tracknet_predict.mp4"))
                module._process_job = process

            extra = ["--no-output-video", "--device", "CPU"]
            if current:
                extra.extend(["--engine", "current", "--current-dir", str(source_dir)])
            with patch.object(benchmark, "ROOT", root), \
                 patch.object(benchmark, "load_module", return_value=module), \
                 patch.object(benchmark, "source_info", return_value={"revision": "fixture"}), \
                 patch.object(benchmark, "MemorySampler", StubMemory), \
                 patch.dict(os.environ), contextlib.redirect_stderr(io.StringIO()):
                if failure or fallback:
                    with self.assertRaises(RuntimeError):
                        benchmark.benchmark(self.args(root, *extra))
                    path = next((root / "results").glob("*/benchmark.json"))
                    report = json.loads(path.read_text(encoding="utf-8"))
                    self.assertEqual(report["status"], "failed")
                    self.assertIn("error", report)
                    if fallback:
                        self.assertEqual(calls, [])
                    return
                report, path = benchmark.benchmark(self.args(root, *extra))
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), report)
            self.assertEqual((report["frames"], report["visible"], report["missing"]), (2, 1, 1))
            self.assertEqual(len(report["input"]["content_sha256"]), 64)
            self.assertGreaterEqual(report["timing"]["elapsed_including_model_load_seconds"],
                                    report["timing"]["elapsed_excluding_model_load_seconds"])
            self.assertEqual(report["memory"]["peak_process_rss_bytes"], 42)
            if current:
                self.assertTrue(report["settings"]["output_video_effective"])
                self.assertEqual(calls[0].parent, path.parent)
                self.assertEqual(calls[0].read_bytes(), b"fixture video")
                self.assertFalse((root / "coordinates.json").exists())
                self.assertEqual(module._jobs, {})
                self.assertTrue(any("encoding is INCLUDED" in note for note in report["notes"]))
            else:
                self.assertFalse(calls[1]["output_video"])
                self.assertFalse(calls[1]["cancelled"]())
                self.assertEqual(calls[0], ("init", "openvino", "CPU"))
                self.assertEqual(report["engine_metrics"]["eval_mode"], "weight")

    def test_v3_analyze_contract_and_report(self):
        self.exercise()

    def test_current_stages_input_and_reports_forced_encoding(self):
        self.exercise(current=True)

    def test_failed_analysis_leaves_report(self):
        self.exercise(failure=True)

    def test_backend_fallback_is_not_benchmarked(self):
        self.exercise(current=True, fallback=True)


class V3CoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import numpy as np
        import tracknet_v3
        cls.np = np
        cls.v3 = tracknet_v3

    def capture(self, frames):
        class Capture:
            def __init__(self):
                self.index = 0
                self.released = False

            def read(self):
                if self.index >= len(frames):
                    return False, None
                self.index += 1
                return True, frames[self.index - 1].copy()

            def release(self):
                self.released = True
        return Capture()

    def test_preprocessing_rgb_and_background_modes(self):
        np = self.np
        frame = np.tile(np.array([10, 20, 30], dtype="uint8"), (2, 2, 1))
        color = self.v3.prepare_frame(frame, None, 2, 2, "")
        np.testing.assert_array_equal(color[:, 0, 0], [30, 20, 10])
        median = np.zeros((2, 2, 3))
        difference = self.v3.prepare_frame(frame, median, 2, 2, "subtract")
        self.assertEqual(difference.shape, (1, 2, 2))
        np.testing.assert_array_equal(difference, 60)
        combined = self.v3.prepare_frame(frame, median, 2, 2, "subtract_concat")
        np.testing.assert_array_equal(combined[:, 0, 0], [30, 20, 10, 60])

    def test_windows_cover_short_clips_and_nonoverlap_tails(self):
        np = self.np
        for count, stride, expected in ((2, 3, [(0, 2)]), (8, 3, [(0, 3), (3, 3), (6, 2)]),
                                        (5, 1, [(0, 3), (1, 3), (2, 3)])):
            with self.subTest(count=count, stride=stride):
                capture = self.capture([np.full((2, 2, 3), index, dtype="uint8") for index in range(count)])
                with patch.object(self.v3.cv2, "VideoCapture", return_value=capture):
                    windows = list(self.v3.frame_windows("fixture", 3, stride, None, 2, 2, "", lambda: False))
                self.assertEqual([(start, valid) for start, _, valid in windows], expected)
                self.assertTrue(capture.released)
                for start, tensor, valid in windows:
                    self.assertEqual(tensor.shape, (9, 2, 2))
                    self.assertEqual(tensor.dtype, np.float32)
                    for offset in range(3):
                        self.assertAlmostEqual(float(tensor[offset * 3, 0, 0]), min(start + offset, count - 1) / 255)

    def test_concat_prepends_background(self):
        np = self.np
        capture = self.capture([np.full((2, 2, 3), 10, dtype="uint8")])
        median = np.full((3, 2, 2), 90, dtype="uint8")
        with patch.object(self.v3.cv2, "VideoCapture", return_value=capture):
            windows = list(self.v3.frame_windows("fixture", 3, 1, median, 2, 2, "concat", lambda: False))
        self.assertEqual(windows[0][1].shape, (12, 2, 2))
        np.testing.assert_allclose(windows[0][1][:3], 90 / 255)
        np.testing.assert_allclose(windows[0][1][3:], 10 / 255)

    def test_cancel_releases_capture(self):
        capture = self.capture([])
        with patch.object(self.v3.cv2, "VideoCapture", return_value=capture):
            with self.assertRaises(InterruptedError):
                list(self.v3.frame_windows("fixture", 3, 1, None, 2, 2, "", lambda: True))
        self.assertTrue(capture.released)

    def test_empty_clip_fails_and_releases_capture(self):
        capture = self.capture([])
        with patch.object(self.v3.cv2, "VideoCapture", return_value=capture):
            with self.assertRaisesRegex(ValueError, "no readable frames"):
                list(self.v3.frame_windows("fixture", 3, 1, None, 2, 2, "", lambda: False))
        self.assertTrue(capture.released)

    def test_decode_uses_bounding_box_area_and_strict_threshold(self):
        np = self.np
        heatmap = np.zeros((16, 16), dtype="float32")
        heatmap[1:4, 1:4] = 0.9
        for index in range(7, 13):
            heatmap[index, index] = 0.8
        x, y, confidence = self.v3.decode_heatmap(heatmap, 160, 80)
        self.assertEqual((x, y), (100, 50))
        self.assertAlmostEqual(confidence, 0.9)
        self.assertEqual(self.v3.decode_heatmap(np.full((4, 4), 0.5), 4, 4), (0, 0, 0.5))

    def engine(self, mode="weight"):
        engine = object.__new__(self.v3.V3Engine)
        for key, value in dict(seq_len=3, stride=1, width=4, height=4, bg_mode="", samples=1,
                               batch_size=2, eval_mode=mode, backend="fixture", device="CPU", inpaint=False).items():
            setattr(engine, key, value)
        return engine

    def test_analysis_weighted_interior_uniform_edges_and_video_flag(self):
        np = self.np
        for mode, expected_middle in (("weight", 0.7), ("average", 0.6)):
            for video_enabled in (False, True):
                with self.subTest(mode=mode, output_video=video_enabled), tempfile.TemporaryDirectory() as directory:
                    engine = self.engine(mode)
                    calls = []
                    def infer(inputs):
                        calls.append(len(inputs[0]))
                        maps = np.zeros((len(inputs[0]), 3, 4, 4), dtype="float32")
                        maps[:, :, 1, 1] = [0.4, 1.0, 0.4]
                        return maps
                    engine.infer = infer
                    windows = [(index, np.zeros((9, 4, 4), dtype="float32"), 3) for index in range(3)]
                    updates = []
                    with patch.object(self.v3, "read_video_info", return_value=dict(frames=5, fps=30, width=4, height=4)), \
                         patch.object(self.v3, "frame_windows", return_value=iter(windows)), \
                         patch.object(self.v3, "encode_video") as encode:
                        result = engine.analyze("fixture", directory, progress=lambda *args: updates.append(args),
                                                output_video=video_enabled)
                    self.assertEqual(calls, [2, 1])
                    self.assertEqual(result["frames"], 5)
                    self.assertEqual([row["frame"] for row in result["coordinates"]], list(range(5)))
                    self.assertAlmostEqual(result["coordinates"][2]["confidence"], expected_middle)
                    self.assertAlmostEqual(result["coordinates"][1]["confidence"], 0.7)
                    self.assertFalse(result["coordinates"][0]["visible"])
                    self.assertIsNone(result["coordinates"][0]["x"])
                    self.assertEqual(result["coordinates"][2]["x"], 0.25)
                    self.assertEqual(result["coordinates"][3]["time"], 3 / 30)
                    self.assertEqual(updates[-1], (1.0, 5, 5))
                    self.assertEqual(encode.call_count, int(video_enabled))
                    self.assertEqual(result["video_path"] is not None, video_enabled)
                    self.assertEqual(json.loads((Path(directory) / "coordinates.json").read_text()), result["coordinates"])

    def test_repaired_coordinates_keep_flags_and_reach_video_encoder(self):
        np = self.np
        engine = self.engine("nonoverlap")
        engine.inpaint = True
        maps = np.zeros((1, 3, 4, 4), dtype="float32")
        maps[0, 0, 1, 1] = 0.9
        engine.infer = lambda inputs: maps
        def repair(xy, info, cancelled):
            result = xy.copy()
            result[1] = [0.5, 0.5]
            return result, np.array([False, True, False])
        engine.repair_trajectory = repair
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(self.v3, "read_video_info", return_value=dict(frames=3, fps=30, width=4, height=4)), \
             patch.object(self.v3, "frame_windows", return_value=iter([(0, np.zeros((9, 4, 4)), 3)])), \
             patch.object(self.v3, "encode_video") as encode:
            result = engine.analyze("fixture", directory, output_video=True)
            points = result["coordinates"]
            self.assertTrue(points[0]["detected"])
            self.assertFalse(points[0]["repaired"])
            self.assertTrue(points[1]["visible"])
            self.assertFalse(points[1]["detected"])
            self.assertTrue(points[1]["repaired"])
            self.assertEqual(points[1]["confidence"], 0)
            self.assertFalse(points[2]["visible"])
            self.assertFalse(points[2]["detected"])
            self.assertFalse(points[2]["repaired"])
            self.assertEqual(encode.call_args.args[1], points)
            self.assertEqual(json.loads((Path(directory) / "coordinates.json").read_text()), points)

    def test_analysis_cancels_before_reading_video(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(self.v3, "read_video_info") as read:
            with self.assertRaises(InterruptedError):
                self.engine().analyze("fixture", directory, cancelled=lambda: True)
            read.assert_not_called()

    def test_openvino_partial_batch_is_padded_and_trimmed(self):
        np = self.np
        engine = self.engine()
        engine.backend = "openvino"
        engine.batch_size = 3
        class Compiled:
            def output(self, index):
                return "output"
            def __call__(self, arrays):
                self.inputs = arrays
                return {"output": arrays[0] + 1}
        engine.track = Compiled()
        inputs = np.full((2, 3, 4, 4), 0.25, dtype="float32")
        result = engine.infer([inputs])
        self.assertEqual(engine.track.inputs[0].shape[0], 3)
        self.assertEqual(result.shape[0], 2)
        np.testing.assert_allclose(result, 1.25)

    def test_inpainting_preserves_observations_and_marks_repairs(self):
        np = self.np
        for count in (2, 7):
            for mode in ("weight", "average", "nonoverlap"):
                with self.subTest(count=count, mode=mode):
                    engine = self.engine(mode)
                    engine.inpaint_seq_len = 3
                    xy = np.full((count, 2), 0.6, dtype="float32")
                    xy[1] = 0
                    mask = np.zeros(count, dtype="float32")
                    mask[1] = 1
                    upstream_test = types.SimpleNamespace(generate_inpaint_mask=lambda *args, **kwargs: mask)
                    def infer(inputs, repair=False):
                        self.assertTrue(repair)
                        return np.full_like(inputs[0], 0.4)
                    engine.infer = infer
                    with patch.dict(sys.modules, {"test": upstream_test}):
                        output, repaired = engine.repair_trajectory(xy, dict(width=640, height=360), lambda: False)
                    np.testing.assert_array_equal(output[mask == 0], xy[mask == 0])
                    np.testing.assert_allclose(output[1], 0.4)
                    self.assertEqual(np.flatnonzero(repaired).tolist(), [1])


if __name__ == "__main__":
    unittest.main()

"""Export official V3 checkpoints without weight compression and check real inputs."""
import argparse
import hashlib
import json
import os
import subprocess
from pathlib import Path

import numpy as np
import openvino as ov
import torch

from tracknet_v3 import RUNTIME, background, frame_windows, load_torch_models, read_video_info, upstream


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--output-dir", default=str(RUNTIME / "openvino"))
    parser.add_argument("--width", type=int, default=512)
    parser.add_argument("--height", type=int, default=288)
    parser.add_argument("--samples", type=int, default=4)
    args = parser.parse_args()
    if args.width % 8 or args.height % 8 or min(args.width, args.height) < 32:
        parser.error("Dimensions must be multiples of 8 and at least 32.")
    torch.set_num_threads(2)
    track, repair, meta = load_torch_models()
    channels = {"concat": (meta["seq_len"] + 1) * 3, "subtract": meta["seq_len"],
                "subtract_concat": meta["seq_len"] * 4, "": meta["seq_len"] * 3}[meta["bg_mode"]]
    target = Path(args.output_dir)
    target.mkdir(parents=True, exist_ok=True)
    (target / "conversion-check.json").write_text(json.dumps({"passed": False, "status": "exporting"}), encoding="utf-8")
    track_input = torch.zeros(1, channels, args.height, args.width)
    repair_inputs = (torch.zeros(1, meta["inpaint_seq_len"], 2), torch.zeros(1, meta["inpaint_seq_len"], 1))
    core = ov.Core()
    compiled = {}
    for name, model, inputs in [("tracknet", track, (track_input,)), ("inpaintnet", repair, repair_inputs)]:
        print(f"Converting {name}...", flush=True)
        converted = ov.convert_model(model, example_input=inputs)
        # Dynamic batch allows full and tail batches; model image dimensions remain fixed.
        shapes = {}
        for port in converted.inputs:
            shape = port.partial_shape
            shape[0] = -1
            shapes[port] = shape
        converted.reshape(shapes)
        ov.save_model(converted, target / f"{name}.xml", compress_to_fp16=False)
        compiled[name] = core.compile_model(converted, "CPU", {
            "INFERENCE_PRECISION_HINT": "f32", "INFERENCE_NUM_THREADS": 2,
            "PERFORMANCE_HINT": "LATENCY"})
    meta.update(width=args.width, height=args.height, precision="FP32", openvino_version=ov.__version__,
                source_commit=subprocess.check_output(["git", "-C", str(upstream()), "rev-parse", "HEAD"], text=True).strip())
    ckpts = Path(os.getenv("TRACKNET_V3_CKPTS", RUNTIME / "ckpts"))
    meta["checkpoint_sha256"] = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(ckpts.glob("*.pt"))}
    (target / "metadata.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    info = read_video_info(args.video)
    median = background(args.video, info, 120, args.width, args.height, meta["bg_mode"], lambda: False)
    report = {"tracknet": [], "inpaintnet": []}
    from tracknet_v3 import decode_heatmap
    for i, (_, array, _) in enumerate(frame_windows(args.video, meta["seq_len"], meta["seq_len"], median,
                                                    args.width, args.height, meta["bg_mode"], lambda: False)):
        if i >= args.samples:
            break
        inputs = array[None]
        with torch.inference_mode():
            expected = track(torch.from_numpy(inputs)).numpy()
        actual = compiled["tracknet"]([inputs])[compiled["tracknet"].output(0)].copy()
        error = float(np.max(np.abs(expected - actual)))
        left = [decode_heatmap(h, info["width"], info["height"])[:2] for h in expected[0]]
        right = [decode_heatmap(h, info["width"], info["height"])[:2] for h in actual[0]]
        report["tracknet"].append(dict(max_absolute_error=error, coordinate_matches=sum(a == b for a, b in zip(left, right)), frames=len(left)))
        # Real detected positions, with a synthetic missing span to exercise repair.
        xy = np.resize(np.asarray(left, dtype="float32") / [info["width"], info["height"]],
                       (1, meta["inpaint_seq_len"], 2)).astype("float32")
        mask = np.zeros((1, meta["inpaint_seq_len"], 1), dtype="float32")
        mask[:, 3:6] = 1
        xy[:, 3:6] = 0
        with torch.inference_mode():
            expected_repair = repair(torch.from_numpy(xy), torch.from_numpy(mask)).numpy()
        actual_repair = compiled["inpaintnet"]([xy, mask])[compiled["inpaintnet"].output(0)].copy()
        repair_error = float(np.max(np.abs(expected_repair - actual_repair)))
        report["inpaintnet"].append(dict(max_absolute_error=repair_error))
        print(f"Sample {i + 1}: TrackNet error {error:.8g}, InpaintNet error {repair_error:.8g}", flush=True)
    report["passed"] = bool(report["tracknet"]) and all(r["max_absolute_error"] < 1e-3 for rows in [report["tracknet"], report["inpaintnet"]] for r in rows)
    (target / "conversion-check.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    if not report["passed"]:
        raise RuntimeError("Conversion check failed; inspect conversion-check.json before use.")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()

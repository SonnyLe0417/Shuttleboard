"""Run a small, repeatable comparison without needing an assistant to watch it."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("benchmark_tracknet", ROOT / "scripts/benchmark-tracknet.py")
benchmark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(benchmark)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", default=str(ROOT / "public/tracknet_predict.mp4"))
    parser.add_argument("--seconds", type=float, default=4)
    parser.add_argument("--starts", type=float, nargs="+", default=[60, 430, 840])
    parser.add_argument("--device", choices=["CPU", "GPU", "AUTO"], default="CPU")
    parser.add_argument("--eval-mode", choices=["nonoverlap", "weight", "average"], default="nonoverlap")
    parser.add_argument("--output-dir", type=Path, default=ROOT / ".tracknet-v3/comparison")
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    manifest = args.output_dir / "suite.json"
    if manifest.exists():
        raise ValueError("Choose a new output directory to preserve the previous comparison.")
    samples = []
    with benchmark.exclusive_benchmark():
        for start in args.starts:
            sample_args = benchmark.parser().parse_args([
                "--video", args.video, "--output-dir", str(args.output_dir), "--extract-sample-only",
                "--sample-start", str(start), "--sample-seconds", str(args.seconds)])
            samples.append(benchmark.extract_sample(sample_args))
    records = []
    configurations = [("current", "openvino", args.device), ("v3", "pytorch", "CPU"), ("v3", "openvino", args.device)]
    env = {**os.environ, "TRACKNET_BATCH_SIZE": "1", "TRACKNET_INTRA_THREADS": "2",
           "OMP_NUM_THREADS": "2", "MKL_NUM_THREADS": "2", "TRACKNET_PRECISION": "f32",
           "TRACKNET_INPAINT": "1", "TRACKNET_BACKGROUND_SAMPLES": "120"}
    for engine, backend, device in configurations:
        for number, sample in enumerate(samples):
            folder = args.output_dir / f"{engine}-{backend}-{number + 1}"
            folder.mkdir()
            command = [sys.executable, str(ROOT / "scripts/benchmark-tracknet.py"),
                       "--engine", engine, "--backend", backend, "--video", str(sample),
                       "--output-dir", str(folder), "--device", device]
            if engine == "v3":
                command.extend(["--eval-mode", args.eval_mode])
            env["TRACKNET_FRAME_STRIDE"] = "4" if engine == "current" else "1"
            print(f"Running {engine}/{backend}/{device}, clip {number + 1}/{len(samples)}", flush=True)
            with (folder / "run.log").open("w", encoding="utf-8") as log:
                run = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, env=env,
                                     creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            reports = list(folder.glob("*/benchmark.json"))
            if run.returncode or not reports:
                raise RuntimeError(f"Comparison stopped; see {folder / 'run.log'}")
            record = json.loads(reports[0].read_text())
            record["report_file"] = str(reports[0])
            records.append(record)
            manifest.write_text(json.dumps(dict(samples=list(map(str, samples)), runs=records), indent=2), encoding="utf-8")
            print(f"Finished: {record['frames']} frames in {record['timing']['elapsed_excluding_model_load_seconds']:.1f}s", flush=True)
    comparisons = []
    for number in range(len(samples)):
        left = records[len(samples) + number]
        right = records[2 * len(samples) + number]
        lpoints = json.loads(Path(left["report_file"]).with_name("coordinates.json").read_text())
        rpoints = json.loads(Path(right["report_file"]).with_name("coordinates.json").read_text())
        import cv2
        cap = cv2.VideoCapture(str(samples[number]))
        width, height = cap.get(3), cap.get(4)
        cap.release()
        errors = [((a["x"] - b["x"]) ** 2 * width ** 2 + (a["y"] - b["y"]) ** 2 * height ** 2) ** 0.5
                  for a, b in zip(lpoints, rpoints) if a["visible"] and b["visible"]]
        comparisons.append(dict(clip=number + 1, frames=len(lpoints),
                                visibility_matches=sum(a["visible"] == b["visible"] for a, b in zip(lpoints, rpoints)),
                                mean_distance_pixels=sum(errors) / len(errors) if errors else None,
                                max_distance_pixels=max(errors) if errors else None))
    manifest.write_text(json.dumps(dict(samples=list(map(str, samples)), runs=records, parity=comparisons), indent=2), encoding="utf-8")
    print(f"Comparison complete: {manifest}", flush=True)


if __name__ == "__main__":
    main()

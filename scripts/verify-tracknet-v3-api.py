"""Exercise the real V3 model through its local HTTP API without a listening port."""
import argparse
import json
import os
from pathlib import Path
import time

from fastapi.testclient import TestClient
from tracknet_v3 import RUNTIME, ffmpeg_path
from tracknet_v3_service import create_app


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True, type=Path)
    parser.add_argument("--output-dir", type=Path, default=RUNTIME / "api-verification")
    args = parser.parse_args()
    os.environ.setdefault("TRACKNET_FFMPEG", ffmpeg_path())
    results = {}
    with TestClient(create_app(data_root=args.output_dir)) as client:
        deadline = time.monotonic() + 180
        while True:
            health = client.get("/health").json()
            if health["model_loaded"]:
                break
            if health.get("error") or time.monotonic() > deadline:
                raise RuntimeError(health)
            time.sleep(0.2)
        results["health"] = health
        with args.video.open("rb") as stream:
            uploaded = client.post("/analyze", files={"video": (args.video.name, stream, "video/mp4")})
        uploaded.raise_for_status()
        job_id = uploaded.json()["job_id"]
        deadline = time.monotonic() + 1200
        while True:
            status = client.get(f"/jobs/{job_id}").json()
            if status["status"] == "completed":
                break
            if status["status"] == "failed" or time.monotonic() > deadline:
                raise RuntimeError(status)
            time.sleep(0.25)
        response = client.get(f"/jobs/{job_id}/result")
        response.raise_for_status()
        result = response.json()
        assert len(result["coordinates"]) == result["frames"] > 0
        video = client.get(result["video_url"])
        video.raise_for_status()
        assert video.headers["content-type"].startswith("video/mp4")
        results["analysis"] = {"job_id": job_id, "frames": result["frames"],
                               "video_bytes": len(video.content), "metrics": result["metrics"]}
        with args.video.open("rb") as stream:
            preview = client.post("/preview", files={"video": (args.video.name, stream, "video/mp4")})
        preview.raise_for_status()
        results["preview_bytes"] = len(preview.content)
        invalid = client.post("/analyze", files={"video": ("invalid.mp4", b"not a video", "video/mp4")})
        invalid.raise_for_status()
        bad_id = invalid.json()["job_id"]
        deadline = time.monotonic() + 30
        while True:
            failed = client.get(f"/jobs/{bad_id}").json()
            if failed["status"] == "failed":
                break
            if time.monotonic() > deadline:
                raise RuntimeError("Invalid video did not fail.")
            time.sleep(0.1)
        results["invalid_video"] = failed["error"]
        with args.video.open("rb") as stream:
            next_job = client.post("/analyze", files={"video": (args.video.name, stream, "video/mp4")}).json()
        cancelled = client.delete(f"/jobs/{next_job['job_id']}").json()
        assert cancelled["cancelled"] and cancelled["status"] == "failed"
        results["cancellation"] = "passed"
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "verification.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()

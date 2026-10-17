"""Sample the broadcast score overlay to locate likely point changes.

This is a review aid: a changed overlay is not itself a hand-labelled rally.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--every-frames", type=int, default=15)
    args = parser.parse_args()
    if args.every_frames < 1:
        parser.error("--every-frames must be positive")
    args.output.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(str(args.video))
    if not cap.isOpened():
        raise ValueError(f"Could not open {args.video}")
    fps = cap.get(cv2.CAP_PROP_FPS)
    clusters: list[dict] = []
    samples: list[dict] = []
    frame_index = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if frame_index % args.every_frames:
            frame_index += 1
            continue
        # The video has a fixed 640x360 broadcast overlay at the top left.
        name_panel = frame[4:31, 75:182]
        white_fraction = float((np.min(name_panel, axis=2) > 175).mean())
        present = white_fraction > 0.25
        column_ids = []
        for column, (left, right) in enumerate(((183, 207), (207, 232), (232, 257))):
            row_ids = []
            for row, (top, bottom) in enumerate(((4, 17), (18, 32))):
                region = frame[top:bottom, left:right]
                gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)
                mask = gray > 165
                cluster_id = None
                if present and mask.sum() >= 2:
                    peers = [item for item in clusters
                             if item["row"] == row and item["column"] == column]
                    distances = [np.count_nonzero(mask != item["mask"]) for item in peers]
                    if distances and min(distances) <= 6:
                        cluster = peers[int(np.argmin(distances))]
                        cluster_id = cluster["id"]
                        cluster["count"] += 1
                    else:
                        cluster_id = len(clusters)
                        clusters.append(dict(id=cluster_id, row=row, column=column, count=1,
                                             first_time=round(frame_index / fps, 3),
                                             mask=mask.copy(), example=region.copy()))
                row_ids.append(cluster_id)
            column_ids.append(row_ids)
        samples.append(dict(frame=frame_index, time=round(frame_index / fps, 3),
                            overlay=present, scores=column_ids if present else None))
        frame_index += 1
    cap.release()
    (args.output / "score-samples.json").write_text(json.dumps(dict(
        fps=fps, sampled_every_frames=args.every_frames, total_frames=frame_index,
        clusters=[{key: value for key, value in item.items() if key not in ("mask", "example")}
                  for item in clusters], samples=samples), indent=2), encoding="utf-8")

    cell_width, cell_height, columns = 270, 95, 4
    rows = (len(clusters) + columns - 1) // columns
    sheet = np.full((rows * cell_height, columns * cell_width, 3), 245, np.uint8)
    for position, cluster in enumerate(clusters):
        x = position % columns * cell_width
        y = position // columns * cell_height
        text = (f"#{cluster['id']} col {cluster['column']} row {cluster['row']} "
                f"t={cluster['first_time']:.1f}s n={cluster['count']}")
        cv2.putText(sheet, text, (x + 3, y + 18), cv2.FONT_HERSHEY_SIMPLEX, .42, (0, 0, 0), 1)
        image = cv2.resize(cluster["example"], (120, 65), interpolation=cv2.INTER_NEAREST)
        sheet[y + 24:y + 89, x + 5:x + 125] = image
    cv2.imwrite(str(args.output / "score-clusters.png"), sheet)
    print(f"Scanned {frame_index} frames; {len(clusters)} visual score clusters")


if __name__ == "__main__":
    main()

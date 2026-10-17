"""Make timestamped contact sheets from an original match for human review."""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import cv2
import numpy as np


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--start", type=float, required=True)
    parser.add_argument("--end", type=float, required=True)
    parser.add_argument("--step", type=float, default=1)
    args = parser.parse_args()
    if args.start < 0 or args.end <= args.start or args.step <= 0:
        parser.error("Expected 0 <= start < end and step > 0")
    args.output.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(str(args.video))
    if not cap.isOpened():
        raise ValueError(f"Cannot open {args.video}")
    fps = cap.get(cv2.CAP_PROP_FPS)
    columns, rows, width, height = 4, 5, 320, 180
    pages = math.ceil(math.ceil((args.end - args.start) / args.step) / (columns * rows))
    for page in range(pages):
        sheet = np.full((rows * height, columns * width, 3), 30, dtype=np.uint8)
        for cell in range(columns * rows):
            second = args.start + (page * columns * rows + cell) * args.step
            if second >= args.end:
                break
            frame_index = round(second * fps)
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
            ok, frame = cap.read()
            if not ok:
                continue
            frame = cv2.resize(frame, (width, height), interpolation=cv2.INTER_AREA)
            cv2.rectangle(frame, (0, height - 25), (width, height), (0, 0, 0), -1)
            cv2.putText(frame, f"{int(second // 60):02d}:{second % 60:04.1f}",
                        (8, height - 7), cv2.FONT_HERSHEY_SIMPLEX, .55, (255, 255, 255), 1)
            x, y = cell % columns * width, cell // columns * height
            sheet[y:y + height, x:x + width] = frame
        path = args.output / f"frames-{args.start:g}-{args.end:g}-p{page + 1}.jpg"
        if not cv2.imwrite(str(path), sheet, [cv2.IMWRITE_JPEG_QUALITY, 90]):
            raise OSError(f"Could not write {path}")
        print(path)
    cap.release()


if __name__ == "__main__":
    main()

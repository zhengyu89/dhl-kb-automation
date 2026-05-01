from __future__ import annotations

from pathlib import Path
import sys
from time import perf_counter

import easyocr


BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent
IMAGE_PATH = REPO_ROOT / "docs" / "data_source" / "Teams_Message_2.jpg"
MODEL_DIR = BACKEND_DIR / "storage" / "easyocr-models"


def main() -> int:
    if not IMAGE_PATH.exists():
        print(f"Image not found: {IMAGE_PATH}", file=sys.stderr)
        return 1

    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    init_started_at = perf_counter()
    try:
        reader = easyocr.Reader(
            ["en"],
            gpu=True,
            model_storage_directory=str(MODEL_DIR),
            download_enabled=True,
        )
        runtime_device = "GPU"
    except Exception as exc:
        print(f"GPU initialization failed, falling back to CPU: {exc}", file=sys.stderr)
        reader = easyocr.Reader(
            ["en"],
            gpu=False,
            model_storage_directory=str(MODEL_DIR),
            download_enabled=True,
        )
        runtime_device = "CPU"
    init_elapsed = perf_counter() - init_started_at

    ocr_started_at = perf_counter()
    results = reader.readtext(
        str(IMAGE_PATH),
        detail=0,
        paragraph=True,
    )
    ocr_elapsed = perf_counter() - ocr_started_at
    raw_text = "\n".join(results)

    print(f"Processed image: {IMAGE_PATH}")
    print(f"Model cache: {MODEL_DIR}")
    print(f"Runtime device: {runtime_device}")
    print(f"Reader initialization time: {init_elapsed:.2f}s")
    print(f"OCR processing time: {ocr_elapsed:.2f}s")
    print("Raw text:")
    print(raw_text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

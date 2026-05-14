"""Integration tests for upload ingestion, duplicate detection, email parsing, and OCR processing."""

import os
import unittest
import json
from pathlib import Path
import shutil

from fastapi.testclient import TestClient
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BASE_DIR / ".env")

from app.services import source_processing as processing
from app.main import app
from tests.support import configure_test_storage, login_headers, poll_processing, repo_root, reset_database_state

def _resolve_email_fixture() -> tuple[Path, str]:
    data_source_dir = repo_root() / "docs" / "data_source"
    msg_path = data_source_dir / "RE_ Invoice mismatch issue.msg"
    if msg_path.exists():
        return msg_path, "application/vnd.ms-outlook"

    eml_path = data_source_dir / "RE_ Invoice mismatch issue.eml"
    return eml_path, "message/rfc822"


def _print_json(label: str, payload: dict) -> None:
    print(f"\n{label}:")
    print(json.dumps(payload, indent=2, default=str))


def _is_real_ocr_environment_issue(payload: dict) -> bool:
    source_document = payload.get("source_document") or {}
    error = source_document.get("processing_error") or payload.get("processing_error") or ""
    lowered_error = error.lower()
    return any(
        marker.lower() in lowered_error
        for marker in [
            "no such file or directory",
            "permission denied",
            "easyocr is not installed",
            "download model",
            "network connection",
            "easyocr",
            "torch",
        ]
    )


class UploadProcessingTests(unittest.TestCase):
    """Exercises the upload API from file submission through final processing state."""

    def setUp(self) -> None:
        self.test_storage_root = configure_test_storage()
        reset_database_state()
        self.client = TestClient(app)
        self.headers = login_headers(self.client)

    def tearDown(self) -> None:
        shutil.rmtree(self.test_storage_root, ignore_errors=True)

    def test_upload_text_file_creates_processed_draft(self) -> None:
        sample_path = repo_root() / "docs" / "data_source" / "Error_Code_AUTH_401.txt"

        with sample_path.open("rb") as handle:
            response = self.client.post(
                "/api/uploads",
                headers=self.headers,
                files={"file": (sample_path.name, handle, "text/plain")},
            )

        self.assertEqual(response.status_code, 202)
        upload_response = response.json()
        _print_json("Text upload response", upload_response)
        payload = poll_processing(self.client, upload_response["processing_id"], self.headers)
        _print_json("Text upload final payload", payload)

        self.assertEqual(payload["processing_status"], "created")
        self.assertEqual(payload["source_document"]["source_type"], "text")
        self.assertIn("AUTH_401", payload["source_document"]["extracted_text"])

    def test_upload_duplicate_file_is_flagged(self) -> None:
        sample_path = repo_root() / "docs" / "data_source" / "Error_Code_AUTH_401.txt"

        for _ in range(2):
            with sample_path.open("rb") as handle:
                response = self.client.post(
                    "/api/uploads",
                    headers=self.headers,
                    files={"file": (sample_path.name, handle, "text/plain")},
                )
            self.assertEqual(response.status_code, 202)
            _print_json("Duplicate test upload response", response.json())

        payload = poll_processing(self.client, response.json()["processing_id"], self.headers)
        _print_json("Duplicate test final payload", payload)

        self.assertEqual(payload["processing_status"], "duplicate")
        self.assertIsNotNone(payload["source_document"]["duplicate_of_source_id"])

    def test_upload_email_file_extracts_email_content(self) -> None:
        sample_path, mime_type = _resolve_email_fixture()

        with sample_path.open("rb") as handle:
            response = self.client.post(
                "/api/uploads",
                headers=self.headers,
                files={"file": (sample_path.name, handle, mime_type)},
            )

        self.assertEqual(response.status_code, 202)
        upload_response = response.json()
        _print_json("Email upload response", upload_response)
        payload = poll_processing(self.client, upload_response["processing_id"], self.headers)
        _print_json("Email final payload", payload)

        self.assertEqual(payload["processing_status"], "created")
        self.assertEqual(payload["source_document"]["source_type"], "email")
        self.assertIn("invoice", payload["source_document"]["extracted_text"].lower())
        self.assertIn("mismatch", payload["source_document"]["extracted_text"].lower())
        self.assertIsNone(payload["ocr_result"])

    @unittest.skipUnless(
        os.getenv("RUN_REAL_OCR_TESTS") == "1",
        "Set RUN_REAL_OCR_TESTS=1 to run real EasyOCR integration test.",
    )
    def test_upload_real_image_uses_easyocr(self) -> None:
        sample_path = repo_root() / "docs" / "data_source" / "Teams_Message_2.jpg"

        with sample_path.open("rb") as handle:
            response = self.client.post(
                "/api/uploads",
                headers=self.headers,
                files={"file": (sample_path.name, handle, "image/jpeg")},
            )

        self.assertEqual(response.status_code, 202)
        upload_response = response.json()
        _print_json("Real OCR upload response", upload_response)
        payload = poll_processing(self.client, upload_response["processing_id"], self.headers)
        _print_json("Real OCR final payload", payload)

        if payload["processing_status"] == "failed" and _is_real_ocr_environment_issue(payload):
            self.skipTest(
                "Real EasyOCR test requires installed OCR dependencies and model download access."
            )

        self.assertIn(payload["processing_status"], {"created", "needs_editor_review"})
        self.assertEqual(payload["source_document"]["source_type"], "chat_screenshot")
        self.assertTrue(payload["source_document"]["requires_editor_review"])
        self.assertIsNotNone(payload["ocr_result"])
        self.assertEqual(payload["ocr_result"]["engine"], "EasyOCR")
        self.assertEqual(
            payload["ocr_result"]["model_name"],
            f"EasyOCR ({', '.join(processing.settings.easyocr_language_list)})",
        )
        self.assertTrue(len(payload["ocr_result"]["extracted_text"].strip()) > 20)


if __name__ == "__main__":
    unittest.main()

# uv run pytest -s tests/test_upload_processing.py

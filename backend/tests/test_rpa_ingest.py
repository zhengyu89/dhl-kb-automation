"""Integration tests for the synchronous UiPath RPA ingest endpoint."""

import shutil
import unittest

from fastapi.testclient import TestClient

from app.main import app
from tests.support import configure_test_storage, repo_root, reset_database_state


class RPAIngestTests(unittest.TestCase):
    """Verifies the contract and final-status behavior of POST /api/rpa/ingest."""

    def setUp(self) -> None:
        self.test_storage_root = configure_test_storage()
        reset_database_state()
        self.client = TestClient(app)

    def tearDown(self) -> None:
        shutil.rmtree(self.test_storage_root, ignore_errors=True)

    def _post_rpa_file(
        self,
        *,
        fixture_name: str,
        content_type: str,
        upload_name: str | None = None,
    ) -> dict:
        sample_path = repo_root() / "docs" / "data_source" / fixture_name
        request_file_name = upload_name or sample_path.name
        with sample_path.open("rb") as handle:
            response = self.client.post(
                "/api/rpa/ingest",
                files={"file": (request_file_name, handle, content_type)},
                data={
                    "file_name": request_file_name,
                    "source_path": f"D:\\RPA\\input\\{request_file_name}",
                    "ingestion_method": "rpa",
                    "rpa_run_id": "RPA-TEST-001",
                    "detected_at": "2026-05-14T21:30:00",
                },
            )

        self.assertEqual(response.status_code, 200)
        return response.json()

    def test_rpa_text_file_returns_created_contract(self) -> None:
        payload = self._post_rpa_file(
            fixture_name="Error_Code_AUTH_401.txt",
            content_type="text/plain",
        )

        self.assertEqual(payload["status"], "created")
        self.assertEqual(payload["processing_id"], payload["source_document_id"])
        self.assertIsNotNone(payload["article_id"])
        self.assertIsNone(payload["duplicate_of_source_id"])
        self.assertFalse(payload["requires_editor_review"])
        self.assertEqual(payload["message"], "Draft article created")

    def test_rpa_query_path_request_returns_created_contract(self) -> None:
        fixture_path = repo_root() / "docs" / "data_source" / "Error_Code_AUTH_401.txt"
        self.test_storage_root.mkdir(parents=True, exist_ok=True)
        sample_path = self.test_storage_root / "Error Code AUTH_401.txt"
        shutil.copyfile(fixture_path, sample_path)
        response = self.client.post(
            "/api/rpa/ingest",
            params={
                "file": str(sample_path),
                "file_name": sample_path.name,
                "source_path": str(sample_path),
                "ingestion_method": "rpa",
                "rpa_run_id": "RPA-TEST-QUERY-001",
                "detected_at": "2026-05-14T22:57:01",
            },
            headers={"Content-Type": "application/json"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "created")
        self.assertEqual(payload["processing_id"], payload["source_document_id"])
        self.assertIsNotNone(payload["article_id"])
        self.assertFalse(payload["requires_editor_review"])

    def test_rpa_duplicate_file_returns_duplicate_contract(self) -> None:
        self._post_rpa_file(
            fixture_name="Error_Code_AUTH_401.txt",
            content_type="text/plain",
        )
        payload = self._post_rpa_file(
            fixture_name="Error_Code_AUTH_401.txt",
            content_type="text/plain",
        )

        self.assertEqual(payload["status"], "duplicate")
        self.assertEqual(payload["processing_id"], payload["source_document_id"])
        self.assertIsNone(payload["article_id"])
        self.assertIsNotNone(payload["duplicate_of_source_id"])
        self.assertFalse(payload["requires_editor_review"])

    def test_rpa_long_document_returns_needs_editor_review_contract(self) -> None:
        payload = self._post_rpa_file(
            fixture_name="SOP_Customer Credit Approval and New Customer Onboarding Process.txt",
            content_type="text/plain",
        )

        self.assertEqual(payload["status"], "needs_editor_review")
        self.assertEqual(payload["processing_id"], payload["source_document_id"])
        self.assertIsNotNone(payload["article_id"])
        self.assertIsNone(payload["duplicate_of_source_id"])
        self.assertTrue(payload["requires_editor_review"])
        self.assertEqual(payload["message"], "Draft article created and flagged for editor review")

    def test_rpa_unsupported_file_returns_failed_contract(self) -> None:
        response = self.client.post(
            "/api/rpa/ingest",
            files={
                "file": (
                    "Unsupported.xlsx",
                    b"not-a-supported-spreadsheet",
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            },
            data={
                "file_name": "Unsupported.xlsx",
                "source_path": "D:\\RPA\\input\\Unsupported.xlsx",
                "ingestion_method": "rpa",
                "rpa_run_id": "RPA-TEST-001",
                "detected_at": "2026-05-14T21:30:00",
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "failed")
        self.assertIsNone(payload["processing_id"])
        self.assertIsNone(payload["source_document_id"])
        self.assertIsNone(payload["article_id"])
        self.assertIsNone(payload["duplicate_of_source_id"])
        self.assertFalse(payload["requires_editor_review"])
        self.assertIn("Unsupported file type", payload["message"])


if __name__ == "__main__":
    unittest.main()

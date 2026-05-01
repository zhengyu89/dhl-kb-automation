"""Integration tests for article generation, versioning, keywords, and update workflows."""

import os
import shutil
import time
import unittest
from pathlib import Path

from dotenv import load_dotenv
from fastapi.testclient import TestClient
from sqlalchemy import select

BASE_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BASE_DIR / ".env")
OCR_CACHE_DIR = BASE_DIR / ".easyocr-models"

from app.core.auth import seed_demo_users
from app.db.models import AIGenerationRun, ArticleKeyword, ArticleVersion, KBArticle
from app.db.session import Base, SessionLocal, engine
from app.main import app
from app.services import source_processing as processing


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _login_headers(
    client: TestClient, login_id: str = "Editor1", password: str = "editor123"
) -> dict[str, str]:
    response = client.post(
        "/api/auth/login",
        json={"login_id": login_id, "password": password},
    )
    assert response.status_code == 200
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _poll_processing(client: TestClient, processing_id: str, headers: dict[str, str]) -> dict:
    terminal_statuses = {"created", "duplicate", "failed", "needs_editor_review"}
    last_payload = {}
    for _ in range(60):
        response = client.get(f"/api/processing/{processing_id}", headers=headers)
        assert response.status_code == 200
        last_payload = response.json()
        if last_payload["processing_status"] in terminal_statuses:
            return last_payload
        time.sleep(0.5)
    return last_payload


class ArticleGenerationManagementTests(unittest.TestCase):
    """Validates article records created from uploads and subsequent article edits."""

    def setUp(self) -> None:
        self.test_storage_root = _repo_root() / "backend" / ".test_uploads"
        shutil.rmtree(self.test_storage_root, ignore_errors=True)
        processing.settings.upload_storage_dir = str(self.test_storage_root)
        processing.settings.easyocr_model_storage_dir = str(OCR_CACHE_DIR)
        processing.settings.openai_api_key = None
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)
        with SessionLocal() as db:
            seed_demo_users(db)
        self.client = TestClient(app)
        self.headers = _login_headers(self.client)

    def tearDown(self) -> None:
        Base.metadata.drop_all(bind=engine)
        shutil.rmtree(self.test_storage_root, ignore_errors=True)

    def _upload_text_source(self, filename: str = "Error_Code_AUTH_401.txt") -> dict:
        sample_path = _repo_root() / "docs" / "data_source" / filename
        with sample_path.open("rb") as handle:
            response = self.client.post(
                "/api/uploads",
                headers=self.headers,
                files={"file": (sample_path.name, handle, "text/plain")},
            )
        self.assertEqual(response.status_code, 202)
        return _poll_processing(self.client, response.json()["processing_id"], self.headers)

    def test_processing_creates_ai_run_article_and_initial_version(self) -> None:
        payload = self._upload_text_source()

        self.assertEqual(payload["processing_status"], "created")
        self.assertIsNotNone(payload["article"])
        self.assertEqual(payload["article"]["status"], "draft")
        self.assertEqual(payload["article"]["structured_content"]["source_reference"], "Error_Code_AUTH_401.txt")
        self.assertTrue(payload["article"]["keywords"])

        article_id = payload["article"]["id"]
        with SessionLocal() as db:
            article = db.get(KBArticle, article_id)
            self.assertIsNotNone(article)

            ai_run = db.scalar(
                select(AIGenerationRun).where(AIGenerationRun.article_id == article.id)
            )
            self.assertIsNotNone(ai_run)
            self.assertEqual(ai_run.status, "success")
            self.assertEqual(ai_run.schema_name, "KBArticleDraft")
            self.assertIsNotNone(ai_run.ai_workflow_name)
            self.assertIsNotNone(article.steps)
            self.assertIsNotNone(article.sections)

            versions = db.scalars(
                select(ArticleVersion).where(ArticleVersion.article_id == article.id)
            ).all()
            self.assertEqual(len(versions), 1)
            self.assertEqual(versions[0].version_no, 1)

            article_keywords = db.scalars(
                select(ArticleKeyword).where(ArticleKeyword.article_id == article.id)
            ).all()
            self.assertGreaterEqual(len(article_keywords), 1)

    def test_article_update_creates_new_version_and_updates_keywords(self) -> None:
        payload = self._upload_text_source()
        article = payload["article"]
        article_id = article["id"]

        update_payload = {
            "title": "Resolve AUTH_401 Access Failure",
            "summary": "Validated draft for missing AD group access in forwarding operations.",
            "kind": "article",
            "description": "Users cannot access the forwarding module because their access assignment is incomplete. The editor validated the access recovery steps.",
            "source_type": article["structured_content"]["source_type"],
            "steps": [
                {"step_no": 1, "instruction": "Check the user's AD group membership."},
                {"step_no": 2, "instruction": "Assign the missing forwarding access group."},
                {"step_no": 3, "instruction": "Ask the user to sign out and sign in again."},
            ],
            "sections": [
                {
                    "heading": "Cause",
                    "content": "The required AD group access was not assigned.",
                },
                {
                    "heading": "Escalation",
                    "content": "Escalate to IT access support if the group assignment does not resolve the issue.",
                },
            ],
            "keywords": ["authorization", "auth-401", "forwarding"],
            "source_reference": "Error_Code_AUTH_401.txt",
            "requires_editor_review": False,
            "change_note": "Tightened summary and clarified the access steps.",
        }

        update_response = self.client.patch(
            f"/api/articles/{article_id}",
            headers=self.headers,
            json=update_payload,
        )
        self.assertEqual(update_response.status_code, 200)
        updated_article = update_response.json()
        self.assertEqual(updated_article["title"], update_payload["title"])
        self.assertEqual(updated_article["current_version_no"], 2)
        self.assertEqual(updated_article["structured_content"]["keywords"], update_payload["keywords"])

        versions_response = self.client.get(
            f"/api/articles/{article_id}/versions",
            headers=self.headers,
        )
        self.assertEqual(versions_response.status_code, 200)
        versions = versions_response.json()
        self.assertEqual(len(versions), 2)
        self.assertEqual(versions[0]["version_no"], 2)
        self.assertEqual(
            versions[0]["change_note"],
            "Tightened summary and clarified the access steps.",
        )

        list_response = self.client.get("/api/articles", headers=self.headers)
        self.assertEqual(list_response.status_code, 200)
        list_payload = list_response.json()
        self.assertEqual(len(list_payload), 1)
        self.assertEqual(list_payload[0]["current_version_no"], 2)


if __name__ == "__main__":
    unittest.main()

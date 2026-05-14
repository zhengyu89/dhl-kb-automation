from __future__ import annotations

import shutil
import time
from pathlib import Path

from dotenv import load_dotenv
from fastapi.testclient import TestClient
from sqlalchemy import text

BASE_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BASE_DIR / ".env")
OCR_CACHE_DIR = BASE_DIR / ".easyocr-models"

from app.core.auth import seed_demo_users
from app.db.session import Base, SessionLocal, engine, ensure_database_schema_up_to_date
from app.services import source_processing as processing


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def configure_test_storage() -> Path:
    test_storage_root = repo_root() / "backend" / ".test_uploads"
    shutil.rmtree(test_storage_root, ignore_errors=True)
    processing.settings.upload_storage_dir = str(test_storage_root)
    processing.settings.easyocr_model_storage_dir = str(OCR_CACHE_DIR)
    processing.settings.openai_api_key = None
    return test_storage_root


def reset_database_state() -> None:
    Base.metadata.create_all(bind=engine)
    ensure_database_schema_up_to_date()

    table_names = [table.name for table in Base.metadata.sorted_tables]
    quoted_table_names = ", ".join(f'"{table_name}"' for table_name in table_names)
    if quoted_table_names:
        with engine.begin() as connection:
            connection.execute(text(f"TRUNCATE TABLE {quoted_table_names} RESTART IDENTITY CASCADE"))

    with SessionLocal() as db:
        seed_demo_users(db)


def login_headers(
    client: TestClient, login_id: str = "Editor1", password: str = "editor123"
) -> dict[str, str]:
    response = client.post(
        "/api/auth/login",
        json={"login_id": login_id, "password": password},
    )
    assert response.status_code == 200
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def poll_processing(client: TestClient, processing_id: str, headers: dict[str, str]) -> dict:
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

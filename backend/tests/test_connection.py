"""Smoke tests for database connectivity and optional OpenAI reachability."""

import os
import unittest
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI
from sqlalchemy import text

from app.core.config import settings
from app.db.session import engine


BASE_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BASE_DIR / ".env")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")


class DatabaseConnectionTests(unittest.TestCase):
    """Verifies that the configured SQLAlchemy engine can reach the database."""

    def test_database_connection(self) -> None:
        with engine.connect() as connection:
            result = connection.execute(text("SELECT CURRENT_TIMESTAMP"))
            self.assertIsNotNone(result.scalar())

    @unittest.skipUnless(
        os.getenv("RUN_REAL_OPENAI_TESTS") == "1" and OPENAI_API_KEY,
        "Set RUN_REAL_OPENAI_TESTS=1 and OPENAI_API_KEY to run the OpenAI smoke test.",
    )
    def test_openai_connection(self) -> None:
        client = OpenAI(api_key=OPENAI_API_KEY, timeout=settings.ai_timeout_seconds)
        model = client.models.retrieve(settings.openai_model_name)

        print(f"OpenAI connection OK: model '{model.id}' is reachable.")

        self.assertIsNotNone(model)
        self.assertEqual(model.id, settings.openai_model_name)


if __name__ == "__main__":
    unittest.main()

"""Simple real OpenAI integration tests for kind-based article generation."""

import json
import logging
import os
import unittest
from pathlib import Path
from time import perf_counter

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BASE_DIR / ".env")

from app.db.models import SourceType
from app.services import ai_article_generation as generation
from app.services import source_processing as processing
from app.services.ai_article_generation import generate_structured_article


OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _sample_text_fixture(filename: str) -> tuple[str, str]:
    sample_path = _repo_root() / "docs" / "data_source" / filename
    return sample_path.name, sample_path.read_text(encoding="utf-8")


@unittest.skipUnless(
    os.getenv("RUN_REAL_OPENAI_TESTS") == "1" and OPENAI_API_KEY,
    "Set RUN_REAL_OPENAI_TESTS=1 and OPENAI_API_KEY to run real OpenAI integration tests.",
)
class AIArticleGenerationManagementTests(unittest.TestCase):
    """Exercises one OpenAI generation call per simple kind test."""

    @classmethod
    def setUpClass(cls) -> None:
        processing.settings.openai_api_key = OPENAI_API_KEY
        logging.getLogger("app.services.ai_article_generation").setLevel(logging.INFO)
        print("\nOpenAI integration test configuration:")
        print(f"Model: {processing.settings.openai_model_name}")
        print(f"Timeout: {processing.settings.ai_timeout_seconds}s")
        print(f"Max retries: {processing.settings.ai_max_retries}")
        print(f"API key configured: {bool(OPENAI_API_KEY)}")

    def _assert_generation_case(
        self,
        *,
        text: str,
        source_reference: str,
        expected_kind: str,
        expected_provider: str = "openai-agents",
        source_type: SourceType = SourceType.text,
    ) -> None:
        started_at = perf_counter()
        print("\nArticle generation test input:")
        print(f"Source reference: {source_reference}")
        print(f"Source type: {source_type.value}")
        print(f"Expected kind: {expected_kind}")
        print(f"Expected provider: {expected_provider}")
        print(f"Input length: {len(text)} chars")
        print(f"Input lines: {len(text.splitlines())}")

        result = generate_structured_article(
            extracted_text=text,
            source_reference=source_reference,
            source_type=source_type,
        )
        elapsed = perf_counter() - started_at

        print("\nArticle generation result:")
        print(f"Provider: {result.provider}")
        print(f"Model: {result.model_name}")
        print(f"Workflow: {result.workflow_name}")
        print(f"Prompt version: {result.prompt_version}")
        print(f"Retry count: {result.retry_count}")
        print(f"Input hash: {result.input_text_hash}")
        print(f"Elapsed: {elapsed:.2f}s")
        print(f"Actual kind: {result.draft.kind.value}")
        print(f"Title: {result.draft.title}")
        print(f"Summary: {result.draft.summary}")
        print(f"Description: {result.draft.description}")
        print("Generated draft:")
        print(json.dumps(result.draft.model_dump(), indent=2, default=str))

        self.assertEqual(result.provider, expected_provider)
        if expected_provider == "openai-agents":
            self.assertEqual(result.model_name, processing.settings.openai_model_name)
        else:
            self.assertEqual(result.model_name, "local-preservation-heuristic")
        self.assertEqual(result.draft.source_reference, source_reference)
        self.assertEqual(result.draft.kind.value, expected_kind)
        self.assertGreater(len(result.draft.title.strip()), 4)
        self.assertGreater(len(result.draft.summary.strip()), 9)
        self.assertGreater(len(result.draft.description.strip()), 19)
        self.assertTrue(result.draft.steps or result.draft.sections)
        self.assertTrue(result.draft.keywords)

    def test_troubleshooting_generation(self) -> None:
        source_reference, text = _sample_text_fixture("Error_Code_AUTH_401.txt")
        self._assert_generation_case(
            text=text,
            source_reference=source_reference,
            expected_kind="article",
        )

    def test_sop_generation(self) -> None:
        source_reference, text = _sample_text_fixture(
            "SOP_Customer Credit Approval and New Customer Onboarding Process.txt"
        )
        self._assert_generation_case(
            text=text,
            source_reference=source_reference,
            expected_kind="sop",
            expected_provider="heuristic",
        )

    def test_checklist_generation(self) -> None:
        self._assert_generation_case(
            text=(
                "New Staff Setup Checklist\n"
                "- Confirm AD account has been created\n"
                "- Confirm email access is active\n"
                "- Confirm SAP role is assigned\n"
                "- Confirm CW1 role is assigned\n"
                "- Confirm the SOP folder is shared\n"
                "- Reject setup completion if SAP approval is still pending\n"
            ),
            source_reference="New_staff_setup_checklist.txt",
            expected_kind="sop",
        )

    def test_faq_generation(self) -> None:
        self._assert_generation_case(
            text=(
                "FAQ - POD Upload Help\n"
                "Q: Why did the POD upload fail?\n"
                "A: The file was too large for the upload limit.\n"
                "Q: What should I do before retrying?\n"
                "A: Compress the image, save it as JPEG, and refresh the screen twice after uploading.\n"
            ),
            source_reference="FAQ_POD_upload_help.txt",
            expected_kind="article",
        )

    def test_policy_generation(self) -> None:
        self._assert_generation_case(
            text=(
                "Warehouse Access Policy\n"
                "Only approved staff may use shared SAP credentials.\n"
                "Managers must not share passwords over email or chat.\n"
                "All access changes must be requested through IT support and approved by the operations manager.\n"
                "Policy violations must be escalated to the site manager and IT security.\n"
            ),
            source_reference="Warehouse_Access_Policy.txt",
            expected_kind="article",
        )

class LongDocumentPreservationTests(unittest.TestCase):
    """Verifies long documents use local preservation mode instead of OpenAI."""

    def test_long_sop_uses_heuristic_preservation_mode(self) -> None:
        source_reference, text = _sample_text_fixture(
            "SOP_Customer Credit Approval and New Customer Onboarding Process.txt"
        )
        original_api_key = generation.settings.openai_api_key
        try:
            generation.settings.openai_api_key = "not-used-for-long-documents"

            result = generate_structured_article(
                extracted_text=text,
                source_reference=source_reference,
                source_type=SourceType.text,
            )
        finally:
            generation.settings.openai_api_key = original_api_key

        self.assertGreater(len(text), generation.settings.ai_long_document_char_limit)
        self.assertEqual(result.provider, "heuristic")
        self.assertEqual(result.model_name, "local-preservation-heuristic")
        self.assertEqual(result.workflow_name, "kb-article-long-document-preservation")
        self.assertEqual(result.draft.kind.value, "sop")
        self.assertEqual(result.draft.steps, [])
        self.assertGreater(len(result.draft.description), 3000)
        self.assertTrue(result.draft.sections)
        self.assertTrue(result.draft.requires_editor_review)


if __name__ == "__main__":
    unittest.main()

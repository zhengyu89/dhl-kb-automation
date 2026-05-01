from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass
from functools import lru_cache
from hashlib import sha256
from pathlib import Path
from time import perf_counter
from time import sleep

from openai import AsyncOpenAI
from pydantic import ValidationError

from app.core.config import settings
from app.db.models import SourceType as DBSourceType
from app.schemas.api import (
    ArticleKind,
    ArticleSection,
    ArticleStep,
    KBArticleDraft,
    SourceType,
)
from app.services.prompt_templates import (
    AGENT_INSTRUCTIONS,
    AGENT_NAME,
    AGENT_WORKFLOW_NAME,
    PROMPT_VERSION,
    build_agent_input,
)


SCHEMA_VERSION = "1.0"
PRESERVATION_WORKFLOW_NAME = "kb-article-long-document-preservation"
logger = logging.getLogger(__name__)


class AIGenerationError(RuntimeError):
    """Raised when structured article generation fails."""


@dataclass
class AIGenerationResult:
    draft: KBArticleDraft
    provider: str
    model_name: str
    workflow_name: str | None
    prompt_version: str
    retry_count: int
    input_text_hash: str

    @property
    def chain_name(self) -> str | None:
        return self.workflow_name


def generate_structured_article(
    *,
    extracted_text: str,
    source_reference: str,
    source_type: DBSourceType,
) -> AIGenerationResult:
    # Hash the raw source text so callers can correlate retries/results without
    # storing or logging the full extracted payload everywhere.
    input_text_hash = sha256(extracted_text.encode("utf-8")).hexdigest()
    last_error: Exception | None = None
    validation_error: ValidationError | None = None
    started_at = perf_counter()

    logger.info(
        "AI generation started source_reference=%s source_type=%s text_chars=%s text_hash=%s "
        "prompt_version=%s max_retries=%s long_document_char_limit=%s",
        source_reference,
        source_type.value,
        len(extracted_text),
        input_text_hash[:12],
        PROMPT_VERSION,
        settings.ai_max_retries,
        settings.ai_long_document_char_limit,
    )

    if _should_use_preservation_heuristic(extracted_text):
        logger.info(
            "Long document detected; using heuristic preservation mode source_reference=%s "
            "text_chars=%s limit=%s",
            source_reference,
            len(extracted_text),
            settings.ai_long_document_char_limit,
        )
        draft = _generate_preserved_long_document_with_heuristics(
            extracted_text=extracted_text,
            source_reference=source_reference,
            source_type=source_type,
        )
        elapsed = perf_counter() - started_at
        logger.info(
            "Long document heuristic generation completed source_reference=%s kind=%s "
            "title=%r sections=%s elapsed=%.2fs",
            source_reference,
            draft.kind.value,
            draft.title,
            len(draft.sections),
            elapsed,
        )
        return AIGenerationResult(
            draft=draft,
            provider="heuristic",
            model_name="local-preservation-heuristic",
            workflow_name=PRESERVATION_WORKFLOW_NAME,
            prompt_version=PROMPT_VERSION,
            retry_count=0,
            input_text_hash=input_text_hash,
        )

    for attempt in range(settings.ai_max_retries):
        attempt_started_at = perf_counter()
        try:
            if _can_use_openai_agents():
                logger.info(
                    "AI generation attempt=%s provider=openai-agents model=%s workflow=%s",
                    attempt + 1,
                    settings.openai_model_name,
                    AGENT_WORKFLOW_NAME,
                )
                draft, workflow_name = _generate_with_openai_agents(
                    extracted_text=extracted_text,
                    source_reference=source_reference,
                    source_type=source_type,
                )
                provider = "openai-agents"
                model_name = settings.openai_model_name
            else:
                logger.info(
                    "AI generation attempt=%s provider=heuristic model=local-rule-engine",
                    attempt + 1,
                )
                draft = _generate_with_heuristics(
                    extracted_text=extracted_text,
                    source_reference=source_reference,
                    source_type=source_type,
                )
                provider = "heuristic"
                model_name = "local-rule-engine"
                workflow_name = None

            elapsed = perf_counter() - started_at
            attempt_elapsed = perf_counter() - attempt_started_at
            logger.info(
                "AI generation completed source_reference=%s provider=%s model=%s workflow=%s "
                "kind=%s title=%r attempt=%s attempt_elapsed=%.2fs total_elapsed=%.2fs",
                source_reference,
                provider,
                model_name,
                workflow_name,
                draft.kind.value,
                draft.title,
                attempt + 1,
                attempt_elapsed,
                elapsed,
            )

            return AIGenerationResult(
                draft=draft,
                provider=provider,
                model_name=model_name,
                workflow_name=workflow_name,
                prompt_version=PROMPT_VERSION,
                retry_count=attempt,
                input_text_hash=input_text_hash,
            )
        except ValidationError as exc:
            validation_error = exc
            last_error = exc
        except TimeoutError as exc:
            last_error = exc
        except AIGenerationError as exc:
            last_error = exc
        except Exception as exc:  # pragma: no cover - unexpected provider/runtime issue
            last_error = exc

        logger.warning(
            "AI generation attempt failed source_reference=%s attempt=%s elapsed=%.2fs error_type=%s error=%s",
            source_reference,
            attempt + 1,
            perf_counter() - attempt_started_at,
            type(last_error).__name__ if last_error else "unknown",
            last_error,
        )

        if attempt < settings.ai_max_retries - 1:
            # Keep retries in this service so both the AI and heuristic paths share
            # the same backoff behavior and error surface.
            backoff_seconds = min(2**attempt, 4)
            logger.info(
                "AI generation retry scheduled source_reference=%s next_attempt=%s backoff_seconds=%s",
                source_reference,
                attempt + 2,
                backoff_seconds,
            )
            sleep(backoff_seconds)

    if validation_error is not None:
        logger.error(
            "AI generation failed with validation error source_reference=%s total_elapsed=%.2fs",
            source_reference,
            perf_counter() - started_at,
        )
        raise AIGenerationError(f"Pydantic validation failed: {validation_error}") from validation_error
    if last_error is not None:
        logger.error(
            "AI generation failed source_reference=%s total_elapsed=%.2fs error_type=%s error=%s",
            source_reference,
            perf_counter() - started_at,
            type(last_error).__name__,
            last_error,
        )
        raise AIGenerationError(str(last_error)) from last_error
    logger.error(
        "AI generation failed without concrete error source_reference=%s total_elapsed=%.2fs",
        source_reference,
        perf_counter() - started_at,
    )
    raise AIGenerationError("AI generation failed without a concrete error.")


def _can_use_openai_agents() -> bool:
    if not settings.openai_api_key:
        logger.info("OpenAI Agents generation disabled because openai_api_key is not configured.")
        return False
    try:
        import agents  # noqa: F401
    except ImportError:
        logger.warning("OpenAI Agents generation disabled because openai-agents is unavailable.")
        return False
    return True


@lru_cache(maxsize=1)
def get_kb_article_agent():
    from agents import Agent

    return Agent(
        name=AGENT_NAME,
        instructions=AGENT_INSTRUCTIONS,
        model=settings.openai_model_name,
        output_type=KBArticleDraft,
    )


@lru_cache(maxsize=4)
def _configure_openai_agents_client(
    *,
    api_key: str,
    timeout_seconds: float,
    provider_max_retries: int,
) -> None:
    from agents import set_default_openai_client

    set_default_openai_client(
        AsyncOpenAI(
            api_key=api_key,
            timeout=timeout_seconds,
            max_retries=provider_max_retries,
        ),
        use_for_tracing=False,
    )


def _build_agents_run_config():
    from agents import ModelSettings, RunConfig
    from agents.model_settings import ModelRetrySettings, Reasoning

    reasoning_effort = settings.ai_reasoning_effort
    run_config = RunConfig(
        workflow_name=AGENT_WORKFLOW_NAME,
        tracing_disabled=not settings.openai_agents_tracing_enabled,
        trace_include_sensitive_data=False,
        model_settings=ModelSettings(
            max_tokens=settings.ai_max_output_tokens,
            verbosity=settings.ai_verbosity,
            reasoning=Reasoning(effort=reasoning_effort),
            store=settings.ai_store_responses,
            retry=ModelRetrySettings(max_retries=settings.ai_provider_max_retries),
        ),
    )
    logger.info(
        "OpenAI Agents run config prepared model=%s timeout=%.2fs max_output_tokens=%s "
        "reasoning_effort=%s verbosity=%s tracing_enabled=%s provider_max_retries=%s store=%s",
        settings.openai_model_name,
        settings.ai_timeout_seconds,
        settings.ai_max_output_tokens,
        reasoning_effort,
        settings.ai_verbosity,
        settings.openai_agents_tracing_enabled,
        settings.ai_provider_max_retries,
        settings.ai_store_responses,
    )
    return run_config


def generate_article_with_agent(
    *,
    source_reference: str,
    source_type: str,
    text: str,
) -> KBArticleDraft:
    from agents import Runner

    os.environ["OPENAI_API_KEY"] = settings.openai_api_key or ""
    if settings.openai_api_key:
        _configure_openai_agents_client(
            api_key=settings.openai_api_key,
            timeout_seconds=settings.ai_timeout_seconds,
            provider_max_retries=settings.ai_provider_max_retries,
        )

    input_started_at = perf_counter()
    agent_input = build_agent_input(
        source_reference=source_reference,
        source_type=source_type,
        text=text,
    )
    logger.info(
        "OpenAI Agents input prepared source_reference=%s source_type=%s input_chars=%s elapsed=%.4fs",
        source_reference,
        source_type,
        len(agent_input),
        perf_counter() - input_started_at,
    )

    run_started_at = perf_counter()
    result = Runner.run_sync(
        get_kb_article_agent(),
        agent_input,
        max_turns=1,
        run_config=_build_agents_run_config(),
    )
    logger.info(
        "OpenAI Agents Runner.run_sync completed source_reference=%s elapsed=%.2fs",
        source_reference,
        perf_counter() - run_started_at,
    )
    return _coerce_agent_draft_response(result.final_output)


def _generate_with_openai_agents(
    *,
    extracted_text: str,
    source_reference: str,
    source_type: DBSourceType,
) -> tuple[KBArticleDraft, str]:
    logger.info(
        "OpenAI Agents single-pass run starting source_reference=%s model=%s max_turns=1",
        source_reference,
        settings.openai_model_name,
    )
    invoke_started_at = perf_counter()
    response = generate_article_with_agent(
        source_reference=source_reference,
        source_type=_map_db_source_type_to_schema_source_type(source_type).value,
        text=extracted_text,
    )
    logger.info(
        "OpenAI Agents single-pass run completed source_reference=%s elapsed=%.2fs response_type=%s",
        source_reference,
        perf_counter() - invoke_started_at,
        type(response).__name__,
    )
    return response, AGENT_WORKFLOW_NAME


def _coerce_agent_draft_response(response: object) -> KBArticleDraft:
    if isinstance(response, KBArticleDraft):
        return response
    if isinstance(response, dict):
        return KBArticleDraft.model_validate(response)
    if isinstance(response, str):
        return _validate_json_payload(response)
    raise AIGenerationError("OpenAI Agents SDK returned an unsupported structured response.")


def _validate_json_payload(payload: str) -> KBArticleDraft:
    try:
        parsed = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise AIGenerationError("Invalid JSON returned by AI provider.") from exc
    return KBArticleDraft.model_validate(parsed)


def _generate_with_heuristics(
    *,
    extracted_text: str,
    source_reference: str,
    source_type: DBSourceType,
) -> KBArticleDraft:
    # Normalize the extracted text into trimmed content lines so the helper
    # functions can work from a stable, low-noise representation.
    lines = [line.strip(" -\t") for line in extracted_text.splitlines() if line.strip()]
    title = _title_from_reference(source_reference, lines)
    kind = _guess_article_kind(source_reference, lines)
    summary = _build_summary(lines, extracted_text)
    steps = _build_steps(lines, extracted_text)
    sections = _build_sections(lines, extracted_text, kind)
    keywords = _build_keywords(source_reference, source_type, extracted_text)

    return KBArticleDraft(
        title=title,
        kind=kind,
        summary=summary,
        description=_build_description(lines, extracted_text),
        steps=steps,
        sections=sections,
        keywords=keywords,
        source_type=_map_db_source_type_to_schema_source_type(source_type),
        source_reference=source_reference,
        requires_editor_review=source_type in {DBSourceType.image, DBSourceType.chat_screenshot},
    )


def _should_use_preservation_heuristic(extracted_text: str) -> bool:
    return len(extracted_text) > settings.ai_long_document_char_limit


def _generate_preserved_long_document_with_heuristics(
    *,
    extracted_text: str,
    source_reference: str,
    source_type: DBSourceType,
) -> KBArticleDraft:
    cleaned_text = clean_source_text_for_article(extracted_text)
    lines = [line.strip(" -\t") for line in cleaned_text.splitlines() if line.strip()]
    kind = _guess_article_kind(source_reference, lines)
    sections = extract_sections_from_source_text(cleaned_text)

    return KBArticleDraft(
        title=_title_from_reference(source_reference, lines),
        kind=kind,
        summary=_build_summary(lines, cleaned_text),
        description=cleaned_text,
        steps=[],
        sections=sections,
        keywords=_build_keywords(source_reference, source_type, cleaned_text),
        source_type=_map_db_source_type_to_schema_source_type(source_type),
        source_reference=source_reference,
        requires_editor_review=True,
    )


def clean_source_text_for_article(text: str) -> str:
    normalized_lines = [
        line.rstrip()
        for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
        if not re.fullmatch(r"[_=\-]{5,}", line.strip())
    ]
    cleaned_text = "\n".join(normalized_lines).strip()
    cleaned_text = re.sub(r"\n{4,}", "\n\n\n", cleaned_text)
    if len(cleaned_text) > 20000:
        logger.warning(
            "Preserved source text truncated for schema limit original_chars=%s max_chars=20000",
            len(cleaned_text),
        )
    return cleaned_text[:20000]


def extract_sections_from_source_text(text: str) -> list[ArticleSection]:
    sections: list[ArticleSection] = []
    current_heading = "Original SOP Content"
    current_lines: list[str] = []

    for line in text.splitlines():
        stripped = line.strip()

        if not stripped:
            current_lines.append("")
            continue

        if _looks_like_section_heading(stripped):
            if current_lines:
                _append_preserved_section(
                    sections,
                    heading=current_heading,
                    lines=current_lines,
                )
            current_heading = stripped.lstrip("#").strip()[:120]
            current_lines = []
            continue

        current_lines.append(stripped)

    if current_lines:
        _append_preserved_section(
            sections,
            heading=current_heading,
            lines=current_lines,
        )

    if not sections and text.strip():
        _append_preserved_section(
            sections,
            heading="Original SOP Content",
            lines=[text.strip()],
        )

    return sections[:20]


def _looks_like_section_heading(text: str) -> bool:
    lowered = text.lower().strip()
    if len(text) > 100 or text.endswith("."):
        return False

    is_numbered_heading = re.match(r"^\d+(?:\.\d+)*\.? +[A-Za-z]", text) is not None
    if ":" in text and not is_numbered_heading and not text.startswith(("#", "##")):
        return False

    return (
        text.startswith(("#", "##"))
        or is_numbered_heading
        or text.isupper()
        or lowered.startswith(
            (
                "scope",
                "purpose",
                "roles",
                "role",
                "process",
                "procedure",
                "exception",
                "approval",
                "requirement",
                "responsibility",
                "background",
                "objective",
                "steps",
                "workflow",
                "notes",
            )
        )
    )


def _append_preserved_section(
    sections: list[ArticleSection],
    *,
    heading: str,
    lines: list[str],
) -> None:
    content = "\n".join(lines).strip()
    if len(content) < 3:
        return
    sections.append(
        ArticleSection(
            heading=(heading.strip() or "Original SOP Content")[:120],
            content=content[:5000],
        )
    )


def _title_from_reference(source_reference: str, lines: list[str]) -> str:
    stem = Path(source_reference).stem.replace("_", " ").replace(".", " ")
    stem = re.sub(r"\s+", " ", stem).strip().title()
    if stem and len(stem) >= 5:
        if any(token in stem.lower() for token in ("error", "invalid", "failed", "issue", "problem")):
            return f"Resolve {stem}"
        if "sop" in stem.lower():
            return stem.replace("Sop", "SOP")
        return stem
    if lines:
        return lines[0][:120].title()
    return "Untitled Knowledge Article"


def _guess_article_kind(source_reference: str, lines: list[str]) -> ArticleKind:
    lowered_name = source_reference.lower()
    lowered_text = "\n".join(lines[:10]).lower()
    if any(term in lowered_name for term in ("sop", "checklist", "steps", "process")):
        return ArticleKind.SOP
    if any(term in lowered_text for term in ("procedure", "checklist", "step", "approval flow", "onboarding")):
        return ArticleKind.SOP
    return ArticleKind.ARTICLE


def _build_summary(lines: list[str], extracted_text: str) -> str:
    if lines:
        first = lines[0]
        second = lines[1] if len(lines) > 1 else ""
        summary = " ".join(item for item in [first, second] if item)
    else:
        summary = extracted_text
    summary = re.sub(r"\s+", " ", summary).strip()
    if len(summary) < 10:
        summary = f"Structured knowledge article generated from operational source text: {summary}"
    return summary[:320]


def _build_description(lines: list[str], extracted_text: str) -> str:
    description = " ".join(lines[:4]) if lines else extracted_text
    description = re.sub(r"\s+", " ", description).strip()
    if len(description) < 20:
        description = f"This draft summarizes the operational source text: {description}"
    return description[:3000]


def _build_steps(lines: list[str], extracted_text: str) -> list[ArticleStep]:
    candidate_lines = [
        line
        for line in lines
        if len(line) > 6 and not line.lower().startswith(("subject:", "from:", "to:", "cc:", "date:"))
    ]
    chosen = candidate_lines[:6]
    if not chosen:
        sentences = re.split(r"(?<=[.!?])\s+", extracted_text)
        chosen = [sentence.strip() for sentence in sentences if len(sentence.strip()) > 6][:4]

    steps: list[ArticleStep] = []
    for index, line in enumerate(chosen, start=1):
        cleaned = re.sub(r"^[\d✔\-\*\).\s]+", "", line).strip()
        if len(cleaned) < 3:
            continue
        steps.append(ArticleStep(step_no=index, instruction=cleaned[:500]))
    return steps[:8]


def _build_sections(lines: list[str], extracted_text: str, kind: ArticleKind) -> list[ArticleSection]:
    sections: list[ArticleSection] = []
    section_hints = {
        "cause": "Cause",
        "delay": "Important Note",
        "note": "Note",
        "warning": "Warning",
        "escalat": "Escalation",
        "require": "Requirement",
        "approval": "Approval",
    }
    for line in lines:
        lowered = line.lower()
        for hint, heading in section_hints.items():
            if hint in lowered:
                content = line.split(":", 1)[1].strip() if ":" in line else line
                if len(content) >= 3:
                    sections.append(ArticleSection(heading=heading, content=content[:1500]))
                    break
        if len(sections) == 4:
            break

    if not sections and kind is ArticleKind.ARTICLE:
        sections.append(ArticleSection(heading="Source Note", content=_build_description(lines, extracted_text)[:1500]))
    return sections


def _build_keywords(source_reference: str, source_type: DBSourceType, extracted_text: str) -> list[str]:
    keywords = {source_type.value.replace("_", "-")}
    lowered = f"{source_reference.lower()} {extracted_text.lower()}"
    keyword_map = {
        "authorization": ["auth", "authorization", "access", "ad group"],
        "routing-code": ["routing code"],
        "invoice": ["invoice", "surcharge"],
        "printer": ["printer", "label"],
        "pod-upload": ["pod", "proof of delivery"],
        "customer-address": ["postcode", "address"],
        "new-staff": ["new staff", "onboarding"],
        "customer-onboarding": ["customer onboarding", "credit approval"],
    }
    for keyword, terms in keyword_map.items():
        if any(term in lowered for term in terms):
            keywords.add(keyword)
    return sorted(keywords)[:8]


def _map_db_source_type_to_schema_source_type(source_type: DBSourceType) -> SourceType:
    mapping = {
        DBSourceType.text: SourceType.TEXT,
        DBSourceType.email: SourceType.EMAIL,
        DBSourceType.chat_screenshot: SourceType.IMAGE,
        DBSourceType.image: SourceType.IMAGE,
        DBSourceType.pdf: SourceType.PDF,
        DBSourceType.docx: SourceType.DOCX,
        DBSourceType.rpa_import: SourceType.UNKNOWN,
    }
    return mapping.get(source_type, SourceType.UNKNOWN)

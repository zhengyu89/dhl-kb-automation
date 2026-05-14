from __future__ import annotations

import hashlib
import re
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import (
    AIGenerationRun,
    Attachment,
    ArticleSource,
    ArticleStatus,
    KBArticle,
    OCRResult,
    ProcessingStatus,
    SourceDocument,
    SourceType,
    SystemLog,
)
from app.db.session import SessionLocal
from app.schemas.api import KBArticleDraft
from app.services.ai_article_generation import (
    AIGenerationError,
    AGENT_WORKFLOW_NAME,
    PROMPT_VERSION,
    SCHEMA_VERSION,
    generate_structured_article,
)
from app.services.article_management import create_article_from_draft
from app.services.content_extraction import (
    EasyOCRService,
    ExtractionError,
    OCRExtractionResult,
    extract_text_from_docx,
    extract_text_from_email,
    extract_text_from_pdf,
    extract_text_from_plain_bytes,
    normalize_text,
)


IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".webp"}
EMAIL_SUFFIXES = {".eml", ".msg"}
TEXT_SUFFIXES = {".txt", ".md", ".csv", ".log"}

ocr_service = EasyOCRService()


def ensure_storage_directory() -> Path:
    settings.upload_storage_path.mkdir(parents=True, exist_ok=True)
    return settings.upload_storage_path


def infer_source_type(filename: str, content_type: str | None) -> SourceType:
    suffix = Path(filename).suffix.lower()
    lowered_name = filename.lower()

    if suffix in TEXT_SUFFIXES:
        if "message" in lowered_name or "outlook" in lowered_name:
            return SourceType.email
        return SourceType.text
    if suffix == ".pdf" or content_type == "application/pdf":
        return SourceType.pdf
    if suffix == ".docx" or content_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        return SourceType.docx
    if suffix in EMAIL_SUFFIXES:
        return SourceType.email
    if suffix in IMAGE_SUFFIXES or (content_type or "").startswith("image/"):
        if any(keyword in lowered_name for keyword in ("teams", "chat", "screenshot")):
            return SourceType.chat_screenshot
        return SourceType.image

    raise ExtractionError(f"Unsupported file type for '{filename}'.")


def save_upload_bytes(filename: str, data: bytes) -> str:
    storage_dir = ensure_storage_directory()
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(filename).name)
    target = storage_dir / f"{uuid.uuid4()}_{safe_name}"
    target.write_bytes(data)
    return str(target)


def create_source_document(
    db: Session,
    *,
    filename: str,
    content_type: str | None,
    file_bytes: bytes,
    uploaded_by: uuid.UUID | None,
    ingestion_method: str = "manual_upload",
    log_metadata: dict | None = None,
) -> SourceDocument:
    source_type = infer_source_type(filename, content_type)
    storage_path = save_upload_bytes(filename, file_bytes)
    file_hash = hashlib.sha256(file_bytes).hexdigest()
    normalized_ingestion_method = (ingestion_method or "manual_upload").strip().lower() or "manual_upload"

    source_document = SourceDocument(
        original_filename=Path(filename).name,
        source_type=source_type,
        ingestion_method=normalized_ingestion_method,
        storage_path=storage_path,
        mime_type=content_type,
        file_hash=file_hash,
        processing_status=ProcessingStatus.pending,
        processing_stage="queued",
        uploaded_by=uploaded_by,
    )
    db.add(source_document)
    db.flush()

    db.add(
        Attachment(
            source_document_id=source_document.id,
            file_name=source_document.original_filename,
            mime_type=content_type,
            storage_path=storage_path,
            uploaded_by=uploaded_by,
        )
    )
    append_system_log(
        db,
        event_type="upload_created",
        entity_id=source_document.id,
        message=f"Upload queued for {source_document.original_filename}",
        metadata=_merge_log_metadata(
            {
                "source_type": source_type.value,
                "mime_type": content_type,
                "ingestion_method": normalized_ingestion_method,
            },
            log_metadata,
        ),
    )
    db.commit()
    db.refresh(source_document)
    return source_document


def append_system_log(
    db: Session,
    *,
    event_type: str,
    entity_id: uuid.UUID | None,
    message: str,
    severity: str = "info",
    metadata: dict | None = None,
) -> None:
    db.add(
        SystemLog(
            actor_type="system",
            event_type=event_type,
            entity_type="source_document",
            entity_id=entity_id,
            severity=severity,
            message=message,
            metadata_json=metadata,
        )
    )


def _merge_log_metadata(*metadata_parts: dict | None) -> dict | None:
    merged: dict = {}
    for item in metadata_parts:
        if item:
            merged.update(item)
    return merged or None


def _set_processing_state(
    source_document: SourceDocument,
    *,
    status: ProcessingStatus,
    stage: str,
    error: str | None = None,
) -> None:
    source_document.processing_status = status
    source_document.processing_stage = stage
    source_document.processing_error = error


def _extract_for_source(source_document: SourceDocument) -> tuple[str, str, OCRExtractionResult | None]:
    file_path = Path(source_document.storage_path)
    raw_text: str
    ocr_result: OCRExtractionResult | None = None

    if source_document.source_type in {SourceType.text, SourceType.email, SourceType.rpa_import}:
        if source_document.source_type is SourceType.email:
            raw_text = extract_text_from_email(file_path)
        else:
            raw_text = extract_text_from_plain_bytes(file_path.read_bytes())
    elif source_document.source_type is SourceType.pdf:
        raw_text = extract_text_from_pdf(file_path)
    elif source_document.source_type is SourceType.docx:
        raw_text = extract_text_from_docx(file_path)
    elif source_document.source_type in {SourceType.image, SourceType.chat_screenshot}:
        ocr_result = ocr_service.extract(file_path)
        raw_text = ocr_result.text
    else:
        raise ExtractionError(f"Unsupported source type '{source_document.source_type.value}'.")

    extracted_text = normalize_text(raw_text)
    if not extracted_text:
        raise ExtractionError("No usable text could be extracted from the uploaded file.")
    return raw_text, extracted_text, ocr_result


def _find_duplicate(db: Session, source_document: SourceDocument) -> SourceDocument | None:
    if not source_document.content_hash:
        return None

    lookback = datetime.now(UTC) - timedelta(days=14)
    return db.scalar(
        select(SourceDocument)
        .where(
            SourceDocument.content_hash == source_document.content_hash,
            SourceDocument.id != source_document.id,
            SourceDocument.created_at >= lookback,
        )
        .order_by(SourceDocument.created_at.desc())
    )


def process_source_document(source_document_id: uuid.UUID, processing_metadata: dict | None = None) -> None:
    db = SessionLocal()
    try:
        source_document = db.get(SourceDocument, source_document_id)
        if source_document is None:
            return

        _set_processing_state(source_document, status=ProcessingStatus.processing, stage="extracting_text")
        db.commit()

        raw_text, extracted_text, ocr_result = _extract_for_source(source_document)
        source_document.raw_text = raw_text
        source_document.extracted_text = extracted_text
        source_document.content_hash = hashlib.sha256(extracted_text.lower().encode("utf-8")).hexdigest()
        source_document.processing_stage = "checking_duplicates"
        db.commit()

        duplicate = _find_duplicate(db, source_document)
        if duplicate is not None:
            source_document.duplicate_of_source_id = duplicate.id
            source_document.requires_editor_review = source_document.source_type in {
                SourceType.image,
                SourceType.chat_screenshot,
            }
            source_document.processed_at = datetime.now(UTC)
            _set_processing_state(
                source_document,
                status=ProcessingStatus.duplicate,
                stage="duplicate_detected",
            )
            append_system_log(
                db,
                event_type="duplicate_detected",
                entity_id=source_document.id,
                message=f"Duplicate source detected for {source_document.original_filename}",
                severity="warning",
                metadata=_merge_log_metadata(
                    {"duplicate_of_source_id": str(duplicate.id)},
                    processing_metadata,
                ),
            )
            db.commit()
            return

        source_document.processing_stage = "generating_article"
        db.commit()

        ai_result = generate_structured_article(
            extracted_text=extracted_text,
            source_reference=source_document.original_filename,
            source_type=source_document.source_type,
        )
        ai_run = AIGenerationRun(
            source_document_id=source_document.id,
            provider=ai_result.provider,
            model_name=ai_result.model_name,
            ai_workflow_name=ai_result.workflow_name or AGENT_WORKFLOW_NAME,
            prompt_version=ai_result.prompt_version or PROMPT_VERSION,
            schema_name="KBArticleDraft",
            schema_version=SCHEMA_VERSION,
            input_text_hash=ai_result.input_text_hash,
            output_json=ai_result.draft.model_dump(),
            status="success",
            retry_count=ai_result.retry_count,
            max_retries=settings.ai_max_retries,
        )
        db.add(ai_run)

        requires_editor_review = source_document.requires_editor_review or ai_result.draft.requires_editor_review
        if ocr_result is not None:
            is_low_confidence = (
                ocr_result.average_confidence is not None
                and ocr_result.average_confidence < settings.ocr_confidence_threshold
            )
            db.add(
                OCRResult(
                    source_document_id=source_document.id,
                    model_name=ocr_result.model_name,
                    extracted_text=extracted_text,
                    average_confidence=ocr_result.average_confidence,
                    is_low_confidence=is_low_confidence,
                )
            )
            requires_editor_review = requires_editor_review or is_low_confidence

        source_document.requires_editor_review = requires_editor_review
        final_status = (
            ProcessingStatus.needs_editor_review if requires_editor_review else ProcessingStatus.created
        )
        article_status = (
            ArticleStatus.rpa_submitted
            if source_document.ingestion_method == "rpa" and not requires_editor_review
            else ArticleStatus.draft
        )

        article = create_article_from_draft(
            db,
            draft=ai_result.draft,
            source_document=source_document,
            created_by=source_document.uploaded_by,
            created_via=source_document.ingestion_method,
            requires_editor_review=source_document.requires_editor_review,
            status=article_status,
        )
        ai_run.article_id = article.id
        source_document.processed_at = datetime.now(UTC)
        _set_processing_state(
            source_document,
            status=final_status,
            stage="completed",
        )
        append_system_log(
            db,
            event_type="processing_completed",
            entity_id=source_document.id,
            message=f"Processing completed for {source_document.original_filename}",
            metadata=_merge_log_metadata(
                {"processing_status": final_status.value},
                processing_metadata,
            ),
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        source_document = db.get(SourceDocument, source_document_id)
        if source_document is not None:
            if source_document.extracted_text:
                validation_error = str(exc) if isinstance(exc, AIGenerationError) else None
                db.add(
                    AIGenerationRun(
                        source_document_id=source_document.id,
                        provider="openai-agents" if settings.openai_api_key else "heuristic",
                        model_name=settings.openai_model_name if settings.openai_api_key else "local-rule-engine",
                        ai_workflow_name=AGENT_WORKFLOW_NAME if settings.openai_api_key else None,
                        prompt_version=PROMPT_VERSION,
                        schema_name="KBArticleDraft",
                        schema_version=SCHEMA_VERSION,
                        input_text_hash=hashlib.sha256(source_document.extracted_text.encode("utf-8")).hexdigest(),
                        status="failed",
                        retry_count=max(settings.ai_max_retries - 1, 0),
                        max_retries=settings.ai_max_retries,
                        validation_error=validation_error,
                        error_message=str(exc),
                    )
                )
            source_document.processed_at = datetime.now(UTC)
            _set_processing_state(
                source_document,
                status=ProcessingStatus.failed,
                stage="failed",
                error=str(exc),
            )
            append_system_log(
                db,
                event_type="processing_failed",
                entity_id=source_document.id,
                message=f"Processing failed for {source_document.original_filename}",
                severity="error",
                metadata=_merge_log_metadata(
                    {"error": str(exc)},
                    processing_metadata,
                ),
            )
            db.commit()
    finally:
        db.close()


def build_draft_preview(source_document: SourceDocument, db: Session) -> dict | None:
    draft = get_generated_article_draft(db, source_document.id)
    if draft is not None:
        return {
            "title": draft.title,
            "summary": draft.summary,
            "kind": draft.kind,
            "source_reference": draft.source_reference,
            "extracted_text_preview": (source_document.extracted_text or "")[:1200],
            "keywords": draft.keywords,
            "steps": [step.model_dump() for step in draft.steps],
        }

    if not source_document.extracted_text:
        return None

    text = source_document.extracted_text
    lines = [line.strip("- ").strip() for line in text.splitlines() if line.strip()]
    steps = []
    for index, line in enumerate(lines[:5], start=1):
        steps.append({"step_no": index, "instruction": line[:180]})

    title = _humanize_title(source_document.original_filename)
    keywords = [source_document.source_type.value.replace("_", "-")]
    if source_document.requires_editor_review:
        keywords.append("needs-editor-review")
    if source_document.processing_status is ProcessingStatus.duplicate:
        keywords.append("duplicate-detected")

    return {
        "title": title,
        "summary": text[:220] + ("..." if len(text) > 220 else ""),
        "kind": _guess_article_kind(source_document.original_filename, lines),
        "source_reference": source_document.original_filename,
        "extracted_text_preview": text[:1200],
        "keywords": keywords,
        "steps": steps,
    }


def _humanize_title(filename: str) -> str:
    stem = Path(filename).stem.replace("_", " ").replace(".", " ")
    stem = re.sub(r"\s+", " ", stem).strip()
    return stem.title() or "Untitled Source Document"


def _guess_article_kind(filename: str, lines: list[str]) -> str:
    lowered_name = filename.lower()
    if "checklist" in lowered_name or any(line.lower().startswith("check") for line in lines[:3]):
        return "sop"
    if any(term in lowered_name for term in ("sop", "steps", "process")):
        return "sop"
    return "article"


def get_generated_article(source_document_id: uuid.UUID, db: Session) -> KBArticle | None:
    return db.scalar(
        select(KBArticle)
        .join(ArticleSource, ArticleSource.article_id == KBArticle.id)
        .where(ArticleSource.source_document_id == source_document_id)
        .order_by(KBArticle.created_at.desc())
    )


def get_generated_article_draft(db: Session, source_document_id: uuid.UUID) -> KBArticleDraft | None:
    article = get_generated_article(source_document_id, db)
    if article is None:
        return None
    return KBArticleDraft.model_validate(article.structured_content)

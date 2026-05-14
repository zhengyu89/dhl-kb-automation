from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.db.models import ArticleStatus, ProcessingStatus, SourceType as DBSourceType, UserRole


class ArticleKind(StrEnum):
    SOP = "sop"
    ARTICLE = "article"


class SourceType(StrEnum):
    TEXT = "text"
    EMAIL = "email"
    IMAGE = "image"
    PDF = "pdf"
    DOCX = "docx"
    UNKNOWN = "unknown"


class ArticleSection(BaseModel):
    heading: str = Field(..., min_length=3, max_length=120)
    content: str = Field(..., min_length=3, max_length=5000)


class ArticleStep(BaseModel):
    step_no: int = Field(..., ge=1)
    instruction: str = Field(..., min_length=3, max_length=500)


class KBArticleDraft(BaseModel):
    schema_version: Literal["1.0"] = "1.0"

    title: str = Field(..., min_length=5, max_length=160)
    kind: ArticleKind
    summary: str = Field(..., min_length=10, max_length=700)

    description: str = Field(..., min_length=20, max_length=20000)

    steps: list[ArticleStep] = Field(default_factory=list)
    sections: list[ArticleSection] = Field(default_factory=list)

    keywords: list[str] = Field(default_factory=list, max_length=8)

    source_reference: str = Field(..., min_length=1, max_length=300)
    source_type: SourceType = SourceType.UNKNOWN

    requires_editor_review: bool = True

    @field_validator("keywords")
    @classmethod
    def normalize_keywords(cls, keywords: list[str]) -> list[str]:
        cleaned = []
        seen = set()

        for keyword in keywords:
            normalized = keyword.strip().lower().replace(" ", "-")
            if normalized and normalized not in seen:
                cleaned.append(normalized[:40])
                seen.add(normalized)

        return cleaned[:8]


class UserProfile(BaseModel):
    id: str
    login_id: str
    full_name: str
    email: str
    role: UserRole


class AttachmentSummary(BaseModel):
    id: str
    file_name: str
    mime_type: str | None
    storage_path: str
    created_at: datetime


class OCRResultSummary(BaseModel):
    engine: str
    model_name: str | None
    average_confidence: float | None
    is_low_confidence: bool
    extracted_text: str


class DraftPreview(BaseModel):
    title: str
    summary: str
    kind: ArticleKind
    source_reference: str
    extracted_text_preview: str
    keywords: list[str]
    steps: list[ArticleStep]


class SourceDocumentSummary(BaseModel):
    id: str
    original_filename: str
    source_type: DBSourceType
    mime_type: str | None
    processing_status: ProcessingStatus
    processing_stage: str
    requires_editor_review: bool
    raw_text: str | None
    extracted_text: str | None
    content_hash: str | None
    file_hash: str | None
    duplicate_of_source_id: str | None
    processing_error: str | None
    created_at: datetime
    processed_at: datetime | None


class UploadResponse(BaseModel):
    processing_id: str
    processing_status: ProcessingStatus
    processing_stage: str


class ArticleListItem(BaseModel):
    id: str
    title: str
    summary: str | None
    kind: str
    status: ArticleStatus
    created_via: str
    requires_editor_review: bool
    current_version_no: int
    source_references: list[str]
    keywords: list[str]
    created_at: datetime
    updated_at: datetime


class ArticleDetail(BaseModel):
    id: str
    title: str
    summary: str | None
    kind: str
    status: ArticleStatus
    created_via: str
    requires_editor_review: bool
    current_version_no: int
    description: str | None
    steps: list[ArticleStep]
    sections: list[ArticleSection]
    structured_content: KBArticleDraft
    source_references: list[str]
    keywords: list[str]
    created_at: datetime
    updated_at: datetime
    created_by: str | None
    updated_by: str | None


class ArticleVersionSummary(BaseModel):
    id: str
    version_no: int
    title: str
    summary: str | None
    status_snapshot: ArticleStatus
    change_note: str | None
    created_by: str | None
    created_at: datetime
    structured_content: KBArticleDraft


class ArticleUpdatePayload(KBArticleDraft):
    change_note: str | None = None

    @field_validator("change_note")
    @classmethod
    def strip_change_note(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class ArticleStatusTransitionPayload(BaseModel):
    change_note: str | None = None

    @field_validator("change_note")
    @classmethod
    def strip_change_note(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class ProcessingStatusResponse(BaseModel):
    processing_id: str
    processing_status: ProcessingStatus
    processing_stage: str
    source_document: SourceDocumentSummary
    attachment: AttachmentSummary | None = None
    ocr_result: OCRResultSummary | None = None
    generated_draft: DraftPreview | None = None
    article: ArticleDetail | None = None

from __future__ import annotations

import re
import uuid
from typing import Iterable

from sqlalchemy import Select, delete, select
from sqlalchemy.orm import Session

from app.db.models import (
    AppUser,
    ArticleKeyword,
    ArticleSource,
    ArticleStatus,
    ArticleVersion,
    KBArticle,
    Keyword,
    SourceDocument,
    UserRole,
)
from app.schemas.api import (
    ArticleDetail,
    ArticleListItem,
    ArticleUpdatePayload,
    ArticleVersionSummary,
    KBArticleDraft,
)


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "article"


def build_unique_slug(db: Session, title: str, article_id: uuid.UUID | None = None) -> str:
    base_slug = slugify(title)
    slug = base_slug
    counter = 2

    while True:
        statement = select(KBArticle.id).where(KBArticle.slug == slug)
        if article_id is not None:
            statement = statement.where(KBArticle.id != article_id)
        exists = db.scalar(statement)
        if exists is None:
            return slug
        slug = f"{base_slug}-{counter}"
        counter += 1


def create_article_from_draft(
    db: Session,
    *,
    draft: KBArticleDraft,
    source_document: SourceDocument,
    created_by: uuid.UUID | None,
    created_via: str = "manual_upload",
    requires_editor_review: bool = False,
    status: ArticleStatus = ArticleStatus.draft,
) -> KBArticle:
    article = KBArticle(
        kind=draft.kind.value,
        title=draft.title,
        slug=build_unique_slug(db, draft.title),
        summary=draft.summary,
        description=draft.description,
        steps=[step.model_dump() for step in draft.steps],
        sections=[section.model_dump() for section in draft.sections],
        keywords=draft.keywords,
        structured_content=draft.model_dump(),
        status=status,
        created_via=created_via,
        requires_editor_review=requires_editor_review or draft.requires_editor_review,
        current_version_no=1,
        created_by=created_by,
        updated_by=created_by,
    )
    db.add(article)
    db.flush()

    db.add(
        ArticleSource(
            article_id=article.id,
            source_document_id=source_document.id,
        )
    )
    sync_article_keywords(db, article.id, draft.keywords)
    create_article_version(
        db,
        article=article,
        created_by=created_by,
        change_note="Initial AI-generated draft",
    )
    db.flush()
    return article


def update_article_from_payload(
    db: Session,
    *,
    article: KBArticle,
    payload: ArticleUpdatePayload,
    actor: AppUser,
) -> KBArticle:
    structured_content = KBArticleDraft.model_validate(payload.model_dump(exclude={"change_note"}))

    article.kind = structured_content.kind.value
    article.title = structured_content.title
    article.slug = build_unique_slug(db, structured_content.title, article.id)
    article.summary = structured_content.summary
    article.description = structured_content.description
    article.steps = [step.model_dump() for step in structured_content.steps]
    article.sections = [section.model_dump() for section in structured_content.sections]
    article.keywords = structured_content.keywords
    article.structured_content = structured_content.model_dump()
    article.requires_editor_review = structured_content.requires_editor_review
    article.updated_by = actor.id
    article.current_version_no += 1

    sync_article_keywords(db, article.id, structured_content.keywords)
    create_article_version(
        db,
        article=article,
        created_by=actor.id,
        change_note=payload.change_note or "Draft updated",
    )
    db.flush()
    return article


def create_article_version(
    db: Session,
    *,
    article: KBArticle,
    created_by: uuid.UUID | None,
    change_note: str | None,
) -> ArticleVersion:
    version = ArticleVersion(
        article_id=article.id,
        version_no=article.current_version_no,
        title=article.title,
        summary=article.summary,
        structured_content=article.structured_content,
        status_snapshot=article.status,
        change_note=change_note,
        created_by=created_by,
    )
    db.add(version)
    return version


def sync_article_keywords(db: Session, article_id: uuid.UUID, keyword_names: Iterable[str]) -> None:
    cleaned_keywords: list[str] = []
    seen: set[str] = set()
    for raw_name in keyword_names:
        name = raw_name.strip().lower()
        if not name or name in seen:
            continue
        seen.add(name)
        cleaned_keywords.append(name)

    db.execute(delete(ArticleKeyword).where(ArticleKeyword.article_id == article_id))
    if not cleaned_keywords:
        return

    keywords_by_name = {
        keyword.name: keyword
        for keyword in db.scalars(select(Keyword).where(Keyword.name.in_(cleaned_keywords))).all()
    }

    for name in cleaned_keywords:
        keyword = keywords_by_name.get(name)
        if keyword is None:
            keyword = Keyword(name=name)
            db.add(keyword)
            db.flush()
            keywords_by_name[name] = keyword
        db.add(ArticleKeyword(article_id=article_id, keyword_id=keyword.id))


def article_select_for_user(user: AppUser) -> Select[tuple[KBArticle]]:
    statement = select(KBArticle)
    if user.role is UserRole.editor:
        statement = statement.where(KBArticle.created_by == user.id)
    return statement


def get_article_for_user(db: Session, article_id: uuid.UUID, user: AppUser) -> KBArticle | None:
    statement = article_select_for_user(user).where(KBArticle.id == article_id)
    return db.scalar(statement)


def serialize_article_list_item(db: Session, article: KBArticle) -> ArticleListItem:
    return ArticleListItem(
        id=str(article.id),
        title=article.title,
        summary=article.summary,
        kind=article.kind,
        status=article.status,
        created_via=article.created_via,
        requires_editor_review=article.requires_editor_review,
        current_version_no=article.current_version_no,
        source_references=get_article_source_references(db, article.id),
        keywords=get_article_keywords(db, article.id),
        created_at=article.created_at,
        updated_at=article.updated_at,
    )


def serialize_article_detail(db: Session, article: KBArticle) -> ArticleDetail:
    draft = KBArticleDraft.model_validate(article.structured_content)
    return ArticleDetail(
        id=str(article.id),
        title=article.title,
        summary=article.summary,
        kind=article.kind,
        status=article.status,
        created_via=article.created_via,
        requires_editor_review=article.requires_editor_review,
        current_version_no=article.current_version_no,
        description=article.description,
        steps=draft.steps,
        sections=draft.sections,
        structured_content=draft,
        source_references=get_article_source_references(db, article.id),
        keywords=get_article_keywords(db, article.id),
        created_at=article.created_at,
        updated_at=article.updated_at,
        created_by=str(article.created_by) if article.created_by else None,
        updated_by=str(article.updated_by) if article.updated_by else None,
    )


def serialize_article_version(version: ArticleVersion) -> ArticleVersionSummary:
    return ArticleVersionSummary(
        id=str(version.id),
        version_no=version.version_no,
        title=version.title,
        summary=version.summary,
        status_snapshot=version.status_snapshot,
        change_note=version.change_note,
        created_by=str(version.created_by) if version.created_by else None,
        created_at=version.created_at,
        structured_content=KBArticleDraft.model_validate(version.structured_content),
    )


def get_article_versions(db: Session, article_id: uuid.UUID) -> list[ArticleVersionSummary]:
    versions = db.scalars(
        select(ArticleVersion)
        .where(ArticleVersion.article_id == article_id)
        .order_by(ArticleVersion.version_no.desc())
    ).all()
    return [serialize_article_version(version) for version in versions]


def get_article_keywords(db: Session, article_id: uuid.UUID) -> list[str]:
    rows = db.execute(
        select(Keyword.name)
        .join(ArticleKeyword, ArticleKeyword.keyword_id == Keyword.id)
        .where(ArticleKeyword.article_id == article_id)
        .order_by(Keyword.name.asc())
    ).all()
    return [row[0] for row in rows]


def get_article_source_references(db: Session, article_id: uuid.UUID) -> list[str]:
    rows = db.execute(
        select(SourceDocument.original_filename)
        .join(ArticleSource, ArticleSource.source_document_id == SourceDocument.id)
        .where(ArticleSource.article_id == article_id)
        .order_by(SourceDocument.created_at.asc())
    ).all()
    return [row[0] for row in rows]

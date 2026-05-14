from contextlib import asynccontextmanager
import uuid

from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.auth import (
    LoginRequest,
    LoginResponse,
    create_access_token,
    get_current_user,
    require_roles,
    seed_demo_users,
    user_to_profile,
    verify_password,
)
from app.core.config import settings
from app.db.models import AppUser, ArticleStatus, Attachment, KBArticle, OCRResult, SourceDocument, UserRole
from app.db.session import Base, SessionLocal, engine, ensure_database_schema_up_to_date, get_db
from app.schemas.api import (
    AttachmentSummary,
    ArticleDetail,
    ArticleListItem,
    ArticleStatusTransitionPayload,
    ArticleUpdatePayload,
    ArticleVersionSummary,
    DraftPreview,
    OCRResultSummary,
    ProcessingStatusResponse,
    SourceDocumentSummary,
    UploadResponse,
    UserProfile,
)
from app.services.article_management import (
    article_select_for_user,
    delete_article,
    get_article_for_user,
    get_article_source_references,
    get_article_versions,
    serialize_article_detail,
    serialize_article_list_item,
    transition_article_status,
    update_article_from_payload,
)
from app.services.source_processing import (
    build_draft_preview,
    create_source_document,
    ensure_storage_directory,
    get_generated_article,
    process_source_document,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    ensure_database_schema_up_to_date()
    ensure_storage_directory()
    db = SessionLocal()
    try:
        seed_demo_users(db)
        yield
    finally:
        db.close()

app = FastAPI(
    title="DHL KB Automation API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.frontend_origin,
        "http://localhost:4173",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:4173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {"message": "DHL KB Automation API is running"}


@app.post("/api/auth/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.scalar(
        select(AppUser).where(AppUser.login_id == payload.login_id, AppUser.is_active.is_(True))
    )
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid ID or password",
        )

    return LoginResponse(access_token=create_access_token(user), user=user_to_profile(user))


@app.get("/api/users/me", response_model=UserProfile)
def get_profile(current_user: AppUser = Depends(get_current_user)):
    return user_to_profile(current_user)


@app.post("/api/uploads", response_model=UploadResponse, status_code=status.HTTP_202_ACCEPTED)
async def upload_source_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    current_user: AppUser = Depends(require_roles(UserRole.editor, UserRole.admin)),
    db: Session = Depends(get_db),
):
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty")

    try:
        source_document = create_source_document(
            db,
            filename=file.filename or "uploaded_file",
            content_type=file.content_type,
            file_bytes=file_bytes,
            uploaded_by=current_user.id,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    background_tasks.add_task(process_source_document, source_document.id)
    return UploadResponse(
        processing_id=str(source_document.id),
        processing_status=source_document.processing_status,
        processing_stage=source_document.processing_stage,
    )


@app.get("/api/processing/{processing_id}", response_model=ProcessingStatusResponse)
def get_processing_status(
    processing_id: str,
    current_user: AppUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        source_uuid = uuid.UUID(processing_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Processing record not found") from exc

    source_document = db.get(SourceDocument, source_uuid)
    if source_document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Processing record not found")

    if current_user.role is UserRole.editor and source_document.uploaded_by not in {None, current_user.id}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to this record")

    attachment = db.scalar(
        select(Attachment).where(Attachment.source_document_id == source_document.id)
    )
    ocr_result = db.scalar(select(OCRResult).where(OCRResult.source_document_id == source_document.id))

    generated_draft = build_draft_preview(source_document, db)
    article = get_generated_article(source_document.id, db)
    return ProcessingStatusResponse(
        processing_id=str(source_document.id),
        processing_status=source_document.processing_status,
        processing_stage=source_document.processing_stage,
        source_document=SourceDocumentSummary(
            id=str(source_document.id),
            original_filename=source_document.original_filename,
            source_type=source_document.source_type,
            mime_type=source_document.mime_type,
            processing_status=source_document.processing_status,
            processing_stage=source_document.processing_stage,
            requires_editor_review=source_document.requires_editor_review,
            raw_text=source_document.raw_text,
            extracted_text=source_document.extracted_text,
            content_hash=source_document.content_hash,
            file_hash=source_document.file_hash,
            duplicate_of_source_id=str(source_document.duplicate_of_source_id)
            if source_document.duplicate_of_source_id
            else None,
            processing_error=source_document.processing_error,
            created_at=source_document.created_at,
            processed_at=source_document.processed_at,
        ),
        attachment=AttachmentSummary(
            id=str(attachment.id),
            file_name=attachment.file_name,
            mime_type=attachment.mime_type,
            storage_path=attachment.storage_path,
            created_at=attachment.created_at,
        )
        if attachment
        else None,
        ocr_result=OCRResultSummary(
            engine=ocr_result.engine,
            model_name=ocr_result.model_name,
            average_confidence=float(ocr_result.average_confidence)
            if ocr_result.average_confidence is not None
            else None,
            is_low_confidence=ocr_result.is_low_confidence,
            extracted_text=ocr_result.extracted_text,
        )
        if ocr_result
        else None,
        generated_draft=DraftPreview.model_validate(generated_draft) if generated_draft else None,
        article=serialize_article_detail(db, article) if article else None,
    )


@app.get("/api/articles", response_model=list[ArticleListItem])
def list_articles(
    q: str | None = Query(default=None),
    current_user: AppUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    statement = article_select_for_user(current_user).order_by(KBArticle.updated_at.desc())
    articles = db.scalars(statement).all()

    if q:
        q_lower = q.lower()
        articles = [
            article
            for article in articles
            if q_lower in article.title.lower()
            or q_lower in (article.summary or "").lower()
            or q_lower in article.kind.lower()
            or any(q_lower in keyword.lower() for keyword in (article.keywords or []))
            or any(q_lower in reference.lower() for reference in get_article_source_references(db, article.id))
        ]

    return [serialize_article_list_item(db, article) for article in articles]


@app.get("/api/articles/{article_id}", response_model=ArticleDetail)
def get_article(
    article_id: str,
    current_user: AppUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        article_uuid = uuid.UUID(article_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Article not found") from exc

    article = get_article_for_user(db, article_uuid, current_user)
    if article is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Article not found")
    return serialize_article_detail(db, article)


@app.patch("/api/articles/{article_id}", response_model=ArticleDetail)
def update_article(
    article_id: str,
    payload: ArticleUpdatePayload,
    current_user: AppUser = Depends(require_roles(UserRole.editor, UserRole.reviewer, UserRole.admin)),
    db: Session = Depends(get_db),
):
    try:
        article_uuid = uuid.UUID(article_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Article not found") from exc

    article = get_article_for_user(db, article_uuid, current_user)
    if article is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Article not found")

    update_article_from_payload(db, article=article, payload=payload, actor=current_user)
    db.commit()
    db.refresh(article)
    return serialize_article_detail(db, article)


def _load_article_for_transition(
    db: Session,
    article_id: str,
    current_user: AppUser,
) -> KBArticle:
    try:
        article_uuid = uuid.UUID(article_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Article not found") from exc

    article = get_article_for_user(db, article_uuid, current_user)
    if article is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Article not found")
    return article


@app.delete("/api/articles/{article_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_article_endpoint(
    article_id: str,
    current_user: AppUser = Depends(require_roles(UserRole.admin)),
    db: Session = Depends(get_db),
):
    article = _load_article_for_transition(db, article_id, current_user)
    delete_article(db, article=article)
    db.commit()
    return None


@app.post("/api/articles/{article_id}/submit-review", response_model=ArticleDetail)
def submit_article_for_review(
    article_id: str,
    payload: ArticleStatusTransitionPayload | None = None,
    current_user: AppUser = Depends(require_roles(UserRole.editor, UserRole.admin)),
    db: Session = Depends(get_db),
):
    article = _load_article_for_transition(db, article_id, current_user)
    if article.status not in {ArticleStatus.draft, ArticleStatus.rejected}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only draft or rejected articles can be submitted")

    transition_article_status(
        db,
        article=article,
        actor=current_user,
        status=ArticleStatus.submitted,
        change_note=(payload.change_note if payload else None) or "Submitted for reviewer approval",
    )
    db.commit()
    db.refresh(article)
    return serialize_article_detail(db, article)


@app.post("/api/articles/{article_id}/approve", response_model=ArticleDetail)
def approve_article(
    article_id: str,
    payload: ArticleStatusTransitionPayload | None = None,
    current_user: AppUser = Depends(require_roles(UserRole.reviewer, UserRole.admin)),
    db: Session = Depends(get_db),
):
    article = _load_article_for_transition(db, article_id, current_user)
    if article.status not in {ArticleStatus.submitted, ArticleStatus.rpa_submitted}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only submitted articles can be approved")

    transition_article_status(
        db,
        article=article,
        actor=current_user,
        status=ArticleStatus.reviewed,
        change_note=(payload.change_note if payload else None) or "Approved by reviewer",
    )
    db.commit()
    db.refresh(article)
    return serialize_article_detail(db, article)


@app.post("/api/articles/{article_id}/publish", response_model=ArticleDetail)
def publish_article(
    article_id: str,
    payload: ArticleStatusTransitionPayload | None = None,
    current_user: AppUser = Depends(require_roles(UserRole.reviewer, UserRole.admin)),
    db: Session = Depends(get_db),
):
    article = _load_article_for_transition(db, article_id, current_user)
    if article.status not in {ArticleStatus.submitted, ArticleStatus.rpa_submitted, ArticleStatus.reviewed}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only submitted or reviewed articles can be published")

    transition_article_status(
        db,
        article=article,
        actor=current_user,
        status=ArticleStatus.published,
        change_note=(payload.change_note if payload else None) or "Published directly from review queue",
    )
    db.commit()
    db.refresh(article)
    return serialize_article_detail(db, article)


@app.post("/api/articles/{article_id}/reject", response_model=ArticleDetail)
def reject_article(
    article_id: str,
    payload: ArticleStatusTransitionPayload | None = None,
    current_user: AppUser = Depends(require_roles(UserRole.reviewer, UserRole.admin)),
    db: Session = Depends(get_db),
):
    article = _load_article_for_transition(db, article_id, current_user)
    if article.status not in {ArticleStatus.submitted, ArticleStatus.rpa_submitted, ArticleStatus.reviewed}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only review-stage articles can be rejected")

    transition_article_status(
        db,
        article=article,
        actor=current_user,
        status=ArticleStatus.rejected,
        change_note=(payload.change_note if payload else None) or "Rejected by reviewer",
    )
    db.commit()
    db.refresh(article)
    return serialize_article_detail(db, article)


@app.post("/api/articles/{article_id}/request-changes", response_model=ArticleDetail)
def request_article_changes(
    article_id: str,
    payload: ArticleStatusTransitionPayload | None = None,
    current_user: AppUser = Depends(require_roles(UserRole.reviewer, UserRole.admin)),
    db: Session = Depends(get_db),
):
    article = _load_article_for_transition(db, article_id, current_user)
    if article.status not in {ArticleStatus.submitted, ArticleStatus.rpa_submitted, ArticleStatus.reviewed, ArticleStatus.rejected}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only review-stage articles can be returned to draft")

    transition_article_status(
        db,
        article=article,
        actor=current_user,
        status=ArticleStatus.draft,
        change_note=(payload.change_note if payload else None) or "Returned to draft for changes",
    )
    db.commit()
    db.refresh(article)
    return serialize_article_detail(db, article)


@app.get("/api/articles/{article_id}/versions", response_model=list[ArticleVersionSummary])
def list_article_versions(
    article_id: str,
    current_user: AppUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        article_uuid = uuid.UUID(article_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Article not found") from exc

    article = get_article_for_user(db, article_uuid, current_user)
    if article is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Article not found")
    return get_article_versions(db, article.id)


@app.get("/db-test")
def db_test(db: Session = Depends(get_db)):
    try:
        result = db.execute(text("SELECT NOW();"))
        current_time = result.fetchone()[0]
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Database unavailable") from exc

    return {
        "database": "connected",
        "time": str(current_time),
    }

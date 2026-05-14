from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import settings


engine = create_engine(
    settings.resolved_database_url,
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)


class Base(DeclarativeBase):
    pass


def ensure_database_schema_up_to_date() -> None:
    """Upgrade long-lived dev databases to the current application schema."""

    statements = [
        """
        ALTER TABLE IF EXISTS kb_articles
        ADD COLUMN IF NOT EXISTS kind VARCHAR(32)
        """,
        """
        ALTER TABLE IF EXISTS kb_articles
        ADD COLUMN IF NOT EXISTS description TEXT
        """,
        """
        ALTER TABLE IF EXISTS kb_articles
        ADD COLUMN IF NOT EXISTS steps JSON
        """,
        """
        ALTER TABLE IF EXISTS kb_articles
        ADD COLUMN IF NOT EXISTS sections JSON
        """,
        """
        ALTER TABLE IF EXISTS kb_articles
        ADD COLUMN IF NOT EXISTS keywords JSON
        """,
        """
        ALTER TABLE IF EXISTS kb_articles
        ADD COLUMN IF NOT EXISTS structured_content JSON
        """,
        """
        ALTER TABLE IF EXISTS kb_articles
        ADD COLUMN IF NOT EXISTS created_via VARCHAR(32)
        """,
        """
        ALTER TABLE IF EXISTS kb_articles
        ADD COLUMN IF NOT EXISTS requires_editor_review BOOLEAN
        """,
        """
        ALTER TABLE IF EXISTS kb_articles
        ADD COLUMN IF NOT EXISTS current_version_no INTEGER
        """,
        """
        ALTER TABLE IF EXISTS kb_articles
        ADD COLUMN IF NOT EXISTS created_by UUID
        """,
        """
        ALTER TABLE IF EXISTS kb_articles
        ADD COLUMN IF NOT EXISTS updated_by UUID
        """,
        """
        ALTER TABLE IF EXISTS kb_articles
        ADD COLUMN IF NOT EXISTS reviewed_by UUID
        """,
        """
        ALTER TABLE IF EXISTS kb_articles
        ADD COLUMN IF NOT EXISTS published_by UUID
        """,
        """
        ALTER TABLE IF EXISTS kb_articles
        ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ
        """,
        """
        ALTER TABLE IF EXISTS kb_articles
        ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ
        """,
        """
        ALTER TABLE IF EXISTS kb_articles
        ALTER COLUMN kind SET DEFAULT 'article'
        """,
        """
        ALTER TABLE IF EXISTS kb_articles
        ALTER COLUMN created_via SET DEFAULT 'manual_upload'
        """,
        """
        ALTER TABLE IF EXISTS kb_articles
        ALTER COLUMN requires_editor_review SET DEFAULT FALSE
        """,
        """
        ALTER TABLE IF EXISTS kb_articles
        ALTER COLUMN current_version_no SET DEFAULT 1
        """,
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'kb_articles' AND column_name = 'article_type'
            ) THEN
                EXECUTE $sql$
                    UPDATE kb_articles
                    SET kind = COALESCE(
                        kind,
                        article_type,
                        NULLIF(structured_content->>'kind', ''),
                        'article'
                    )
                    WHERE kind IS NULL
                $sql$;
            ELSE
                EXECUTE $sql$
                    UPDATE kb_articles
                    SET kind = COALESCE(kind, NULLIF(structured_content->>'kind', ''), 'article')
                    WHERE kind IS NULL
                $sql$;
            END IF;
        END $$;
        """,
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'kb_articles' AND column_name = 'problem_statement'
            ) AND EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'kb_articles' AND column_name = 'purpose'
            ) THEN
                EXECUTE $sql$
                    UPDATE kb_articles
                    SET description = COALESCE(
                        description,
                        structured_content->>'description',
                        problem_statement,
                        purpose
                    )
                    WHERE description IS NULL
                $sql$;
            ELSE
                EXECUTE $sql$
                    UPDATE kb_articles
                    SET description = COALESCE(description, structured_content->>'description')
                    WHERE description IS NULL
                $sql$;
            END IF;
        END $$;
        """,
        """
        UPDATE kb_articles
        SET created_via = COALESCE(created_via, 'manual_upload')
        WHERE created_via IS NULL
        """,
        """
        UPDATE kb_articles
        SET requires_editor_review = COALESCE(requires_editor_review, FALSE)
        WHERE requires_editor_review IS NULL
        """,
        """
        UPDATE kb_articles
        SET current_version_no = COALESCE(current_version_no, 1)
        WHERE current_version_no IS NULL
        """,
        """
        UPDATE kb_articles
        SET steps = COALESCE(steps, structured_content->'steps')
        WHERE steps IS NULL
        """,
        """
        UPDATE kb_articles
        SET sections = COALESCE(sections, structured_content->'sections')
        WHERE sections IS NULL
        """,
        """
        UPDATE kb_articles
        SET keywords = COALESCE(keywords, structured_content->'keywords')
        WHERE keywords IS NULL
        """,
        """
        DROP TRIGGER IF EXISTS kb_articles_sync_kind_columns ON kb_articles
        """,
        """
        DROP FUNCTION IF EXISTS sync_kb_article_kind_columns()
        """,
        """
        ALTER TABLE IF EXISTS ai_generation_runs
        ADD COLUMN IF NOT EXISTS ai_workflow_name VARCHAR(128)
        """,
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'ai_generation_runs' AND column_name = 'langchain_chain_name'
            ) THEN
                EXECUTE $sql$
                    UPDATE ai_generation_runs
                    SET ai_workflow_name = COALESCE(ai_workflow_name, langchain_chain_name)
                    WHERE ai_workflow_name IS NULL
                $sql$;
            END IF;
        END $$;
        """,
        """
        ALTER TABLE IF EXISTS ai_generation_runs
        ADD COLUMN IF NOT EXISTS article_id UUID
        """,
        """
        ALTER TABLE IF EXISTS ai_generation_runs
        ADD COLUMN IF NOT EXISTS prompt_version VARCHAR(32)
        """,
        """
        ALTER TABLE IF EXISTS ai_generation_runs
        ADD COLUMN IF NOT EXISTS schema_name VARCHAR(64)
        """,
        """
        ALTER TABLE IF EXISTS ai_generation_runs
        ADD COLUMN IF NOT EXISTS schema_version VARCHAR(16)
        """,
        """
        ALTER TABLE IF EXISTS ai_generation_runs
        ADD COLUMN IF NOT EXISTS input_text_hash VARCHAR(64)
        """,
        """
        ALTER TABLE IF EXISTS ai_generation_runs
        ADD COLUMN IF NOT EXISTS output_json JSON
        """,
        """
        ALTER TABLE IF EXISTS ai_generation_runs
        ADD COLUMN IF NOT EXISTS retry_count INTEGER
        """,
        """
        ALTER TABLE IF EXISTS ai_generation_runs
        ADD COLUMN IF NOT EXISTS max_retries INTEGER
        """,
        """
        ALTER TABLE IF EXISTS ai_generation_runs
        ADD COLUMN IF NOT EXISTS validation_error TEXT
        """,
        """
        ALTER TABLE IF EXISTS ai_generation_runs
        ADD COLUMN IF NOT EXISTS error_message TEXT
        """,
        """
        ALTER TABLE IF EXISTS ai_generation_runs
        ALTER COLUMN retry_count SET DEFAULT 0
        """,
        """
        ALTER TABLE IF EXISTS ai_generation_runs
        ALTER COLUMN max_retries SET DEFAULT 3
        """,
        """
        UPDATE ai_generation_runs
        SET retry_count = COALESCE(retry_count, 0)
        WHERE retry_count IS NULL
        """,
        """
        UPDATE ai_generation_runs
        SET max_retries = COALESCE(max_retries, 3)
        WHERE max_retries IS NULL
        """,
        """
        ALTER TABLE IF EXISTS kb_articles
        DROP COLUMN IF EXISTS article_type
        """,
        """
        ALTER TABLE IF EXISTS kb_articles
        DROP COLUMN IF EXISTS problem_statement
        """,
        """
        ALTER TABLE IF EXISTS kb_articles
        DROP COLUMN IF EXISTS error_code
        """,
        """
        ALTER TABLE IF EXISTS kb_articles
        DROP COLUMN IF EXISTS symptoms
        """,
        """
        ALTER TABLE IF EXISTS kb_articles
        DROP COLUMN IF EXISTS root_cause
        """,
        """
        ALTER TABLE IF EXISTS kb_articles
        DROP COLUMN IF EXISTS resolution_steps
        """,
        """
        ALTER TABLE IF EXISTS kb_articles
        DROP COLUMN IF EXISTS purpose
        """,
        """
        ALTER TABLE IF EXISTS kb_articles
        DROP COLUMN IF EXISTS scope
        """,
        """
        ALTER TABLE IF EXISTS kb_articles
        DROP COLUMN IF EXISTS prerequisites
        """,
        """
        ALTER TABLE IF EXISTS kb_articles
        DROP COLUMN IF EXISTS procedure_steps
        """,
        """
        ALTER TABLE IF EXISTS kb_articles
        DROP COLUMN IF EXISTS checklist_items
        """,
        """
        ALTER TABLE IF EXISTS kb_articles
        DROP COLUMN IF EXISTS faq_items
        """,
        """
        ALTER TABLE IF EXISTS kb_articles
        DROP COLUMN IF EXISTS escalation_rules
        """,
        """
        ALTER TABLE IF EXISTS ai_generation_runs
        DROP COLUMN IF EXISTS langchain_chain_name
        """,
    ]

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

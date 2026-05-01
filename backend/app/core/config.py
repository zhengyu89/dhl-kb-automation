from pathlib import Path
from typing import Literal

from pydantic import computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str | None = None
    db_user: str = "postgres"
    db_password: str = "postgres"
    db_host: str = "localhost"
    db_port: int = 5432
    db_name: str = "dhl_kb_automation"
    auth_secret_key: str = "dhl-kb-automation-local-dev-secret"
    frontend_origin: str = "http://localhost:5173"
    upload_storage_dir: str = "storage/uploads"
    ocr_confidence_threshold: float = 0.8
    easyocr_model_storage_dir: str = "storage/easyocr-models"
    easyocr_languages: str = "en"
    easyocr_gpu: bool = False
    openai_api_key: str | None = None
    openai_model_name: str = "gpt-5.4-nano"
    ai_max_retries: int = 3
    ai_timeout_seconds: float = 45.0
    ai_long_document_char_limit: int = 3000
    ai_max_output_tokens: int = 6000
    ai_reasoning_effort: Literal["none", "minimal", "low", "medium", "high", "xhigh"] = "none"
    ai_verbosity: Literal["low", "medium", "high"] = "low"
    ai_store_responses: bool = False
    ai_provider_max_retries: int = 0
    openai_agents_tracing_enabled: bool = False

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @computed_field
    @property
    def resolved_database_url(self) -> str:
        if self.database_url:
            return self.database_url

        return (
            f"postgresql+psycopg2://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )

    @computed_field
    @property
    def upload_storage_path(self) -> Path:
        return Path(self.upload_storage_dir).resolve()

    @computed_field
    @property
    def easyocr_model_storage_path(self) -> Path:
        return Path(self.easyocr_model_storage_dir).resolve()

    @computed_field
    @property
    def easyocr_language_list(self) -> list[str]:
        return [item.strip() for item in self.easyocr_languages.split(",") if item.strip()]


settings = Settings()

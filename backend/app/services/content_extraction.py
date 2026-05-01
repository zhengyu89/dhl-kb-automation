from __future__ import annotations

import re
from dataclasses import dataclass
from email import policy
from email.parser import BytesParser
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.core.config import settings

try:
    from docx import Document as DocxDocument
except ImportError:  # pragma: no cover - optional dependency
    DocxDocument = None

try:
    from pypdf import PdfReader
except ImportError:  # pragma: no cover - optional dependency
    PdfReader = None

try:
    import extract_msg
except ImportError:  # pragma: no cover - optional dependency
    extract_msg = None


class ExtractionError(RuntimeError):
    """Raised when a file cannot be extracted."""


@dataclass
class OCRExtractionResult:
    text: str
    average_confidence: float | None
    model_name: str | None


def normalize_text(value: str) -> str:
    value = value.replace("\r\n", "\n").replace("\r", "\n")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def extract_text_from_plain_bytes(data: bytes) -> str:
    for encoding in ("utf-8", "utf-8-sig", "cp1252", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="ignore")


def extract_text_from_pdf(file_path: Path) -> str:
    if PdfReader is None:
        raise ExtractionError("PDF extraction is unavailable because pypdf is not installed.")

    reader = PdfReader(str(file_path))
    return "\n".join(page.extract_text() or "" for page in reader.pages).strip()


def extract_text_from_docx(file_path: Path) -> str:
    if DocxDocument is None:
        raise ExtractionError("DOCX extraction is unavailable because python-docx is not installed.")

    document = DocxDocument(str(file_path))
    return "\n".join(paragraph.text for paragraph in document.paragraphs).strip()


def extract_text_from_email(file_path: Path) -> str:
    suffix = file_path.suffix.lower()
    if suffix == ".msg":
        return extract_text_from_msg(file_path)
    return extract_text_from_eml(file_path)


def extract_text_from_eml(file_path: Path) -> str:
    message = BytesParser(policy=policy.default).parsebytes(file_path.read_bytes())
    parts: list[str] = []

    subject = message.get("subject")
    sender = message.get("from")
    recipients = message.get("to")
    if subject:
        parts.append(f"Subject: {subject}")
    if sender:
        parts.append(f"From: {sender}")
    if recipients:
        parts.append(f"To: {recipients}")

    body_texts: list[str] = []
    if message.is_multipart():
        for part in message.walk():
            if part.get_content_type() == "text/plain":
                try:
                    body_texts.append(part.get_content())
                except Exception:
                    payload = part.get_payload(decode=True) or b""
                    body_texts.append(extract_text_from_plain_bytes(payload))
    else:
        try:
            body_texts.append(message.get_content())
        except Exception:
            body_texts.append(extract_text_from_plain_bytes(file_path.read_bytes()))

    body = "\n".join(item.strip() for item in body_texts if item and item.strip())
    if body:
        parts.append("Body:")
        parts.append(body)

    return "\n".join(parts).strip()


def extract_text_from_msg(file_path: Path) -> str:
    if extract_msg is None:
        raise ExtractionError("MSG extraction is unavailable because extract-msg is not installed.")

    message = extract_msg.Message(str(file_path))
    parts: list[str] = []

    if message.subject:
        parts.append(f"Subject: {message.subject}")
    if message.sender:
        parts.append(f"From: {message.sender}")
    if message.to:
        parts.append(f"To: {message.to}")
    if message.cc:
        parts.append(f"Cc: {message.cc}")
    if message.date:
        parts.append(f"Date: {message.date}")
    if message.body:
        parts.append("Body:")
        parts.append(message.body)

    return "\n".join(parts).strip()


class EasyOCRService:
    def _get_reader(self) -> Any:
        settings.easyocr_model_storage_path.mkdir(parents=True, exist_ok=True)
        return _get_easyocr_reader(
            tuple(settings.easyocr_language_list or ["en"]),
            settings.easyocr_gpu,
            str(settings.easyocr_model_storage_path),
        )

    def extract(self, file_path: Path) -> OCRExtractionResult:
        reader = self._get_reader()
        result = reader.readtext(str(file_path), detail=1, paragraph=False)
        model_name = f"EasyOCR ({', '.join(settings.easyocr_language_list or ['en'])})"
        return parse_easyocr_output(result, model_name)


@lru_cache(maxsize=1)
def _get_easyocr_reader(
    languages: tuple[str, ...],
    gpu: bool,
    model_storage_directory: str,
) -> Any:
    try:
        import easyocr
    except ImportError as exc:  # pragma: no cover - dependency is optional in tests
        raise ExtractionError("EasyOCR is not installed.") from exc

    return easyocr.Reader(
        list(languages),
        gpu=gpu,
        model_storage_directory=model_storage_directory,
        download_enabled=True,
    )


def parse_easyocr_output(result: Any, model_name: str | None) -> OCRExtractionResult:
    texts: list[str] = []
    scores: list[float] = []

    if isinstance(result, list):
        for item in result:
            if not isinstance(item, (list, tuple)):
                continue
            if len(item) >= 2 and isinstance(item[1], str):
                text = item[1].strip()
                if text:
                    texts.append(text)
            if len(item) >= 3:
                try:
                    scores.append(float(item[2]))
                except (TypeError, ValueError):
                    pass

    cleaned_text = normalize_text("\n".join(texts))
    average_confidence = round(sum(scores) / len(scores), 4) if scores else None
    return OCRExtractionResult(
        text=cleaned_text,
        average_confidence=average_confidence,
        model_name=model_name,
    )

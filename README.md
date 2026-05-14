# DHL Knowledge Base Automation

AI-assisted knowledge capture for DHL logistics operations. This project turns messy operational inputs like emails, screenshots, chat exports, troubleshooting notes, and SOP drafts into structured knowledge base articles that can be edited, reviewed, versioned, and published through a web app.

## Overview

Operations knowledge is often buried in scattered formats and informal messages. This system centralizes that process by combining:

- A React frontend for upload, editing, review, and knowledge browsing
- A FastAPI backend for ingestion, extraction, article management, and workflow state
- PostgreSQL for persistent storage
- EasyOCR for image and screenshot text extraction
- OpenAI Agents SDK for structured draft generation on shorter inputs
- Heuristic long-document preservation for large SOP-style content
- UiPath integration design for future automated ingestion

## What The System Does

The current app supports an end-to-end draft workflow:

- Sign in with role-based demo accounts
- Upload source files such as `.txt`, `.pdf`, `.docx`, `.eml`, `.msg`, and image formats
- Poll backend processing status after upload
- Extract text from documents, emails, and screenshots
- Generate a structured draft article with title, summary, description, steps, sections, and keywords
- Flag OCR-heavy or ambiguous content for editor review
- Edit drafts in the frontend
- Submit articles for review
- Approve, reject, request changes, or publish as reviewer/admin
- Track version history for each article
- Search articles across drafts, review items, and published content

## Workflow

1. An editor uploads a source document.
2. The backend stores the file and creates a processing record.
3. Text is extracted from the file, with EasyOCR used for image-based inputs.
4. Short inputs are structured into `KBArticleDraft` JSON using OpenAI Agents SDK when configured.
5. Long inputs skip full LLM restructuring and preserve the original content with local heuristics.
6. A draft article is created and shown in the frontend.
7. Editors refine the draft and submit it for review.
8. Reviewers approve, reject, return to draft, or publish the article.

## Implemented Modules

- Authentication with seeded demo users
- Upload console with status polling
- Source extraction and OCR pipeline
- AI-assisted article draft generation
- Draft editing and version tracking
- Review and publishing transitions
- Searchable article list and knowledge viewer

Planned or partial areas are documented in [docs/module_breakdown.md](docs/module_breakdown.md) and [docs/system_design.md](docs/system_design.md).

## Tech Stack

- Frontend: React 19, TypeScript, Vite, Tailwind CSS 4, shadcn/ui
- Backend: FastAPI, SQLAlchemy, Pydantic, `uv`
- Database: PostgreSQL
- OCR: EasyOCR
- AI: OpenAI Agents SDK
- Automation: UiPath workflow design

## Repository Structure

```text
frontend/   React application for upload, draft editing, review, and KB browsing
backend/    FastAPI API, services, schemas, database models, and tests
docs/       System design, module planning, requirements, and source samples
dev.ps1     Starts backend and frontend in separate PowerShell windows
```

## Local Development

### Prerequisites

- Node.js and npm
- Python 3.12+
- `uv`
- PostgreSQL running locally

### 1. Configure the backend

From the `backend` folder:

```powershell
Copy-Item .env.example .env
```

Update `.env` with your local database credentials and optional OpenAI key.

Important settings:

- `DB_USER`
- `DB_PASSWORD`
- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `OPENAI_API_KEY` optional

If `OPENAI_API_KEY` is not set, the backend falls back to heuristic draft generation.

### 2. Start the backend

```powershell
cd backend
uv run uvicorn app.main:app --reload
```

API default URL:

```text
http://localhost:8000
```

### 3. Start the frontend

```powershell
cd frontend
npm install
npm run dev
```

Frontend default URL:

```text
http://localhost:5173
```

### 4. Start both with the helper script

From the repo root:

```powershell
.\dev.ps1
```

## Demo Accounts

The backend seeds local demo users on startup:

- `Admin1 / admin123`
- `Reviewer1 / reviewer123`
- `Editor1 / editor123`

## Testing

Run backend tests from the `backend` directory:

```powershell
uv run pytest
```

Useful test docs:

- [backend/tests/README.md](backend/tests/README.md)

Some integration tests are optional and require environment flags:

- `RUN_REAL_OPENAI_TESTS=1`
- `RUN_REAL_OCR_TESTS=1`

## Notes On AI And OCR Behavior

- Shorter documents can be structured with OpenAI Agents SDK into a validated `KBArticleDraft`
- Long documents above the configured threshold use heuristic preservation instead of full AI restructuring
- OCR-based inputs are more likely to be marked for editor review
- Every article change creates a new version snapshot for traceability

## Project Documents

- [docs/system_design.md](docs/system_design.md)
- [docs/module_breakdown.md](docs/module_breakdown.md)
- [docs/systemRequirement.md](docs/systemRequirement.md)
- [docs/uipath_setup_guide.md](docs/uipath_setup_guide.md)

## Current Scope

This repository already demonstrates the core upload-to-draft-to-review workflow. It is also structured to support a fuller DHL operations automation story, including richer admin monitoring, deeper RPA ingestion, and production deployment targets such as Supabase-backed infrastructure.

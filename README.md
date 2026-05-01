# DHL AI-Powered Knowledge Base Automation
The system transforms fragmented operational knowledge from emails, notes, screenshots, SOP drafts, and chat messages into standardized KB/SOP articles with review workflow and audit history.

## Tech Stack

- Frontend: React + Vite + Tailwind CSS + Shadcn.UI
- Backend: FastAPI using uv virtual environment
- Database: PostgreSQL
- RPA: UiPath Studio
- OCR: easyOCR
- LLM: chatgpt 5 nano, OPENAI Agent SDK

## Project Structure

frontend/   React web application
backend/    FastAPI JSON API
docs/       RPA workflow diagrams, report materials, screenshots

| Role     | Main purpose                   |
| -------- | ------------------------------ |
| Editor   | Create/edit draft articles     |
| Reviewer | Review/publish articles        |
| Admin    | Manage users and view RPA logs |

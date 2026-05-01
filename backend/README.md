Activate with: .venv\Scripts\activate
uv run uvicorn app.main:app --reload

Backend layout:
- `app/api` for FastAPI app wiring and endpoints
- `app/core` for configuration and auth helpers
- `app/db` for SQLAlchemy session setup and models
- `app/schemas` for request/response and domain schemas
- `app/services` for processing, extraction, article management, and AI generation
- `tests` for backend test cases

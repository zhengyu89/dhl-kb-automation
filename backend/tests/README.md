# Backend Test Commands

This folder contains backend tests that are run with `pytest`.
The test files use `unittest` style, but the recommended runner for this project is still `pytest`.

## Recommended Working Directory

Run the commands below from the `backend` folder:

```powershell
cd backend
```

## Basic Test Commands

Run all tests:

```powershell
uv run pytest
```

Run one test file:

```powershell
uv run pytest tests/test_connection.py
uv run pytest tests/test_upload_processing.py
uv run pytest tests/test_article_generation_management.py
uv run pytest tests/test_ai_article_generation_management.py
```

Run one specific test case:

```powershell
uv run pytest tests/test_upload_processing.py -k duplicate
uv run pytest tests/test_upload_processing.py::UploadProcessingTests::test_upload_duplicate_file_is_flagged
```

## Common Pytest Flags

### `-v`

Verbose mode. Shows each test name in more detail.

```powershell
uv run pytest -v
uv run pytest -v tests/test_connection.py
```

### `-s`

Shows `print()` output in the terminal. Useful for these tests because several of them print JSON payloads and processing results.

```powershell
uv run pytest -s
uv run pytest -s tests/test_upload_processing.py
```

### `-r`

Shows extra test summary info.

Common variants:

- `-ra` shows a short summary for all except passed tests
- `-rs` shows skipped tests
- `-rf` shows failed tests
- `-rx` shows xfailed tests

```powershell
uv run pytest -ra
uv run pytest -rs
uv run pytest -ra -s
```

### `-q`

Quiet mode. Reduces output.

```powershell
uv run pytest -q
```

### `-x`

Stop after the first failure.

```powershell
uv run pytest -x
```

### `--maxfail`

Stop after a specific number of failures.

```powershell
uv run pytest --maxfail=2
```

### `-k`

Run tests matching a keyword expression.

```powershell
uv run pytest -k upload
uv run pytest -k openai
uv run pytest -k "duplicate or email"
```

## Useful Combined Commands

Show detailed names, print output, and skip summary:

```powershell
uv run pytest -v -s -rs
```

Show detailed output for one file:

```powershell
uv run pytest -v -s tests/test_upload_processing.py
```

Stop early and show extra summary:

```powershell
uv run pytest -x -ra
```

Run a single test with full output:

```powershell
uv run pytest -v -s tests/test_upload_processing.py::UploadProcessingTests::test_upload_text_file_creates_processed_draft
```

## Real Integration Test Flags

Some tests are skipped unless specific environment variables are enabled.

### OCR integration tests

These tests require:

- `RUN_REAL_OCR_TESTS=1`
- OCR dependencies installed
- local model access or download access for EasyOCR

PowerShell:

```powershell
$env:RUN_REAL_OCR_TESTS="1"
uv run pytest -v -s -rs tests/test_upload_processing.py
```

### OpenAI integration tests

These tests require:

- `RUN_REAL_OPENAI_TESTS=1`
- `OPENAI_API_KEY` to be set

PowerShell:

```powershell
$env:RUN_REAL_OPENAI_TESTS="1"
$env:OPENAI_API_KEY="your_api_key_here"
uv run pytest -v -s -rs tests/test_ai_article_generation_management.py
```

### OpenAI + OCR integration tests together

```powershell
$env:RUN_REAL_OPENAI_TESTS="1"
$env:RUN_REAL_OCR_TESTS="1"
$env:OPENAI_API_KEY="your_api_key_here"
uv run pytest -v -s -rs tests/test_ai_article_generation_management.py
```

## Notes

- `-s` is especially useful in this project because many tests print API responses and generated content.
- `-rs` helps explain why optional tests were skipped.
- If you are only checking normal local behavior, start with:

```powershell
uv run pytest -v -s -rs
```

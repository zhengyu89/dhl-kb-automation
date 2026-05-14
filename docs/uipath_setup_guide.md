# UiPath Setup Guide for DHL KB Automation

## 1. Purpose

This guide aligns UiPath with the latest system design in:

- [system_design.md](/d:/UTM/Y3S2/Webtech/dhl-kb-automation/docs/system_design.md)
- [systemRequirement.md](/d:/UTM/Y3S2/Webtech/dhl-kb-automation/docs/systemRequirement.md)

UiPath is a lightweight ingestion layer for the DHL Knowledge Base Automation platform. It should detect incoming source material, submit it to the FastAPI backend, track the result, and notify operators. It should not own extraction, OCR, AI generation, article authoring, approval logic, or direct database writes.

## 2. UiPath Role in the Latest Design

### 2.1 What UiPath Should Do

UiPath is responsible for:

1. Detecting new files from a watched folder, exported mailbox folder, or shared-drive sync location.
2. Filtering eligible source files such as `.txt`, `.pdf`, `.docx`, `.jpg`, `.jpeg`, `.png`, and exported email files.
3. Sending file or text payloads to the FastAPI backend.
4. Receiving the backend processing result.
5. Logging whether the item was created, marked duplicate, flagged for review, or failed.
6. Capturing screenshots when the automation itself fails.
7. Sending a run summary email.

### 2.2 What UiPath Must Not Do

UiPath must not:

1. Write directly into PostgreSQL or Supabase.
2. Run OCR itself.
3. Call OpenAI directly.
4. Generate final SOP or article content.
5. Decide whether content is publishable.
6. Bypass the editor and reviewer lifecycle.
7. Update article records except through the backend API.

This boundary matches the latest architecture rule:

- UiPath detects and sends.
- FastAPI processes and stores.
- EasyOCR extracts image text.
- OpenAI Agents SDK structures short content.
- Human users review and publish.

## 3. End-to-End RPA Flow

The current target flow is:

1. UiPath scans a configured folder or exported mailbox location.
2. UiPath detects a new eligible file.
3. UiPath sends the file to FastAPI.
4. FastAPI stores the file, extracts text, hashes content, checks duplicates, runs OCR when needed, and generates the draft.
5. FastAPI returns a result such as `created`, `duplicate`, `failed`, or `needs_editor_review`.
6. UiPath logs the outcome and moves the file to the correct folder.
7. UiPath captures an automation screenshot if its own processing step fails.
8. UiPath sends a summary email after the run.

This follows the RPA ingestion workflow in the latest system design and keeps FastAPI as the owner of business logic.

## 4. Recommended UiPath Project Structure

### 4.1 UiPath Studio Project

Create one UiPath Studio project, for example:

- `DHL.KB.Automation.Ingestion`

Recommended workflow files:

- `Main.xaml`
- `Init_Config.xaml`
- `Scan_Source_Folder.xaml`
- `Filter_Eligible_Files.xaml`
- `Build_Ingest_Request.xaml`
- `Send_To_FastAPI.xaml`
- `Handle_Backend_Result.xaml`
- `Route_File.xaml`
- `Capture_Failure_Screenshot.xaml`
- `Send_Summary_Email.xaml`

### 4.2 Suggested Transaction Variables

Keep the workflow simple and consistent with the backend response model.

Suggested run-level variables:

- `RunId`
- `RunStartTime`
- `RunEndTime`
- `TotalDetected`
- `CreatedCount`
- `DuplicateCount`
- `NeedsReviewCount`
- `FailedCount`

Suggested item-level variables:

- `CurrentFilePath`
- `CurrentFileName`
- `CurrentExtension`
- `DetectedAt`
- `ApiResponseStatus`
- `ProcessingId`
- `ArticleId`
- `SourceDocumentId`
- `DuplicateOfSourceId`
- `BackendMessage`

## 5. Configuration to Prepare

### 5.1 Local Config File or Orchestrator Assets

Use a config file for local development and move the same settings into Orchestrator assets later if available.

Suggested keys:

- `ApiBaseUrl`
- `RpaIngestEndpoint`
- `SourceFolder`
- `ProcessedFolder`
- `DuplicateFolder`
- `FailedFolder`
- `ReviewNeededFolder`
- `ScreenshotFolder`
- `ArchiveFolder`
- `SummaryEmailTo`
- `SummaryEmailCc`
- `MaxItemsPerRun`
- `RetryCount`
- `RetryDelaySeconds`
- `RequestTimeoutSeconds`
- `AllowedExtensions`

Recommended development values:

- `ApiBaseUrl = http://localhost:8000`
- `RpaIngestEndpoint = /api/rpa/ingest`

### 5.2 Folder Layout

Set up these working folders:

- `input/`
- `processed/`
- `duplicate/`
- `failed/`
- `review-needed/`
- `screenshots/`
- `archive/`

Suggested usage:

- `input/`: new files waiting for UiPath pickup
- `processed/`: files successfully accepted by FastAPI
- `duplicate/`: files that match the backend duplicate rule
- `failed/`: files that could not be processed successfully
- `review-needed/`: optional holding area for files whose backend result is `needs_editor_review`
- `screenshots/`: screenshots from UiPath exception handling
- `archive/`: optional long-term retention area

## 6. Backend Contract UiPath Should Target

### 6.1 Primary Endpoint

UiPath should submit files to:

- `POST /api/rpa/ingest`

Important design note:

- In `system_design.md`, this endpoint is currently marked as `Planned`.
- UiPath setup should therefore target this contract, but the backend must implement it before end-to-end RPA testing can be completed.

### 6.2 Request Shape

UiPath should send a multipart/form-data request for file-based ingestion.

Suggested request parts:

- uploaded file
- `file_name`
- `source_path`
- `ingestion_method = rpa`
- `rpa_run_id`
- `detected_at`

If the source is already available as text rather than a file export, include:

- `raw_text`
- `source_reference`

The backend should still remain responsible for storing the source and deciding the final `source_type`.

### 6.3 Response Handling

UiPath should be ready for these backend outcomes:

- `created`
- `duplicate`
- `failed`
- `needs_editor_review`

UiPath should log these response fields when available:

- `status`
- `processing_id`
- `article_id`
- `source_document_id`
- `duplicate_of_source_id`
- `message`
- `requires_editor_review`

### 6.4 Meaning of Each Result

#### `created`

Meaning:

- FastAPI successfully created a draft article record.

UiPath action:

- increment `CreatedCount`
- move the file to `processed/`

Backend note:

- manual uploads normally create article status `draft`
- successful RPA ingestion may create article status `rpa_submitted`, unless review flags force a safer path

#### `duplicate`

Meaning:

- FastAPI detected the source as a duplicate using normalized text or file hashing with the 14-day lookback rule.

UiPath action:

- increment `DuplicateCount`
- move the file to `duplicate/`

#### `needs_editor_review`

Meaning:

- the backend processed the item, but OCR ambiguity, AI ambiguity, or long-document preservation requires human review

UiPath action:

- increment `NeedsReviewCount`
- move the file to `review-needed/` or `processed/`, depending on your operating preference

Design note:

- this aligns with the `processing_status` enum in the latest design
- OCR-derived content must be reviewed before publication
- long-document heuristic preservation also sets `requires_editor_review = true`

#### `failed`

Meaning:

- FastAPI could not complete the processing flow

UiPath action:

- increment `FailedCount`
- move the file to `failed/`
- record the returned error message

## 7. Recommended UiPath Workflow Logic

### 7.1 Main Sequence

1. Initialize config and summary counters.
2. Generate a `RunId`.
3. Scan the configured input folder.
4. Filter for allowed extensions.
5. Limit items if `MaxItemsPerRun` is configured.
6. Loop through files one by one.
7. Build and send the API request.
8. Parse the backend response.
9. Route the file according to result.
10. Add the item to the summary log.
11. On UiPath-side exception, capture screenshot and continue when safe.
12. Send summary email.
13. End the run.

### 7.2 Decision Rules

If FastAPI returns `created`:

- record success
- move file to `processed/`

If FastAPI returns `duplicate`:

- record duplicate
- move file to `duplicate/`

If FastAPI returns `needs_editor_review`:

- record review-required
- move file to `review-needed/` or `processed/`

If FastAPI returns `failed`:

- record failure
- move file to `failed/`

If UiPath itself throws an exception before a valid response:

- capture screenshot
- record local automation failure
- move file to `failed/` if retry is exhausted

## 8. Logging and Monitoring Alignment

### 8.1 What UiPath Should Log

UiPath should maintain a run summary with:

- run start time
- run end time
- total files detected
- created count
- duplicate count
- needs-review count
- failed count
- list of failed file names

UiPath should maintain item-level details with:

- file name
- source path
- detected time
- API status
- processing ID
- article ID if returned
- duplicate reference if returned
- error message if returned

### 8.2 What the Backend Already Owns

According to the latest system design, the backend is responsible for storing and auditing:

- `source_documents`
- `attachments`
- `ocr_results`
- `ai_generation_runs`
- `system_logs`
- `article_versions`
- article status and structured content

Important refinement from the latest design:

- do not assume `rpa_runs` or `rpa_run_items` tables exist
- they are not part of the current system design schema
- keep UiPath run logging operational on the UiPath side unless the backend later adds dedicated RPA run tables or logging endpoints

## 9. Summary Email Design

UiPath should send one compact email after each run.

Suggested subject:

- `DHL KB Automation RPA Summary - {RunDateTime}`

Suggested content:

- total items scanned
- created count
- duplicate count
- needs-review count
- failed count
- filenames by result group
- brief error list for failed items

Optional attachments:

- local run log export
- failure screenshots when relevant

This satisfies the requirement that the RPA process sends an execution summary to the system admin.

## 10. Exception Handling Rules

UiPath should handle these cases at minimum:

- source folder not reachable
- file locked by another process
- unsupported extension
- FastAPI service unavailable
- request timeout
- backend `500` error
- malformed or incomplete API response

Recommended handling:

1. retry transient failures based on `RetryCount` and `RetryDelaySeconds`
2. record the exception details
3. capture a screenshot when the failure is within the UiPath workflow or desktop interaction
4. continue processing remaining files when safe
5. include all failed items in the summary email

Important boundary:

- screenshots are for UiPath operational troubleshooting
- backend processing failures should still be treated as backend outcomes returned by the API

## 11. Local Development Checklist

Before running UiPath locally, make sure:

1. PostgreSQL is running on localhost.
2. the project database is available.
3. FastAPI starts successfully.
4. the backend file storage path is writable.
5. `POST /api/rpa/ingest` has been implemented or mocked.
6. test files exist in `input/`.
7. UiPath config points to `http://localhost:8000`.

Practical note:

- if `/api/rpa/ingest` is still unimplemented, UiPath workflow development can still proceed using a stubbed response or Postman-tested mock contract

## 12. Alignment With Functional Requirements

This refined UiPath setup supports the documented requirements by ensuring that UiPath can:

- ingest files from a designated folder or exported mailbox source
- rely on backend duplicate checks using a 14-day lookback
- create content through the web application backend rather than directly in the database
- record failures and take screenshots
- send an execution summary email with created, duplicate, review-required, and failed totals

It also stays aligned with the latest design constraints:

- FastAPI owns extraction, OCR orchestration, duplicate detection, AI generation, article creation, and versioning
- UiPath stays intentionally thin and operational
- all articles still go through human review before publication

## 13. Final Boundary Rule

Use this as the implementation rule of thumb:

- UiPath handles detection, submission, routing, and run reporting.
- FastAPI handles extraction, hashing, OCR, AI structuring, persistence, and article lifecycle creation.
- Editors and reviewers handle validation, approval, and publication.

That separation is the latest approved design and should be kept intact during implementation and demo preparation.

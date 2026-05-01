# UiPath Setup Guide for DHL KB Automation

## 1. Purpose

This document explains what can be set up in UiPath for the DHL AI-Powered Knowledge Base Automation project.

It is written to support:

- Module 8: RPA Integration
- Module 10: Database and environment setup alignment
- Module 11: Testing and demo preparation

The goal is to keep UiPath focused on ingestion and operational logging, while FastAPI remains responsible for extraction, OCR orchestration, duplicate detection, AI generation, and database writes.

## 2. What UiPath Should Do in This Project

UiPath should be responsible for:

- Watching a folder, shared drive, or exported mailbox location for new source files
- Picking up eligible files such as `.txt`, `.pdf`, `.docx`, `.jpg`, `.png`, and message exports
- Sending file or text payloads to the FastAPI backend
- Receiving the backend result
- Recording whether the result was `created`, `duplicate`, or `failed`
- Capturing screenshots when a processing failure happens
- Sending a summary email after a run

UiPath should not be responsible for:

- Writing directly into PostgreSQL
- Running OCR itself
- Calling ChatGPT directly
- Deciding whether an article is publishable
- Bypassing the editor and reviewer workflow

## 3. Recommended UiPath Components To Set Up

### 3.1 UiPath Studio Project

Create one UiPath Studio project for this automation, for example:

- `DHL.KB.Automation.Ingestion`

Recommended workflow files:

- `Main.xaml`
- `Init_Config.xaml`
- `Scan_Source_Folder.xaml`
- `Validate_File.xaml`
- `Send_To_FastAPI.xaml`
- `Handle_Result.xaml`
- `Capture_Failure_Screenshot.xaml`
- `Send_Summary_Email.xaml`

### 3.2 Configuration File

Create a config file that UiPath can read at runtime.

Suggested keys:

- `ApiBaseUrl`
- `RpaIngestEndpoint`
- `SourceFolder`
- `ProcessedFolder`
- `DuplicateFolder`
- `FailedFolder`
- `ScreenshotFolder`
- `SummaryEmailTo`
- `SummaryEmailCc`
- `MaxItemsPerRun`
- `RetryCount`
- `RetryDelaySeconds`
- `AllowedExtensions`

Recommended local development values:

- `ApiBaseUrl = http://localhost:8000`
- `RpaIngestEndpoint = /api/rpa/ingest`

### 3.3 Local Source Folders

Set up local or network folders for file movement:

- `input/`
- `processed/`
- `duplicate/`
- `failed/`
- `screenshots/`
- `archive/`

Suggested behavior:

- New items start in `input/`
- Successfully created items move to `processed/`
- Duplicates move to `duplicate/`
- Failed items move to `failed/`
- Error screenshots go to `screenshots/`

### 3.4 Orchestrator Assets or Modern Folders

If UiPath Orchestrator is available, store runtime settings there instead of hardcoding values.

Good candidates for assets:

- API base URL
- email recipients
- source folder path
- API auth token if required later
- environment name such as `dev`, `uat`, or `prod`

Use separate Orchestrator folders or separate asset sets for:

- development
- testing
- production

## 4. How UiPath Should Interact With This System

### 4.1 Ingestion Flow

Recommended flow:

1. Read the configured source folder.
2. Filter files by allowed extension.
3. For each file, gather file name, path, extension, and created time.
4. Send the file to FastAPI.
5. Read the API response.
6. Move the file based on the response status.
7. Log the result in the run summary.
8. Capture screenshot and error details if the request fails.

### 4.2 FastAPI Request

UiPath should call:

- `POST /api/rpa/ingest`

Suggested request content:

- multipart upload for files
- metadata fields such as source path, ingestion method, and run ID

Suggested metadata fields:

- `file_name`
- `source_path`
- `ingestion_method = rpa`
- `rpa_run_id`
- `detected_at`

### 4.3 Expected Backend Response

UiPath should be prepared to handle responses such as:

- `created`
- `duplicate`
- `failed`
- `needs_editor_review`

Suggested response fields UiPath should log:

- `status`
- `processing_id`
- `article_id`
- `source_document_id`
- `duplicate_of_source_id`
- `message`

## 5. What To Prepare In Module 10 For UiPath Compatibility

Module 10 is mainly about database and environment setup, but there are a few things that should be prepared so UiPath can work cleanly with the backend.

### 5.1 Local Development Environment

Set up:

- FastAPI running locally
- PostgreSQL running on localhost
- a development database such as `dhl_kb_automation`
- environment variables for FastAPI pointing to localhost PostgreSQL

Recommended local database connection target:

- `postgresql+psycopg2://postgres:postgres@localhost:5432/dhl_kb_automation`

UiPath should call the local FastAPI API only.
UiPath should not connect directly to PostgreSQL.

### 5.2 Database Tables That Support UiPath

Module 10 should prepare these tables for future UiPath integration:

- `rpa_runs`
- `rpa_run_items`
- `source_documents`
- `system_logs`
- `attachments`

These tables allow the backend to:

- record an RPA run
- record each file processed in that run
- store source-document metadata
- store duplicate and failure information
- store screenshot or attachment references

### 5.3 Storage Structure

Module 10 should also prepare storage locations for:

- uploaded source files
- failure screenshots
- run logs

If Supabase Storage is used later, recommended logical buckets are:

- `source-documents`
- `rpa-screenshots`
- `rpa-logs`

For local development before full Supabase wiring, keep the folder naming aligned with those same concepts.

## 6. Suggested UiPath Workflow Design

### 6.1 Main Sequence

- Initialize config
- Start run log
- Scan folder
- For each file:
- validate file
- send to backend
- parse result
- route file
- add run summary entry
- if failed, capture screenshot
- send summary email
- end run log

### 6.2 Decision Rules

If backend returns `created`:

- mark item as created
- move file to `processed/`

If backend returns `duplicate`:

- mark item as duplicate
- move file to `duplicate/`

If backend returns `needs_editor_review`:

- mark item as created with review flag
- move file to `processed/` or a dedicated `review-needed/` folder

If backend returns `failed`:

- capture screenshot
- move file to `failed/`
- store error message

## 7. Logging and Monitoring Setup

UiPath should maintain a run-level summary containing:

- run start time
- run end time
- total files detected
- created count
- duplicate count
- failed count
- list of failed file names

Suggested item-level fields:

- file name
- source path
- detected time
- API response status
- processing ID
- article ID if created
- duplicate reference if duplicate
- error message if failed

## 8. Summary Email Setup

Set up an email step that sends a compact run report after each automation cycle.

Suggested email sections:

- total items scanned
- created items
- duplicates
- failed items
- list of filenames by result
- screenshots attached for failures if needed

Suggested subject line:

- `DHL KB Automation RPA Summary - {RunDateTime}`

## 9. Exception Handling Setup

UiPath should handle at least these cases:

- source folder not reachable
- file locked by another process
- unsupported extension
- FastAPI unavailable
- request timeout
- API returns `500`
- malformed API response

Recommended handling:

- retry transient failures
- capture error details
- take screenshot where useful
- continue processing remaining files when safe
- include failures in summary email

## 10. Local Development Checklist

Before testing UiPath locally, make sure these are ready:

- PostgreSQL is running on localhost
- the `dhl_kb_automation` database exists
- FastAPI starts successfully against localhost PostgreSQL
- the `POST /api/rpa/ingest` endpoint is available
- test source files exist in the input folder
- UiPath config points to `http://localhost:8000`

## 11. Recommended Future Enhancements

Later, the UiPath setup can be improved with:

- mailbox monitoring instead of only folder monitoring
- queue-based processing through Orchestrator
- separate retry queue for transient failures
- scheduled unattended runs
- dashboard integration for run metrics
- attachment of failure screenshots into centralized storage

## 12. Practical Boundary Rule

The cleanest rule for this project is:

- UiPath detects and sends
- FastAPI processes and stores
- PostgreSQL keeps system records
- human users review and publish

That separation will keep the automation simpler, easier to debug, and consistent with the module design already documented in this project.

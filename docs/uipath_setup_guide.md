# UiPath Setup Guide for DHL KB Automation

## 1. Purpose

This guide documents the current UiPath implementation for DHL Knowledge Base Automation.

The bot scans files, sends them to FastAPI, handles the returned result, routes the file, and finally shows a message box summary.

## 2. UiPath Role

UiPath is a thin ingestion layer.

UiPath is responsible for:

1. detecting source files
2. filtering eligible files
3. building the backend request
4. sending the file to FastAPI
5. reading the backend response
6. routing the file to the correct folder
7. showing the final run result in a message box

UiPath is not responsible for:

- OCR
- AI generation
- database writes
- article publishing

Those responsibilities belong to the FastAPI backend.

## 3. Implemented Workflow Files

The completed workflow files are:

- `Main.xaml`
- `Init_Config.xaml`
- `Scan_Source_Folder.xaml`
- `Filter_Eligible_Files.xaml`
- `Build_Ingest_Request.xaml`
- `Send_To_FastAPI.xaml`
- `Handle_Backend_Result.xaml`
- `Route_File.xaml`

## 4. Recommended Project Structure

Create one UiPath project, for example:

- `DHL.KB.Automation.Ingestion`

Use the workflow files listed above.

## 5. Configuration

Prepare these config values:

- `ApiBaseUrl`
- `RpaIngestEndpoint`
- `SourceFolder`
- `ProcessedFolder`
- `DuplicateFolder`
- `ReviewNeededFolder`
- `FailedFolder`
- `AllowedExtensions`
- `MaxItemsPerRun`

Recommended local values:

- `ApiBaseUrl = http://localhost:8000`
- `RpaIngestEndpoint = /api/rpa/ingest`

## 6. Folder Layout

Set up these folders:

- `input/`
- `processed/`
- `duplicate/`
- `review-needed/`
- `failed/`

Folder usage:

- `input/` for new source files
- `processed/` for successful files
- `duplicate/` for duplicate files
- `review-needed/` for files flagged for human review
- `failed/` for failed files

## 7. Backend Endpoint

UiPath sends files to:

- `POST /api/rpa/ingest`

The backend returns the final result directly for each file.

Expected result values:

- `created`
- `duplicate`
- `needs_editor_review`
- `failed`

Expected response fields:

- `status`
- `processing_id`
- `article_id`
- `source_document_id`
- `duplicate_of_source_id`
- `message`
- `requires_editor_review`

Example response:

```json
{
  "status": "created",
  "processing_id": "source-document-uuid",
  "article_id": "article-uuid",
  "source_document_id": "source-document-uuid",
  "duplicate_of_source_id": null,
  "message": "Draft article created",
  "requires_editor_review": false
}
```

## 8. Workflow Logic

### 8.1 Main Flow

1. Initialize config values.
2. Scan the source folder.
3. Filter files by allowed extension.
4. Loop through each eligible file.
5. Build the ingest request.
6. Send the file to FastAPI.
7. Read the backend result.
8. Route the file based on the returned status.
9. After processing all files, show the final summary in a message box.

### 8.2 Routing Rules

If status is `created`:

- move file to `processed/`

If status is `duplicate`:

- move file to `duplicate/`

If status is `needs_editor_review`:

- move file to `review-needed/`

If status is `failed`:

- move file to `failed/`

## 9. Suggested Variables

Run-level variables:

- `RunId`
- `RunStartTime`
- `RunEndTime`
- `TotalDetected`
- `CreatedCount`
- `DuplicateCount`
- `NeedsReviewCount`
- `FailedCount`

Item-level variables:

- `CurrentFilePath`
- `CurrentFileName`
- `CurrentExtension`
- `ApiResponseStatus`
- `ProcessingId`
- `ArticleId`
- `SourceDocumentId`
- `DuplicateOfSourceId`
- `BackendMessage`

## 10. Final Result Display

The current workflow ends by showing a message box.

The message box can summarize:

- total detected files
- created count
- duplicate count
- needs review count
- failed count

This is the final implemented output of the current UiPath flow.

## 11. Local Run Checklist

Before running the UiPath workflow locally, make sure:

1. FastAPI is running.
2. `POST /api/rpa/ingest` is reachable.
3. the configured source folder exists
4. the routing folders exist
5. test files are available in `input/`
6. the UiPath config points to the correct backend URL

## 12. Final Implementation Boundary

Use this as the current implementation rule:

- UiPath scans, sends, handles results, routes files, and shows a final message box.
- FastAPI processes the file and returns the result.
- The documented scope ends at `Route_File.xaml`.

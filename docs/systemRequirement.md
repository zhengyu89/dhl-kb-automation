# AI-Powered Knowledge Base Automation for DHL Logistics Operations

DHL Logistics Operations teams handle thousands of messages and documents every day. These come from many sources, including:

- Chat messages from MS Teams or Telegram
- Long email threads between teams
- Screenshots used to explain steps or errors
- Handwritten notes or quick instructions shared informally
- Snippets of PowerPoint slides or training materials

All this information is important — but it is unstructured, scattered, and difficult to reuse. As a result, creating clean and standardized SOPs (Standard Operating Procedures) or Knowledge Base (KB) articles becomes extremely slow and inconsistent.

## Objective

Design and build a system that automates the entire transformation process from raw messy input to clean knowledge articles.

## 4. System Requirements

### 4.1 Web Frontend - Web Application (Mandatory)

- Developed using any web technology (example: HTML, CSS, JavaScript, Vue, React, .NET)
- Interactive user interface with event handling
- Use JavaScript functions to manage system logic
- Provide form input and validation
- User-friendly navigation and interface design

### 4.2 Backend - JSON API OR Database (Mandatory)

#### Option 1: JSON API

- Use JSON format for data storage
- Implement CRUD operations (GET, POST, PUT/PATCH, DELETE)
- All data must be retrieved via API (no hardcoded data)

#### Option 2: Database Storage

- All data handled via database storage (example: SQL, MongoDB)

### 4.3 RPA Component (Mandatory)

- Use UiPath Studio to create an RPA workflow
- Design an RPA workflow diagram
- Explain automation logic clearly

## 5. Functional Requirements

### 5.1 Web Application (Mandatory)

- Secured access to the website, allowing RPA to create content
- Upload Console: accepts multiple input types (minimum: text, PDF, and .docx)
- Draft and save information with status
- Viewer Page: searchable and filterable by tag, date, creator, status
- Versioning: show Draft → Reviewed → Published status with history
- Store creator details: at least basic login for editors/reviewers

### 5.2 RPA Automation (Mandatory)

- Ingestion: read new files from Google Drive or a designated email inbox exported to Drive
- Duplicate checks: skip items seen in the last 14 days using a hash of text or file
- Create new content in the web application and attach files/screens
- Update the status in the web application
- Error handling: try/catch, take screenshots on failures, and write logs
- Send summary email to system admin when executed with totals for created, updated, duplicates, and failed items; attach logs

### 5.3 Non-Functional Expectations (Optional)

- Integrate GPT (LLM) to summarize, structure, title, tag, and quality-polish articles; flag conflicts/outdated content; propose step-by-step procedures
- Draft Builder in web application: display AI-proposed Title, Summary, Steps, Tags, Related Links; allow editors to revise and save
- Conflict/outdated information alerts in the web application: flag if the new draft conflicts with existing published articles
- Read and transform information from images (PNG/JPG) via GPT as source data for knowledge base updates in the web application

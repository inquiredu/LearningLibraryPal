# Mngaia Content Engine — Architecture

## System Overview

Single Google Apps Script project, container-bound to a Google Spreadsheet (the Master Sheet). Deployed as a GAS Web App (`doGet`).

```
Browser
  │
  ├── /exec               → Index.html (facilitator dashboard)
  ├── /exec?page=wizard   → Wizard.html (new session intake)
  ├── /exec?page=library&session=ID → LibraryPage.html (shareable library)
  └── /exec?page=diag     → raw JSON diagnostic dump
         │
         │  google.script.run (RPC)
         ▼
    WebApp.js (handlers: getDashboardData, processWizardSubmit,
               getDriveFilesInFolder, webAddResources, webRunSynthesis,
               webGenerateGems, webGetEmailDraft, webSendEmail)
         │
         ├── SessionService.js   (Master Sheet CRUD, Drive scaffolding)
         ├── GeminiService.js    (Gemini 1.5 Flash REST calls)
         ├── SynthesisService.js (fetch resource content + Gemini analysis)
         ├── GemsService.js      (4 AI persona prompt structures)
         ├── ResourceService.js  (add resources, create Drive shortcuts)
         ├── EmailService.js     (Gmail send)
         └── LibraryService.js   (assemble library payload)
```

## Content Lifecycle (5 Phases)

```
[Wizard] ──► SessionService.setupSession()
               • Creates Drive folder (00_Admin / 01_Research / 02_Drafts / 03_Gems / 04_Final)
               • Creates per-session Project DB (Spreadsheet with Resources + Participants tabs)
               • Appends row to Master Sheet (Sessions tab)
               • Calls GeminiService.generateSessionBrief() → BriefJSON stored in col 12

[Synthesis] ► SynthesisService.synthesizeAll(sessionId)
               • Reads resources from Project DB
               • URL-fetches each resource (or uses Gemini for Drive docs)
               • GeminiService.analyzeResource() → writes Summary, KeyThemes, SoWhat, EngagementLevel back to DB

[Gems] ──────► GemsService.generateGems(sessionId)
               • GeminiService.generateGemsPrompts() → 4 persona prompt structures
               • Stored as GemsJSON in Master Sheet col 13

[Library] ───► LibraryService.buildLibraryData(sessionId)
               • Aggregates session + all resources + Gems into one payload
               • doGet injects into LibraryPage.html via __SESSION_ID__ placeholder

[Email] ─────► EmailService.draftAndSend(sessionId, recipients)
               • GeminiService.draftPreSessionEmail() → subject + HTML body
               • Shown in modal for review before sending
               • GmailApp.sendEmail() on approval
```

## Key Design Decisions

**Container-bound script** — `SpreadsheetApp.getActiveSpreadsheet()` always returns the Master Sheet, both in the Sheets menu context and in the web app context. No spreadsheet ID needed in code.

**Drive Picker removed** — GAS web app pages are sandboxed to `*.googleusercontent.com`; the Picker API validates origin against `docs.google.com`/`script.google.com` and rejects the web app origin. Replaced with:
1. **Folder browser** — user pastes a Drive folder URL → `getDriveFilesInFolder()` (server-side `DriveApp`) returns file list → checkbox selection
2. **URL paste** — user pastes individual Drive share links; `fileId` extracted client-side via regex; shortcut created in `01_Research` server-side

**Web app vs. dialog mode detection** — `google.script.host.origin === 'https://docs.google.com'` is true only in Sheets modal dialogs; false in web app pages. Used in Wizard.html to route `Cancel` back to dashboard vs. `google.script.host.close()`.

**Deployment versioning** — `clasp push` only updates HEAD. Production deployments require a "New version" update in GAS Editor → Deploy → Manage deployments.

## Master Sheet Column Index (0-based)

| # | Column |
|---|--------|
| 0 | Session ID |
| 1 | Name |
| 2 | Theme |
| 3 | Date |
| 4 | Format |
| 5 | Audience |
| 6 | Brand |
| 7 | Status |
| 8 | Folder URL |
| 9 | Library URL |
| 10 | Project DB URL |
| 11 | Email Sent |
| 12 | Brief JSON |
| 13 | Gems JSON |
| 14 | Created At |

## Script Properties

| Key | Description |
|-----|-------------|
| `GEMINI_API_KEY` | Google AI Studio API key |
| `ROOT_FOLDER_ID` | Parent Drive folder for all sessions (auto-created if missing) |

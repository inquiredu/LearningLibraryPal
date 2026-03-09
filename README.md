# Mngaia Dynamic Content Engine

A Google Apps Script web application that manages the full content lifecycle for Mngaia's monthly collaborative learning sessions — from intake through synthesis, AI-powered Gems, a shareable learning library, and pre-session email.

## What It Does

A facilitator runs through a 5-phase cycle for each session:

| Phase | Trigger | Output |
|-------|---------|--------|
| **1. Wizard** | New Session form | Drive folders, Master Sheet row, Gemini session brief |
| **2. Synthesis** | Synthesize button | Gemini analysis of each resource → written to Project DB |
| **3. Gems** | Generate Gems button | 4 AI persona prompt structures (deep-researcher, synthesis-companion, facilitation-guide, reflection-catalyst) |
| **4. Library** | Auto (on doGet) | Shareable learning library page per session |
| **5. Email** | Draft Email button | Gemini-drafted pre-session email → Gmail send |

## Tech Stack

- **Runtime:** Google Apps Script (V8), no npm / TypeScript
- **AI:** Gemini 1.5 Flash via Google AI Studio REST API
- **Storage:** Google Drive (folders, shortcuts) + Google Sheets (Master Sheet + per-session Project DB)
- **Frontend:** `HtmlService` web app (`doGet`) — dashboard, wizard, and library pages
- **Deploy:** `clasp` for local development, GAS web app deployment

## Setup

1. Clone repo and `cd LearningLibrary`
2. `clasp login` then `clasp push`
3. In the GAS editor → Project Settings → Script Properties, add:
   - `GEMINI_API_KEY` — from [Google AI Studio](https://aistudio.google.com/)
   - `ROOT_FOLDER_ID` — (optional) a Drive folder ID; auto-created in My Drive if missing
4. Deploy as Web App: **Execute as** `User accessing the web app` · **Who has access** `Anyone`
5. Authorize scopes by running any function in the editor the first time

## Key Files

| File | Role |
|------|------|
| `Code.js` | Menu items, triggers, `getGeminiApiKey()` |
| `WebApp.js` | `doGet()` routing (dashboard / wizard / library / diag), all `google.script.run` handlers |
| `SessionService.js` | Session CRUD, Drive folder scaffolding, Master Sheet ops |
| `GeminiService.js` | All Gemini calls — brief, resource analysis, Gems prompts, email draft |
| `SynthesisService.js` | Fetch resource content → Gemini → write back to Project DB |
| `GemsService.js` | Generate 4 AI persona Gems per session |
| `ResourceService.js` | Add resources to Project DB, create Drive shortcuts in `01_Research` |
| `EmailService.js` | Gmail send with HTML wrapper |
| `LibraryService.js` | Aggregate all session data into library payload |
| `SessionService.js` | Master Sheet ops, Drive scaffolding |
| `Index.html` | Facilitator dashboard — session cards, Resources modal, Email modal |
| `Wizard.html` | New Session intake — Step 1 (details) → Step 2 (source materials) |
| `LibraryPage.html` | Per-session shareable learning library |

## Data Model

**Master Sheet** (`Sessions` tab, 15 cols):
`ID · Name · Theme · Date · Format · Audience · Brand · Status · FolderURL · LibraryURL · ProjectDB URL · EmailSent · BriefJSON · GemsJSON · CreatedAt`

**Per-session Project DB** (separate Spreadsheet):
- `Resources` tab (10 cols): URL, Name, Type, FileID, Summary, KeyThemes, SoWhat, EngagementLevel, RelevanceScore, AddedAt
- `Participants` tab

**Drive folder structure** per session:
```
[Session Name]/
  00_Admin/
  01_Research/   ← Drive shortcuts created here
  02_Drafts/
  03_Gems/
  04_Final/
```

## Brand

Navy `#0B2B46` · Cyan `#5DCDF5` · Montserrat (headings) · Open Sans (body)

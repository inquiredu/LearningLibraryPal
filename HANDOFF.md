# Mngaia Content Engine — Handoff (March 9, 2026)

## Current Status: All features implemented and pushed — deployment version update required

All code is committed to `main` and pushed to GitHub. Five feature groups were added in this session.
One manual action is required before the live web app reflects these changes.

---

## ⚠️ Required Before Testing

**Update the GAS deployment version:**
1. Open the bound Google Spreadsheet
2. Extensions → Apps Script
3. Deploy → Manage deployments
4. Edit (pencil) the existing deployment
5. Version → **"New version"**
6. Click Deploy

> `clasp push` only updates HEAD. The live web app won't reflect code changes until a new version is published.

**Also: fix the corrupt session row in the Master Sheet**
One existing session has an error message in the THEME column (col C). Manually edit that cell to contain the real theme text, then click "✨ Generate Brief" on that session card to regenerate the AI brief. Without a real theme, Gemini cannot produce useful content.

---

## What Was Built This Session

### 1. Email Template Fix
- `EmailService.sendApprovedDraft()` was sending raw Gemini HTML without the MNGAIA branded wrapper
- Fixed: `_wrapInEmailTemplate()` now applied before sending in both the web app and menu flows

### 2. Sites Code Generator (`SitesService.js` — new file)
- Generates 5 embed-ready HTML sections for Google Sites: Hero Banner, Session Overview, Inquiry Questions, Resources, AI Gems
- Iframes for Drive Slides, Drive files, YouTube; styled link cards for web resources
- Saves a formatted Google Doc to `04_Final` with copy-paste instructions per section
- Dashboard: `🌐 Site Code` button; menu: `Generate Site Code` item

### 3. Brief Regeneration
- Added `✨ Generate Brief` button to session cards (shown when `Brief ○`)
- `webRegenerateBrief(sessionId)` calls Gemini with session theme/format/audience, writes result to `BRIEF_JSON` column, invalidates library cache
- Handles sessions created before brief generation was working or sessions with corrupted data

### 4. Collaborator Management (`CollaboratorService.js` — new file)
- `addEditors(sessionId, emails)` — shares session Drive folder (recursive: covers all subfolders + Project DB)
- `getEditors(sessionId)` — reads live sharing state from Drive (Drive is source of truth, no extra column)
- `removeEditor(sessionId, email)` — removes access
- Dashboard: `👥 Collaborators` modal with live list, add/remove UI
- Wizard Step 1: optional Collaborators field; access added in background after session creation

### 5. Permission Checker (`PermissionService.js` — new file)
- Checks Drive sharing access for every resource before publishing to Sites
- Access states: `public` (ANYONE/ANYONE_WITH_LINK), `restricted` (PRIVATE/DOMAIN), `external` (non-Drive), `youtube`
- `fixPermissions(fileIds)` — sets ANYONE_WITH_LINK + VIEW on all blocked files
- Dashboard: `🔍 Check Access` button opens results table; `Fix All Restricted` button + re-check

### 6. Type-Aware Resource Synthesis
- `GeminiService.analyzeResourceByType()` — same output schema as before, but type-specific prompt instructions tell Gemini what to extract from each resource type

  | Type | Gemini behavior |
  |------|----------------|
  | Planning Doc | Extract facilitator intent, goals, constraints; `relevanceScore=5`; enrich session brief if none exists |
  | Facilitator Guide | Extract discussion prompts verbatim, activities, timing |
  | Video | `notebookLMReady=false`; surfaces Drive file size (MB); recommends watch timing |
  | Audio / Podcast | `notebookLMReady=false`; fetch show notes; note independent listening |
  | Meeting Link | **Skip Gemini entirely** — write placeholder instantly, no API cost |
  | Slide Deck | Assess standalone-readability; `notebookLMReady` by content richness |
  | Web Resource / Reading | Participant-facing relevance analysis |

- **Planning Doc → Auto-Brief Enrichment**: `GeminiService.enrichBriefFromPlanningDoc()` generates a brief grounded in the facilitator's actual planning document (not just the theme field). Session context refreshes mid-loop so subsequent resources use the enriched brief.
- **Bug fix**: synthesis no longer overwrites the user-set resource type with a URL-inferred type

---

## All Files and Their Current Roles

| File | Role |
|------|------|
| `Code.js` | GAS entry points, menu, `onOpen`, helpers |
| `WebApp.js` | `doGet()` router + all `google.script.run` server handlers |
| `SessionService.js` | Session CRUD, Drive folder scaffolding, Master Sheet r/w |
| `GeminiService.js` | All Gemini API calls — brief, resource analysis (generic + type-aware), planning doc enrichment, gems, email |
| `SynthesisService.js` | Type-aware resource processing; dispatches to GeminiService by type |
| `ResourceService.js` | Adds resources to Project DB + creates Drive shortcuts in `01_Research` |
| `GemsService.js` | Generates + stores Gem instruction sets; manages Gem links |
| `EmailService.js` | Drafts and sends pre-session emails with MNGAIA branded template |
| `LibraryService.js` | Builds public Library page data from session brief + synthesized resources + gems |
| `SitesService.js` | Generates 5 HTML sections for Google Sites embedding; saves to `04_Final` |
| `CollaboratorService.js` | Manages Drive Editor access for co-facilitators |
| `PermissionService.js` | Checks and fixes Drive file sharing access for public embedding |
| `Index.html` | Dashboard UI — session cards, all modals |
| `Wizard.html` | New session wizard (2-step: details + resources) |
| `LibraryPage.html` | Public-facing Learning Library per session |

---

## Drive Folder Structure (per session)

```
[Session Name] [S-timestamp]/
  ├── 00_Admin/
  │     └── [Session Name] — Project Database  (Spreadsheet)
  ├── 01_Research/        (Drive shortcuts to added resources)
  ├── 02_Drafts/
  ├── 03_Gems/            (Gem instruction docs written by GemsService)
  └── 04_Final/           (Site Code doc written by SitesService)
```

---

## Web App Route Map

```
/exec (no params)              → Dashboard (Index.html)
/exec?page=wizard              → New Session Wizard (Wizard.html)
/exec?page=library&session=ID  → Public Learning Library (LibraryPage.html)
/exec?page=diag                → Debug JSON — confirms spreadsheet binding + row count
```

## Server API (WebApp.js)

```
getDashboardData()                   → session cards array
processWizardSubmit(params)          → { sessionId, folderUrl, dbUrl, brief }
webAddResources(id, resources[])     → { added, shortcuts, errors }
webRunSynthesis(id)                  → { count }
webGenerateGems(id)                  → { count }
webUpdateGemLinks(id, gemLinks)      → { ok }
webGetEmailDraft(id)                 → { subject, body, previewText }
webSendEmail(id, recipients, subj, body) → { recipientCount }
webGenerateSiteCode(id)              → { docUrl }
webRegenerateBrief(id)               → { ok }
webGetCollaborators(id)              → [{ email, name }]
webAddCollaborators(id, emails[])    → { added, errors }
webRemoveCollaborator(id, email)     → { ok }
webCheckPermissions(id)              → [{ name, url, embedType, access, fileId?, ok }]
webFixPermissions(fileIds[])         → { fixed, errors }
getDriveFilesInFolder(folderUrl)     → { folderName, files[] } | { error }
getLibraryData(id)                   → full library data object
getOAuthToken()                      → string (for Drive Picker if re-added)
```

---

## Known Issues / Watchouts

- **Library URL not auto-populated**: After creating a session, the `Library URL` column in the Sessions sheet stays blank until manually set. The "Open Library →" button won't appear on the card until this column has the web app URL with `?page=library&session=ID`. A future feature should auto-write this on session creation.

- **Synthesis skips already-scored rows**: If you re-run synthesis, rows where `Relevance Score` is already filled are skipped. To re-synthesize a resource (e.g., after a Planning Doc enriches the brief), manually clear the Relevance Score cell in the Project DB for that row and run synthesis again.

- **Drive video synthesis**: `_readDriveContent()` returns `null` for video file MIME types — Drive videos can't have their frames read server-side. The synthesis falls back to URL fetch (often unhelpful for Drive). The Gemini prompt accounts for this but analysis quality will be lower for Drive-hosted video. YouTube videos get better results via URL fetch (page title + description available).

- **Private Drive resources**: Synthesis uses `UrlFetchApp` as fallback. Private files (not shared) return 403. Run `🔍 Check Access` before synthesis — if a file needs synthesis AND public access, fix permissions first.

- **`executeAs: USER_DEPLOYING`**: All Drive operations run as the script owner. Resources or folders in other accounts' Drive won't be accessible unless shared with the deploying account.

- **GAS execution time limit**: Synthesis on large resource sets (10+ resources each needing URL fetch) can approach the 6-minute GAS execution limit. If it times out, re-run — already-synthesized rows are skipped.

---

## Suggested Next Steps

### High priority
- **Auto-populate Library URL** on session creation: in `SessionService.setupSession()`, call `ScriptApp.getService().getUrl()` and write `?page=library&session={id}` to `LIBRARY_URL` column immediately so the Library button appears on first dashboard load.

- **Re-synthesis mode**: Add a "♻️ Re-Synthesize" option (or a checkbox in the modal) that clears relevance scores for selected resources and re-runs — useful after a Planning Doc enriches the brief and you want all resources re-scored with the new context.

- **Participants sheet UI**: `ProjectDatabase` has a `Participants` sheet (Name, Email, Registered At) but nothing writes to it. Add a Participants modal on the dashboard to bulk-import attendee emails; use it to power personalized pre-session emails and library access control.

### Medium priority
- **Library page access control**: Currently the Library page is public (`ANYONE` access). Add a simple passphrase or Drive-based auth check for sessions intended for registered participants only.

- **YouTube transcript integration**: YouTube's `watch?v=` page HTML often contains auto-caption text in the page source. `_fetchContent()` could be enhanced to extract the `ytInitialPlayerResponse` JSON and pull transcript segments for richer Gemini analysis.

- **Synthesis status in the dashboard**: After synthesis runs, the card currently just shows "Synthesis complete! N resources analyzed." A `Synthesis ✓` indicator (like Brief/Gems/Email) would make session state clearer at a glance.

- **Gem link deep-link**: When a Gem's `link` field is set, the Library page shows "Open Gem →". That Gem link currently must be set manually. An automation or clipboard helper to build the correct Gemini Gem URL format would speed this up.

### Lower priority / future
- **Google Sites API integration**: Sites Code currently generates an HTML doc for copy-pasting. The [Google Sites API](https://developers.google.com/sites/api/reference) could allow direct injection of embed sections — no copy-paste required.

- **Session archiving**: Add a status field toggle (Active → Archived) that hides old sessions from the main dashboard view while keeping Library pages live.

- **Dashboard search/filter**: Once there are 10+ sessions, filtering by date, status, or theme becomes useful.

- **Audio transcript via third-party**: For podcast/audio resources, a Whisper API or AssemblyAI integration could produce a transcript for synthesis — would require an additional API key in Script Properties.

---

## Repo / Deployment

- **GitHub:** `https://github.com/inquiredu/LearningLibrary` — `main` branch, up to date
- **GAS Project:** container-bound to Master Sheet (see `.clasp.json` for `scriptId` + `parentId`)
- **Deploy:** GAS Editor → Deploy → Manage deployments → New version
- **Diagnostic URL:** `[exec-url]?page=diag` — confirms spreadsheet binding and session row count

---

*Handoff updated: 2026-03-09*

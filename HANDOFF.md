# Learning Library Content Engine — Handoff (March 11, 2026)

## Current Status: All features implemented and pushed — deployment version update required

All code is committed to `main` and pushed to GitHub. Multiple feature groups and bug fixes added across three sessions.
One manual action is required before the live web app reflects the latest changes.

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
> Also set "Who has access" to **"Anyone"** (not "Anyone with Google account") so the public Library page works without sign-in.

---

## What Was Built (March 11, 2026 session)

### 15. Context Resource Type
- New type "Context" for background docs the facilitator wants Gemini to read during synthesis
- Strictly faithful extraction (`_typeInstructions` in GeminiService) — no inference or embellishment
- Defaults `isPublic=No` — never appears in Library page or emails
- Set relevanceScore=5, notebookLMReady=false automatically

### 16. Internal Resource Email Fix (bug)
- Internal resources (Planning Doc, Facilitator Guide, Agenda, Context) were leaking into pre-reading lists for draft/send email flows
- `EmailService.draftAndSend`, `getDraft`, and `getNewsletterDraft` now all filter `r.isPublic !== false` before building resource lists

### 17. Resource Type Selector in Drive File Picker
- Both Drive Navigator and Folder URL file lists now show an inline type `<select>` per file (defaults to MIME-inferred type)
- `submitResources()` reads from the select — facilitator's choice always wins

### 18. Drive 📁 Picker in Link Rows
- Each "Add Resource" link row now has a 📁 button that opens an inline Drive navigator overlay
- Clicking any file populates the URL + Name inputs and auto-sets the type select from MIME mapping
- Fixed-position overlay with breadcrumb navigation; dismisses on file select or ×

### 19. Delete Button Fix (bug)
- `JSON.stringify(r.url)` inside a double-quoted HTML onclick attribute broke the attribute entirely — delete button was silently broken
- Fixed by using `data-del-url` attribute and `this.dataset.delUrl` in the onclick

### 20. Duplicate Resource Prevention (bug)
- Same file checked in both Drive navigator and folder URL panels was submitted twice
- `submitResources()` now deduplicates by URL/fileId before sending to server

### 21. Agenda Document Type + Inquiry Question Enrichment
- New "Agenda" type with `GeminiService.enrichBriefFromAgenda()` → extracts `agendaItems[]` + `sessionDuration` into session brief
- Library page shows collapsible "📅 Session Agenda" section (hidden until items exist)
- Post-synthesis: `GeminiService.enrichInquiryQuestions()` rewrites inquiry questions grounded in actual resource content

### 22. Resource Visibility + Manage Resources Modal
- Resources tab extended to 15 cols: N=isPublic, O=sortOrder
- Planning Doc / Facilitator Guide / Agenda / Context default `isPublic=No`
- New "🗂️ Manage Resources" modal: toggle visibility, drag-reorder, stage/batch delete
- Library page applies isPublic filter server-side; sortOrder sort before relevanceScore fallback

### 23. ALLOWED_EMAILS Auth Bypass
- `Config.js` now has `ALLOWED_EMAILS: []` array
- Any email in this list bypasses the domain restriction — useful for testing with a personal Gmail
- Add: `ALLOWED_EMAILS: ['you@gmail.com']` in Config.js, then clasp push + new deployment version

---

## What Was Built (prior sessions, cumulative)

### 1. Email Template Fix
- `EmailService.sendApprovedDraft()` now wraps Gemini HTML in the Learning Library branded email template before sending

### 2. Sites Code Generator (`SitesService.js`)
- Generates 5 embed-ready HTML sections for Google Sites: Hero Banner, Session Overview, Inquiry Questions, Resources, AI Gems
- Iframes for Drive Slides/Docs/files, YouTube; styled link cards for external resources
- Saves a formatted Google Doc to `04_Final` with per-section copy-paste instructions
- Dashboard: `🌐 Site Code` button; menu: `Generate Site Code`

### 3. Brief Regeneration
- `✨ Generate Brief` button on session cards (shown when brief is missing/corrupted)
- `webRegenerateBrief(sessionId)` calls Gemini and writes result to `BRIEF_JSON` column

### 4. Collaborator Management (`CollaboratorService.js`)
- `addEditors` / `getEditors` / `removeEditor` — Drive is source of truth, no extra column needed
- Dashboard: `👥 Collaborators` modal; Wizard Step 1: optional Collaborators field

### 5. Permission Checker (`PermissionService.js`)
- Checks Drive sharing for all session resources; states: `public`, `restricted`, `external`, `youtube`, `error`
- `fixPermissions(fileIds)` — sets ANYONE_WITH_LINK + VIEW on blocked files
- Dashboard: `🔍 Check Access` button + `Fix All Restricted` action

### 6. Type-Aware Resource Synthesis
- `GeminiService.analyzeResourceByType()` — type-specific Gemini prompts per resource type (Planning Doc, Facilitator Guide, Video, Audio, Meeting Link, Slide Deck, Web Resource)
- Meeting Links: skip Gemini entirely — written instantly, no API cost
- Planning Doc → Auto-Brief Enrichment: `GeminiService.enrichBriefFromPlanningDoc()` grounds the brief in the actual facilitator planning doc

### 7. Public Library + Domain-Restricted Dashboard (`Config.js` — new file)
- `Config.js` holds all deployment settings: `ALLOWED_DOMAIN`, `PUBLIC_PAGES`, `DISPLAY_TIMEZONE`, `TIMEZONE_LABEL`, `APP_NAME`
- Dashboard and Wizard require `@example.com` Google account; Library page is fully public (no sign-in)
- Unauthorized users see a branded "Access Restricted" page with a "Switch Account" link
- **Adopters:** change `ALLOWED_DOMAIN` in `Config.js` to match their own Google Workspace domain

### 8. Timezone Fix
- `appsscript.json` timezone changed to `America/Chicago`
- All time displays use `Intl.DateTimeFormat` with the `DISPLAY_TIMEZONE` IANA name — consistent Central time regardless of viewer's browser timezone
- Sheets Date object bug fixed: `instanceof Date ? .toISOString() : String(value)` in SynthesisService

### 9. New Session Button Fix
- `openNewSessionWizard()` in `Index.html` now uses `_appBaseUrl` (fetched from server) instead of `window.location.href`, which returned the internal GAS sandbox URL

### 10. Meeting Links — Live Sessions (separate section)
- Meeting-type resources (type = "Meeting Link", or URL matches Google Meet / Zoom / Teams) are separated from content resources
- One meeting can be marked **Main Room** (shown first, with star badge)
- Start/end times stored per meeting — availability gating: **LIVE** / **STARTING SOON** / **UPCOMING** / **ENDED**
- Resources schema extended to 13 columns (cols K–M: isMain, startTime, endTime)
- Dashboard `Add Resources` modal: 2×2 grid for URL, name, start/end times, Main Room checkbox
- Calendar event import: star toggle per event to designate Main Room; start/end auto-populated from calendar

### 11. Library Page — Live Sessions Section + Hero Join Button
- New "Live Sessions" section with status-aware cards (pulse dot for LIVE, muted for ENDED)
- Hero join button: prominent "Join Main Room" CTA in the library hero — status-aware styling
- Dismissible first-time visitor onboarding banner (dismissed state persisted in localStorage)
- Sidebar nav includes "Live Sessions" item (hidden until meetings exist)

### 12. Dashboard Redesign — Event Database Style
- Each session card now shows: prominent date block, pipeline progress bar (Brief → Resources → Synthesis → Gems → Email), clean info layout
- Pipeline steps shown as colored pills with ✓/○ state indicators

### 13. Newsletter — Meeting Link + Edit Before Send
- Newsletter wizard includes editable "Main Room URL" field pre-seeded from the session's main meeting
- Preview updates live; "Join Session →" green button appears in preview when URL is set
- Email renders meeting + library buttons side by side

### 14. Meet Link URL Fix
- URLs stored without `https://` prefix were resolved as relative paths against the GAS sandbox URL
- Added `_safeUrl(url)` helper in `LibraryPage.html` and `Index.html`
- Applied to: hero join button, Live Sessions card buttons, resource-section meeting cards, newsletter CTA button

---

## All Files and Their Current Roles

| File | Role |
|------|------|
| `Code.js` | GAS entry points, menu, `onOpen`, helpers |
| `Config.js` | Central deployment config — domain, timezone, app name |
| `WebApp.js` | `doGet()` router + auth gate + all `google.script.run` handlers |
| `SessionService.js` | Session CRUD, Drive folder scaffolding, Master Sheet r/w |
| `GeminiService.js` | All Gemini API calls — brief, resource analysis (generic + type-aware), planning doc enrichment, gems, email |
| `SynthesisService.js` | Type-aware resource processing; dispatches to GeminiService by type; reads 13-col schema |
| `ResourceService.js` | Adds resources to Project DB (13-col) + creates Drive shortcuts in `01_Research` |
| `GemsService.js` | Generates + stores Gem instruction sets; manages Gem links |
| `EmailService.js` | Drafts and sends pre-session emails; extracts main meeting URL for newsletter |
| `LibraryService.js` | Builds public Library page data — separates meetings from resources, computes isMain |
| `SitesService.js` | Generates 5 HTML sections for Google Sites; saves to `04_Final` |
| `CollaboratorService.js` | Manages Drive Editor access for co-facilitators |
| `PermissionService.js` | Checks and fixes Drive file sharing access for public embedding |
| `Index.html` | Dashboard UI — session cards (event DB style), all modals, newsletter wizard |
| `Wizard.html` | New session wizard (2-step: details + resources, with meeting fields) |
| `LibraryPage.html` | Public-facing Learning Library — Live Sessions, hero join button, onboarding banner, drag reorder |

---

## Resources Sheet Schema (Project DB per session)

Columns A–M:

| Col | Field | Notes |
|-----|-------|-------|
| A | URL | Resource URL |
| B | Title | Display name |
| C | Type | e.g. "Web Resource", "Meeting Link", "Slide Deck" |
| D | Relevance Score | 1–5 (blank = not yet synthesized) |
| E | Relevance Statement | Short participant-facing description |
| F | Engagement Level | "Low" / "Medium" / "High" |
| G | Pre-Reading | "Yes" or blank |
| H | NotebookLM Ready | "Yes" or blank |
| I | Gem Prompt | AI gem research prompt |
| J | Summary | Full synthesis summary |
| K | isMain | "Yes" or blank (meeting main room flag) |
| L | startTime | ISO 8601 datetime string |
| M | endTime | ISO 8601 datetime string |

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
/exec (no params)              → Dashboard (Index.html)       — requires @example.com account
/exec?page=wizard              → New Session Wizard           — requires @example.com account
/exec?page=library&session=ID  → Public Learning Library      — no sign-in required
/exec?page=diag                → Debug JSON (binding + row count)
```

## Server API (WebApp.js)

```
getDashboardData()                    → session cards array
processWizardSubmit(params)           → { sessionId, folderUrl, dbUrl, brief }
webAddResources(id, resources[])      → { added, shortcuts, errors }
webRunSynthesis(id)                   → { count }
webGenerateGems(id)                   → { count }
webUpdateGemLinks(id, gemLinks)       → { ok }
webGetEmailDraft(id)                  → { subject, body, previewText, mainMeetingUrl, mainMeetingName }
webSendEmail(id, recipients, subj, body) → { recipientCount }
webGenerateSiteCode(id)               → { docUrl }
webRegenerateBrief(id)                → { ok }
webGetCollaborators(id)               → [{ email, name }]
webAddCollaborators(id, emails[])     → { added, errors }
webRemoveCollaborator(id, email)      → { ok }
webCheckPermissions(id)               → [{ name, url, embedType, access, fileId?, ok }]
webFixPermissions(fileIds[])          → { fixed, errors }
webGetAppConfig()                     → { timezone, timezoneLabel }
webGetAppBaseUrl()                    → string (exec base URL, for client navigation)
getDriveFilesInFolder(folderUrl)      → { folderName, files[] } | { error }
getLibraryData(id)                    → full library data object (meetings + resources + brief + gems)
getCalendarList()                     → [{ id, name, color }]
getCalendarEvents(calendarId, days)   → { events[], total }
```

---

## Known Issues / Watchouts

- **Library URL not auto-populated**: After session creation, `LIBRARY_URL` column stays blank until manually set. The "Open Library →" button on the card won't appear until this column has the exec URL with `?page=library&session=ID`. Future: auto-write on session creation via `ScriptApp.getService().getUrl()`.

- **Synthesis skips already-scored rows**: Re-running synthesis skips rows where `Relevance Score` is filled. To force re-synthesis (e.g., after Planning Doc enriches the brief), manually clear the Relevance Score cell in the Project DB for that row.

- **Drive video synthesis**: `_readDriveContent()` returns `null` for Drive-hosted video MIME types — frames can't be read server-side. Falls back to URL fetch (lower quality). YouTube videos get better results via URL fetch.

- **GAS execution time limit**: Synthesis on large resource sets (10+ resources needing URL fetch) can approach the 6-minute GAS limit. If it times out, re-run — already-synthesized rows are skipped.

- **Meet link time-gating**: If a meeting has no startTime/endTime set, the join button is always active ("live"). Set times in the Add Resources modal for proper availability gating.

- **`executeAs: USER_DEPLOYING`**: All Drive/Calendar operations run as the script owner. Resources or calendars owned by other accounts won't be accessible unless shared with the deploying account.

---

## Planned Next Feature: Drive Navigator + Calendar Selector

A plan file exists at `/home/codespace/.claude/plans/virtual-snacking-castle.md` with a full implementation spec. Summary:

- **Drive Navigator**: Replace "paste folder URL" with a server-side folder browser (breadcrumb + folders + checkable files) using `getDriveNavigate(folderId)` via `google.script.run`. Picker API is not used — it fails on `*.googleusercontent.com`.
- **Calendar Selector**: Replace hardcoded "Load Events" with a calendar dropdown populated from `getCalendarList()`, plus a "days ahead" number input, then "Load Events".
- Files to change: `WebApp.js` (3 new functions), `Index.html` (modal revamp), `Wizard.html` (same), `appsscript.json` (calendar.readonly scope — already present).

---

## Suggested Next Steps

### High priority
- **Auto-populate Library URL** on session creation in `SessionService.setupSession()` using `ScriptApp.getService().getUrl()` + `?page=library&session={id}`.
- **Drive Navigator + Calendar Selector** (see plan file above) — removes the need to paste Drive folder URLs.

### Medium priority
- **Re-synthesis mode**: "♻️ Re-Synthesize" option that clears relevance scores for selected resources and re-runs — useful after a Planning Doc enriches the brief.
- **Participants sheet UI**: `ProjectDatabase` has a Participants sheet but nothing writes to it. Bulk-import attendee emails; use for personalized pre-session emails.
- **Synthesis status pill**: After synthesis, show a `Synthesis ✓` indicator on the card alongside Brief/Gems/Email.

### Lower priority / future
- **Session archiving**: Active → Archived status toggle; hides old sessions from dashboard while keeping Library pages live.
- **Dashboard search/filter**: Filter by date, status, or theme once 10+ sessions exist.
- **Google Sites API**: Direct section injection instead of copy-paste HTML doc.
- **YouTube transcript**: Extract `ytInitialPlayerResponse` from page source for richer synthesis.
- **Audio transcript**: Whisper API or AssemblyAI for podcast/audio resources.

---

## Repo / Deployment

- **GitHub:** `https://github.com/inquiredu/LearningLibrary` — `main` branch
- **GAS Script ID:** `1iIHgvEr_xe2RT_zgUYduI-NhYuYrZAQCbD4hHKpJiJPISMIueFxYKOdy`
- **Bound Spreadsheet:** `1KHW7tFNmqFyf9Oi-8SfRO0eZOG_VTX9hH-T8Ub5CTbw`
- **Deploy:** GAS Editor → Deploy → Manage deployments → New version → "Anyone" access
- **Diagnostic URL:** `[exec-url]?page=diag`

---

*Handoff updated: 2026-03-10*

# Mngaia Content Engine — Handoff (March 8–9, 2026)

## Current Status: Ready to test end-to-end after one manual deployment step

All code is pushed to GAS and committed to `main`. One manual action required before testing.

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

---

## What Was Built / Changed This Session

### Problem Being Solved
- Facilitator created a session, skipped resources in the wizard, found their Drive files, and couldn't add them after the fact
- Dashboard showed no sessions (empty state)
- "+ New Session" button did nothing

### Fixes Applied

| Problem | Root Cause | Fix |
|---------|-----------|-----|
| Dashboard empty | `ensureMasterSheet()` not called on load | Added to `getDashboardData()` in WebApp.js |
| New Session button silent | Called `showWizard()` → `SpreadsheetApp.getUi()` fails in web app | Now navigates to `?page=wizard` URL |
| Wizard close broken | `google.script.host.close()` invalid in web app | `closeOrRedirect()` strips `?page=wizard` and returns to dashboard |
| Drive Picker errors | Picker API rejects `*.googleusercontent.com` origin | **Removed Picker entirely** |

### New Features Added

**Drive Folder Browser** (both Resources modal on dashboard + Wizard Step 2):
- Paste any Google Drive folder share URL
- Click "Load Files" → server reads folder via `DriveApp`, returns file list
- Checkbox-select which files to add
- Up to 100 files per folder

**URL Paste** (both modals):
- Paste any Drive share link or web URL
- Drive file IDs auto-extracted (regex on `/d/{id}/` and `?id=` patterns)
- Drive shortcuts auto-created in session's `01_Research` folder on submit

**Diagnostic route** (`?page=diag`):
- Appended to your web app URL to dump raw spreadsheet state as JSON
- Use to confirm which spreadsheet is bound and whether Sessions rows exist

---

## Files Changed This Session

| File | What Changed |
|------|-------------|
| `WebApp.js` | Added `getDriveFilesInFolder()`, `?page=diag` route, `?page=wizard` route, `ensureMasterSheet()` in `getDashboardData()` |
| `Index.html` | Fixed New Session button URL, removed Drive Picker, added folder browser + URL-paste Resources modal, fixed failure handler |
| `Wizard.html` | Removed Drive Picker from Step 2, added folder browser + URL-paste, added `closeOrRedirect()`, fixed web app detection |
| `appsscript.json` | Changed access from `ANYONE_ANONYMOUS` → `ANYONE` |
| `README.md` | Full rewrite — current architecture |
| `ARCHITECTURE.md` | Full rewrite — current architecture + design decisions |
| `gas-workspace-template.zip` | **Deleted** — stale artifact from initial setup |

---

## Test Checklist (do in order)

### 1. Confirm spreadsheet binding
- Hit `[your-exec-url]?page=diag`
- Confirm `spreadsheetId` is your Master Sheet
- Confirm `sheets` array includes `"Sessions"`
- If Sessions tab missing → the app will auto-create it on first dashboard load

### 2. Dashboard loads
- Navigate to base exec URL (no query params)
- Should see spinner → then either session cards or empty state with "🚀 No sessions yet" message
- Should NOT see a blank white page or error

### 3. Create a new session
- Click "+ New Session"
- Fill in Name + Theme (required), date, format, audience
- Submit → should show spinner "Creating workspace + generating AI brief (~20 sec)..."
- Step 2 appears with AI brief preview
- Test Drive folder browser: paste a folder URL → click "Load Files" → checkboxes appear
- Check a few files → click "Add to Session & Finish"
- Should redirect to dashboard with new session card visible

### 4. Add resources to existing session
- On any session card → "📁 Add Resources"
- Modal opens with "Browse a Drive Folder" at top + "Or Add Individual Links" below
- Test both paths
- Click "Add to Session" → success banner shows count + shortcut count

### 5. Run Synthesis
- On a session with resources → "🔬 Synthesize"
- Wait (Gemini calls per resource, ~10s each)
- Success alert with count

### 6. Generate Gems
- "💎 Generate Gems" → success → check session card shows "Gems ✓"

### 7. Draft + Send Email
- "📧 Draft Email" → AI draft loads in modal
- Enter recipient(s) → "Send Email"

---

## Known Issues / Watchouts

- **Gemini brief generation** in Wizard Step 1 takes ~20 seconds. The spinner will show "Creating workspace + generating AI brief..." — this is normal.
- **getDriveFilesInFolder** requires the folder to be accessible to the script runner (the deployer's account, since `executeAs: USER_DEPLOYING`). If the folder is in someone else's Drive, it will return an error.
- **Synthesis** fetches resource URLs via `UrlFetchApp`. Private Drive files (not shared) will 403. Resources already have a `fileId` but synthesis currently doesn't use Drive's export API for those — just URL fetch. This is a future improvement.
- **Library page** (`?page=library&session=ID`) — confirm `LibraryURL` is populated in the Master Sheet after creating a session. If blank, the "Open Library →" button won't appear on the session card.

---

## Architecture Quick Reference

```
Web App URL (/exec)
  ├── (no params)          → Dashboard (Index.html)
  ├── ?page=wizard         → New Session Wizard (Wizard.html)
  ├── ?page=library&session=ID → Learning Library (LibraryPage.html)
  └── ?page=diag           → Debug JSON dump

google.script.run handlers (all in WebApp.js):
  getDashboardData()       → session cards
  processWizardSubmit(cfg) → creates session, returns { sessionId, folderUrl, dbUrl, brief }
  getDriveFilesInFolder(url) → { folderName, files[] }
  webAddResources(id, arr) → { added, shortcuts }
  webRunSynthesis(id)      → { count }
  webGenerateGems(id)      → void
  webGetEmailDraft(id)     → { subject, body }
  webSendEmail(id, r, s, b) → { recipientCount }
```

---

## Repo

- **Local:** `/Users/sbeaverson/Documents/VIBECODE/LearningLibrary/LearningLibrary/`
- **GitHub:** `main` branch, up to date as of this handoff
- **GAS Project:** container-bound to Master Sheet (see `.clasp.json` for `scriptId` + `parentId`)
- **Deploy:** GAS Editor → Deploy → Manage deployments

---

*Handoff prepared: 2026-03-09 morning*

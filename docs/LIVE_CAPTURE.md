# Live capture (proof of concept)

Live capture lets tables at an event send what they write together, from a phone, while it happens. Facilitators see every entry word for word, ask AI for a draft grouping, finish the grouping themselves, and print gallery-walk posters. A projector page shows the room its progress.

It is a new kind of event for Learning Library, not a separate app. It lives inside a session and stores its data in that session's Project Database. What tables write is defined by a **capture template** (`CaptureTemplates.js`). **Need Cards** is the first template. Another kind of event adds a template; the pages, AI prompts and posters read from it.

Status: built and tested locally with mocks on branch `claude/need-cards-live-capture`. Nothing here has run on Google yet. See [What is checked](#what-is-checked).

## Need Cards, end to end

1. A facilitator opens the **board**, picks the session, and turns on live capture (template, title, number of tables).
2. Each table opens the **table link** (a QR code works). They pick their table number once.
3. For each card they either take a photo of the paper card or type it. A photo is read by Gemini into the card's fields; the table checks and fixes the text, then sends. Each text box also has a **Speak** button where the browser allows dictation.
4. Cards appear on the board as they arrive, with counts per table. Tables with no cards are flagged.
5. A facilitator closes entry and presses **Suggest groups**. Gemini proposes topics and which cards belong together. The board repairs any draft that drops or repeats a card. Every count, table list and route is computed from the cards, never taken from the model.
6. Facilitators rename topics, move cards (drag, or select a card and press **Move here**), reorder groups and override a route. Changes save automatically.
7. **Make posters** creates a Slides deck in the session's `04_Final` folder: one poster per gallery-walk topic with space for dots, then parking-lot pages listing every B card word for word.
8. The **wall** shows card counts by table and level while entry is open, then the ranked topics. It never shows card text.

## Pages

| Page | URL | Who |
|---|---|---|
| Board | `/exec?page=board` (then pick a session) | Authorized facilitators (`AuthService`) |
| Table entry | `/exec?page=capture&session=S-…&k=…` | Anyone with the table link |
| Wall | `/exec?page=wall&session=S-…&k=…` | Anyone with the wall link |

The `k` parameter is a random table key made when capture is turned on. Every table and wall call checks it, so the session's public library link cannot be used to send cards. The board shows both links.

## Files

| File | What it holds |
|---|---|
| `CaptureTemplates.js` | Templates: fields, levels, routes, prompt focus. Need Cards is here. |
| `CaptureLogic.js` | Pure rules: validation, text cleaning, formula escaping, group repair, counts, ordering, wall summary. |
| `CaptureStore.js` | Reads and writes the `Live Capture`, `Live Cards` and `Live Groups` tabs under the script lock. |
| `CaptureAiService.js` | Photo reading and group drafting through `GeminiService.request`, with a daily call limit. |
| `CapturePosterService.js` | Builds the poster deck with SlidesApp. |
| `CaptureApi.js` | Browser entry points and page rendering. |
| `Capture.html`, `CaptureBoard.html`, `CaptureWall.html` | The three pages. |
| `CaptureStyles.html`, `CaptureClient.html` | Shared styles and browser helpers, inserted into each page. |
| `scripts/capture-preview.cjs` | Builds the three pages as local files with a stand-in for Apps Script, for screenshots and review. Not uploaded. |
| `tests/capture.test.cjs` | 18 tests for the rules, the API boundaries, page rendering and the AI calls. |

Changes to existing files are small: a `request` method in `GeminiService.js` that takes image parts and a response schema (`_call` now uses it; its tests pass unchanged); a route block in `doGet`; `capture` and `wall` in `CONFIG.PUBLIC_PAGES`; `CONFIG.CAPTURE_AI_DAILY_LIMIT`; and the Slides scope widened from read-only to `presentations` so posters can be created.

## Privacy and safety

- Nothing asks for a name. Table number is the only identifier.
- Photos are sent to Gemini to be read and are **not stored**. Only the text the table confirms is saved.
- Card text and model text that start with `=`, `+`, `-` or `@` are stored with a leading apostrophe so Sheets keeps them as text.
- Control and invisible characters are stripped from everything a table sends and everything a model returns.
- Both prompts say that text inside a photo or a card is data, never instructions.
- `CONFIG.CAPTURE_AI_DAILY_LIMIT` (300) caps photo readings plus grouping calls per day across all sessions. 0 turns live-capture AI off; typing still works.
- A table can remove only cards it sent from that device (a token returned when each card is sent). Facilitators can hide any card; hidden cards stay in the Sheet.

## Try it

You need Node 22, the Apps Script API turned on for your Google account, and a Gemini API key from Google AI Studio. Use a new key for this pilot, restricted to the Generative Language API, with a low daily quota.

```bash
git clone https://github.com/inquiredu/LearningLibraryPal.git
```

```bash
cd LearningLibraryPal
```

```bash
git checkout claude/need-cards-live-capture
```

```bash
npm ci --ignore-scripts
```

```bash
npm run setup
```

`npm run setup` creates a new Sheet-bound project and uploads the code. It does not deploy anything. Then:

1. `npm run open`, reload the Sheet, and run **Learning Library Engine → Initial Setup**. Enter the Gemini key and a model ID your key can use. The default is `gemini-3.8-flash`; check it exists in AI Studio. Gather uses `gemini-3.6-flash`.
2. `npm run open:script`, then **Deploy → New deployment → Web app**, **Execute as: Me**, **Who has access: Anyone**. Tables are not signed in, so the table page needs "Anyone". The dashboard, wizard and board still check the signed-in Google account; only the library, table and wall pages are open, and the table and wall need the key.
3. Open the `/exec` URL, create a session in the dashboard (the wizard), then open `/exec?page=board` and turn on live capture for it.
4. Copy the table link from the board into a QR code. Open the wall link on the projector.

After any later `npm run push`, update the deployment to a **New version** so the change goes live.

To review the pages without Google:

```bash
node scripts/capture-preview.cjs /tmp/capture-preview
```

Then open `capture.html`, `board.html` or `wall.html` from that folder in a browser.

## What is checked

Checked here, with mocks:

- `npm run check` and `npm test`: 40 tests pass (the 22 existing and 18 new).
- The three pages, rendered against the stand-in with 30 made-up cards, at 375 px (phone), 1366×768 (Chromebook) and 1920×1080 (projector). No script errors.
- On the board: drafting groups, keyboard select-and-move, drag-and-drop, reordering, renaming with autosave, making posters, closing entry and filtering by table.

Not checked, because it needs a real Google run:

- Sheet writes, the script lock under six tables sending at once, and the per-session ID numbering.
- SlidesApp poster building and filing into `04_Final`.
- Gemini: whether the configured model accepts images, `responseSchema` and `thinkingConfig`, and how well it reads handwriting on real cards.
- The camera button and **Speak** inside the Apps Script page frame on iPhone, Android and Chromebook. If the frame blocks the microphone, the page hides **Speak** and points to the keyboard's microphone.
- Whether Google shows its "created by another user" notice on the page.
- Facilitators other than the owner: Google may withhold their email in an owner-run web app, and access then fails closed (see the README).
- Apps Script quotas and response times with about 36 cards.

## Next ideas

- A second template to prove the pattern, for example exit tickets or "one word for today".
- A QR code drawn on the board itself.
- Saving the final groups into the session's library page as a post-event record.

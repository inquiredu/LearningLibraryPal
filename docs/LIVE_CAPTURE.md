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
| `tests/capture.test.cjs` | 19 tests for the rules, the API boundaries, page rendering, public links and the AI calls. |
| `scripts/poc.sh`, `tests/poc.test.cjs` | `npm run poc`: one command for a separate proof-of-concept instance with two deployments. Tested against a fake clasp. |

Changes to existing files are small: a `request` method in `GeminiService.js` that takes image parts and a response schema (`_call` now uses it; its tests pass unchanged); a route block in `doGet`; `capture` and `wall` in `CONFIG.PUBLIC_PAGES`; `CONFIG.CAPTURE_AI_DAILY_LIMIT`; and the Slides scope widened from read-only to `presentations` so posters can be created.

## Privacy and safety

- Nothing asks for a name. Table number is the only identifier.
- Photos are sent to Gemini to be read and are **not stored**. Only the text the table confirms is saved.
- Card text and model text that start with `=`, `+`, `-` or `@` are stored with a leading apostrophe so Sheets keeps them as text.
- Control and invisible characters are stripped from everything a table sends and everything a model returns.
- Both prompts say that text inside a photo or a card is data, never instructions.
- `CONFIG.CAPTURE_AI_DAILY_LIMIT` (300) caps photo readings plus grouping calls per day across all sessions. 0 turns live-capture AI off; typing still works.
- A table can remove only cards it sent from that device (a token returned when each card is sent). Facilitators can hide any card; hidden cards stay in the Sheet.

## Try it: `npm run poc`

One command stands up a separate proof-of-concept instance in your Google account. It never touches another Learning Library install: it makes its own Sheet and Apps Script project and keeps its settings in `.clasp.poc.json` and `.poc.json` (both ignored by Git).

It makes **two deployments of the same code**, because Apps Script only tells a script who the visitor is when the visitor has to sign in:

| Deployment | Who has access | Serves |
|---|---|---|
| Public | Anyone, no sign-in | Table entry and the wall (both need the table key) |
| Board | Anyone with a Google account | Dashboard and board (`AuthService` then allows only the owner and listed facilitators) |

The script writes the public deployment's address into `CaptureDeploy.js`, so the table and wall links the board shows always open without sign-in.

### In a Codespace (nothing to install)

1. On GitHub, open the repository, switch to the `claude/need-cards-live-capture` branch, then choose **Code → Codespaces → Create codespace**. It installs dependencies by itself.
2. In the Codespace terminal:

   ```bash
   npm run poc
   ```

3. Turn on the Apps Script API when asked (https://script.google.com/home/usersettings), then follow clasp's sign-in steps.

### On your own machine

You need Node 22.

```bash
git clone -b claude/need-cards-live-capture https://github.com/inquiredu/LearningLibraryPal.git
```

```bash
cd LearningLibraryPal
```

```bash
npm ci --ignore-scripts
```

```bash
npm run poc
```

### Then, once, in Google

The script prints the Sheet, dashboard and board addresses.

1. Open the Sheet, reload it, and choose **Learning Library Engine → Initial Setup**. Leave the Gemini key blank for a first run and Save. Approve the permissions Google asks for. These include Slides, for posters.
2. Open the dashboard and create a session.
3. Open the board, pick the session and turn on live capture. Copy the table link into a QR code and open the wall link on a projector.

Without a key, typing, dictation, the board, the wall and posters all work. Reading photos and **Suggest groups** say they need a key. To add AI later, run Initial Setup again with a new Gemini key restricted to the Generative Language API, with a low daily quota, and a model your key can use. The default is `gemini-3.8-flash`; check it exists in AI Studio. Gather uses `gemini-3.6-flash`.

Run `npm run poc` again after any code change. It updates both deployments in place, so the links stay the same.

### Sharing it

- **Tables and anyone else who adds cards:** the table link (or its QR code). No sign-in.
- **The room:** the wall link. No sign-in. It shows counts and topics only.
- **Other facilitators:** the board needs a Google account listed in `CONFIG.ALLOWED_EMAILS`. Google may withhold the email of people outside your account's domain, in which case access fails closed (see the README). For the POC, plan to run the board yourself.

To review the pages without Google:

```bash
node scripts/capture-preview.cjs /tmp/capture-preview
```

Then open `capture.html`, `board.html` or `wall.html` from that folder in a browser.

## What is checked

Checked here, with mocks:

- `npm run check` and `npm test`: 43 tests pass (the 22 existing and 21 new), including `scripts/poc.sh` run against a fake clasp: it creates both deployments, writes the public address, restores the manifest, and updates in place on a second run.
- The three pages, rendered against the stand-in with 30 made-up cards, at 375 px (phone), 1366×768 (Chromebook) and 1920×1080 (projector). No script errors.
- On the board: drafting groups, keyboard select-and-move, drag-and-drop, reordering, renaming with autosave, making posters, closing entry and filtering by table.

Not checked, because it needs a real Google run:

- Sheet writes, the script lock under six tables sending at once, and the per-session ID numbering.
- SlidesApp poster building and filing into `04_Final`.
- Gemini: whether the configured model accepts images, `responseSchema` and `thinkingConfig`, and how well it reads handwriting on real cards.
- The camera button and **Speak** inside the Apps Script page frame on iPhone, Android and Chromebook. If the frame blocks the microphone, the page hides **Speak** and points to the keyboard's microphone.
- Whether Google shows its "created by another user" notice on the page.
- `npm run poc` against the real Apps Script API: the two-deployment setup, and that the board deployment sees the owner's email.
- Facilitators other than the owner: Google may withhold their email in an owner-run web app, and access then fails closed (see the README).
- Apps Script quotas and response times with about 36 cards.

## Next ideas

- A second template to prove the pattern, for example exit tickets or "one word for today".
- A QR code drawn on the board itself.
- Saving the final groups into the session's library page as a post-event record.

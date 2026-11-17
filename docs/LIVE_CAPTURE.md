# Live capture (proof of concept)

Live capture lets tables at an event send what they write together, from a phone, while it happens. Facilitators see every entry word for word, ask AI for a draft grouping, finish the grouping themselves, and print gallery-walk posters. A projector page shows the room its progress.

It is a new kind of event for Learning Library, not a separate app. It lives inside a session and stores its data in that session's Project Database. What tables write is defined by a **capture template** (`CaptureTemplates.js`). **Need Cards** is the first template. Another kind of event adds a template; the pages, AI prompts and posters read from it.

Status: on branch `claude/need-cards-live-capture`. A first instance ran on Google through `npm run poc` (setup, sign-in and API key). The parts that need a real run are listed under [What is checked](#what-is-checked).

## Need Cards, following the retreat agenda

The facilitator moves the room through the agenda's stages from the **stage bar** on the board. Every phone and the wall follow within a few seconds. Each kind of entry is only accepted during its own stage.

| Time | Stage | Phones | Board | Wall |
|---|---|---|---|---|
| 9:00 | Welcome | Pick table (preset by a table card's QR code) and Student or Adult, once | Links, table cards, survey link | "Scan the QR code on your table" |
| 10:00 | Signals | Jot signals, one per entry | Every signal, by table and role; hide any | Count, by role and table |
| 11:12 | The Flip | The table's 3–4 flip statements ("Right now…, but we want…"); anyone at the table can add or edit | Flip statements by table | Count by table |
| 11:30 | Gallery dots | Tap Resonates, Surprising or Missing/mislabeled on any table's flip statements (up to 9) | Dot counts per flip statement, by role | Dots placed, by role |
| 12:08 | Need cards | Mark the table's top flip statement(s), using the dot counts; each person sends need cards: which flip statement, the need, G / G+ / B, Student or Adult. Photo reading and dictation help. | Cards word for word | Cards by table, tag and role |
| 12:25 | Synthesis | "The team is grouping" | **Suggest groups** (AI draft), then edit in G / G+ / B columns. A group's column is the tag most of its cards carry; **?** marks groups where tables tagged differently. **Doesn't fit yet** holds what no group claims. **Publish for voting** freezes the groups. | "Grouping N needs" |
| 12:40 | Vote | 3 votes from each phone, stackable, by role; changeable until the stage moves on | Turnout by role | The question, turnout, and the published topics |
| 12:55 | Read-out | Ranked priorities per column with the role split; the table's assigned priority | Tally from **phone votes**, **paper dots** (typed in per group, by role) or **both**; ranked columns; the top priorities go to tables 1–N, each overridable | Ranked columns with student/adult bars |
| 13:05 | Test drive | The table's priority, and its notes: change, add, cut, beyond guidance | Every table's notes, for the share-outs | Each table's priority |
| 13:47 | Close | Thank you and the exit survey link | Survey link setting | Thank you and the survey QR code |

Paper is the fallback all the way through: the tables still write on paper, and if phones fail at the vote, the team counts dots and types them into the board, which then ranks and assigns exactly as it does for phone votes.

Two things to tell the room, because of how entries are stored:

- **Gallery dots and votes count once per phone.** A phone gets a random voter id the first time it opens the page, so two people sharing a phone are one voter. People sharing a phone vote with paper dots.
- **Each table has one set of test-drive notes, and each save replaces it.** If two phones at a table both type, the last save wins. Each table picks one note-taker.

The attendee walkthrough and the projected phone guide (shared outside the repo) follow the stages above.

## Pages

| Page | URL | Who |
|---|---|---|
| Board | `/exec?page=board` (then pick a session) | Authorized facilitators (`AuthService`) |
| Table cards | `/exec?page=tablecards&session=S-…` | Authorized facilitators |
| Phones (tables and voting) | `/exec?page=capture&session=S-…&k=…` (`&t=3` chooses table 3) | Anyone with the link |
| Wall | `/exec?page=wall&session=S-…&k=…` | Anyone with the wall link |

The `k` parameter is a random table key made when capture is turned on. Every table and wall call checks it, so the session's public library link cannot be used to send cards. The board shows both links.

## AI skills

Skills replace Gemini Gems. A skill is a platform-neutral instruction pack for an AI assistant: instructions, three starter prompts and the session materials to attach. Each one is saved as a `SKILL.md` file (a short YAML header, then Markdown) in the session's `03_Skills` folder (older sessions keep `03_Gems`). That is the format Claude uses for skills, and the same text pastes into a Gemini or ChatGPT custom assistant, or the start of any conversation. The library page shows each skill with a copy button, the materials to add and short notes for each assistant.

- A session with live capture gets skills written for its activity. Need Cards defines three: **Need Card Coach** and **Guidance Sorter** for tables, **Next Steps Planner** for facilitators after the gallery walk.
- Other sessions get the four library companions (Session Primer, Critical Lens, Synthesis Companion, Reflection Catalyst).
- Ids and names come from the code, not the model; only titles of the session's public materials can be listed; old Gems still display, read as skills.
- Skills are stored where Gems were (the Gems JSON column), so no sheet schema changes. Code names (`GemsService`, `webGenerateGems`) stay for compatibility; what people see says skills.

## Files

| File | What it holds |
|---|---|
| `CaptureTemplates.js` | Templates: fields, levels, routes, prompt focus. Need Cards is here. |
| `CaptureLogic.js` | Pure rules: validation, text cleaning, formula escaping, group repair, counts, ordering, wall summary. |
| `CaptureStore.js` | Reads and writes the `Live Capture`, `Live Cards`, `Live Groups` and `Live Tables` tabs under the script lock. |
| `CaptureAiService.js` | Photo reading and group drafting through `GeminiService.request`, with a daily call limit. |
| `CapturePosterService.js` | Builds the poster deck with SlidesApp. |
| `CaptureApi.js` | Browser entry points and page rendering. |
| `Capture.html`, `CaptureBoard.html`, `CaptureWall.html`, `CaptureTableCards.html` | The pages. Table cards draw QR codes in the browser with qrcode-generator 1.4.4 from cdnjs; if it can't load, each card prints its link. |
| `Skills.js`, `GemsService.js` | AI skills (they replace Gems): see [AI skills](#ai-skills). |
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
2. Open the dashboard and create a session with the event type **Live capture: Need Cards** and your number of tables. The wizard opens the board.
3. From the board, open **Table cards**, scan one to check it, and print. Open the wall on a projector.

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

Checked here, with stand-ins for Google:

- `npm run check` and `npm test`: 62 tests pass, covering the agenda rules (cards tied to their own table's flip statement, columns and **?**, the published snapshot, dots, votes, tallies by source and role, ranking and assignment), stage gating, the key and sign-in boundaries, the wall never carrying anyone's words, the store reading older sheets by header, the AI calls, the page rendering and `scripts/poc.sh`.
- Every stage's phone, board and wall rendered from `scripts/capture-preview.cjs` with no script errors (30 screens), and a click-through of each stage's actions: adding and editing signals and flip statements, gallery dots, marking a top flip statement and sending cards, voting with the 3-vote limit, test-drive notes, publishing, switching the tally between phone, paper and both, typing paper dots, overriding a table's assignment and moving the stage.

Not checked, because it needs a real Google run:

- Many phones at once: about 40 phones checking for stage changes every 8 seconds, and everyone voting within a few minutes. Reads come from a snapshot cached for 4 seconds, and writes wait on the script lock, but the real limits only show on the day. Rehearse with as many phones as you can.
- Sheet writes for the new tabs, and the header-based reading on a real spreadsheet.
- SlidesApp posters and filing into `04_Final`.
- Gemini on real handwriting, and the skills the model writes.
- The camera and **Speak** inside the Apps Script page frame on phones.
- QR codes on the table cards and the close slide (the library is loaded in the browser; it was blocked here).
- Facilitators other than the owner (Google may withhold their email; access then fails closed).

## Next ideas

- A second template to prove the pattern, for example exit tickets or "one word for today".
- A QR code drawn on the board itself.
- Saving the final groups into the session's library page as a post-event record.

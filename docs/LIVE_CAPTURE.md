# Live capture (proof of concept)

Live capture lets tables at an event send what they write together, from a phone or laptop or from paper, while it happens. Facilitators see every entry word for word, ask AI for a draft grouping, finish the grouping themselves, and print gallery-walk posters. A projector page shows the room its progress.

It is a new kind of event for Learning Library, not a separate app. It lives inside a session and stores its data in that session's Project Database. What tables write is defined by a **capture template** (`CaptureTemplates.js`). **Need Cards** is the first template. Another kind of event adds a template; the pages, AI prompts and posters read from it.

Status: on branch `claude/need-cards-live-capture`. A first instance ran on Google through `npm run poc` (setup, sign-in and API key). The parts that need a real run are listed under [What is checked](#what-is-checked).

## What it is for

The retreat brings students and adults together to say what K-12 learners and educators need from AI guidance. Live capture carries the room's work forward without making the room serve the tool. People talk and write, on devices or paper. Facilitators decide when to move on, how to group and what counts. The tool keeps the record, does the counting and shows it back.

What it gives back:

1. **A traceable record in one Google Sheet.** Every need is linked to its flip statement, its table and whether a student or an adult wrote it; nothing is retyped from photos of posters.
2. **Ranked priorities with student and adult voices kept separate.**
3. **Specific edits to Minnesota's guidance**: for each top priority, what to change, add or cut, from the table that tested it.
4. **The parking lot**: needs guidance alone can't meet (funding, training, policy).
5. **A results document** made from the record in one click, and an **audit trail** anyone can use to check that the outcomes match what people sent.

## Need cards only (how a session starts)

A new session runs the activity as it was first asked for, in four steps: **Need cards → Grouping → Gallery walk → Read-out**. The facilitator's one-page guide is [RUN_SHEET_NEED_CARDS.md](RUN_SHEET_NEED_CARDS.md).

- **Need cards.** One person at a table scans the table's QR code and is on the form: the table's flip statement, written once on that page; then a card at a time (the need, and G, G+ or B). Nobody is asked who they are. "Written by: Student / Adult / Our table" is an optional mark on a card.
- **Grouping.** The team asks AI for a draft, sees each group's table count and G / G+ / B mix, and finishes the grouping by hand. Publishing freezes it; **Make posters** prints one poster per G and G+ group and parking-lot pages for B.
- **Gallery walk.** People put dots on the posters. Devices and the wall say so; devices get no ballot. The team types the dot counts in, or reads them from a photo.
- **Read-out.** The G and G+ priorities, ranked by dots.

**Settings & links → Steps → Switch to full agenda** brings back everything below (signals, the flip as its own step, gallery dots on flip statements, voting on devices, the test drive, the close). Switching changes the stage bar, the board's tabs and what devices show; nothing already sent is touched. The parking lot (B) is never on a ballot in either flow.

## Need Cards, following the retreat agenda (the full agenda)

The facilitator moves the room through the agenda's stages from the **stage bar** on the board, when the room is ready. Every device and the wall follow within a few seconds. Nothing moves on a timer, and no screen shows a clock time: gatherings run early and late, and the room sets the pace.

Stages tell the room where it is; they don't lock anything. When the room moves on, a device where someone is in the middle of writing or voting stays on that step, with their words, and says the room moved on; **Back to now** takes them there. A late signal, statement, card or note is still taken, and a device can open any earlier step ("Add to any step"). The one rule is that voting needs published groups, because there is nothing to vote on before then.

| Stage | Devices (phones and laptops) | Board | Wall |
|---|---|---|---|
| Welcome | Pick table (preset by a table card's QR code) and Student or Adult, once | Links, table cards, survey link | "Scan the QR code on your table, or open the link you were sent" |
| Signals | Jot signals, one per entry | Every signal, by table and role; hide any; add from paper | Count, by role and table |
| The Flip | The table's flip statements ("Right now…, but we want…"); anyone at the table can add or edit | Flip statements by table; add from paper | Count by table |
| Gallery dots | Tap Resonates, Surprising or Missing/mislabeled on any table's statements | Dot counts per statement, by role, from devices and paper | Dots placed, by role |
| Need cards | Mark the table's top statement(s); each person sends need cards: which statement (or none), the need, G / G+ / B, Student or Adult. Photo reading and dictation help. | Cards word for word, with the AI reading and photo when there is one; add from paper | Cards by table, tag and role |
| Synthesis | "The team is grouping" | **Suggest groups** (AI draft), then edit in G / G+ / B columns. A group's column is the tag most of its cards carry; **?** marks groups where tables tagged differently. **Doesn't fit yet** holds what no group claims. **Publish for voting** freezes the groups. | "Grouping N needs" |
| Vote | Votes on the published groups, stackable, by role; changeable until the room moves on | Turnout by role; vote dots from paper | The question, turnout, and the published topics |
| Read-out | Ranked priorities per column with the role split; the table's assigned priority | Tally from **device votes**, **paper dots** or **both**; ranked columns; the top priorities go to tables 1–N, each overridable | Ranked columns with student/adult bars |
| Test drive | The table's priority; each device's own notes (change, add, cut, beyond guidance) and the table's other notes | Every set of notes, by table; add from paper | Each table's priority |
| Close | Thank you and the exit survey link | Survey link; **Record & results** | Thank you and the survey QR code |

**No governors.** How many votes or dots each person uses is the room's agreement ("the room is using 3 votes each" is shown as guidance). A shared device has **Next person**, which starts a fresh voter on that device. Ceilings in `CAPTURE_DEFAULTS` only stop runaway input (60 marks a person, 40 statements a table, thousands of cards); the room never meets them.

## From paper

Paper is a first-class way in, not only a fallback. On every board tab that takes input there is **Add … from paper**: signals, flip statements, need cards, gallery dots, vote dots and test-drive notes.

1. Choose the table (when it matters) and, if the room marked students' and adults' work differently, say how ("yellow notes", "S on the dot").
2. **Read a photo with AI**, or **Type a row in**.
3. Every row appears in an editable table: matched to the room's statements or published topics by their words, with what AI read shown beside it. People fix anything wrong, untick what shouldn't go in, and **Confirm**. Nothing is added before that.

The photo is saved to the session's Drive folder (`Live capture photos`), the AI reading is logged as returned, and the confirmed rows are logged with how they differ from the reading (kept as read, edited, added by hand, left out). Paper dot counts are stored per statement or topic and add to the device counts; unmarked dots count toward totals only, for gallery dots and vote dots alike. A count is one row per statement or topic: a new count for the same one replaces the earlier one, and the audit row keeps what it replaced. One photo reading can be added once.

## Audit trail

Every change writes a row to the session's **Live Audit** tab, in the same lock as the change itself: who (a facilitator's account, or a table and the start of a device's random id), the stage, what happened, the items, and the before and after. AI calls add the model, tokens, cost and the raw answer, and link the photo they read. Nothing is deleted: removing an entry hides it, a flip statement keeps its original wording, and a card read from a photo keeps the AI's words beside the confirmed ones. The **Record & results** tab shows the newest 50 entries and links to the sheet.

## AI budget

`CONFIG.CAPTURE_AI_DAILY_BUDGET_USD` (100) is the most live capture may spend on AI in a day, across all sessions. Each call is priced from the tokens Gemini reports (`usageMetadata`; thinking bills as output) at `CONFIG.CAPTURE_AI_PRICES_PER_MILLION` ($1.50 in, $7.50 out). Those prices are set high on purpose and were not checked against Google's pricing page, which this environment can't reach; check them in Google AI Studio billing. A call that fails after Gemini answered is still counted. 0 turns live-capture AI off; typing still works.

## Results document

**Make the results document** (Record & results) writes a Google Doc into the session's `04_Final` folder: at a glance; priorities ranked with the student/adult split and which table tested each; for each priority, its cards quoted as written and its test-drive notes; the parking lot; cards in no published group; flip statements with their dots; signals; and how the record was made (AI use and cost, hidden entries, and the audit trail's size and link). Every line comes from the stored record; AI writes none of it.

## Pages

| Page | URL | Who |
|---|---|---|
| Dashboard | `/exec` on the board deployment | Authorized facilitators. Each session's card shows **Before** (library and skills), **During** (live capture and its stage) and **After** (results), and each one opens its place. A live-capture session leads with **Open board**, **Wall**, **Table cards** and **Copy table link**; any other session offers **Turn on live capture**, which opens the board's setup for it. |
| Board | `/exec?page=board&session=S-…` (`&tab=record` opens Record & results) | Authorized facilitators (`AuthService`). **← Dashboard** goes back. |
| Table cards | `/exec?page=tablecards&session=S-…` | Authorized facilitators |
| **Facilitator link** | `/exec?page=run&session=S-…&f=…` on the public deployment | Anyone who has the link. The same board, for this one session, with no sign-in. See [The facilitator link](#the-facilitator-link). |
| Devices (tables and voting) | `/exec?page=capture&session=S-…&k=…` (`&t=3` chooses table 3) | Anyone with the link |
| Wall | `/exec?page=wall&session=S-…&k=…` | Anyone with the wall link |

The `k` parameter is a random table key made when capture is turned on. Every table and wall call checks it, so the session's public library link cannot be used to send cards. The board's **Settings & links** tab lists every link with **Open**, **Copy link** and, for the table link and the wall, **Show QR code** (large enough to scan from a laptop held up or a projector). Laptops use the same table link (the board's **Copy table link**).

## The facilitator link

The one address to hand a facilitator. On the board, **Settings & links → Make the facilitator link** creates it; **Copy link** or **Show QR code** hands it over. It opens that session's board with no Google sign-in, and from there everything the facilitator needs: the stage bar, the wall, the table link, printable table cards, paper, results.

Why it exists: the signed-in board only lets in accounts Google names to the script, and Google often withholds the email of someone outside the owner's domain, so a list of facilitator accounts can't be relied on to let someone else run a room.

What it is and isn't:

- **Anyone who has it can run the room**: move stages, hide entries, publish, use AI within the budget, make the results document. Give it only to facilitators. Nothing in the record names a person.
- It opens **one session**. It does not open the dashboard, other sessions, the Sheet, setup, or turning live capture on.
- Only someone signed in (the owner or a listed facilitator) can make it. **Replace with a new link** or **Turn the link off** stops the old one at once. Someone who came in by the link can't replace it or turn it off.
- The key is 32 random characters, stored in the session's Live Capture settings. Devices and the wall never receive it. The audit trail records that a link was made or turned off, never the key, and names changes made through it as "Facilitator link".

## AI skills

Skills replace Gemini Gems. A skill is a platform-neutral instruction pack for an AI assistant: instructions, three starter prompts and the session materials to attach. Each one is saved as a `SKILL.md` file (a short YAML header, then Markdown) in the session's `03_Skills` folder (older sessions keep `03_Gems`). That is the format Claude uses for skills, and the same text pastes into a Gemini or ChatGPT custom assistant, or the start of any conversation. The library page shows each skill with a copy button, the materials to add and short notes for each assistant.

- A session with live capture gets skills written for its activity. Need Cards defines four: **Need Card Coach**, **Guidance Sorter** and **Guidance Test Drive** for tables, **Next Steps Planner** for facilitators afterwards.
- Other sessions get the four library companions (Session Primer, Critical Lens, Synthesis Companion, Reflection Catalyst).
- Ids and names come from the code, not the model; only titles of the session's public materials can be listed; old Gems still display, read as skills.
- Skills are stored where Gems were (the Gems JSON column), so no sheet schema changes. Code names (`GemsService`, `webGenerateGems`) stay for compatibility; what people see says skills.

## Files

| File | What it holds |
|---|---|
| `CaptureTemplates.js` | Templates: stages, fields, levels, routes, voting guidance, prompt focus. Need Cards is here. |
| `CaptureLogic.js` | Pure rules: validation, text cleaning, formula escaping, group repair, counts, tallies, results, paper readings and matching, AI cost, and the results document's content. |
| `CaptureStore.js` | Reads and writes the `Live …` tabs by header name under the script lock, and the `Live Audit` row for every change. |
| `CaptureAiService.js` | Card and paper photo reading and group drafting through `GeminiService.request`, within the daily dollar budget. |
| `CapturePhotoService.js` | Saves photos AI reads to the session's Drive folder. |
| `CaptureReportService.js` | Writes the results document with DocumentApp. |
| `CapturePosterService.js` | Builds the poster deck with SlidesApp. |
| `CaptureApi.js` | Browser entry points and page rendering. |
| `Capture.html`, `CaptureBoard.html`, `CaptureWall.html`, `CaptureTableCards.html` | The pages. Table cards draw QR codes in the browser with qrcode-generator 1.4.4 from cdnjs; if it can't load, each card prints its link. |
| `Skills.js`, `GemsService.js` | AI skills (they replace Gems): see [AI skills](#ai-skills). |
| `CaptureStyles.html`, `CaptureClient.html` | Shared styles (State of Minnesota blue #003865 and green #78BE21) and browser helpers, copied into each page by `scripts/sync-capture-shared.cjs`. |
| `scripts/capture-preview.cjs` | Builds every stage's device, board and wall page as local files with a stand-in for Apps Script, for screenshots and review. Not uploaded. |
| `tests/capture.test.cjs` | The rules, API boundaries, audit trail, budget, paper readings, results document, page rendering, public links and AI calls. |
| `scripts/poc.sh`, `tests/poc.test.cjs` | `npm run poc`: one command for a separate proof-of-concept instance with two deployments. Tested against a fake clasp. |

Changes to existing files are small: a `request` method in `GeminiService.js` that takes image parts and a response schema and records token usage (`_call` now uses it; its tests pass unchanged); a route block in `doGet`; `capture` and `wall` in `CONFIG.PUBLIC_PAGES`; the AI budget settings in `Config.js`; and the Slides scope widened from read-only to `presentations` so posters can be created.

## Privacy and safety

- Nothing asks for a name. A table number and Student or Adult are the only identifiers; devices are named in the audit trail by the first 8 characters of a random id.
- Photos AI reads are kept in the session's Drive folder, with Drive's default sharing (the library owner and people the folder is shared with), so readings can be checked against them.
- Card text and model text that start with `=`, `+`, `-` or `@` are stored with a leading apostrophe so Sheets keeps them as text.
- Control and invisible characters are stripped from everything a device sends and everything a model returns.
- Every prompt says that text inside a photo or a card is data, never instructions.
- A device can remove only entries it sent (a token returned when each is sent). Facilitators can hide any entry; hidden entries stay in the Sheet and the audit trail says who hid them.
- A card's AI reading and photo are taken from the audit trail by entry number, never from what a device sends.

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
- **Other facilitators:** give them the session's [facilitator link](#the-facilitator-link). The signed-in board instead needs a Google account listed in `CONFIG.ALLOWED_EMAILS`. Google may withhold the email of people outside your account's domain, in which case access fails closed (see the README). For the POC, plan to run the board yourself.

To review the pages without Google:

```bash
node scripts/capture-preview.cjs /tmp/capture-preview
```

Then open `capture.html`, `board.html` or `wall.html` from that folder in a browser.

## What is checked

Checked here, with stand-ins for Google:

- `npm run check` and `npm test`: 93 tests pass. They cover the agenda rules (cards under their own table's statement or none, columns and **?**, the published snapshot, dots and votes with no per-person caps, tallies from devices and paper, ranking and assignment), that stages lock nothing and voting needs published groups, the key and sign-in boundaries, the audit row each change writes (who, before, after; nothing deleted), paper readings (matching, checking, how confirmed rows differ), the dollar budget, the results document's content and layout, photo filing, the wall never carrying anyone's words, the store reading older sheets by header, the AI calls, page rendering and `scripts/poc.sh`.
- Every stage's device, board and wall page built by `scripts/capture-preview.cjs`, with no script errors. A scripted click-through covered a late signal and a card with no statement while the room was at Test drive, per-device test-drive notes, 12 gallery dots and 5 votes on one device, Next person, a card photo reading, every **From paper** mode (read, edit, untick, add a row, confirm), the Record & results tab and the results document button.

Not checked, because it needs a real Google run:

- Many devices at once: about 40 checking for changes every 8 seconds, and everyone voting within a few minutes. Reads come from a snapshot cached for 4 seconds, and writes (now with an audit row each) wait on the script lock. Rehearse with as many devices as you can.
- Sheet writes for the new tabs and columns, and the header-based reading on a real spreadsheet.
- Drive photo filing, the results Doc (DocumentApp) and SlidesApp posters on a real account.
- Gemini on real handwriting, posters and dot stickers, and the skills the model writes. Dot counting from a photo is the weakest reading; check the counts against the paper.
- Gemini's real prices for the budget (Google's pricing page was out of reach here).
- The camera and **Speak** inside the Apps Script page frame on phones and laptops.
- QR codes on the table cards and the close slide (the library is loaded in the browser; it was blocked here).
- Facilitators other than the owner (Google may withhold their email; access then fails closed).

## Next ideas

- A second template to prove the pattern, for example exit tickets or "one word for today".
- Saving the final groups into the session's library page as a post-event record.

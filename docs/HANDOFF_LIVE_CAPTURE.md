# Handoff: live capture for the Learner-Centered AI in Education Retreat

Written November 18, 2026, the day of the retreat. Start any new session on this work from **this repository** (`inquiredu/LearningLibraryPal`), branch `claude/need-cards-live-capture`, and read this file first. Then read `docs/LIVE_CAPTURE.md` for how live capture works.

This work lives in LearningLibraryPal and nowhere else. Gather (`inquiredu/gather`) was only a source of lessons; none of its code or data is part of this, and it must not be changed for this work.

## Why this exists

Jeff Plaman's retreat for MDE (Minnesota Department of Education) brings students and adults together to say what K-12 learners and educators need from AI guidance. Live capture carries the room's work forward without making the room serve the tool: people talk and write, on phones, laptops or paper; facilitators decide when to move on, how to group and what counts; the tool keeps the record, does the counting and shows it back.

What it gives back to MDE:

1. A traceable record: every need linked to its flip statement, table, and whether a student or an adult wrote it.
2. Ranked priorities with student and adult voices kept separate.
3. Specific edits to Minnesota's AI guidance: for each top priority, what to change, add or cut, from the table that tested it.
4. The parking lot: needs guidance alone can't meet (funding, training, policy).
5. A results document made in one click, and an audit trail anyone can use to check that outcomes match what people sent.

**Theme / core question** (used in the session wizard): What do Minnesota's students and educators need from AI guidance to keep learning human and learner-centered? Students and adults turn what they're noticing about AI into needs, rank them together, and test current Minnesota guidance against the top priorities: what to change, add or cut, and what needs more than guidance.

## Decisions Sean made (keep them)

- **Nothing is timed.** Stages show no clock times; the facilitator moves the room on when it's ready.
- **No governors.** No caps on votes, dots or statements; "3 votes each" is guidance the room keeps. Shared devices use **Next person**. Stages lock nothing; only voting needs published groups.
- **Phones and laptops**, and **paper is a first-class way in**: a photo of a poster is read by Gemini, people check and edit every row, then confirm.
- **Audit trail** for everything, so anyone can verify outcomes against what people sent.
- **AI budget: $100 a day**, on Sean's own Gemini key. Data in Sean's Google account is fine for this experience.
- **State of Minnesota colors** (blue #003865, green #78BE21) on the live capture screens and the facilitator screens. The newsletter, emails and public library pages keep their colors.
- **Stay laser focused** on this retreat's goal; don't spread into other parts of Learning Library.
- Skills replace Gemini Gems (platform-neutral `SKILL.md`).

## Where things are

| What | Where |
|---|---|
| Code | branch `claude/need-cards-live-capture` (all pushed). Latest: `6956560`. |
| How it works | `docs/LIVE_CAPTURE.md` |
| Proof-of-concept instance | Sean's Google account. Its Sheet is `1wdxMK4y1-VdsMUDQXnBJDszEdczuTqER0Ap87V_LpBs`; `npm run poc` prints the board and public links. |
| Where `npm run poc` runs | Sean's **GitHub Codespace** for this repo. It holds `.clasp.poc.json` and `.poc.json` (which project to update) and the clasp sign-in. A fresh clone without those files makes a new POC instead of updating this one. |
| Fallback (Google Form version) | Drive folder `1lmUNDOFtVmlg6Qt-jP8ADM97vvkFNmud`: response Sheet `1wHVnaSaDfoo3cpP85cxAbM-4HoMUw3qW7akJTBa7Zzc` and slides `1ERcD5zQzesC1qeJOoHpvrh_x-jg0k4xm3BPx5G5NGOg`. |
| Attendee walkthrough | https://claude.ai/artifact/QchwUwoSjar4rbD5R71iWR ("Using your phone or laptop at the retreat"; private until shared) |
| Projected deck | https://claude.ai/artifact/FcAyYxTgfEXvS81LnCMWt5 ("Retreat Phone and Laptop Guide"; private until shared) |
| Click-through preview | https://claude.ai/artifact/SwYBUqxc7MSVS3EBeSdfBX (**out of date**: built before the audit, paper and no-governor changes; rebuild with `scripts/capture-preview.cjs` before sharing) |

## Run and check

In the Codespace:

```bash
git pull && npm run poc
```

Then hard-reload the Sheet, board and devices. Anywhere:

```bash
npm test
```
```bash
node scripts/check.cjs
```
```bash
node scripts/capture-preview.cjs /tmp/preview
```

78 tests pass as of `6956560`. The preview builds every stage's device, board and wall page with made-up data and a stand-in for Apps Script.

## What changed on the branch, newest first

| Commit | What |
|---|---|
| `6956560` | A code comment no longer points at Gather. |
| `140af3e` | **Speed.** The cached snapshot was over Apps Script's 100 KB cache limit, so every device check-in re-read the whole Sheet. It is now cached in pieces and not dropped on writes; whoever just changed something reads fresh. Settings and the session lookup are cached. Measured on a busy stand-in: device check-in 18 → 0 Sheet calls, sending a card 37 → 12, board refresh 19 → 0. |
| `44ebebf` | State colors on the facilitator screens; wizard says skills and phones and laptops. |
| `3d979e6` | Audit trail, From paper, no governors, per-device test-drive notes, dollar budget, results document, state colors on live capture. |
| `c4a63dd` | No clock times anywhere. |
| `cd5dd96`, `32c032a` and earlier | The agenda-driven stages, phone/board/wall pages, skills, table cards, `npm run poc`. |

## Not yet proven on Google

These ran only against stand-ins here. Check them in a rehearsal and after the event:

- Load with about 40 devices after the speed fix; Apps Script still takes about a second per tap.
- Drive photo saving, the results Doc (DocumentApp), and SlidesApp posters on a real account.
- Gemini on real handwriting, posters and especially dot stickers (the weakest reading; check counts against the paper).
- Gemini's real price. The budget assumes $1.50 in / $7.50 out per million tokens from third-party sources; Google's pricing page was unreachable from the build environment. Confirm in AI Studio billing and adjust `CAPTURE_AI_PRICES_PER_MILLION` in `Config.js`.
- QR codes on table cards (drawn in the browser from cdnjs; it was blocked during the build).
- Camera and dictation inside the Apps Script page frame; facilitators other than the owner.

## Loose ends

- The Codespace has an **uncommitted `Brands.js`** edit adding an "MDE" brand text of unknown origin. It does nothing today (nothing reads `Brands.js`, and the wizard's Brand dropdown is hard-coded). Decide whether to commit or discard it; check any MDE identity claims against MDE's real guide first.
- The walkthrough has a `[Wi-Fi name and password]` placeholder. Both attendee artifacts are private until shared from their Share menu.
- After the event: make the results document, then save the Sheet (with its Live Audit tab), the Doc and the photos folder somewhere MDE can reach.

## Next: a LearningLibrary Firebase version (after the retreat)

Sean asked about moving this architecture to Firebase. Agreed direction: yes, as **a new, separate Firebase project for LearningLibrary**, after the retreat; not Gather's project. Why: devices get changes as they happen instead of every 8 seconds; each write is its own document, so a room sending at once doesn't queue on one lock; devices keep working through Wi-Fi drops; pages load faster than Apps Script's.

What a useful, reliable version needs:

1. **Data and rules.** `sessions/{id}/` with signals, flip statements, cards, dots, votes, notes, groups and published snapshots. Security rules with tests; a separate test project; rollback tags before deploys.
2. **Identity without names.** Anonymous sign-in per device (replaces today's random device id, enforced by rules); tables join with a short code; facilitators sign in with Google from an allowlist.
3. **Append-only audit trail** written by Cloud Functions on every change, which no client (not even the owner) can edit.
4. **AI on the server.** Gemini key in Secret Manager, called from Cloud Functions with the daily dollar budget; photos in Storage with rules; every reading and confirmation in the audit trail.
5. **Hand-off to MDE.** Export the results to Google Docs and Sheets.
6. **Proof before use.** A simulated load of 60+ devices, a rehearsal mode, monitoring and a billing cap.
7. **Governance to settle with Jeff.** Who owns the data (a state agency, with students in the room), how long it's kept, and whether MDE needs to approve where it lives.
8. **Carry over.** `CaptureLogic.js` and `CaptureTemplates.js` already use no Google services; their rules and tests move as they are.

Use what the retreat teaches (what lagged, what people did on paper, what facilitators needed) to shape the plan. Write the plan first and settle the decisions with Sean before building.

## Working with Sean

- Collaborator and co-guide. Never assume; verify, and say plainly what was and wasn't checked.
- Plain language; no clock times or rigid rules in what attendees see.
- Commit and push to the feature branch; don't open a pull request unless asked. Don't touch Gather.
- Never ask for secrets in chat (Gemini key, OAuth codes, `.clasprc.json`).

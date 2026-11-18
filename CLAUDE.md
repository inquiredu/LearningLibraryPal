# LearningLibraryPal

## What this is for

LearningLibraryPal is an Apps Script approach to supporting interaction and using AI to synthesize and illuminate meaning around a learning event: before (resources, the library page, skills), during (live capture) and after (synthesis). AI drafts and counts; people decide.

Live capture (`docs/LIVE_CAPTURE.md`) applies that intent to one specific request, the November 18, 2026 MDE retreat, and departs from the original design. Whether it stays here, becomes a fork, or moves to Firebase is open. Decide after the retreat from what it showed, especially whether the library side did real work there. Until then, staying in this repo is a default, not a rule.

Live capture's current state is in `docs/HANDOFF_LIVE_CAPTURE.md` (on branch `claude/need-cards-live-capture` until it merges). Read it first for that work.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (`inquiredu/LearningLibraryPal`), worked through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage labels, used as-is: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root (neither exists yet; made when needed). See `docs/agents/domain.md`.

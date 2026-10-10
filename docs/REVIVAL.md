# Revival implementation decisions

## Baseline and scope

The repair branch starts from LearningLibraryPal commit `6f5b9704ab94b51d2bdb2fff962c19579fe87ac1` (March 24, 2026). The public project keeps its existing 15-column Sessions schema and resource schema.

A comparison with the private LearningLibrary repository found broader configurable branding/setup, draft-email persistence, post-event synthesis and approval, a public post-event page, a 20-column Sessions schema, and a small synthesis type-inference test suite. Its storage, AI endpoint and synthesis checkpoint assumptions also need repair. Importing it wholesale would expand the data/schema and deployment changes before the pilot is established.

Decisions:

- Keep LearningLibraryPal as the pilot baseline.
- Adapt automatic library-link creation without changing its Sessions schema.
- Add behavior-focused tests for the actual revival blockers rather than importing only URL-type tests.
- Defer private-version post-event publishing and branding until after a verified pilot; compare individual features with migration tests at that point.

## Implemented in this branch

- Caller authorization on every privileged browser handler; setup restricted to the owner; no token export; secret getter made server-private; setup returns only whether a key exists.
- Owner-only default access. Shared facilitator access requires an explicit email/domain configuration and an identity Google can verify.
- Explicit master spreadsheet ID captured in Initial Setup and used from the web app.
- Configurable Gemini model, key sent in a header, bounded transient retries and validation of failed/incomplete responses. The retired model is removed.
- Private meeting filtering, reduced public metadata, validated session IDs and a new public cache namespace.
- Incremental synthesis writes, a soft four-minute batch deadline, resumable completion markers, failure counts and resource-mutation locking. Automatically discovered materials default to internal visibility.
- New projects no longer inherit the historical deployment ID. Setup runs clasp creation in a temporary folder to preserve application files, backs up old local configuration and requires explicit confirmation of an existing target.
- Pinned local clasp and lockfile; upload allowlist; regression tests and GitHub Actions checks.
- Email uses MailApp with its send-only scope; the Sheet menu directs users to the dashboard preview before sending. Explicit identity and Slides-read scopes cover the services actually used.

## Remaining release work

1. Run the private Google Workspace pilot in [PILOT.md](PILOT.md), including real model access and identity behavior. Local mocks cannot certify it.
2. Introduce session-wide Draft → Preview → Published states, with a publication snapshot so AI regeneration cannot immediately change an already shared participant page.
3. Simplify the main journey to Create → Add materials → Review → Preview → Share. Keep Gems, NotebookLM, page composition and newsletters optional.
4. Bring across private-version post-event review/approval and branding selectively, with schema migration and privacy tests.
5. Add email delivery tracking/idempotency before bulk participant campaigns; a retry after partial delivery can currently resend to earlier recipients.

## Tooling limitation

`npm audit` reports a high-severity stack-exhaustion advisory in clasp 3.4.1's transitive `braces`/`micromatch` dependency. Compatible `npm audit fix` does not resolve it; npm's forced suggestion downgrades clasp to 2.5.0. No forced downgrade was applied. This is local development tooling and is excluded from Apps Script uploads. Use the checked-in simple ignore patterns; track an upstream fix before broad distribution. Advisory: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm.

## Platform references verified during implementation

- [Apps Script client/server communication and private functions](https://developers.google.com/apps-script/guides/html/communication)
- [Bound-script method limitations in web apps](https://developers.google.com/apps-script/guides/bound)
- [Active versus effective user identity](https://developers.google.com/apps-script/reference/base/session)
- [Gemini model lifecycle](https://ai.google.dev/gemini-api/docs/deprecations)
- [MailApp authorization](https://developers.google.com/apps-script/reference/mail/mail-app)

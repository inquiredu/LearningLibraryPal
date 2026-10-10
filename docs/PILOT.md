# Private pilot verification

Status: **not run against Google Workspace yet**. Local tests use mocks. They do not verify OAuth consent, a real deployment, Gemini access, Drive policies or email delivery.

Use a new project and test materials. The owner must finish Initial Setup from its bound spreadsheet. Begin with **Execute as Me / Only myself**.

## One complete learning session

1. Open the dashboard and create a session titled “Pilot: Evaluating AI-generated learning materials.” Confirm the Sessions row, session folders, project database and library URL exist.
2. Add a short Google Doc, a Google Slides deck and a public article. Add a private planning document and mark a sample meeting link internal.
3. Run Synthesis. Confirm per-resource completion, useful summaries and source-grounded questions. If a request fails, check that the row shows an error and that fixing the key/model and running Synthesize retries it.
4. Preview the library. Internal resources and the internal meeting must be absent. Public resources should appear in the selected order. Check that Drive permissions actually permit the intended participants to open each source.
5. Generate Gems if desired; review their instructions and add the intended links.
6. Preview an email in the dashboard. Send **only after approving its content and recipients**, initially to your own test address. Verify the received message and its library link.
7. Reload both the Sheet and dashboard. Confirm data persists and both entry points work.

## Access checks before expanding the audience

In a separate test deployment, select the intended audience, including anonymous access only if the participant page is meant to support it. These checks cannot be performed against an owner-only deployment using a second account.

- The owner can use the dashboard. An unrelated account cannot.
- An intended facilitator can access protected functionality only when its verified email is in the allowlist or configured domain. If Google withholds its email, access must remain denied.
- A participant can open the library route but cannot invoke privileged handlers such as `getDashboardData`, `getSetupConfig`, `webGetParticipants` or `getDriveNavigate` through `google.script.run`.
- There is no browser-callable `getGeminiApiKey` or `getOAuthToken` function.
- An internal meeting and an internal document are absent from the library response, not just visually hidden.
- Resource additions, visibility changes and removals invalidate the participant cache.

## Recovery checks

- Interrupt a synthesis run after at least one resource has completed. Its result remains in the Sheet. Ordinary Synthesize continues only unfinished work.
- Try a resource edit from another tab while synthesis is running. The app should report that work is in progress rather than shift rows beneath the active run.
- Do not directly reorder or delete Sheet rows during a run; direct Sheet edits bypass the application lock.
- Retry an interrupted forced re-analysis with **Synthesize**, not **Re-synthesize**, to keep the newly completed rows.
- A failed setup must not overwrite an existing `.clasp.json`; new-project setup must not replace `Code.js` or the repository manifest.

Record the deployment version, account type, model ID, pass/fail results and any execution-log errors. Do not record API keys or OAuth tokens. Public launch remains a separate decision after these checks pass.

# LearningLibraryPal

Turn a facilitator's materials into a shareable learning library: create a session, add sources, review AI synthesis, and share a participant page with resources, an agenda, inquiry questions, and optional AI learning companions.

Google Apps Script hosts the application. Google Sheets stores session data; Drive stores source materials. Gemini generates drafts that facilitators review. Google account permissions, Apps Script quotas, and Gemini billing/quotas apply.

## Current status

This branch prepares a **private pilot**. Automated checks cover authorization, public-resource filtering, interrupted synthesis, AI error handling, and installation. A live Google Workspace pilot is still required before a public release. See [the pilot checklist](docs/PILOT.md) and [revival decisions](docs/REVIVAL.md).

## Install a separate pilot instance

Use Node.js 22 or newer and a Google account that can create Apps Script projects.

```bash
git clone https://github.com/inquiredu/LearningLibraryPal.git
cd LearningLibraryPal
npm ci --ignore-scripts
npm run setup
```

The setup script:

1. Uses the pinned local clasp dependency.
2. Asks you to enable the Apps Script API and sign in to Google.
3. Creates a new spreadsheet-bound project by default. If you deliberately choose an existing destination, it requires that project's Script ID.
4. Uploads application source and its manifest. It does **not** publish or update a web-app deployment.

If you use Codespaces, run the same commands in its terminal and follow clasp's login prompt. No global clasp installation is needed.

### Finish setup in Google Sheets

1. Run `npm run open` to open the new bound Sheet, then reload it.
2. Choose **Learning Library Engine → Initial Setup**. Authorize the script when prompted.
3. Enter your Gemini API key and an available Gemini model ID. The default is `gemini-3.8-flash`; change it if needed for your AI Studio project.
4. Optionally supply a root Drive folder ID, then save.

Saving records the master spreadsheet ID and installing account as the library owner. A saved API key is never returned to the browser; leave the key field blank to retain it.

### Deploy the private pilot

1. Run `npm run open:script`.
2. In Apps Script choose **Deploy → New deployment → Web app**.
3. Set **Execute as: Me**, using the same account that completed Initial Setup.
4. Set access to **Only myself** for the first pilot.
5. Open the deployment's `/exec` URL and complete [the pilot checklist](docs/PILOT.md).

Later, public participant access requires a deployment audience that permits those participants. The `library` route intentionally serves participant data without a facilitator check; the dashboard, editing, email, Calendar, Drive browsing and configuration operations enforce server-side authorization.

**Facilitator access:** by default only the owner can administer the library. To add facilitators, set `ALLOWED_EMAILS` or `ALLOWED_DOMAIN` in `Config.js`. A blank domain does **not** grant access to every Google account. Google may withhold a visitor's email in owner-executed web apps, particularly across domains. Such requests fail closed; do not substitute `getEffectiveUser()` for visitor identity. Verify the intended collaborator accounts before expanding the pilot. [Google's identity limitations](https://developers.google.com/apps-script/reference/base/session#getActiveUser()).

## Use the library

1. **Create a session** with a theme, date and audience.
2. **Add materials** through Drive browsing or links. Planning documents, agendas, facilitator guides and context documents default to internal visibility.
3. **Synthesize** the materials. Review generated summaries and questions against the sources.
4. **Manage resources** to select participant-visible materials and their order; preview the library page.
5. **Share** the library link. Use the dashboard's email preview to inspect content and recipients before explicitly sending.

Gems, NotebookLM prompts and the page designer are optional extensions. Participant-visible material on a shared library page should be treated as public. There is no session-wide draft/publish approval gate in this pilot yet.

Synthesis saves each completed resource and pauses between resources after about four minutes. Click **Synthesize** again to process unfinished resources; completed rows are skipped. **Re-synthesize** resets completion markers once. If interrupted, use ordinary **Synthesize** to resume. Failed rows retain an error message in the resource sheet. Files discovered automatically in `01_Research` start internal until you choose to make them public. Avoid direct Sheet row edits while synthesis is running.

## Develop and verify

```bash
npm run check   # Server/client JavaScript, shell and manifest syntax
npm test        # Local mocked regression tests; no Google access or email sends
npm run push   # Upload source to your configured project; does not update /exec
```

`.claspignore` allows only root application JavaScript/HTML and `appsscript.json`. Tests, dependencies, documentation and credentials are excluded. `.clasp.json` is local and ignored by Git.

After an intentional upload, update the Apps Script web-app deployment to a **New version** to make changes live. Existing installations must run **Initial Setup → Save** after this upgrade to record the master spreadsheet ID and owner. Use a separate pilot project first; the historical public and private repositories pointed to the same deployment.

## References

- [Architecture](ARCHITECTURE.md)
- [Pilot verification](docs/PILOT.md)
- [Revival scope and follow-up work](docs/REVIVAL.md)
- [Contributing](CONTRIBUTING.md)
- [Historical handoff](HANDOFF.md) — historical feature notes, not current setup instructions

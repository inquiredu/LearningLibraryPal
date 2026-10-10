/**
 * SynthesisService
 * Phase 2: Processes resources for a session.
 * For Drive files (Docs, Slides) reads content natively via DocumentApp/SlidesApp.
 * For web URLs falls back to UrlFetchApp. Passes session context to Gemini so
 * analysis is grounded in the session brief.
 */

const SynthesisService = {

  /**
   * Main entry point. Synthesizes all un-analyzed resources for a session.
   * @param {string} sessionId
   * @param {boolean} [force] - If true, re-analyzes already-scored rows too.
   * @returns {{ count: number, remaining: number, failed: number, paused: boolean }}
   */
  synthesizeAll: function(sessionId, force) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(1000)) throw new Error('Another synthesis is running. Try again shortly.');
    try {
      return this._synthesizeBatch(sessionId, force, Date.now() + 240000);
    } finally {
      lock.releaseLock();
    }
  },

  _synthesizeBatch: function(sessionId, force, deadline) {
    const session = SessionService.getSession(sessionId);
    if (!session) throw new Error('Session not found: ' + sessionId);
    if (!session.dbUrl) throw new Error('No Project Database URL for session: ' + sessionId);

    // Build session context for Gemini — grounded in the brief generated in Phase 1
    // Both are `let` so a Planning Doc can enrich them mid-synthesis
    let brief = session.brief || {};
    let sessionContext = {
      overview:   brief.overview   || '',
      objectives: brief.learningObjectives || []
    };

    const dbId = this._extractId(session.dbUrl);
    const db = SpreadsheetApp.openById(dbId);
    const resourcesSheet = db.getSheetByName('Resources');
    if (!resourcesSheet) throw new Error('No Resources sheet found in Project DB.');

    // Register discovered files before analysis so every completed result has a durable row.
    const discoveryPaused = this._registerResearchFolder(session, resourcesSheet, deadline);
    const rows = resourcesSheet.getDataRange().getValues();
    if (rows.length <= 1) return { count: 0, remaining: 0, failed: 0, paused: discoveryPaused };
    if (force) {
      // Reset only completion markers once; ordinary Synthesize resumes an interrupted re-run.
      resourcesSheet.getRange(2, 4, rows.length - 1, 1).clearContent();
      rows.slice(1).forEach(row => { row[3] = ''; });
      SpreadsheetApp.flush();
    }

    let processedCount = 0;
    let failed = 0;
    let paused = discoveryPaused;

    for (let i = 1; i < rows.length; i++) {
      if (Date.now() >= deadline) { paused = true; break; }
      const url = String(rows[i][0] || '').trim();
      if (!url) continue;

      // Skip already-synthesized rows (relevanceScore filled means done) — unless force=true
      if (String(rows[i][3] === undefined ? '' : rows[i][3]).trim() !== '') continue;

      // Read the user-set resource type — this drives the Gemini prompt and special handling
      const resourceType = String(rows[i][2] || '').trim();

      // ── Meeting Links: logistics only, no content to analyze ────────────────
      if (resourceType === 'Meeting Link') {
        if (!rows[i][1]) rows[i][1] = 'Meeting / Session Link';
        rows[i][3] = 1;          // relevanceScore
        rows[i][4] = 'Accessible'; // engagementLevel
        rows[i][7] = 'No';         // notebookLMReady
        rows[i][9] = 'Session logistics link — no content to analyze.';
        this._saveAnalysis(resourcesSheet, i + 1, rows[i]);
        processedCount++;
        continue;
      }

      try {
        const fileId = this._extractDriveFileId(url);

        // ── Video size check for Drive-hosted files ──────────────────────────
        let sizeNote = '';
        if (resourceType === 'Video' && fileId) {
          try {
            const bytes = DriveApp.getFileById(fileId).getSize();
            const mb = (bytes / (1024 * 1024)).toFixed(1);
            sizeNote = '[Drive Video — ' + mb + ' MB] ';
          } catch (e) { /* file may not be accessible */ }
        }

        // ── Read content — native Drive first, then URL fetch ────────────────
        let content = null;
        if (fileId) {
          content = this._readDriveContent(fileId);
        }
        if (!content) {
          if (resourceType === 'Audio / Podcast') {
            // Attempt URL fetch for show notes / episode description
            content = this._fetchContent(url);
            if (!content || content.startsWith('[Could not')) {
              content = '[Audio resource — no transcript available. URL: ' + url + ']';
            }
          } else {
            content = this._fetchContent(url);
          }
        }

        // Prepend size note so Gemini can reference it in the summary
        if (sizeNote) content = sizeNote + (content || url);

        // ── Type-aware Gemini analysis ───────────────────────────────────────
        const meta = GeminiService.analyzeResourceByType(
          content,
          resourceType,
          url,
          session.theme,
          session.audience,
          sessionContext
        );

        if (!meta || !Number.isFinite(meta.relevanceScore) || meta.relevanceScore < 1 || meta.relevanceScore > 5
            || typeof meta.summary !== 'string') {
          throw new Error('AI analysis returned an invalid score or summary. Retry this resource.');
        }

        // Write results — preserve user-set type; only infer type when blank
        rows[i][1] = meta.title || '';
        if (!resourceType) {
          rows[i][2] = this._inferType(url);
        }
        rows[i][3] = meta.relevanceScore || '';
        rows[i][4] = meta.engagementLevel || '';
        rows[i][5] = Array.isArray(meta.keyConceptTags) ? meta.keyConceptTags.join(', ') : '';
        rows[i][6] = meta.relevanceScore >= 4 ? 'Yes' : 'No';
        rows[i][7] = meta.notebookLMReady ? 'Yes' : 'No';
        rows[i][8] = meta.relevanceStatement || '';
        rows[i][9] = meta.summary || '';

        // ── Planning Doc: enrich session brief if none exists ────────────────
        // The planning document IS the session context — use it to build a
        // grounded brief rather than relying solely on the theme/format fields.
        if (resourceType === 'Planning Doc' && content && !(brief && brief.overview)) {
          try {
            const enrichedBrief = GeminiService.enrichBriefFromPlanningDoc(
              content, session.theme, session.format || '', session.audience
            );
            SessionService.updateSession(sessionId, { BRIEF_JSON: JSON.stringify(enrichedBrief) });
            brief = enrichedBrief;
            // Update session context so subsequent resources benefit from the new brief
            sessionContext = {
              overview:   enrichedBrief.overview || '',
              objectives: enrichedBrief.learningObjectives || []
            };
            console.log('Session brief enriched from Planning Doc.');
          } catch (e) {
            console.error('Brief enrichment from Planning Doc failed: ' + e.message);
          }
        }

        // ── Agenda: extract structured timeline into the session brief ───────
        // Always re-extracts on re-synthesis so the agenda stays current.
        if (resourceType === 'Agenda' && content) {
          try {
            const agendaData = GeminiService.enrichBriefFromAgenda(content, session.theme);
            if (agendaData && Array.isArray(agendaData.agendaItems) && agendaData.agendaItems.length) {
              const currentBrief = Object.assign({}, brief);
              currentBrief.agendaItems    = agendaData.agendaItems;
              currentBrief.sessionDuration = agendaData.duration || '';
              SessionService.updateSession(sessionId, { BRIEF_JSON: JSON.stringify(currentBrief) });
              brief = currentBrief;
              console.log('Session agenda extracted: ' + agendaData.agendaItems.length + ' items.');
            }
          } catch (e) {
            console.error('Agenda extraction failed: ' + e.message);
          }
        }

        this._saveAnalysis(resourcesSheet, i + 1, rows[i]);
        processedCount++;
        Utilities.sleep(500);
      } catch (e) {
        console.error('Failed to process row ' + (i + 1) + ': ' + e.message);
        failed++;
        rows[i][3] = '';
        rows[i][8] = 'Error: ' + e.message;
        this._saveAnalysis(resourcesSheet, i + 1, rows[i]);
      }
    }

    const remaining = rows.slice(1).filter(row => row[0] && String(row[3] === undefined ? '' : row[3]).trim() === '').length;

    // ── Post-synthesis: enrich inquiry questions from actual resource content ──
    // Only runs when at least one resource was processed this cycle.
    // Reads the in-memory rows (already written to sheet) to build a digest of
    // resource titles, key concept tags, and summaries, then asks Gemini to
    // rewrite the inquiry questions grounded in the specific materials curated.
    if (processedCount > 0 && remaining === 0 && Date.now() < deadline - 45000) {
      try {
        const contentRows = rows.slice(1).filter(function(r) {
          return String(r[2] || '').trim() !== 'Meeting Link' &&
                 r[9] && String(r[9]).trim();
        });

        if (contentRows.length && brief.inquiryQuestions && brief.inquiryQuestions.length) {
          const digest = contentRows.map(function(r, idx) {
            return (idx + 1) + '. ' + (r[1] || 'Resource') +
              (r[5] ? ' [' + r[5] + ']' : '') +
              '\n   ' + String(r[9]).substring(0, 200);
          }).join('\n\n');

          const enriched = GeminiService.enrichInquiryQuestions(
            brief.inquiryQuestions, digest, session.theme, session.audience
          );

          if (enriched && Array.isArray(enriched.inquiryQuestions) && enriched.inquiryQuestions.length) {
            const updatedBrief = Object.assign({}, brief);
            updatedBrief.inquiryQuestions = enriched.inquiryQuestions;
            SessionService.updateSession(sessionId, { BRIEF_JSON: JSON.stringify(updatedBrief) });
            console.log('Inquiry questions enriched from ' + contentRows.length + ' resources.');
          }
        }
      } catch (e) {
        console.error('Inquiry question enrichment failed: ' + e.message);
      }
    }

    return { count: processedCount, remaining: remaining, failed: failed, paused: paused };
  },

  /**
   * Returns all synthesized resources for a session as plain objects.
   * Used by LibraryService.
   */
  getResources: function(sessionId) {
    const session = SessionService.getSession(sessionId);
    if (!session || !session.dbUrl) return [];

    try {
      const dbId = this._extractId(session.dbUrl);
      const db = SpreadsheetApp.openById(dbId);
      const sheet = db.getSheetByName('Resources');
      if (!sheet) return [];

      const rows = sheet.getDataRange().getValues();
      if (rows.length <= 1) return [];

      return rows.slice(1)
        .filter(row => row[0] && String(row[0]).trim())
        .map(row => ({
          url:               String(row[0]).trim(),
          title:             row[1] || 'Untitled Resource',
          type:              row[2] || 'Article',
          relevanceScore:    Number(row[3]) || 0,
          engagementLevel:   row[4] || '',
          keyTags:           row[5] ? String(row[5]).split(', ') : [],
          preReading:        row[6] === 'Yes',
          notebookLMReady:   row[7] === 'Yes',
          relevanceStatement: row[8] || '',
          summary:           row[9] || '',
          isMain:    row[10] === 'Yes',
          startTime: row[11] ? (row[11] instanceof Date ? row[11].toISOString() : String(row[11])) : '',
          endTime:   row[12] ? (row[12] instanceof Date ? row[12].toISOString() : String(row[12])) : '',
          isPublic:  row[13] !== 'No',                     // col N — default true if blank or 'Yes'
          sortOrder: parseInt(row[14]) || 9999             // col O — default 9999 (unordered → end)
        }))
        .sort((a, b) => b.relevanceScore - a.relevanceScore);
    } catch (e) {
      console.error('getResources failed: ' + e.message);
      return [];
    }
  },

  // ─── Private ────────────────────────────────────────────────────────────────

  /**
   * Reads native content from a Drive file.
   * Returns plain text (up to 12 000 chars) or null if type not supported.
   */
  _readDriveContent: function(fileId) {
    try {
      const file = DriveApp.getFileById(fileId);
      const mime = file.getMimeType();

      // Google Docs — full text via DocumentApp
      if (mime === MimeType.GOOGLE_DOCS) {
        const doc = DocumentApp.openById(fileId);
        return doc.getBody().getText().substring(0, 12000);
      }

      // Google Slides — concatenate all slide text shapes
      if (mime === MimeType.GOOGLE_SLIDES) {
        const pres = SlidesApp.openById(fileId);
        let text = '';
        pres.getSlides().forEach(function(slide) {
          slide.getShapes().forEach(function(shape) {
            try {
              const t = shape.getText ? shape.getText().asString() : '';
              if (t.trim()) text += t + '\n';
            } catch (e) { /* shape has no text */ }
          });
        });
        return text.substring(0, 12000) || null;
      }

      // Google Sheets — read first sheet as TSV
      if (mime === MimeType.GOOGLE_SHEETS) {
        const ss = SpreadsheetApp.openById(fileId);
        const sheet = ss.getSheets()[0];
        const values = sheet.getDataRange().getValues();
        const text = values.map(row => row.join('\t')).join('\n');
        return text.substring(0, 8000) || null;
      }

      // Plain text files
      if (mime === MimeType.PLAIN_TEXT) {
        return file.getBlob().getDataAsString().substring(0, 12000) || null;
      }

      // PDF and other binary types — not parseable natively in GAS
      return null;
    } catch (e) {
      console.error('_readDriveContent failed for ' + fileId + ': ' + e.message);
      return null;
    }
  },

  /** Save only analysis columns; preserve concurrent visibility, ordering and meeting edits. */
  _saveAnalysis: function(sheet, rowNumber, row) {
    sheet.getRange(rowNumber, 2, 1, 9).setValues([row.slice(1, 10)]);
    SpreadsheetApp.flush();
  },

  /** Discover source files without spending AI calls before they are registered. */
  _registerResearchFolder: function(session, sheet, deadline) {
    if (!session.folderUrl) return false;
    const folder = DriveApp.getFolderById(this._extractId(session.folderUrl));
    const research = folder.getFoldersByName('01_Research');
    if (!research.hasNext()) return false;
    const existing = new Set(sheet.getDataRange().getValues().slice(1).map(row => String(row[0]).trim()));
    const files = research.next().getFiles();
    while (files.hasNext()) {
      if (Date.now() >= deadline) return true;
      const file = files.next();
      const mime = file.getMimeType();
      if (mime !== MimeType.GOOGLE_DOCS && mime !== MimeType.PLAIN_TEXT) continue;
      const url = file.getUrl();
      if (existing.has(url)) continue;
      // Discovered files remain internal until the facilitator chooses to publish them.
      sheet.appendRow([url, file.getName(), 'Document', '', '', '', '', '', '', '', '', '', '', 'No', 9999]);
      existing.add(url);
    }
    SpreadsheetApp.flush();
    return false;
  },

  _fetchContent: function(url) {
    try {
      const response = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        followRedirects: true,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (response.getResponseCode() !== 200) {
        return '[Could not fetch content. HTTP ' + response.getResponseCode() + ']';
      }
      return response.getContentText()
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .substring(0, 8000);
    } catch (e) {
      return '[Could not fetch URL: ' + e.message + ']';
    }
  },

  /**
   * Extracts a Google Drive file ID from a URL.
   * Handles /d/{id}/, ?id={id}, and open?id={id} patterns.
   */
  _extractDriveFileId: function(url) {
    var m = url.match(/\/d\/([a-zA-Z0-9_-]{25,})/);
    if (m) return m[1];
    m = url.match(/[?&]id=([a-zA-Z0-9_-]{25,})/);
    if (m) return m[1];
    return null;
  },

  _inferType: function(url) {
    const u = String(url).toLowerCase();
    if (u.includes('youtube.com') || u.includes('youtu.be') || u.includes('vimeo.com')) return 'Video';
    if (u.includes('docs.google.com')) return 'Google Doc';
    if (u.includes('podcast') || u.includes('spotify') || u.includes('anchor.fm')) return 'Podcast';
    if (u.includes('github.com')) return 'GitHub';
    return 'Article';
  },

  _extractId: function(url) {
    const match = String(url).match(/[-\w]{25,}/);
    return match ? match[0] : null;
  }

};

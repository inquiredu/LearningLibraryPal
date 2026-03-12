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
   * @returns {number} Count of resources processed
   */
  synthesizeAll: function(sessionId, force) {
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

    const rows = resourcesSheet.getDataRange().getValues();
    if (rows.length <= 1) return 0;

    let processedCount = 0;

    for (let i = 1; i < rows.length; i++) {
      const url = String(rows[i][0] || '').trim();
      if (!url) continue;

      // Skip already-synthesized rows (relevanceScore filled means done) — unless force=true
      if (!force && rows[i][3] && String(rows[i][3]).trim() !== '') continue;

      // Read the user-set resource type — this drives the Gemini prompt and special handling
      const resourceType = String(rows[i][2] || '').trim();

      // ── Meeting Links: logistics only, no content to analyze ────────────────
      if (resourceType === 'Meeting Link') {
        if (!rows[i][1]) rows[i][1] = 'Meeting / Session Link';
        rows[i][3] = 1;          // relevanceScore
        rows[i][4] = 'Accessible'; // engagementLevel
        rows[i][7] = 'No';         // notebookLMReady
        rows[i][9] = 'Session logistics link — no content to analyze.';
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

        processedCount++;
        Utilities.sleep(500);
      } catch (e) {
        console.error('Failed to process row ' + (i + 1) + ': ' + e.message);
        rows[i][8] = 'Error: ' + e.message;
      }
    }

    // Batch write all updates to the Resources sheet
    if (rows.length > 1) {
      resourcesSheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
    }

    // Also scan the 01_Research folder for any Docs/text files not yet in the DB
    const folderCount = this._processResearchFolder(session, resourcesSheet, sessionContext);
    processedCount += folderCount;

    // ── Post-synthesis: enrich inquiry questions from actual resource content ──
    // Only runs when at least one resource was processed this cycle.
    // Reads the in-memory rows (already written to sheet) to build a digest of
    // resource titles, key concept tags, and summaries, then asks Gemini to
    // rewrite the inquiry questions grounded in the specific materials curated.
    if (processedCount > 0) {
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

    return processedCount;
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

  /**
   * Processes Google Docs and text files found directly in 01_Research
   * (not yet registered in the Project DB via the resources form).
   */
  _processResearchFolder: function(session, resourcesSheet, sessionContext) {
    if (!session.folderUrl) return 0;
    let count = 0;
    try {
      const folderId = this._extractId(session.folderUrl);
      const sessionFolder = DriveApp.getFolderById(folderId);
      const researchIter = sessionFolder.getFoldersByName('01_Research');
      if (!researchIter.hasNext()) return 0;
      const researchFolder = researchIter.next();

      // Build set of URLs already in the sheet (to avoid dupes)
      const allRows = resourcesSheet.getDataRange().getValues();
      const existingUrls = new Set(allRows.slice(1).map(r => String(r[0]).trim()));

      const files = researchFolder.getFiles();
      const newRows = [];
      while (files.hasNext()) {
        const file = files.next();
        const mime = file.getMimeType();

        // Only process shortcut targets and native text files
        if (mime === MimeType.GOOGLE_APPS_SCRIPT) continue;

        let text = '';
        if (mime === MimeType.GOOGLE_DOCS) {
          text = DocumentApp.openById(file.getId()).getBody().getText();
        } else if (mime === MimeType.PLAIN_TEXT) {
          text = file.getBlob().getDataAsString();
        } else {
          continue;
        }

        if (!text.trim()) continue;
        const url = file.getUrl();
        if (existingUrls.has(url)) continue;

        try {
          const meta = GeminiService.analyzeResource(
            text.substring(0, 12000),
            session.theme,
            session.audience,
            sessionContext
          );
          newRows.push([
            url,
            meta.title || file.getName(),
            'Document',
            meta.relevanceScore || '',
            meta.engagementLevel || '',
            Array.isArray(meta.keyConceptTags) ? meta.keyConceptTags.join(', ') : '',
            meta.relevanceScore >= 4 ? 'Yes' : 'No',
            meta.notebookLMReady ? 'Yes' : 'No',
            meta.relevanceStatement || '',
            meta.summary || ''
          ]);
          existingUrls.add(url);
          count++;
          Utilities.sleep(500);
        } catch (e) {
          console.error('Failed to process file ' + file.getName() + ': ' + e.message);
        }
      }

      if (newRows.length > 0) {
        resourcesSheet.getRange(resourcesSheet.getLastRow() + 1, 1, newRows.length, 10).setValues(newRows);
      }
    } catch (e) {
      console.error('_processResearchFolder failed: ' + e.message);
    }
    return count;
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

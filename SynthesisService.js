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
   * @returns {number} Count of resources processed
   */
  synthesizeAll: function(sessionId) {
    const session = SessionService.getSession(sessionId);
    if (!session) throw new Error('Session not found: ' + sessionId);
    if (!session.dbUrl) throw new Error('No Project Database URL for session: ' + sessionId);

    // Build session context for Gemini — grounded in the brief generated in Phase 1
    const brief = session.brief || {};
    const sessionContext = {
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

      // Skip already-synthesized rows (relevanceScore filled means done)
      if (rows[i][3] && String(rows[i][3]).trim() !== '') continue;

      try {
        // Try to read native Drive content first; fall back to URL fetch
        const fileId = this._extractDriveFileId(url);
        let content = null;
        if (fileId) {
          content = this._readDriveContent(fileId);
        }
        if (!content) {
          content = this._fetchContent(url);
        }

        const meta = GeminiService.analyzeResource(
          content,
          session.theme,
          session.audience,
          sessionContext
        );

        resourcesSheet.getRange(i + 1, 2).setValue(meta.title || '');
        resourcesSheet.getRange(i + 1, 3).setValue(this._inferType(url));
        resourcesSheet.getRange(i + 1, 4).setValue(meta.relevanceScore || '');
        resourcesSheet.getRange(i + 1, 5).setValue(meta.engagementLevel || '');
        resourcesSheet.getRange(i + 1, 6).setValue(
          Array.isArray(meta.keyConceptTags) ? meta.keyConceptTags.join(', ') : ''
        );
        resourcesSheet.getRange(i + 1, 7).setValue(meta.relevanceScore >= 4 ? 'Yes' : 'No');
        resourcesSheet.getRange(i + 1, 8).setValue(meta.notebookLMReady ? 'Yes' : 'No');
        resourcesSheet.getRange(i + 1, 9).setValue(meta.relevanceStatement || '');
        resourcesSheet.getRange(i + 1, 10).setValue(meta.summary || '');

        processedCount++;
        Utilities.sleep(500);
      } catch (e) {
        console.error('Failed to process row ' + (i + 1) + ': ' + e.message);
        resourcesSheet.getRange(i + 1, 9).setValue('Error: ' + e.message);
      }
    }

    // Also scan the 01_Research folder for any Docs/text files not yet in the DB
    const folderCount = this._processResearchFolder(session, resourcesSheet, sessionContext);
    processedCount += folderCount;

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
          summary:           row[9] || ''
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
          resourcesSheet.appendRow([
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

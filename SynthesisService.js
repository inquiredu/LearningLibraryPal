/**
 * SynthesisService
 * Phase 2: Processes resources from the session's 01_Research folder
 * and the Project Database. Enriches each resource with Gemini-generated metadata.
 */

const SynthesisService = {

  /**
   * Main entry point. Synthesizes all resources for a session.
   * Reads URLs from the Project DB, fetches content, analyzes with Gemini,
   * writes enriched metadata back.
   * @param {string} sessionId
   * @returns {number} Count of resources processed
   */
  synthesizeAll: function(sessionId) {
    const session = SessionService.getSession(sessionId);
    if (!session) throw new Error('Session not found: ' + sessionId);
    if (!session.dbUrl) throw new Error('No Project Database URL for session: ' + sessionId);

    const dbId = this._extractId(session.dbUrl);
    const db = SpreadsheetApp.openById(dbId);
    const resourcesSheet = db.getSheetByName('Resources');
    if (!resourcesSheet) throw new Error('No Resources sheet found in Project DB.');

    const rows = resourcesSheet.getDataRange().getValues();
    if (rows.length <= 1) return 0;

    let processedCount = 0;

    for (let i = 1; i < rows.length; i++) {
      const url = rows[i][0];
      if (!url || String(url).trim() === '') continue;

      // Skip already-synthesized rows (Relevance Score filled)
      if (rows[i][3] && String(rows[i][3]).trim() !== '') continue;

      try {
        const content = this._fetchContent(url);
        const meta = GeminiService.analyzeResource(content, session.theme, session.audience);

        resourcesSheet.getRange(i + 1, 2).setValue(meta.title || '');
        resourcesSheet.getRange(i + 1, 3).setValue(this._inferType(url));
        resourcesSheet.getRange(i + 1, 4).setValue(meta.relevanceScore || '');
        resourcesSheet.getRange(i + 1, 5).setValue(meta.engagementLevel || '');
        resourcesSheet.getRange(i + 1, 6).setValue(Array.isArray(meta.keyConceptTags) ? meta.keyConceptTags.join(', ') : '');
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

    const folderCount = this._processResearchFolder(session, resourcesSheet);
    processedCount += folderCount;

    return processedCount;
  },

  /**
   * Gets all synthesized resources for a session as plain objects.
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

  _processResearchFolder: function(session, resourcesSheet) {
    if (!session.folderUrl) return 0;
    let count = 0;
    try {
      const folderId = this._extractId(session.folderUrl);
      const sessionFolder = DriveApp.getFolderById(folderId);
      const researchIter = sessionFolder.getFoldersByName('01_Research');
      if (!researchIter.hasNext()) return 0;
      const researchFolder = researchIter.next();

      const files = researchFolder.getFiles();
      while (files.hasNext()) {
        const file = files.next();
        const mimeType = file.getMimeType();
        let text = '';

        if (mimeType === MimeType.GOOGLE_DOCS) {
          text = DocumentApp.openById(file.getId()).getBody().getText();
        } else if (mimeType === MimeType.PLAIN_TEXT) {
          text = file.getBlob().getDataAsString();
        } else {
          continue;
        }

        if (!text.trim()) continue;

        try {
          const meta = GeminiService.analyzeResource(text, session.theme, session.audience);
          resourcesSheet.appendRow([
            file.getUrl(),
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

/**
 * ResourceService
 * Handles adding source materials to a session:
 * - Writes resource metadata to the Project DB
 * - Creates Drive shortcuts in the 01_Research folder (non-destructive — files stay in place)
 */

const ResourceService = {

  RESOURCE_TYPES: [
    'Reading',
    'Video',
    'Slide Deck',
    'Facilitator Guide',
    'Planning Doc',
    'Meeting Link',
    'Web Resource',
    'Audio / Podcast',
    'Other'
  ],

  /**
   * Adds an array of resource objects to a session.
   * Drive files get a shortcut created in 01_Research.
   * All resources are written to the Project DB.
   *
   * @param {string} sessionId
   * @param {Object[]} resources - Each resource: { fileId?, url, name, type, mimeType? }
   * @returns {{ added: number, shortcuts: number, errors: string[] }}
   */
  addResources: function(sessionId, resources) {
    const session = SessionService.getSession(sessionId);
    if (!session) throw new Error('Session not found: ' + sessionId);
    if (!session.dbUrl) throw new Error('No Project Database for session.');

    const dbId = this._extractId(session.dbUrl);
    const db = SpreadsheetApp.openById(dbId);
    const sheet = db.getSheetByName('Resources');
    if (!sheet) throw new Error('Resources sheet not found in Project DB.');

    // Get existing URLs to avoid dupes
    const existing = this._getExistingUrls(sheet);

    const researchFolderId = this._getResearchFolderId(session);
    let added = 0;
    let shortcuts = 0;
    const errors = [];
    const newRows = [];

    resources.forEach(function(r) {
      try {
        // Build the canonical URL
        const url = r.url ||
          (r.fileId ? 'https://drive.google.com/open?id=' + r.fileId : '');
        if (!url) return;

        // Skip dupes
        if (existing.has(url)) return;

        // Build row data (15-col schema: A-J = content, K-M = meeting metadata, N-O = visibility/order)
        const rType    = r.type || 'Resource';
        const internal = (rType === 'Planning Doc' || rType === 'Facilitator Guide');
        newRows.push([
          url,
          r.name || 'Untitled',
          rType,
          '', // relevanceScore (filled by synthesis)
          '', // engagementLevel
          '', // keyTags
          '', // preReading
          '', // notebookLMReady
          '', // relevanceStatement
          '', // summary
          r.isMain     ? 'Yes' : '', // K: isMain
          r.startTime  || '',        // L: startTime (ISO string)
          r.endTime    || '',        // M: endTime   (ISO string)
          internal     ? 'No' : 'Yes', // N: isPublic
          ''                           // O: sortOrder (blank until facilitator sets order)
        ]);
        existing.add(url);
        added++;

        // Create shortcut in 01_Research for Drive files
        if (r.fileId && researchFolderId) {
          const ok = this._createShortcut(r.fileId, r.name || 'Untitled', researchFolderId);
          if (ok) shortcuts++;
        }
      } catch (e) {
        errors.push((r.name || r.url || 'unknown') + ': ' + e.message);
      }
    }, this);

    // Batch write to sheet
    if (newRows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, 15).setValues(newRows);
    }

    return { added: added, shortcuts: shortcuts, errors: errors };
  },

  // ─── Helpers ────────────────────────────────────────────────────────────────

  _getResearchFolderId: function(session) {
    if (!session.folderUrl) return null;
    try {
      const folderId = this._extractId(session.folderUrl);
      const sessionFolder = DriveApp.getFolderById(folderId);
      const iter = sessionFolder.getFoldersByName('01_Research');
      return iter.hasNext() ? iter.next().getId() : null;
    } catch (e) {
      console.error('_getResearchFolderId failed: ' + e.message);
      return null;
    }
  },

  /**
   * Creates a Drive shortcut inside a folder pointing to the original file.
   * The original file is NOT moved.
   * @returns {boolean} success
   */
  _createShortcut: function(fileId, fileName, parentFolderId) {
    try {
      const resp = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
        payload: JSON.stringify({
          name: fileName,
          mimeType: 'application/vnd.google-apps.shortcut',
          shortcutDetails: { targetId: fileId },
          parents: [parentFolderId]
        }),
        muteHttpExceptions: true
      });
      const code = resp.getResponseCode();
      if (code !== 200 && code !== 201) {
        console.error('Shortcut API returned ' + code + ': ' + resp.getContentText());
        return false;
      }
      return true;
    } catch (e) {
      console.error('_createShortcut failed for ' + fileName + ': ' + e.message);
      return false;
    }
  },

  _getExistingUrls: function(sheet) {
    const set = new Set();
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) set.add(String(data[i][0]).trim());
    }
    return set;
  },

  /**
   * Removes a single resource row from the Project DB by its URL.
   * @param {string} sessionId
   * @param {string} url - The resource URL (col A value) to delete
   * @returns {{ ok: boolean }}
   */
  removeResource: function(sessionId, url) {
    const session = SessionService.getSession(sessionId);
    if (!session) throw new Error('Session not found: ' + sessionId);
    const dbId = this._extractId(session.dbUrl);
    const sheet = SpreadsheetApp.openById(dbId).getSheetByName('Resources');
    if (!sheet) throw new Error('Resources sheet not found.');

    const data = sheet.getDataRange().getValues();
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][0]).trim() === String(url).trim()) {
        sheet.deleteRow(i + 1); // sheet rows are 1-indexed
        return { ok: true };
      }
    }
    return { ok: false, message: 'URL not found in Resources sheet.' };
  },

  /**
   * Batch-updates isPublic (col N) and sortOrder (col O) for a set of resources.
   * @param {string} sessionId
   * @param {{ url: string, isPublic: string, sortOrder: number }[]} updates
   * @returns {{ updated: number }}
   */
  updateResourceSettings: function(sessionId, updates) {
    const session = SessionService.getSession(sessionId);
    if (!session) throw new Error('Session not found: ' + sessionId);
    const dbId = this._extractId(session.dbUrl);
    const sheet = SpreadsheetApp.openById(dbId).getSheetByName('Resources');
    if (!sheet) throw new Error('Resources sheet not found.');

    const data   = sheet.getDataRange().getValues();
    const urlMap = {}; // url → row index (1-based)
    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) urlMap[String(data[i][0]).trim()] = i + 1;
    }

    let updated = 0;
    updates.forEach(function(u) {
      const rowNum = urlMap[String(u.url).trim()];
      if (!rowNum) return;
      sheet.getRange(rowNum, 14).setValue(u.isPublic || 'Yes'); // col N
      sheet.getRange(rowNum, 15).setValue(u.sortOrder || '');   // col O
      updated++;
    });

    return { updated: updated };
  },

  _extractId: function(url) {
    const match = String(url).match(/[-\w]{25,}/);
    return match ? match[0] : null;
  }

};

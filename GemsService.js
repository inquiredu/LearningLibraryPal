/**
 * GemsService
 * Phase 3: Generates 4 AI Gem prompt structures for the session.
 * Gems are stored as JSON in the session row and in 03_Gems/gems.json.
 */

const GemsService = {

  /**
   * Generates Gems for a session and persists them.
   * @param {string} sessionId
   * @returns {Object[]} Array of 4 Gem objects
   */
  generateGems: function(sessionId) {
    const session = SessionService.getSession(sessionId);
    if (!session) throw new Error('Session not found: ' + sessionId);

    const brief = session.brief;
    if (!brief) throw new Error('No session brief found. Run the Wizard first.');

    const objectives = brief.learningObjectives || [];
    const inquiryQuestions = brief.inquiryQuestions || [];

    // Call Gemini
    const result = GeminiService.generateGemsPrompts(
      session.theme,
      objectives,
      inquiryQuestions
    );

    const gems = result.gems || [];

    // Persist to session row
    SessionService.updateSession(sessionId, {
      GEMS_JSON: JSON.stringify(gems),
      STATUS: 'Gems Ready'
    });

    // Persist gems.json file to 03_Gems folder in Drive
    this._saveGemsFile(session, gems);

    return gems;
  },

  /**
   * Returns the gems for a session (from stored JSON).
   */
  getGems: function(sessionId) {
    const session = SessionService.getSession(sessionId);
    if (!session || !session.gems) return [];
    return Array.isArray(session.gems) ? session.gems : [];
  },

  // ─── Private ────────────────────────────────────────────────────────────────

  _saveGemsFile: function(session, gems) {
    if (!session.folderUrl) return;
    try {
      const folderId = this._extractId(session.folderUrl);
      const sessionFolder = DriveApp.getFolderById(folderId);
      const gemsIter = sessionFolder.getFoldersByName('03_Gems');
      if (!gemsIter.hasNext()) return;
      const gemsFolder = gemsIter.next();

      // Delete old gems.json if it exists
      const existing = gemsFolder.getFilesByName('gems.json');
      while (existing.hasNext()) existing.next().setTrashed(true);

      // Create new file
      const blob = Utilities.newBlob(JSON.stringify(gems, null, 2), 'application/json', 'gems.json');
      gemsFolder.createFile(blob);
    } catch (e) {
      console.error('_saveGemsFile failed: ' + e.message);
    }
  },

  _extractId: function(url) {
    const match = String(url).match(/[-\w]{25,}/);
    return match ? match[0] : null;
  }

};

/**
 * GemsService
 * Phase 3: Generates Gem instruction sets for the session.
 * Each Gem is a ready-to-paste system instruction for Google AI Studio,
 * personalized to the session name, theme, brief, and synthesized resources.
 * Facilitators create Gems manually in AI Studio then paste the links back
 * via the dashboard "Set Gem Links" action.
 */

const GemsService = {

  /**
   * Generates 4 Gem instruction sets for a session.
   * Requires synthesis to have run first (resources used for context).
   * @param {string} sessionId
   * @returns {Object[]} Array of 4 Gem objects
   */
  generateGems: function(sessionId) {
    const session = SessionService.getSession(sessionId);
    if (!session) throw new Error('Session not found: ' + sessionId);

    const brief = session.brief;
    if (!brief) throw new Error('No session brief found. Run the Wizard first.');

    // Use synthesized resources as context for richer instruction sets
    const resources = SynthesisService.getResources(sessionId).slice(0, 6);

    // Generate instruction sets via Gemini
    const gems = GeminiService.generateGemInstructions(session.name, brief, resources);
    if (!Array.isArray(gems) || !gems.length) {
      throw new Error('Gemini did not return valid Gem instructions.');
    }

    // Ensure each gem has a null link (will be filled by facilitator later)
    gems.forEach(function(g) { g.link = g.link || null; });

    // Persist to session row
    SessionService.updateSession(sessionId, {
      GEMS_JSON: JSON.stringify(gems),
      STATUS: 'Gems Ready'
    });

    // Save a human-readable instruction file per Gem to 03_Gems/
    this._saveGemFiles(session, gems);

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

  /**
   * Updates the shareable link for one or more Gems.
   * gemLinks: { "session-primer": "https://...", "critical-lens": "https://..." }
   */
  updateGemLinks: function(sessionId, gemLinks) {
    const session = SessionService.getSession(sessionId);
    if (!session) throw new Error('Session not found: ' + sessionId);

    const gems = Array.isArray(session.gems) ? session.gems : [];
    if (!gems.length) throw new Error('No gems found. Generate gems first.');

    Object.keys(gemLinks).forEach(function(gemId) {
      const gem = gems.find(function(g) { return g.id === gemId; });
      if (gem) gem.link = gemLinks[gemId] || null;
    });

    SessionService.updateSession(sessionId, { GEMS_JSON: JSON.stringify(gems) });
    return gems;
  },

  // ─── Private ────────────────────────────────────────────────────────────────

  /**
   * Saves a human-readable .txt instruction file for each Gem to 03_Gems/.
   * Facilitators can open these directly from Drive to copy-paste into AI Studio.
   */
  _saveGemFiles: function(session, gems) {
    if (!session.folderUrl) return;
    try {
      const folderId = this._extractId(session.folderUrl);
      const sessionFolder = DriveApp.getFolderById(folderId);
      const gemsIter = sessionFolder.getFoldersByName('03_Gems');
      if (!gemsIter.hasNext()) return;
      const gemsFolder = gemsIter.next();

      // Remove old gem files
      const oldFiles = gemsFolder.getFiles();
      while (oldFiles.hasNext()) { oldFiles.next().setTrashed(true); }

      // Write one .txt file per Gem
      gems.forEach(function(gem) {
        const setupText = (gem.setupSteps || [])
          .map(function(s, i) { return (i + 1) + '. ' + s; })
          .join('\n');
        const startersText = (gem.starterQueries || [])
          .map(function(q) { return '  • ' + q; })
          .join('\n');

        const content = [
          '═══════════════════════════════════════════════════════════════',
          gem.name + (gem.emoji ? ' ' + gem.emoji : ''),
          '═══════════════════════════════════════════════════════════════',
          '',
          'PERSONA',
          gem.persona || '',
          '',
          '──────────────────────────────────────────────────────────────',
          'SYSTEM INSTRUCTION (paste into Google AI Studio → Instructions)',
          '──────────────────────────────────────────────────────────────',
          gem.systemInstruction || '',
          '',
          '──────────────────────────────────────────────────────────────',
          'SETUP STEPS',
          '──────────────────────────────────────────────────────────────',
          setupText,
          '',
          '──────────────────────────────────────────────────────────────',
          'CONVERSATION STARTERS',
          '──────────────────────────────────────────────────────────────',
          startersText
        ].join('\n');

        const filename = 'gem-' + (gem.id || gem.name.toLowerCase().replace(/\s+/g, '-')) + '.txt';
        const blob = Utilities.newBlob(content, MimeType.PLAIN_TEXT, filename);
        gemsFolder.createFile(blob);
      });

      // Also save full gems.json for programmatic use
      const jsonBlob = Utilities.newBlob(
        JSON.stringify(gems, null, 2),
        'application/json',
        'gems.json'
      );
      gemsFolder.createFile(jsonBlob);
    } catch (e) {
      console.error('_saveGemFiles failed: ' + e.message);
    }
  },

  _extractId: function(url) {
    const match = String(url).match(/[-\w]{25,}/);
    return match ? match[0] : null;
  }

};

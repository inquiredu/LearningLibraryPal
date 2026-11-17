/**
 * GemsService
 * Phase 3: AI skills for the session. (The name stays for compatibility: the
 * dashboard, menu and library page call these methods.)
 *
 * Skills replace Gemini Gems. Each is a platform-neutral instruction pack:
 * instructions, starter prompts and the session materials to attach, saved as a
 * SKILL.md file that works as a Claude skill and pastes into Gemini, ChatGPT or
 * any other assistant. See Skills.js. A session with live capture gets skills
 * written for its activity (the template's `skills`); others get the four
 * library companions.
 */

const GemsService = {

  /**
   * Writes the session's skills, stores them in the Gems JSON column and saves
   * one SKILL.md per skill to the session's skills folder.
   * @param {string} sessionId
   * @returns {Object[]} skills
   */
  generateGems: function(sessionId) {
    const session = SessionService.getSession(sessionId);
    if (!session) throw new Error('Session not found: ' + sessionId);
    const brief = session.brief;
    if (!brief) throw new Error('No session brief found. Run the Wizard first.');

    const resources = SynthesisService.getResources(sessionId).filter(r => r.isPublic !== false).slice(0, 8);
    const template = this._activityTemplate(sessionId);
    const roles = skillsRoles_(template);
    const raw = GeminiService.generateSkills(session.name, brief, resources, roles, template ? template.activity : '');
    const skills = skillsFromGenerated_(roles, raw, resources.map(r => r.title).filter(Boolean));
    if (!skills.length) throw new Error('Gemini did not return usable skills. Try again.');

    // Keep any shared links a facilitator already set for skills with the same id.
    const previous = this.getGems(sessionId);
    skills.forEach(s => {
      const old = previous.find(p => p.id === s.id);
      s.link = old && old.link ? old.link : null;
    });

    SessionService.updateSession(sessionId, { GEMS_JSON: JSON.stringify(skills), STATUS: 'Skills Ready' });
    this._saveSkillFiles(session, skills);
    return skills;
  },

  /** The session's skills, with old Gems read as skills. */
  getGems: function(sessionId) {
    const session = SessionService.getSession(sessionId);
    if (!session || !Array.isArray(session.gems)) return [];
    return session.gems.map(skillsNormalize_).filter(Boolean);
  },

  /**
   * Sets an optional shared link per skill (a shared Claude project, Gemini
   * Gem, ChatGPT project or any https link). gemLinks: { "skill-id": "https://..." }
   */
  updateGemLinks: function(sessionId, gemLinks) {
    const skills = this.getGems(sessionId);
    if (!skills.length) throw new Error('No skills yet. Generate skills first.');
    Object.keys(gemLinks || {}).forEach(id => {
      const skill = skills.find(s => s.id === id);
      const link = String(gemLinks[id] || '').trim();
      if (skill) skill.link = /^https:\/\//.test(link) ? link : null;
    });
    SessionService.updateSession(sessionId, { GEMS_JSON: JSON.stringify(skills) });
    return skills;
  },

  // ─── Private ────────────────────────────────────────────────────────────────

  _activityTemplate: function(sessionId) {
    try {
      const config = CaptureStore.getConfig(sessionId);
      return config ? captureTemplate_(config.template) : null;
    } catch (e) {
      return null;
    }
  },

  /** One SKILL.md per skill, plus skills.json, in 03_Skills (or an older session's 03_Gems). */
  _saveSkillFiles: function(session, skills) {
    if (!session.folderUrl) return;
    try {
      const sessionFolder = DriveApp.getFolderById(this._extractId(session.folderUrl));
      let folder = null;
      ['03_Skills', '03_Gems'].some(name => {
        const it = sessionFolder.getFoldersByName(name);
        if (it.hasNext()) { folder = it.next(); return true; }
        return false;
      });
      if (!folder) folder = sessionFolder.createFolder('03_Skills');
      const old = folder.getFiles();
      while (old.hasNext()) old.next().setTrashed(true);
      skills.forEach(skill => {
        folder.createFile(Utilities.newBlob(skillsToMarkdown_(skill, session.name), 'text/markdown', skill.id + '.SKILL.md'));
      });
      folder.createFile(Utilities.newBlob(JSON.stringify(skills, null, 2), 'application/json', 'skills.json'));
    } catch (e) {
      console.error('_saveSkillFiles failed: ' + e.message);
    }
  },

  _extractId: function(url) {
    const match = String(url).match(/[-\w]{25,}/);
    return match ? match[0] : null;
  }

};

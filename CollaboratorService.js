/**
 * CollaboratorService
 * Manages co-facilitator access to a session's Drive folder.
 *
 * When a collaborator is added as an Editor to the session folder, Google Drive
 * propagates access to all subfolders and files within it — including the
 * Project Database in 00_Admin, research materials in 01_Research, etc.
 *
 * No additional column is needed in the Sessions sheet; Drive is the source of
 * truth for who has access. Use getEditors() to retrieve the live list.
 */

const CollaboratorService = {

  /**
   * Adds collaborators as Editors to the session's Drive folder.
   * @param {string} sessionId
   * @param {string[]} emails - Array of email addresses to add
   * @returns {{ added: number, errors: string[] }}
   */
  addEditors: function(sessionId, emails) {
    const session = SessionService.getSession(sessionId);
    if (!session) throw new Error('Session not found: ' + sessionId);
    if (!session.folderUrl) throw new Error('No Drive folder found for this session.');

    const folderId = this._extractId(session.folderUrl);
    if (!folderId) throw new Error('Could not determine session folder ID.');

    const folder = DriveApp.getFolderById(folderId);
    const added = [];
    const errors = [];

    emails.forEach(function(email) {
      email = String(email).trim().toLowerCase();
      if (!email || !email.includes('@')) return;
      try {
        folder.addEditor(email);
        added.push(email);
      } catch (e) {
        errors.push(email + ': ' + e.message);
      }
    });

    return { added: added.length, errors: errors };
  },

  /**
   * Returns the list of Editor collaborators for a session folder.
   * Excludes the script's active user (the owner/deployer).
   * @param {string} sessionId
   * @returns {{ email: string, name: string }[]}
   */
  getEditors: function(sessionId) {
    const session = SessionService.getSession(sessionId);
    if (!session || !session.folderUrl) return [];

    const folderId = this._extractId(session.folderUrl);
    if (!folderId) return [];

    try {
      const folder = DriveApp.getFolderById(folderId);
      const me = Session.getActiveUser().getEmail();
      return folder.getEditors()
        .map(function(u) {
          return { email: u.getEmail(), name: u.getName() || u.getEmail() };
        })
        .filter(function(u) { return u.email && u.email !== me; });
    } catch (e) {
      console.error('CollaboratorService.getEditors failed: ' + e.message);
      return [];
    }
  },

  /**
   * Removes a collaborator's Editor access from the session folder.
   * @param {string} sessionId
   * @param {string} email
   * @returns {{ ok: boolean }}
   */
  removeEditor: function(sessionId, email) {
    const session = SessionService.getSession(sessionId);
    if (!session || !session.folderUrl) throw new Error('Session or folder not found.');

    const folderId = this._extractId(session.folderUrl);
    if (!folderId) throw new Error('Could not determine session folder ID.');

    DriveApp.getFolderById(folderId).removeEditor(email);
    return { ok: true };
  },

  // ─── Helper ────────────────────────────────────────────────────────────────

  _extractId: function(url) {
    const m = String(url || '').match(/[-\w]{25,}/);
    return m ? m[0] : null;
  }

};

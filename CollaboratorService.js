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

    // Send notification email to each newly added collaborator
    if (added.length > 0) {
      var dashboardUrl = '';
      try { dashboardUrl = PropertiesService.getScriptProperties().getProperty('WEB_APP_URL') || ''; } catch(e2) {}
      var self = this;
      added.forEach(function(email) {
        try {
          GmailApp.sendEmail(
            email,
            'You\'ve been added as a collaborator — ' + (session.name || 'Mngaia Session'),
            '',
            { htmlBody: self._buildNotificationEmail(session, dashboardUrl) }
          );
        } catch(e2) {
          console.warn('Collaborator notification failed for ' + email + ': ' + e2.message);
        }
      });
    }

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

  // ─── Helpers ───────────────────────────────────────────────────────────────

  _extractId: function(url) {
    const m = String(url || '').match(/[-\w]{25,}/);
    return m ? m[0] : null;
  },

  /**
   * Builds a branded HTML notification email for a newly added collaborator.
   */
  _buildNotificationEmail: function(session, dashboardUrl) {
    const navy    = '#0B2B46';
    const cyan    = '#5DCDF5';
    const dashBtn = dashboardUrl
      ? '<p style="margin:20px 0;"><a href="' + dashboardUrl + '" style="background:' + cyan + ';color:' + navy + ';padding:11px 26px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">Open Facilitator Dashboard →</a></p>'
      : '';
    const folderLink = session.folderUrl
      ? '<p style="font-size:14px;margin:8px 0 4px;">📁 <a href="' + session.folderUrl + '" style="color:' + navy + ';font-weight:600;">Session Drive Folder</a> — research files, drafts, Gems, and Project Database.</p>'
      : '';
    return '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>' +
      '<body style="margin:0;padding:0;background:#f5f7fa;font-family:\'Open Sans\',Arial,sans-serif;">' +
        '<div style="max-width:560px;margin:24px auto;background:#fff;border-radius:8px;overflow:hidden;">' +
          '<div style="background:' + navy + ';padding:24px 28px;">' +
            '<p style="color:' + cyan + ';font-size:11px;letter-spacing:2px;text-transform:uppercase;margin:0 0 5px;">Mngaia Learning Community</p>' +
            '<h1 style="color:#fff;font-size:20px;margin:0;">' + (session.name || 'Upcoming Session') + '</h1>' +
          '</div>' +
          '<div style="padding:24px 28px;color:#2d2d2d;font-size:15px;line-height:1.7;">' +
            '<p>You\'ve been added as a <strong>co-facilitator</strong> for this session. You now have Editor access to all session materials in Google Drive.</p>' +
            dashBtn +
            folderLink +
            '<p style="margin-top:16px;font-size:13px;color:#888;">From the dashboard you can add resources, run AI synthesis, review Gems, manage participants, and preview the Learning Library.</p>' +
          '</div>' +
          '<div style="background:#f5f7fa;padding:16px 28px;border-top:1px solid #e0e6ed;">' +
            '<p style="color:#8a9bae;font-size:12px;margin:0;">Mngaia Learning Community &nbsp;·&nbsp; ' + (session.date || '') + '</p>' +
          '</div>' +
        '</div>' +
      '</body></html>';
  }

};

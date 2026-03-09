/**
 * ParticipantService
 * CRUD for the Participants sheet in each session's Project Database.
 *
 * Participants sheet columns (0-based):
 *   0 — Email
 *   1 — Name
 *   2 — Registered At
 */

const ParticipantService = {

  /**
   * Returns all participants for a session.
   * @param {string} sessionId
   * @returns {{ email: string, name: string, registeredAt: string }[]}
   */
  getParticipants: function(sessionId) {
    const sheet = this._getSheet(sessionId);
    if (!sheet) return [];
    const rows = sheet.getDataRange().getValues();
    if (rows.length <= 1) return [];
    return rows.slice(1)
      .filter(row => row[0] && String(row[0]).trim())
      .map(row => ({
        email:        String(row[0]).trim().toLowerCase(),
        name:         String(row[1] || '').trim(),
        registeredAt: String(row[2] || '')
      }));
  },

  /**
   * Adds participants to a session, deduplicating by email.
   * @param {string} sessionId
   * @param {{ name: string, email: string }[]} participants
   * @returns {{ added: number, skipped: number }}
   */
  addParticipants: function(sessionId, participants) {
    const sheet = this._getSheet(sessionId);
    if (!sheet) throw new Error('Could not access Participants sheet for session: ' + sessionId);

    const existing = this.getParticipants(sessionId);
    const existingEmails = new Set(existing.map(p => p.email));
    let added = 0;
    let skipped = 0;
    const now = new Date().toISOString();
    const newRows = [];

    participants.forEach(function(p) {
      const email = String(p.email || '').trim().toLowerCase();
      if (!email || !email.includes('@')) { skipped++; return; }
      if (existingEmails.has(email)) { skipped++; return; }
      newRows.push([email, String(p.name || '').trim(), now]);
      existingEmails.add(email);
      added++;
    });

    if (newRows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, 3).setValues(newRows);
    }

    return { added: added, skipped: skipped };
  },

  /**
   * Removes a participant by email (idempotent — safe to call if already removed).
   * @param {string} sessionId
   * @param {string} email
   * @returns {{ ok: boolean }}
   */
  removeParticipant: function(sessionId, email) {
    const sheet = this._getSheet(sessionId);
    if (!sheet) throw new Error('Could not access Participants sheet.');

    email = String(email || '').trim().toLowerCase();
    const rows = sheet.getDataRange().getValues();
    // Iterate bottom-up so row deletion doesn't shift indices
    for (let i = rows.length - 1; i >= 1; i--) {
      if (String(rows[i][0]).trim().toLowerCase() === email) {
        sheet.deleteRow(i + 1);
        return { ok: true };
      }
    }
    return { ok: true }; // Already absent — treat as success
  },

  // ─── Private ────────────────────────────────────────────────────────────────

  _getSheet: function(sessionId) {
    try {
      const session = SessionService.getSession(sessionId);
      if (!session || !session.dbUrl) return null;
      const m = String(session.dbUrl).match(/[-\w]{25,}/);
      if (!m) return null;
      const db = SpreadsheetApp.openById(m[0]);
      return db.getSheetByName('Participants');
    } catch (e) {
      console.error('ParticipantService._getSheet failed: ' + e.message);
      return null;
    }
  }

};

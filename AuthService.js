/** Server-only authorization. Never use the effective user as a visitor identity. */
const AuthService = {
  email: function() {
    return String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  },

  isOwner: function() {
    const email = this.email();
    if (!email) return false;
    const owner = PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL');
    if (owner) return email === owner.toLowerCase();
    // First setup must run from the bound Sheet under the installing account.
    return email === String(Session.getEffectiveUser().getEmail()).toLowerCase()
      && !!SpreadsheetApp.getActiveSpreadsheet();
  },

  isAuthorized: function() {
    try {
      const email = this.email();
      if (!email) return false;
      if (this.isOwner()) return true;
      if (CONFIG.ALLOWED_EMAILS.some(e => e.toLowerCase() === email)) return true;
      return !!CONFIG.ALLOWED_DOMAIN && email.endsWith('@' + CONFIG.ALLOWED_DOMAIN.toLowerCase());
    } catch (e) {
      return false;
    }
  },

  requireUser: function() {
    if (!this.isAuthorized()) throw new Error('Access denied. Sign in with an authorized facilitator account.');
  },

  requireOwner: function() {
    if (!this.isOwner()) throw new Error('Only the library owner can change setup. Open Initial Setup from the bound Sheet.');
  }
};

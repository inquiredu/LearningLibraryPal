/**
 * PermissionService
 * Verifies that session resources are accessible for public embedding in Google Sites.
 *
 * For iframes to render in Sites, Drive-hosted files (Slides, Docs, Drive video files)
 * must be set to "Anyone with the link can view" (ANYONE_WITH_LINK or ANYONE).
 * YouTube links are inherently public. External web links become styled link cards
 * (not iframes), so their accessibility isn't critical for embedding.
 *
 * Access states returned:
 *   'public'     — ANYONE or ANYONE_WITH_LINK share access; embed will work
 *   'restricted' — PRIVATE or DOMAIN only; iframe will be blocked
 *   'external'   — web URL (not Drive-hosted); rendered as link card, no iframe
 *   'youtube'    — YouTube link; always embeds fine
 *   'error'      — Could not check (no access to file metadata)
 *   'unknown'    — Drive URL pattern but no parseable file ID
 */

const PermissionService = {

  /**
   * Checks sharing access for all resources linked to a session.
   * @param {string} sessionId
   * @returns {{ name, url, embedType, access, fileId?, ok, error? }[]}
   */
  checkResources: function(sessionId) {
    const session = SessionService.getSession(sessionId);
    if (!session) throw new Error('Session not found: ' + sessionId);

    const resources = this._loadRawResources(sessionId, session);
    return resources.map(function(r) {
      return PermissionService._checkOne(r);
    });
  },

  /**
   * Sets sharing on Drive files to "Anyone with the link can view".
   * @param {string[]} fileIds
   * @returns {{ fixed: number, errors: string[] }}
   */
  fixPermissions: function(fileIds) {
    let fixed = 0;
    const errors = [];
    fileIds.forEach(function(fileId) {
      try {
        DriveApp.getFileById(fileId).setSharing(
          DriveApp.Access.ANYONE_WITH_LINK,
          DriveApp.Permission.VIEW
        );
        fixed++;
      } catch (e) {
        errors.push(fileId + ': ' + e.message);
      }
    });
    return { fixed: fixed, errors: errors };
  },

  // ─── Private ───────────────────────────────────────────────────────────────

  /**
   * Reads resources directly from the Project DB so we catch unsynthesized entries too.
   */
  _loadRawResources: function(sessionId, session) {
    if (!session.dbUrl) return [];
    try {
      const dbId = String(session.dbUrl).match(/[-\w]{25,}/);
      if (!dbId) return [];
      const db = SpreadsheetApp.openById(dbId[0]);
      const sheet = db.getSheetByName('Resources');
      if (!sheet) return [];
      const rows = sheet.getDataRange().getValues();
      return rows.slice(1)
        .filter(function(row) { return row[0] && String(row[0]).trim(); })
        .map(function(row) {
          return { url: String(row[0]).trim(), name: row[1] || String(row[0]).trim() };
        });
    } catch (e) {
      console.error('PermissionService._loadRawResources failed: ' + e.message);
      return [];
    }
  },

  _checkOne: function(resource) {
    const embedType = PermissionService._detectEmbedType(resource.url);
    const result = {
      name:      resource.name,
      url:       resource.url,
      embedType: embedType,
      ok:        null,
      access:    'unknown'
    };

    if (embedType === 'youtube') {
      result.access = 'youtube';
      result.ok = true;
      return result;
    }

    if (embedType === 'web') {
      result.access = 'external';
      result.ok = null; // external links are not embedded; access irrelevant
      return result;
    }

    // Drive-hosted content — check sharing level
    const fileId = PermissionService._extractFileId(resource.url);
    if (!fileId) {
      result.access = 'unknown';
      return result;
    }

    result.fileId = fileId;
    try {
      const file = DriveApp.getFileById(fileId);
      const sharing = file.getSharingAccess();
      const isPublic = (
        sharing === DriveApp.Access.ANYONE ||
        sharing === DriveApp.Access.ANYONE_WITH_LINK
      );
      result.access = isPublic ? 'public' : 'restricted';
      result.ok = isPublic;
    } catch (e) {
      result.access = 'error';
      result.error = e.message;
      result.ok = false;
    }

    return result;
  },

  _detectEmbedType: function(url) {
    if (!url) return 'web';
    if (/docs\.google\.com\/presentation\/d\//i.test(url)) return 'slides';
    if (/docs\.google\.com\/document\/d\//i.test(url))     return 'doc';
    if (/drive\.google\.com\/file\/d\//i.test(url))        return 'drive';
    if (/drive\.google\.com\/open\?id=/i.test(url))        return 'drive';
    if (/youtube\.com\/watch\?/i.test(url))                return 'youtube';
    if (/youtu\.be\//i.test(url))                          return 'youtube';
    return 'web';
  },

  _extractFileId: function(url) {
    var m = String(url || '').match(/\/d\/([a-zA-Z0-9_-]{25,})/);
    if (m) return m[1];
    m = String(url || '').match(/[?&]id=([a-zA-Z0-9_-]{25,})/);
    if (m) return m[1];
    return null;
  }

};

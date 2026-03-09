/**
 * WebApp.js
 * GAS Web App entry point and all server-side API handlers.
 * Routes: ?page=dashboard (default) | ?page=library&session=ID
 */

// ─── Routing ─────────────────────────────────────────────────────────────────

function doGet(e) {
  // Cache the live published URL on first request so openDashboard() (Sheets menu) can read it.
  // ScriptApp.getService().getUrl() from a menu trigger returns the dev URL; from doGet it's always /exec.
  try {
    var _liveUrl = ScriptApp.getService().getUrl();
    if (_liveUrl) {
      var _props = PropertiesService.getScriptProperties();
      if (!_props.getProperty('WEB_APP_URL')) _props.setProperty('WEB_APP_URL', _liveUrl);
    }
  } catch(_ex) { /* script not yet deployed */ }

  const page = e && e.parameter && e.parameter.page ? e.parameter.page : 'dashboard';

  if (page === 'diag') {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss ? ss.getSheetByName('Sessions') : null;
      const data = sheet ? sheet.getDataRange().getValues() : [];
      const info = {
        spreadsheetId:   ss ? ss.getId() : null,
        spreadsheetName: ss ? ss.getName() : null,
        sheets:          ss ? ss.getSheets().map(s => s.getName()) : [],
        sessionRowCount: Math.max(0, data.length - 1),
        firstFourRows:   data.slice(0, 4)
      };
      return HtmlService.createHtmlOutput('<pre style="font-family:monospace;padding:20px">' + JSON.stringify(info, null, 2) + '</pre>');
    } catch (err) {
      return HtmlService.createHtmlOutput('<pre style="color:red;padding:20px">ERROR: ' + err.message + '\n' + err.stack + '</pre>');
    }
  }

  if (page === 'wizard') {
    return HtmlService.createHtmlOutputFromFile('Wizard')
      .setTitle('New Session — Mngaia')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  if (page === 'library') {
    const sessionId = e.parameter.session || '';
    const output = HtmlService.createHtmlOutputFromFile('LibraryPage')
      .setTitle('Learning Library — Mngaia')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);

    // Inject session ID into the page for client-side fetch
    const html = output.getContent().replace('__SESSION_ID__', sessionId);
    return HtmlService.createHtmlOutput(html)
      .setTitle('Learning Library — Mngaia')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Mngaia Content Engine')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ─── Dashboard API ────────────────────────────────────────────────────────────

/**
 * Returns all sessions for the dashboard.
 */
function getDashboardData() {
  SessionService.ensureMasterSheet(); // create Sessions tab if it doesn't exist yet
  const sessions = SessionService.getAllSessions();
  const baseUrl = _getWebAppUrl();
  return sessions.reverse().map(s => ({
    id:         s.id,
    name:       s.name,
    theme:      s.theme,
    date:       s.date,
    format:     s.format,
    audience:   s.audience,
    status:     s.status,
    folderUrl:  s.folderUrl,
    dbUrl:      s.dbUrl,
    emailSent:  s.emailSent,
    hasGems:    !!(s.gems && s.gems.length),
    gemsJson:   s.gems ? JSON.stringify(s.gems) : '[]',
    hasBrief:   !!(s.brief && s.brief.overview),
    libraryUrl: baseUrl ? baseUrl + '?page=library&session=' + s.id : ''
  }));
}

// ─── Session API ──────────────────────────────────────────────────────────────

/**
 * Runs Synthesis for a session. Called from dashboard.
 * @param {string} sessionId
 * @param {boolean} [force] - If true, re-analyzes already-scored resources too.
 */
function webRunSynthesis(sessionId, force) {
  const count = SynthesisService.synthesizeAll(sessionId, force || false);
  invalidateLibraryCache(sessionId);
  return { success: true, count: count };
}

/**
 * Generates Gem instruction sets for a session. Called from dashboard.
 */
function webGenerateGems(sessionId) {
  const gems = GemsService.generateGems(sessionId);
  invalidateLibraryCache(sessionId);
  return { success: true, count: gems.length };
}

/**
 * Updates shareable links for published Gems. Called from "Set Gem Links" modal.
 * @param {string} sessionId
 * @param {Object} gemLinks - { "session-primer": "https://...", ... }
 */
function webUpdateGemLinks(sessionId, gemLinks) {
  GemsService.updateGemLinks(sessionId, gemLinks);
  invalidateLibraryCache(sessionId);
  return { ok: true };
}

/**
 * Returns draft email content for review modal. Called from dashboard.
 */
function webGetEmailDraft(sessionId) {
  const draft = EmailService.getDraft(sessionId);
  return draft;
}

/**
 * Sends approved email draft to recipients. Called from dashboard.
 */
function webSendEmail(sessionId, recipients, subject, htmlBody) {
  return EmailService.sendApprovedDraft(sessionId, recipients, subject, htmlBody);
}

// ─── Library API ──────────────────────────────────────────────────────────────

/**
 * Returns the full library data for a session page. Called from LibraryPage.html.
 */
function getLibraryData(sessionId) {
  // Cache for performance — library data doesn't change during a page load
  const cacheKey = 'library_' + sessionId;
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* fall through */ }
  }

  const data = LibraryService.buildLibraryData(sessionId);

  // Cache for 5 minutes (300 seconds)
  try {
    cache.put(cacheKey, JSON.stringify(data), 300);
  } catch (e) { /* data may be too large for cache — skip */ }

  return data;
}

/**
 * Invalidates the library cache for a session (call after synthesis or gems update).
 */
function invalidateLibraryCache(sessionId) {
  CacheService.getScriptCache().remove('library_' + sessionId);
  return true;
}

/**
 * Adds resources to a session. Called from Wizard.html and Index.html.
 * @param {string} sessionId
 * @param {Object[]} resources - [{ fileId?, url, name, type, mimeType? }]
 */
function webAddResources(sessionId, resources) {
  return ResourceService.addResources(sessionId, resources);
}

/**
 * Generates Google Sites embed code for a session. Called from dashboard.
 * @param {string} sessionId
 * @returns {{ docUrl: string }}
 */
function webGenerateSiteCode(sessionId) {
  return SitesService.generateSiteCode(sessionId);
}

/**
 * Regenerates the AI session brief for an existing session.
 * Used when a session was created without a brief or the brief is missing.
 * @param {string} sessionId
 * @returns {{ ok: boolean }}
 */
function webRegenerateBrief(sessionId) {
  const session = SessionService.getSession(sessionId);
  if (!session) throw new Error('Session not found: ' + sessionId);
  const brief = GeminiService.generateSessionBrief(session.theme, session.format, session.audience);
  SessionService.updateSession(sessionId, { BRIEF_JSON: JSON.stringify(brief) });
  invalidateLibraryCache(sessionId);
  return { ok: true };
}

// ─── Collaborator API ─────────────────────────────────────────────────────────

/**
 * Returns current Editor collaborators for a session's Drive folder.
 * @param {string} sessionId
 * @returns {{ email: string, name: string }[]}
 */
function webGetCollaborators(sessionId) {
  return CollaboratorService.getEditors(sessionId);
}

/**
 * Adds collaborators as Editors to the session Drive folder.
 * @param {string} sessionId
 * @param {string[]} emails
 * @returns {{ added: number, errors: string[] }}
 */
function webAddCollaborators(sessionId, emails) {
  return CollaboratorService.addEditors(sessionId, emails);
}

/**
 * Removes a collaborator's Editor access from the session Drive folder.
 * @param {string} sessionId
 * @param {string} email
 */
function webRemoveCollaborator(sessionId, email) {
  return CollaboratorService.removeEditor(sessionId, email);
}

// ─── Participant API ──────────────────────────────────────────────────────────

/**
 * Returns all participants for a session.
 * @param {string} sessionId
 * @returns {{ email: string, name: string, registeredAt: string }[]}
 */
function webGetParticipants(sessionId) {
  return ParticipantService.getParticipants(sessionId);
}

/**
 * Adds participants to a session (deduplicates by email).
 * @param {string} sessionId
 * @param {{ name: string, email: string }[]} participants
 * @returns {{ added: number, skipped: number }}
 */
function webAddParticipants(sessionId, participants) {
  return ParticipantService.addParticipants(sessionId, participants);
}

/**
 * Removes a participant by email.
 * @param {string} sessionId
 * @param {string} email
 */
function webRemoveParticipant(sessionId, email) {
  return ParticipantService.removeParticipant(sessionId, email);
}

// ─── Permission API ───────────────────────────────────────────────────────────

/**
 * Checks Drive sharing access for all resources in a session.
 * Returns which files are publicly embeddable and which are restricted.
 * @param {string} sessionId
 * @returns {{ name, url, embedType, access, fileId?, ok }[]}
 */
function webCheckPermissions(sessionId) {
  return PermissionService.checkResources(sessionId);
}

/**
 * Sets "Anyone with the link can view" on a list of Drive file IDs.
 * @param {string[]} fileIds
 * @returns {{ fixed: number, errors: string[] }}
 */
function webFixPermissions(fileIds) {
  return PermissionService.fixPermissions(fileIds);
}

// ─── Drive Folder Browser ─────────────────────────────────────────────────────

/**
 * Lists files in a Drive folder by URL. Called from Resources modal and Wizard.
 * @param {string} folderUrl - Full Google Drive folder share URL
 * @returns {{ folderName, files: [{fileId, name, url, mimeType}] } | { error }}
 */
function getDriveFilesInFolder(folderUrl) {
  var m = folderUrl.match(/\/folders\/([a-zA-Z0-9_-]{25,})/);
  var folderId = m ? m[1] : null;
  if (!folderId) {
    m = folderUrl.match(/[?&]id=([a-zA-Z0-9_-]{25,})/);
    folderId = m ? m[1] : null;
  }
  if (!folderId) return { error: 'Could not find folder ID in that URL. Paste the full Google Drive folder share link.' };

  try {
    var folder = DriveApp.getFolderById(folderId);
    var files = [];
    var iter = folder.getFiles();
    while (iter.hasNext() && files.length < 100) {
      var f = iter.next();
      files.push({ fileId: f.getId(), name: f.getName(), url: f.getUrl(), mimeType: f.getMimeType() });
    }
    return { folderName: folder.getName(), files: files };
  } catch (e) {
    return { error: 'Could not access folder: ' + e.message };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _getWebAppUrl() {
  try {
    return ScriptApp.getService().getUrl();
  } catch (e) {
    return '';
  }
}

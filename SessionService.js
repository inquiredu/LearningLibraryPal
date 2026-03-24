/**
 * SessionService
 * Handles all session CRUD operations, Drive folder scaffolding,
 * and Master Sheet read/write operations.
 */

const SessionService = {

  // ─── Constants ──────────────────────────────────────────────────────────────

  SESSIONS_SHEET_NAME: 'Sessions',
  SETTINGS_SHEET_NAME: 'Settings',

  // Sessions sheet column indices (0-based)
  COL: {
    ID:          0,
    NAME:        1,
    THEME:       2,
    DATE:        3,
    FORMAT:      4,
    AUDIENCE:    5,
    BRAND:       6,
    STATUS:      7,
    FOLDER_URL:  8,
    LIBRARY_URL: 9,
    DB_URL:      10,
    EMAIL_SENT:  11,
    BRIEF_JSON:  12,
    GEMS_JSON:   13,
    CREATED_AT:  14
  },

  // ─── Setup ──────────────────────────────────────────────────────────────────

  /**
   * Ensures the Master Sheet has the Sessions and Settings tabs.
   * Creates them if missing. Called from Code.js onOpen / setup.
   */
  ensureMasterSheet: function() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sessionsSheet = ss.getSheetByName(this.SESSIONS_SHEET_NAME);
    if (!sessionsSheet) {
      sessionsSheet = ss.insertSheet(this.SESSIONS_SHEET_NAME);
      const headers = [
        'ID', 'Name', 'Theme', 'Date', 'Format', 'Audience', 'Brand',
        'Status', 'Folder URL', 'Library URL', 'Project DB URL',
        'Email Sent', 'Brief JSON', 'Gems JSON', 'Created At'
      ];
      sessionsSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sessionsSheet.setFrozenRows(1);
      sessionsSheet.getRange(1, 1, 1, headers.length)
        .setBackground('#0B2B46').setFontColor('#FFFFFF').setFontWeight('bold');
    }

    let settingsSheet = ss.getSheetByName(this.SETTINGS_SHEET_NAME);
    if (!settingsSheet) {
      settingsSheet = ss.insertSheet(this.SETTINGS_SHEET_NAME);
      settingsSheet.getRange('A1:B1').setValues([['Setting', 'Value']]);
      settingsSheet.getRange('A2:B3').setValues([
        ['Root Folder ID', ''],
        ['Gemini API Key', '']
      ]);
      settingsSheet.getRange(1, 1, 1, 2)
        .setBackground('#0B2B46').setFontColor('#FFFFFF').setFontWeight('bold');
    }
    return ss;
  },

  // ─── Session CRUD ───────────────────────────────────────────────────────────

  /**
   * Creates a new session: scaffolds folders, calls Gemini for the brief,
   * writes row to Sessions sheet, creates Project Database spreadsheet.
   * @returns {{ sessionId, folderUrl, dbUrl }}
   */
  setupSession: function(params) {
    const { name, theme, date, format, audience, brand } = params;
    const sessionId = 'S-' + new Date().getTime();
    const rootFolderId = this._getRootFolderId();

    // 1. Scaffold Drive folders
    const sessionFolder = this._scaffoldFolders(rootFolderId, name, sessionId);

    // 2. Create Project Database spreadsheet
    const db = this._createProjectDatabase(sessionFolder, name, sessionId);

    // 3. Call Gemini for session brief
    let brief = null;
    try {
      brief = GeminiService.generateSessionBrief(theme, format, audience);
    } catch (e) {
      console.error('Brief generation failed, continuing without AI content', e);
      brief = {
        overview: '',
        learningObjectives: [],
        inquiryQuestions: [],
        notebookLMStarterPrompt: ''
      };
    }

    // 4. Write session row to Master Sheet
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(this.SESSIONS_SHEET_NAME);
    const row = new Array(15).fill('');
    row[this.COL.ID]         = sessionId;
    row[this.COL.NAME]       = name;
    row[this.COL.THEME]      = theme;
    row[this.COL.DATE]       = date;
    row[this.COL.FORMAT]     = format;
    row[this.COL.AUDIENCE]   = audience;
    row[this.COL.BRAND]      = brand || 'Learning Library';
    row[this.COL.STATUS]     = 'Active';
    row[this.COL.FOLDER_URL] = sessionFolder.getUrl();
    row[this.COL.LIBRARY_URL]= '';
    row[this.COL.DB_URL]     = db.getUrl();
    row[this.COL.EMAIL_SENT] = 'No';
    row[this.COL.BRIEF_JSON] = JSON.stringify(brief);
    row[this.COL.GEMS_JSON]  = '';
    row[this.COL.CREATED_AT] = new Date().toISOString();
    sheet.appendRow(row);

    return {
      sessionId: sessionId,
      sessionName: name,
      folderUrl: sessionFolder.getUrl(),
      dbUrl: db.getUrl(),
      brief: brief
    };
  },

  /**
   * Returns all sessions as an array of plain objects.
   */
  getAllSessions: function() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(this.SESSIONS_SHEET_NAME);
    if (!sheet) return [];
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return [];

    return data.slice(1).map(row => ({
      id:          row[this.COL.ID],
      name:        row[this.COL.NAME],
      theme:       row[this.COL.THEME],
      date:        row[this.COL.DATE] ? String(row[this.COL.DATE]) : '',
      format:      row[this.COL.FORMAT],
      audience:    row[this.COL.AUDIENCE],
      brand:       row[this.COL.BRAND],
      status:      row[this.COL.STATUS],
      folderUrl:   row[this.COL.FOLDER_URL],
      libraryUrl:  row[this.COL.LIBRARY_URL],
      dbUrl:       row[this.COL.DB_URL],
      emailSent:   row[this.COL.EMAIL_SENT],
      brief:       this._safeParseJson(row[this.COL.BRIEF_JSON]),
      gems:        this._safeParseJson(row[this.COL.GEMS_JSON]),
      createdAt:   row[this.COL.CREATED_AT]
    })).filter(s => s.id);
  },

  /**
   * Returns a single session object by ID.
   */
  getSession: function(sessionId) {
    return this.getAllSessions().find(s => s.id === sessionId) || null;
  },

  /**
   * Updates specific columns on a session row.
   * @param {string} sessionId
   * @param {Object} updates - Keys matching COL names (e.g., { LIBRARY_URL: 'https://...' })
   */
  updateSession: function(sessionId, updates) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(this.SESSIONS_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][this.COL.ID] === sessionId) {
        Object.entries(updates).forEach(([colName, value]) => {
          const colIndex = this.COL[colName];
          if (colIndex !== undefined) {
            sheet.getRange(i + 1, colIndex + 1).setValue(value);
          }
        });
        return true;
      }
    }
    return false;
  },

  // ─── Drive Scaffolding ──────────────────────────────────────────────────────

  _scaffoldFolders: function(rootFolderId, sessionName, sessionId) {
    const rootFolder = DriveApp.getFolderById(rootFolderId);
    const sessionFolderName = `${sessionName} [${sessionId}]`;
    const sessionFolder = rootFolder.createFolder(sessionFolderName);

    ['00_Admin', '01_Research', '02_Drafts', '03_Gems', '04_Final'].forEach(name => {
      sessionFolder.createFolder(name);
    });

    return sessionFolder;
  },

  _createProjectDatabase: function(sessionFolder, sessionName, sessionId) {
    const adminFolder = this._getSubfolder(sessionFolder, '00_Admin');
    const db = SpreadsheetApp.create(`${sessionName} — Project Database`);
    DriveApp.getFileById(db.getId()).moveTo(adminFolder);

    // Resources sheet
    const resourcesSheet = db.getSheets()[0];
    resourcesSheet.setName('Resources');
    const headers = [
      'URL', 'Title', 'Type', 'Relevance Score', 'Engagement Level',
      'Key Tags', 'Pre-Reading', 'NotebookLM Ready', 'Relevance Statement', 'Summary'
    ];
    resourcesSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    resourcesSheet.setFrozenRows(1);
    resourcesSheet.getRange(1, 1, 1, headers.length)
      .setBackground('#0B2B46').setFontColor('#FFFFFF').setFontWeight('bold');

    // Participants sheet
    db.insertSheet('Participants');
    const pSheet = db.getSheetByName('Participants');
    pSheet.getRange(1, 1, 1, 3).setValues([['Name', 'Email', 'Registered At']]);
    pSheet.getRange(1, 1, 1, 3)
      .setBackground('#0B2B46').setFontColor('#FFFFFF').setFontWeight('bold');

    return db;
  },

  // ─── Helpers ────────────────────────────────────────────────────────────────

  _getRootFolderId: function() {
    const props = PropertiesService.getScriptProperties();
    let folderId = props.getProperty('ROOT_FOLDER_ID');
    if (folderId) return folderId;

    // Fallback: check Settings sheet
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(this.SETTINGS_SHEET_NAME);
    if (sheet) {
      const data = sheet.getDataRange().getValues();
      const row = data.find(r => r[0] === 'Root Folder ID');
      if (row && row[1]) {
        folderId = row[1];
        props.setProperty('ROOT_FOLDER_ID', folderId);
        return folderId;
      }
    }

    // Last resort: create a folder next to the spreadsheet
    const ss2 = SpreadsheetApp.getActiveSpreadsheet();
    const ssFile = DriveApp.getFileById(ss2.getId());
    const parents = ssFile.getParents();
    const parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
    const newFolder = parent.createFolder('Learning Library — Learning Library');
    folderId = newFolder.getId();
    props.setProperty('ROOT_FOLDER_ID', folderId);
    return folderId;
  },

  _getSubfolder: function(parentFolder, name) {
    const iter = parentFolder.getFoldersByName(name);
    return iter.hasNext() ? iter.next() : parentFolder.createFolder(name);
  },

  _safeParseJson: function(str) {
    if (!str) return null;
    try { return JSON.parse(str); } catch (e) { return null; }
  }

};

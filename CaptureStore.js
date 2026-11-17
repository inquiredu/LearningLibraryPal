/**
 * CaptureStore
 * Live capture lives in the session's own Project Database, in three tabs:
 *   Live Capture  key/value settings (template, tables, open, table key)
 *   Live Cards    one row per card, written only under the script lock
 *   Live Groups   the facilitators' current grouping, rewritten whole on save
 * Facilitators can read every row in the Sheet; nothing here is secret except
 * the table key, which keeps a shared library link from being used to submit.
 */

const CaptureStore = {
  CONFIG_SHEET: 'Live Capture',
  CARDS_SHEET: 'Live Cards',
  GROUPS_SHEET: 'Live Groups',
  CARD_BASE_HEADERS: ['Card', 'Submitted', 'Table', 'Level', 'Source', 'Hidden', 'Token'],
  GROUP_HEADERS: ['Rank', 'Topic', 'Route override', 'Card IDs', 'Group ID', 'Updated'],

  db: function(sessionId) {
    const cache = CacheService.getScriptCache();
    const cacheKey = 'capture_db_' + sessionId;
    let dbId = cache.get(cacheKey);
    if (!dbId) {
      const session = SessionService.getSession(sessionId);
      if (!session || !session.dbUrl) throw new Error('This session link is not available.');
      const match = String(session.dbUrl).match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (!match) throw new Error('This session has no Project Database.');
      dbId = match[1];
      try { cache.put(cacheKey, dbId, 600); } catch (e) {}
    }
    return SpreadsheetApp.openById(dbId);
  },

  getConfig: function(sessionId) {
    const sheet = this.db(sessionId).getSheetByName(this.CONFIG_SHEET);
    if (!sheet) return null;
    const values = sheet.getDataRange().getValues();
    const map = {};
    values.slice(1).forEach(row => { if (row[0]) map[String(row[0])] = row[1]; });
    if (!map.template) return null;
    return {
      template: String(map.template),
      tables: Number(map.tables) || CAPTURE_DEFAULTS.TABLES,
      open: String(map.open) === 'yes',
      key: String(map.key || ''),
      title: String(map.title || '')
    };
  },

  writeConfig_: function(sessionId, config) {
    const db = this.db(sessionId);
    let sheet = db.getSheetByName(this.CONFIG_SHEET);
    if (!sheet) sheet = db.insertSheet(this.CONFIG_SHEET);
    const rows = [
      ['Setting', 'Value'],
      ['template', config.template],
      ['tables', config.tables],
      ['open', config.open ? 'yes' : 'no'],
      ['key', config.key],
      ['title', config.title]
    ];
    sheet.clearContents();
    sheet.getRange(1, 1, rows.length, 2).setValues(rows);
    sheet.getRange(1, 1, 1, 2).setBackground('#0B2B46').setFontColor('#FFFFFF').setFontWeight('bold');
  },

  enable: function(sessionId, templateId, tables, title) {
    const template = captureTemplate_(templateId);
    const count = Math.round(Number(tables));
    if (!Number.isInteger(count) || count < 1 || count > CAPTURE_DEFAULTS.MAX_TABLES) {
      throw new Error('Tables must be between 1 and ' + CAPTURE_DEFAULTS.MAX_TABLES + '.');
    }
    return this.withLock_(() => {
      const existing = this.getConfig(sessionId);
      const config = {
        template: template.id,
        tables: count,
        open: existing ? existing.open : false,
        key: existing && existing.key ? existing.key : Utilities.getUuid().replace(/-/g, '').slice(0, 20),
        title: captureCleanText_(title, 80) || template.name
      };
      this.writeConfig_(sessionId, config);
      this.ensureSheets_(sessionId, template);
      return config;
    });
  },

  setOpen: function(sessionId, open) {
    return this.withLock_(() => {
      const config = this.getConfig(sessionId);
      if (!config) throw new Error('Turn on live capture for this session first.');
      config.open = !!open;
      this.writeConfig_(sessionId, config);
      return config;
    });
  },

  ensureSheets_: function(sessionId, template) {
    const db = this.db(sessionId);
    if (!db.getSheetByName(this.CARDS_SHEET)) {
      const sheet = db.insertSheet(this.CARDS_SHEET);
      const headers = this.CARD_BASE_HEADERS.concat(template.fields.map(f => f.label));
      sheet.getRange(1, 1, 1, headers.length).setValues([headers])
        .setBackground('#0B2B46').setFontColor('#FFFFFF').setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
    if (!db.getSheetByName(this.GROUPS_SHEET)) {
      const sheet = db.insertSheet(this.GROUPS_SHEET);
      sheet.getRange(1, 1, 1, this.GROUP_HEADERS.length).setValues([this.GROUP_HEADERS])
        .setBackground('#0B2B46').setFontColor('#FFFFFF').setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  },

  readCards: function(sessionId, template) {
    const sheet = this.db(sessionId).getSheetByName(this.CARDS_SHEET);
    if (!sheet) return [];
    const values = sheet.getDataRange().getValues();
    const base = this.CARD_BASE_HEADERS.length;
    return values.slice(1).filter(row => row[0] !== '' && row[0] !== null).map(row => {
      const fields = {};
      template.fields.forEach((f, i) => { fields[f.key] = String(row[base + i] || ''); });
      const submitted = row[1] instanceof Date ? row[1].toISOString() : String(row[1] || '');
      return {
        id: Number(row[0]),
        submittedAt: submitted,
        table: Number(row[2]),
        level: String(row[3]),
        source: String(row[4] || 'typed'),
        hidden: String(row[5]) === 'yes',
        token: String(row[6] || ''),
        fields: fields
      };
    });
  },

  appendCard: function(sessionId, template, card) {
    return this.withLock_(() => {
      const sheet = this.db(sessionId).getSheetByName(this.CARDS_SHEET);
      if (!sheet) throw new Error('Live capture is not set up for this session.');
      const existing = this.readCards(sessionId, template);
      if (existing.length >= CAPTURE_DEFAULTS.MAX_CARDS_PER_SESSION) {
        throw new Error('This session has reached its card limit. Tell a facilitator.');
      }
      const id = existing.reduce((max, c) => Math.max(max, c.id), 0) + 1;
      const token = Utilities.getUuid().replace(/-/g, '');
      const row = [id, new Date(), card.table, captureSheetSafe_(card.level), card.source, 'no', token]
        .concat(template.fields.map(f => captureSheetSafe_(card.fields[f.key])));
      sheet.appendRow(row);
      return { id: id, token: token };
    });
  },

  setHidden: function(sessionId, template, id, hidden, token) {
    return this.withLock_(() => {
      const sheet = this.db(sessionId).getSheetByName(this.CARDS_SHEET);
      if (!sheet) throw new Error('Live capture is not set up for this session.');
      const values = sheet.getDataRange().getValues();
      for (let i = 1; i < values.length; i++) {
        if (Number(values[i][0]) === Number(id)) {
          if (token !== undefined && String(values[i][6]) !== String(token)) {
            throw new Error('Only the table that sent this card can remove it.');
          }
          sheet.getRange(i + 1, 6).setValue(hidden ? 'yes' : 'no');
          return true;
        }
      }
      throw new Error('That card was not found.');
    });
  },

  readGroups: function(sessionId) {
    const sheet = this.db(sessionId).getSheetByName(this.GROUPS_SHEET);
    if (!sheet) return [];
    return sheet.getDataRange().getValues().slice(1).filter(row => row[3] !== '').map(row => ({
      rank: Number(row[0]) || 0,
      topic: String(row[1] || ''),
      routeOverride: String(row[2] || ''),
      cardIds: String(row[3]).split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n > 0),
      id: String(row[4] || '')
    }));
  },

  writeGroups: function(sessionId, groups) {
    return this.withLock_(() => {
      const sheet = this.db(sessionId).getSheetByName(this.GROUPS_SHEET);
      if (!sheet) throw new Error('Live capture is not set up for this session.');
      const last = sheet.getLastRow();
      if (last > 1) sheet.getRange(2, 1, last - 1, this.GROUP_HEADERS.length).clearContent();
      const now = new Date();
      const rows = groups.map(g => [g.rank || '', captureSheetSafe_(g.topic), g.routeOverride || '',
        g.cardIds.join(', '), captureSheetSafe_(g.id), now]);
      if (rows.length) sheet.getRange(2, 1, rows.length, this.GROUP_HEADERS.length).setValues(rows);
      return rows.length;
    });
  },

  withLock_: function(action) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) throw new Error('Busy saving other cards. Try again in a moment.');
    try { return action(); } finally { lock.releaseLock(); }
  }
};

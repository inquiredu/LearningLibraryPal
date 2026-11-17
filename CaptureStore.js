/**
 * CaptureStore
 * Live capture lives in the session's own Project Database:
 *   Live Capture    key/value settings (template, tables, table key, stage,
 *                   published groups, paper dots, tally mode, assignments, survey)
 *   Live Signals    one row per signal (10:00)
 *   Live Flips      one row per flip statement; a table marks its top ones (11:12)
 *   Live Flip Dots  one row per person: their gallery dots on flip statements (11:30)
 *   Live Cards      one row per need card (12:08)
 *   Live Groups     the synthesis team's working groups, rewritten whole on save
 *   Live Votes      one row per person: their priority votes (12:40)
 *   Live Test Drive one row per table: its notes on the guidance (13:05)
 * Rows are read and written by header name, so a column added later goes at
 * the end and older sheets keep working. Writes run under the script lock.
 * Phones and the wall read one cached snapshot per session, refreshed every
 * few seconds and cleared on every write.
 */

const CaptureStore = {
  CONFIG_SHEET: 'Live Capture',
  SNAPSHOT_SECONDS: 4,

  SPECS: {
    signals: { sheet: 'Live Signals', headers: ['Signal', 'Submitted', 'Table', 'Role', 'Text', 'Hidden', 'Token'] },
    flips: { sheet: 'Live Flips', headers: ['Flip', 'Updated', 'Table', 'Text', 'Top', 'Hidden'] },
    flipDots: { sheet: 'Live Flip Dots', headers: ['Voter', 'Role', 'Dots', 'Updated'] },
    cards: { sheet: 'Live Cards', headers: ['Card', 'Submitted', 'Table', 'Level', 'Source', 'Hidden', 'Token', 'Role', 'Flip ID', 'Flip statement', 'Need'] },
    groups: { sheet: 'Live Groups', headers: ['Rank', 'Topic', 'Column override', 'Card IDs', 'Group ID', 'Updated'] },
    votes: { sheet: 'Live Votes', headers: ['Voter', 'Role', 'Choices', 'Updated'] },
    testDrive: { sheet: 'Live Test Drive', headers: ['Table', 'Group ID', 'Topic', 'Change', 'Add', 'Cut', 'Beyond guidance', 'Updated'] }
  },
  // Earlier sheets named the need column after its prompt.
  ALIASES: { 'Need': ['To close this gap, students and educators need…', 'To address this gap, schools and educators need…'] },

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

  // ─── Settings ─────────────────────────────────────────────────────────────

  JSON_KEYS: ['published', 'paperDots', 'assign'],

  getConfig: function(sessionId) {
    const sheet = this.db(sessionId).getSheetByName(this.CONFIG_SHEET);
    if (!sheet) return null;
    const map = {};
    sheet.getDataRange().getValues().slice(1).forEach(row => { if (row[0]) map[String(row[0])] = row[1]; });
    if (!map.template) return null;
    const json = (v, fallback) => { try { return v ? JSON.parse(String(v)) : fallback; } catch (e) { return fallback; } };
    const template = CAPTURE_TEMPLATES[String(map.template)];
    const stages = template ? captureStageIds_(template) : [];
    return {
      template: String(map.template),
      tables: Number(map.tables) || CAPTURE_DEFAULTS.TABLES,
      key: String(map.key || ''),
      title: String(map.title || ''),
      stage: stages.indexOf(String(map.stage)) !== -1 ? String(map.stage) : (stages[0] || ''),
      published: json(map.published, null),
      publishedAt: String(map.publishedAt || ''),
      paperDots: json(map.paperDots, {}),
      tallyMode: ['phone', 'paper', 'both'].indexOf(String(map.tallyMode)) !== -1 ? String(map.tallyMode) : 'phone',
      assign: json(map.assign, {}),
      surveyUrl: /^https:\/\//.test(String(map.surveyUrl || '')) ? String(map.surveyUrl) : ''
    };
  },

  writeConfig_: function(sessionId, config) {
    const db = this.db(sessionId);
    let sheet = db.getSheetByName(this.CONFIG_SHEET);
    if (!sheet) sheet = db.insertSheet(this.CONFIG_SHEET);
    const keys = ['template', 'tables', 'key', 'title', 'stage', 'published', 'publishedAt', 'paperDots', 'tallyMode', 'assign', 'surveyUrl'];
    const rows = [['Setting', 'Value']].concat(keys.map(k => {
      const v = config[k];
      if (this.JSON_KEYS.indexOf(k) !== -1) return [k, v ? JSON.stringify(v) : ''];
      return [k, captureSheetSafe_(v === undefined || v === null ? '' : v)];
    }));
    sheet.clearContents();
    sheet.getRange(1, 1, rows.length, 2).setValues(rows);
    sheet.getRange(1, 1, 1, 2).setBackground('#0B2B46').setFontColor('#FFFFFF').setFontWeight('bold');
    this.invalidate_(sessionId);
  },

  /** Changes some settings under the lock and returns the new config. */
  updateConfig: function(sessionId, change) {
    return this.withLock_(() => {
      const config = this.getConfig(sessionId);
      if (!config) throw new Error('Turn on live capture for this session first.');
      const next = Object.assign({}, config, change(config) || {});
      this.writeConfig_(sessionId, next);
      return next;
    });
  },

  enable: function(sessionId, templateId, tables, title) {
    const template = captureTemplate_(templateId);
    const count = Math.round(Number(tables));
    if (!Number.isInteger(count) || count < 1 || count > CAPTURE_DEFAULTS.MAX_TABLES) {
      throw new Error('Tables must be between 1 and ' + CAPTURE_DEFAULTS.MAX_TABLES + '.');
    }
    return this.withLock_(() => {
      const existing = this.getConfig(sessionId) || {};
      const config = Object.assign({ stage: template.stages[0].id, tallyMode: 'phone', paperDots: {}, assign: {}, published: null, publishedAt: '', surveyUrl: '' }, existing, {
        template: template.id,
        tables: count,
        key: existing.key || Utilities.getUuid().replace(/-/g, '').slice(0, 20),
        title: captureCleanText_(title, 80) || existing.title || template.name
      });
      this.writeConfig_(sessionId, config);
      const db = this.db(sessionId);
      Object.keys(this.SPECS).forEach(name => this.sheet_(db, name, true));
      return config;
    });
  },

  // ─── Rows by header ───────────────────────────────────────────────────────

  /** The sheet for a spec, with any missing headers added at the end. */
  sheet_: function(db, name, create) {
    const spec = this.SPECS[name];
    let sheet = db.getSheetByName(spec.sheet);
    if (!sheet) {
      if (!create) return null;
      sheet = db.insertSheet(spec.sheet);
      sheet.getRange(1, 1, 1, spec.headers.length).setValues([spec.headers])
        .setBackground('#0B2B46').setFontColor('#FFFFFF').setFontWeight('bold');
      sheet.setFrozenRows(1);
      return sheet;
    }
    const have = (sheet.getDataRange().getValues()[0] || []).map(String);
    const missing = spec.headers.filter(h => this.columnOf_(have, h) === -1);
    if (missing.length && create) {
      sheet.getRange(1, have.length + 1, 1, missing.length).setValues([missing])
        .setBackground('#0B2B46').setFontColor('#FFFFFF').setFontWeight('bold');
    }
    return sheet;
  },

  columnOf_: function(headers, name) {
    const i = headers.indexOf(name);
    if (i !== -1) return i;
    const aliases = this.ALIASES[name] || [];
    for (let k = 0; k < aliases.length; k++) { const j = headers.indexOf(aliases[k]); if (j !== -1) return j; }
    return -1;
  },

  /** [{ _row, Header: value, ... }] */
  rows_: function(db, name) {
    const sheet = this.sheet_(db, name, false);
    if (!sheet) return [];
    const values = sheet.getDataRange().getValues();
    const headers = (values[0] || []).map(String);
    const spec = this.SPECS[name];
    return values.slice(1).map((row, i) => {
      const out = { _row: i + 2 };
      spec.headers.forEach(h => { const c = this.columnOf_(headers, h); out[h] = c === -1 ? '' : row[c]; });
      return out;
    }).filter(r => String(r[spec.headers[0]]) !== '');
  },

  /** Writes the given header values into row `rowNumber`, or appends when it is 0. */
  put_: function(db, name, rowNumber, values) {
    const sheet = this.sheet_(db, name, true);
    const headers = (sheet.getDataRange().getValues()[0] || []).map(String);
    if (!rowNumber) {
      const row = headers.map(h => {
        const key = Object.keys(values).find(k => this.columnOf_([h], k) === 0);
        return key === undefined ? '' : this.cell_(values[key]);
      });
      sheet.appendRow(row);
      return;
    }
    Object.keys(values).forEach(k => {
      const c = this.columnOf_(headers, k);
      if (c !== -1) sheet.getRange(rowNumber, c + 1).setValue(this.cell_(values[k]));
    });
  },

  cell_: function(v) {
    if (v instanceof Date || typeof v === 'number') return v;
    return captureSheetSafe_(v === undefined || v === null ? '' : v);
  },

  // ─── Reading everything at once ───────────────────────────────────────────

  /** Everything phones, the wall and the board read, cached for a few seconds. */
  snapshot: function(sessionId, template) {
    const cache = CacheService.getScriptCache();
    const key = 'capture_snap_' + sessionId;
    const hit = cache.get(key);
    if (hit) { try { return JSON.parse(hit); } catch (e) {} }
    const db = this.db(sessionId);
    const bool = v => String(v) === 'yes';
    const iso = v => (v instanceof Date ? v.toISOString() : String(v || ''));
    const snap = {
      signals: this.rows_(db, 'signals').map(r => ({ id: Number(r.Signal), submittedAt: iso(r.Submitted), table: Number(r.Table), role: String(r.Role), text: String(r.Text), hidden: bool(r.Hidden), token: String(r.Token) })),
      flips: this.rows_(db, 'flips').map(r => ({ id: Number(r.Flip), table: Number(r.Table), text: String(r.Text), top: bool(r.Top), hidden: bool(r.Hidden) })),
      flipDots: this.rows_(db, 'flipDots').map(r => ({ voter: String(r.Voter), role: String(r.Role), dots: this.json_(r.Dots, []) })),
      cards: this.rows_(db, 'cards').map(r => {
        const fields = {};
        fields[template.parent.key] = String(r['Flip statement'] || '');
        template.fields.forEach(f => { fields[f.key] = String(r.Need || ''); });
        return { id: Number(r.Card), submittedAt: iso(r.Submitted), table: Number(r.Table), level: String(r.Level), source: String(r.Source || 'typed'),
          hidden: bool(r.Hidden), token: String(r.Token), role: String(r.Role || ''), flipId: Number(r['Flip ID']) || 0, fields: fields };
      }),
      groups: this.rows_(db, 'groups').map(r => ({
        rank: Number(r.Rank) || 0, topic: String(r.Topic || ''), columnOverride: String(r['Column override'] || ''), id: String(r['Group ID'] || ''),
        cardIds: String(r['Card IDs']).split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n > 0)
      })),
      votes: this.rows_(db, 'votes').map(r => ({ voter: String(r.Voter), role: String(r.Role), choices: String(r.Choices || '').split(',').map(s => s.trim()).filter(Boolean) })),
      testDrive: this.rows_(db, 'testDrive').map(r => {
        const notes = {};
        template.testDrive.prompts.forEach(p => { notes[p.key] = String(r[{ change: 'Change', add: 'Add', cut: 'Cut', beyond: 'Beyond guidance' }[p.key]] || ''); });
        return { table: Number(r.Table), groupId: String(r['Group ID'] || ''), topic: String(r.Topic || ''), notes: notes };
      })
    };
    // The flip-dot tally is derived, so it is cached with the rows.
    snap.flipDots = snap.flipDots.reduce((all, p) => all.concat((p.dots || []).map(d => ({ flipId: Number(d.flipId), color: String(d.color), role: p.role, voter: p.voter }))), []);
    try { cache.put(key, JSON.stringify(snap), this.SNAPSHOT_SECONDS); } catch (e) {}
    return snap;
  },

  json_: function(v, fallback) { try { return v ? JSON.parse(String(v)) : fallback; } catch (e) { return fallback; } },

  invalidate_: function(sessionId) {
    try { CacheService.getScriptCache().remove('capture_snap_' + sessionId); } catch (e) {}
  },

  // ─── Writes ───────────────────────────────────────────────────────────────

  nextId_: function(rows, header) {
    return rows.reduce((max, r) => Math.max(max, Number(r[header]) || 0), 0) + 1;
  },

  addSignal: function(sessionId, signal) {
    return this.write_(sessionId, db => {
      const rows = this.rows_(db, 'signals');
      if (rows.length >= CAPTURE_DEFAULTS.MAX_SIGNALS_PER_SESSION) throw new Error('This session has reached its signal limit.');
      const id = this.nextId_(rows, 'Signal');
      const token = Utilities.getUuid().replace(/-/g, '');
      this.put_(db, 'signals', 0, { Signal: id, Submitted: new Date(), Table: signal.table, Role: signal.role, Text: signal.text, Hidden: 'no', Token: token });
      return { id: id, token: token };
    });
  },

  hideRow_: function(sessionId, name, idHeader, id, hidden, token) {
    return this.write_(sessionId, db => {
      const row = this.rows_(db, name).find(r => Number(r[idHeader]) === Number(id));
      if (!row) throw new Error('That entry was not found.');
      if (token !== undefined && String(row.Token) !== String(token)) throw new Error('Only the phone that sent this can remove it.');
      this.put_(db, name, row._row, { Hidden: hidden ? 'yes' : 'no' });
      return true;
    });
  },

  setSignalHidden: function(sessionId, id, hidden, token) { return this.hideRow_(sessionId, 'signals', 'Signal', id, hidden, token); },

  /** Adds or edits a table's flip statement; editing rewrites it on that table's cards. */
  saveFlip: function(sessionId, template, table, id, text) {
    return this.write_(sessionId, db => {
      const rows = this.rows_(db, 'flips');
      if (!id) {
        const own = rows.filter(r => Number(r.Table) === table && String(r.Hidden) !== 'yes');
        if (own.length >= template.parent.perTableMax) throw new Error('A table can have up to ' + template.parent.perTableMax + ' ' + template.parent.plural + '.');
        const newId = this.nextId_(rows, 'Flip');
        this.put_(db, 'flips', 0, { Flip: newId, Updated: new Date(), Table: table, Text: text, Top: 'no', Hidden: 'no' });
        return { id: newId };
      }
      const row = rows.find(r => Number(r.Flip) === Number(id) && Number(r.Table) === table);
      if (!row) throw new Error('That ' + template.parent.label.toLowerCase() + ' belongs to another table.');
      this.put_(db, 'flips', row._row, { Text: text, Updated: new Date() });
      this.rows_(db, 'cards').filter(c => Number(c['Flip ID']) === Number(id)).forEach(c => this.put_(db, 'cards', c._row, { 'Flip statement': text }));
      return { id: Number(id) };
    });
  },

  setFlipFlags: function(sessionId, template, table, id, flags) {
    return this.write_(sessionId, db => {
      const row = this.rows_(db, 'flips').find(r => Number(r.Flip) === Number(id) && (table === null || Number(r.Table) === table));
      if (!row) throw new Error('That ' + template.parent.label.toLowerCase() + ' was not found.');
      const values = { Updated: new Date() };
      if (flags.top !== undefined) values.Top = flags.top ? 'yes' : 'no';
      if (flags.hidden !== undefined) values.Hidden = flags.hidden ? 'yes' : 'no';
      this.put_(db, 'flips', row._row, values);
      return true;
    });
  },

  /** One row per person; sending again replaces their dots. */
  saveFlipDots: function(sessionId, entry) {
    return this.write_(sessionId, db => {
      const row = this.rows_(db, 'flipDots').find(r => String(r.Voter) === entry.voter);
      this.put_(db, 'flipDots', row ? row._row : 0, { Voter: entry.voter, Role: entry.role, Dots: JSON.stringify(entry.dots), Updated: new Date() });
      return true;
    });
  },

  appendCard: function(sessionId, template, card) {
    return this.write_(sessionId, db => {
      const rows = this.rows_(db, 'cards');
      if (rows.length >= CAPTURE_DEFAULTS.MAX_CARDS_PER_SESSION) throw new Error('This session has reached its card limit. Tell a facilitator.');
      const id = this.nextId_(rows, 'Card');
      const token = Utilities.getUuid().replace(/-/g, '');
      const primary = template.fields[0];
      this.put_(db, 'cards', 0, {
        Card: id, Submitted: new Date(), Table: card.table, Level: card.level, Source: card.source, Hidden: 'no', Token: token,
        Role: card.role, 'Flip ID': card.flipId, 'Flip statement': card.fields[template.parent.key], Need: card.fields[primary.key]
      });
      return { id: id, token: token };
    });
  },

  setHidden: function(sessionId, template, id, hidden, token) { return this.hideRow_(sessionId, 'cards', 'Card', id, hidden, token); },

  writeGroups: function(sessionId, groups) {
    return this.write_(sessionId, db => {
      const sheet = this.sheet_(db, 'groups', true);
      const last = sheet.getLastRow();
      const width = this.SPECS.groups.headers.length;
      if (last > 1) sheet.getRange(2, 1, last - 1, width).clearContent();
      const now = new Date();
      const rows = groups.map(g => [g.rank || '', captureSheetSafe_(g.topic), g.columnOverride || '', g.cardIds.join(', '), captureSheetSafe_(g.id), now]);
      if (rows.length) sheet.getRange(2, 1, rows.length, width).setValues(rows);
      return rows.length;
    });
  },

  /** One row per person; sending again replaces their votes. */
  saveVote: function(sessionId, vote) {
    return this.write_(sessionId, db => {
      const row = this.rows_(db, 'votes').find(r => String(r.Voter) === vote.voter);
      this.put_(db, 'votes', row ? row._row : 0, { Voter: vote.voter, Role: vote.role, Choices: vote.choices.join(','), Updated: new Date() });
      return true;
    });
  },

  clearVotes: function(sessionId) {
    return this.write_(sessionId, db => {
      const sheet = this.sheet_(db, 'votes', false);
      if (sheet && sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, this.SPECS.votes.headers.length).clearContent();
      return true;
    });
  },

  /** One row per table. */
  saveTestDrive: function(sessionId, template, table, group, notes) {
    return this.write_(sessionId, db => {
      const row = this.rows_(db, 'testDrive').find(r => Number(r.Table) === table);
      this.put_(db, 'testDrive', row ? row._row : 0, {
        Table: table, 'Group ID': group ? group.id : '', Topic: group ? group.topic : '',
        Change: notes.change, Add: notes.add, Cut: notes.cut, 'Beyond guidance': notes.beyond, Updated: new Date()
      });
      return true;
    });
  },

  write_: function(sessionId, action) {
    return this.withLock_(() => {
      try { return action(this.db(sessionId)); } finally { this.invalidate_(sessionId); }
    });
  },

  withLock_: function(action) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) throw new Error('Busy saving other entries. Try again in a moment.');
    try { return action(); } finally { lock.releaseLock(); }
  }
};

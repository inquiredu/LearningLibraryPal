/**
 * CaptureStore
 * Live capture lives in the session's own Project Database:
 *   Live Capture    key/value settings (template, tables, table key, stage,
 *                   published groups, paper dots, tally mode, assignments, survey)
 *   Live Signals    one row per signal
 *   Live Flips      one row per flip statement, with its original wording; a table marks its top ones
 *   Live Flip Dots  one row per person: their gallery dots on flip statements
 *   Live Cards      one row per need card, with the AI reading when it came from a photo
 *   Live Groups     the synthesis team's working groups, rewritten whole on save
 *   Live Votes      one row per person: their priority votes
 *   Live Test Drive one row per table and device: its notes on the guidance
 *   Live Audit      one row per change: who, when, what, before and after, and
 *                   for AI calls the model, tokens, cost and the raw answer
 * Nothing is deleted: removing an entry hides it, and the audit row says who
 * hid it. Rows are read and written by header name, so a column added later
 * goes at the end and older sheets keep working. Writes, and the audit row
 * that describes them, run together under the script lock, and are flushed to
 * the Sheet before the lock is let go.
 *
 * Speed: every device checks in every few seconds, so reads come from
 * CacheService. The snapshot of all rows is cached in chunks (one cache value
 * holds at most 100 KB) for a few seconds and is not thrown away on writes;
 * whoever just changed something asks for a fresh one, so they see their own
 * change at once and everyone else within seconds. Settings and the session's
 * spreadsheet id are cached and rewritten on every change. Within one request,
 * the spreadsheet, its tabs and their header rows are fetched once.
 */

const CaptureStore = {
  CONFIG_SHEET: 'Live Capture',
  SNAPSHOT_SECONDS: 5,
  CONFIG_SECONDS: 120,
  GENERATION_SECONDS: 21600,
  CHUNK: 90000,
  HEADER_COLOR: '#003865',
  CELL_MAX: 45000,

  SPECS: {
    signals: { sheet: 'Live Signals', headers: ['Signal', 'Submitted', 'Table', 'Role', 'Text', 'Hidden', 'Token', 'Source', 'Photo'] },
    flips: { sheet: 'Live Flips', headers: ['Flip', 'Updated', 'Table', 'Text', 'Top', 'Hidden', 'Original text', 'Source', 'Photo'] },
    flipDots: { sheet: 'Live Flip Dots', headers: ['Voter', 'Role', 'Dots', 'Updated'] },
    cards: { sheet: 'Live Cards', headers: ['Card', 'Submitted', 'Table', 'Level', 'Source', 'Hidden', 'Token', 'Role', 'Flip ID', 'Flip statement', 'Need', 'AI reading', 'Photo'] },
    groups: { sheet: 'Live Groups', headers: ['Rank', 'Topic', 'Column override', 'Card IDs', 'Group ID', 'Updated'] },
    votes: { sheet: 'Live Votes', headers: ['Voter', 'Role', 'Choices', 'Updated'] },
    testDrive: { sheet: 'Live Test Drive', headers: ['Table', 'Group ID', 'Topic', 'Change', 'Add', 'Cut', 'Beyond guidance', 'Updated', 'Device', 'Source', 'Photo'] },
    audit: { sheet: 'Live Audit', headers: ['Entry', 'Time', 'Actor', 'Stage', 'Action', 'Item', 'IDs', 'Before', 'After', 'Model', 'Tokens', 'Cost (USD)', 'Photo', 'Detail'] }
  },
  // Earlier sheets named the need column after its prompt.
  ALIASES: { 'Need': ['To close this gap, students and educators need…', 'To address this gap, schools and educators need…'] },
  NOTE_COLUMNS: { change: 'Change', add: 'Add', cut: 'Cut', beyond: 'Beyond guidance' },

  // Who is acting and in which stage, set by CaptureApi for the current request.
  context_: { actor: '', stage: '' },
  as: function(actor, stage) { this.context_ = { actor: String(actor || ''), stage: String(stage || '') }; return this; },

  memo_: { dbs: {}, sheets: {}, headers: {} },

  /**
   * The session's name and links, cached: looking a session up reads the whole
   * master Sessions sheet. Returns { id, name, dbUrl, folderUrl } or null.
   */
  sessionInfo: function(sessionId) {
    const cache = CacheService.getScriptCache();
    const key = 'capture_sess_' + sessionId;
    const hit = cache.get(key);
    if (hit) { try { return JSON.parse(hit); } catch (e) {} }
    const s = SessionService.getSession(sessionId);
    if (!s) return null;
    const info = { id: s.id, name: String(s.name || ''), dbUrl: String(s.dbUrl || ''), folderUrl: String(s.folderUrl || '') };
    try { cache.put(key, JSON.stringify(info), 600); } catch (e) {}
    return info;
  },

  db: function(sessionId) {
    if (this.memo_.dbs[sessionId]) return this.memo_.dbs[sessionId];
    const session = this.sessionInfo(sessionId);
    if (!session || !session.dbUrl) throw new Error('This session link is not available.');
    const match = String(session.dbUrl).match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (!match) throw new Error('This session has no Project Database.');
    const db = SpreadsheetApp.openById(match[1]);
    this.memo_.dbs[sessionId] = db;
    return db;
  },

  /** Clears the per-request memo (tests and long runs). */
  forget: function() { this.memo_ = { dbs: {}, sheets: {}, headers: {} }; },

  // ─── Settings ─────────────────────────────────────────────────────────────

  JSON_KEYS: ['published', 'paperDots', 'assign', 'paperFlipDots'],
  CONFIG_KEYS: ['template', 'tables', 'key', 'title', 'stage', 'published', 'publishedAt', 'paperDots', 'tallyMode', 'assign', 'surveyUrl', 'paperFlipDots', 'facilitatorKey'],

  /**
   * Settings come from the cache when the cached copy is current. Each write
   * gives the settings a new generation; a cached copy is used only while it
   * carries the current one. So a device that read the Sheet just before a
   * stage move, and cached what it read just after, can't put the old stage
   * back: its copy carries the old generation and the next reader ignores it.
   */
  cachedConfig_: function(sessionId, peek) {
    const cache = CacheService.getScriptCache();
    const cfgKey = 'capture_cfg_' + sessionId, genKey = 'capture_cfgv_' + sessionId, offKey = 'capture_off_' + sessionId;
    let got = {};
    try { got = cache.getAll(peek ? [cfgKey, genKey, offKey] : [cfgKey, genKey]) || {}; } catch (e) { got = {}; }
    const gen = typeof got[genKey] === 'string' ? got[genKey] : '';
    if (typeof got[cfgKey] === 'string') {
      try { const hit = JSON.parse(got[cfgKey]); if (hit && hit.c && hit.v === gen) return hit.c; } catch (e) {}
    }
    if (peek && got[offKey] === 'off:' + gen) return null;
    const config = this.readConfig_(sessionId);
    try {
      if (config) cache.put(cfgKey, JSON.stringify({ v: gen, c: config }), this.CONFIG_SECONDS);
      else if (peek) cache.put(offKey, 'off:' + gen, this.CONFIG_SECONDS);
    } catch (e) {}
    return config;
  },

  getConfig: function(sessionId) { return this.cachedConfig_(sessionId, false); },

  /**
   * getConfig for the dashboard, which asks about every session: also
   * remembers for a while that a session has no live capture, so the
   * dashboard doesn't open that session's spreadsheet on every load.
   */
  peekConfig: function(sessionId) { return this.cachedConfig_(sessionId, true); },

  readConfig_: function(sessionId) {
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
      paperFlipDots: json(map.paperFlipDots, {}),
      tallyMode: ['phone', 'paper', 'both'].indexOf(String(map.tallyMode)) !== -1 ? String(map.tallyMode) : 'phone',
      assign: json(map.assign, {}),
      surveyUrl: /^https:\/\//.test(String(map.surveyUrl || '')) ? String(map.surveyUrl) : '',
      // Set when the owner makes a facilitator link; empty means there is none.
      facilitatorKey: /^[a-f0-9]{32}$/.test(String(map.facilitatorKey || '')) ? String(map.facilitatorKey) : ''
    };
  },

  writeConfig_: function(sessionId, config) {
    const db = this.db(sessionId);
    let sheet = db.getSheetByName(this.CONFIG_SHEET);
    if (!sheet) sheet = db.insertSheet(this.CONFIG_SHEET);
    const rows = [['Setting', 'Value']].concat(this.CONFIG_KEYS.map(k => {
      const v = config[k];
      if (this.JSON_KEYS.indexOf(k) !== -1) return [k, v ? JSON.stringify(v) : ''];
      return [k, captureSheetSafe_(v === undefined || v === null ? '' : v)];
    }));
    // Written over the old rows, never cleared first, so a device reading at
    // that instant can't find the settings empty.
    sheet.getRange(1, 1, rows.length, 2).setValues(rows);
    const last = sheet.getLastRow();
    if (last > rows.length) sheet.getRange(rows.length + 1, 1, last - rows.length, 2).clearContent();
    sheet.getRange(1, 1, 1, 2).setBackground(this.HEADER_COLOR).setFontColor('#FFFFFF').setFontWeight('bold');
    // Commit, then start a new generation and cache the new settings under it,
    // so a stage change reaches every device on its next check-in. Anyone who
    // sees the new generation reads a Sheet that already has this write.
    try { SpreadsheetApp.flush(); } catch (e) {}
    const cache = CacheService.getScriptCache();
    const gen = Utilities.getUuid();
    try { cache.put('capture_cfgv_' + sessionId, gen, this.GENERATION_SECONDS); cache.remove('capture_off_' + sessionId); } catch (e) {}
    // The dashboard shows each session's stage and links: let it see this change on its next load.
    try { if (typeof DASHBOARD_CACHE_KEY_ === 'string') cache.remove(DASHBOARD_CACHE_KEY_); } catch (e) {}
    const fresh = this.readConfig_(sessionId);
    if (fresh) { try { cache.put('capture_cfg_' + sessionId, JSON.stringify({ v: gen, c: fresh }), this.CONFIG_SECONDS); } catch (e) {} }
  },

  /**
   * Changes some settings under the lock and returns the new config.
   * log: { action, item, ids, before(config), after(next) } for the audit trail.
   */
  updateConfig: function(sessionId, change, log) {
    return this.withLock_(() => {
      const config = this.readConfig_(sessionId);
      if (!config) throw new Error('Turn on live capture for this session first.');
      const next = Object.assign({}, config, change(config) || {});
      this.writeConfig_(sessionId, next);
      if (log) {
        this.log_(this.db(sessionId), {
          action: log.action, item: log.item, ids: log.ids,
          before: log.before ? log.before(config) : '', after: log.after ? log.after(next) : '', detail: log.detail
        });
      }
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
      const existing = this.readConfig_(sessionId) || {};
      const config = Object.assign({ stage: template.stages[0].id, tallyMode: 'phone', paperDots: {}, paperFlipDots: {}, assign: {}, published: null, publishedAt: '', surveyUrl: '' }, existing, {
        template: template.id,
        tables: count,
        key: existing.key || Utilities.getUuid().replace(/-/g, '').slice(0, 20),
        title: captureCleanText_(title, 80) || existing.title || template.name
      });
      this.writeConfig_(sessionId, config);
      const db = this.db(sessionId);
      Object.keys(this.SPECS).forEach(name => this.sheet_(db, name, true));
      this.log_(db, { action: existing.template ? 'Live capture settings changed' : 'Live capture turned on', item: 'session',
        before: existing.template ? { tables: existing.tables, title: existing.title } : '', after: { template: template.id, tables: count, title: config.title } });
      return config;
    });
  },

  // ─── Rows by header ───────────────────────────────────────────────────────

  headers_: function(sheet) {
    const key = sheet.getName ? sheet.getName() : '';
    if (key && this.memo_.headers[key]) return this.memo_.headers[key];
    const width = sheet.getLastColumn();
    const headers = width ? sheet.getRange(1, 1, 1, width).getValues()[0].map(String) : [];
    if (key) this.memo_.headers[key] = headers;
    return headers;
  },

  /** The sheet for a spec, with any missing headers added at the end. */
  sheet_: function(db, name, create) {
    const spec = this.SPECS[name];
    const memo = this.memo_.sheets[spec.sheet];
    if (memo && (memo.checked || !create)) return memo.sheet;
    let sheet = memo ? memo.sheet : db.getSheetByName(spec.sheet);
    if (!sheet) {
      if (!create) return null;
      sheet = db.insertSheet(spec.sheet);
      sheet.getRange(1, 1, 1, spec.headers.length).setValues([spec.headers])
        .setBackground(this.HEADER_COLOR).setFontColor('#FFFFFF').setFontWeight('bold');
      sheet.setFrozenRows(1);
      this.memo_.headers[spec.sheet] = spec.headers.slice();
      this.memo_.sheets[spec.sheet] = { sheet: sheet, checked: true };
      return sheet;
    }
    if (create) {
      const have = this.headers_(sheet);
      const missing = spec.headers.filter(h => this.columnOf_(have, h) === -1);
      if (missing.length) {
        sheet.getRange(1, have.length + 1, 1, missing.length).setValues([missing])
          .setBackground(this.HEADER_COLOR).setFontColor('#FFFFFF').setFontWeight('bold');
        this.memo_.headers[spec.sheet] = have.concat(missing);
      }
    }
    this.memo_.sheets[spec.sheet] = { sheet: sheet, checked: !!create };
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
    const headers = this.headers_(sheet);
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

  // ─── Audit ────────────────────────────────────────────────────────────────

  text_: function(value) {
    if (value === undefined || value === null || value === '') return '';
    const s = typeof value === 'string' ? value : JSON.stringify(value);
    return s.length > this.CELL_MAX ? s.slice(0, this.CELL_MAX) + ' …[cut at ' + this.CELL_MAX + ' characters]' : s;
  },

  /**
   * Appends one audit row and returns its entry number. Called inside the
   * same lock as the change it describes, so the two can't drift apart.
   * e: { action, item, ids, before, after, model, tokens, cost, photo, detail }
   */
  log_: function(db, e) {
    const sheet = this.sheet_(db, 'audit', true);
    const entry = Math.max(1, sheet.getLastRow());
    this.put_(db, 'audit', 0, {
      Entry: entry, Time: new Date(), Actor: this.context_.actor || 'unknown', Stage: this.context_.stage,
      Action: e.action, Item: e.item || '', IDs: Array.isArray(e.ids) ? e.ids.join(', ') : String(e.ids === undefined ? '' : e.ids),
      Before: this.text_(e.before), After: this.text_(e.after), Model: e.model || '', Tokens: e.tokens || '',
      'Cost (USD)': e.cost === undefined || e.cost === '' ? '' : Number(e.cost), Photo: e.photo || '', Detail: this.text_(e.detail)
    });
    return entry;
  },

  /** An audit entry made outside another write (AI calls, documents made). */
  audit: function(sessionId, e) {
    return this.write_(sessionId, db => this.log_(db, e));
  },

  /** The newest `count` audit rows, newest first. */
  auditTail: function(sessionId, count) {
    const sheet = this.sheet_(this.db(sessionId), 'audit', false);
    if (!sheet || sheet.getLastRow() < 2) return { total: 0, rows: [] };
    const last = sheet.getLastRow(), n = Math.min(count, last - 1);
    const headers = this.headers_(sheet);
    const values = sheet.getRange(last - n + 1, 1, n, headers.length).getValues();
    const rows = values.map(v => { const o = {}; headers.forEach((h, i) => { o[h] = v[i] instanceof Date ? v[i].toISOString() : v[i]; }); return o; }).reverse();
    return { total: last - 1, rows: rows };
  },

  /** One audit row by entry number, or null. */
  auditEntry: function(sessionId, entry) {
    const sheet = this.sheet_(this.db(sessionId), 'audit', false);
    const n = Number(entry);
    if (!sheet || !Number.isInteger(n) || n < 1 || n + 1 > sheet.getLastRow()) return null;
    const headers = this.headers_(sheet);
    const v = sheet.getRange(n + 1, 1, 1, headers.length).getValues()[0];
    const o = {};
    headers.forEach((h, i) => { o[h] = v[i]; });
    return Number(o.Entry) === n ? o : null;
  },

  // ─── Reading everything at once ───────────────────────────────────────────

  /**
   * Everything devices, the wall and the board read, cached for a few seconds.
   * fresh: true reads the sheet now (whoever just made a change); otherwise a
   * snapshot up to SNAPSHOT_SECONDS old is fine.
   */
  snapshot: function(sessionId, template, fresh) {
    if (!fresh) {
      const hit = this.cacheGet_('capture_snap_' + sessionId);
      if (hit) { try { return JSON.parse(hit); } catch (e) {} }
    }
    const db = this.db(sessionId);
    const bool = v => String(v) === 'yes';
    const iso = v => (v instanceof Date ? v.toISOString() : String(v || ''));
    const snap = {
      signals: this.rows_(db, 'signals').map(r => ({ id: Number(r.Signal), submittedAt: iso(r.Submitted), table: Number(r.Table), role: String(r.Role), text: String(r.Text),
        hidden: bool(r.Hidden), token: String(r.Token), source: String(r.Source || 'typed'), photo: String(r.Photo || '') })),
      flips: this.rows_(db, 'flips').map(r => ({ id: Number(r.Flip), table: Number(r.Table), text: String(r.Text), top: bool(r.Top), hidden: bool(r.Hidden),
        originalText: String(r['Original text'] || r.Text), source: String(r.Source || 'typed') })),
      flipDots: this.rows_(db, 'flipDots').map(r => ({ voter: String(r.Voter), role: String(r.Role), dots: this.json_(r.Dots, []) })),
      cards: this.rows_(db, 'cards').map(r => {
        const fields = {};
        fields[template.parent.key] = String(r['Flip statement'] || '');
        template.fields.forEach(f => { fields[f.key] = String(r.Need || ''); });
        return { id: Number(r.Card), submittedAt: iso(r.Submitted), table: Number(r.Table), level: String(r.Level), source: String(r.Source || 'typed'),
          hidden: bool(r.Hidden), token: String(r.Token), role: String(r.Role || ''), flipId: Number(r['Flip ID']) || 0, fields: fields,
          aiReading: String(r['AI reading'] || ''), photo: String(r.Photo || '') };
      }),
      groups: this.rows_(db, 'groups').map(r => ({
        rank: Number(r.Rank) || 0, topic: String(r.Topic || ''), columnOverride: String(r['Column override'] || ''), id: String(r['Group ID'] || ''),
        cardIds: String(r['Card IDs']).split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n > 0)
      })),
      votes: this.rows_(db, 'votes').map(r => ({ voter: String(r.Voter), role: String(r.Role), choices: String(r.Choices || '').split(',').map(s => s.trim()).filter(Boolean) })),
      testDrive: this.rows_(db, 'testDrive').map(r => {
        const notes = {};
        template.testDrive.prompts.forEach(p => { notes[p.key] = String(r[this.NOTE_COLUMNS[p.key]] || ''); });
        return { table: Number(r.Table), device: String(r.Device || ''), groupId: String(r['Group ID'] || ''), topic: String(r.Topic || ''), notes: notes,
          source: String(r.Source || 'typed'), updatedAt: iso(r.Updated) };
      })
    };
    // The flip-dot list is derived, so it is cached with the rows.
    snap.flipDots = snap.flipDots.reduce((all, p) => all.concat((p.dots || []).map(d => ({ flipId: Number(d.flipId), color: String(d.color), role: p.role, voter: p.voter }))), []);
    this.cachePut_('capture_snap_' + sessionId, JSON.stringify(snap), this.SNAPSHOT_SECONDS);
    return snap;
  },

  /** Stores a long string across several cache values (each holds at most 100 KB). */
  cachePut_: function(key, text, seconds) {
    const cache = CacheService.getScriptCache();
    const parts = {};
    let n = 0;
    for (let i = 0; i < text.length; i += this.CHUNK) parts[key + ':' + (n++)] = text.slice(i, i + this.CHUNK);
    parts[key] = String(n);
    try { cache.putAll(parts, seconds); } catch (e) {}
  },

  cacheGet_: function(key) {
    const cache = CacheService.getScriptCache();
    const count = Number(cache.get(key));
    if (!count || count > 200) return null;
    const keys = [];
    for (let i = 0; i < count; i++) keys.push(key + ':' + i);
    const got = cache.getAll(keys);
    let text = '';
    for (let i = 0; i < count; i++) { if (typeof got[keys[i]] !== 'string') return null; text += got[keys[i]]; }
    return text;
  },

  json_: function(v, fallback) { try { return v ? JSON.parse(String(v)) : fallback; } catch (e) { return fallback; } },

  /** Drops the cached snapshot (used when settings change, which the snapshot doesn't hold, so rarely needed). */
  invalidate_: function(sessionId) {
    try { CacheService.getScriptCache().remove('capture_snap_' + sessionId); } catch (e) {}
  },

  // ─── Writes ───────────────────────────────────────────────────────────────

  nextId_: function(rows, header) {
    return rows.reduce((max, r) => Math.max(max, Number(r[header]) || 0), 0) + 1;
  },

  /** The ids in a tab's first column, read without the rest of the row. */
  ids_: function(db, name) {
    const sheet = this.sheet_(db, name, false);
    if (!sheet) return [];
    const last = sheet.getLastRow();
    if (last < 2) return [];
    const header = this.SPECS[name].headers[0];
    return sheet.getRange(2, 1, last - 1, 1).getValues().map(r => { const o = {}; o[header] = r[0]; return o; }).filter(o => String(o[header]) !== '');
  },

  token_: function() { return Utilities.getUuid().replace(/-/g, ''); },

  /** signal: { table, role, text, source, photo } */
  addSignal_: function(db, signal, rows) {
    if (rows.length >= CAPTURE_DEFAULTS.MAX_SIGNALS_PER_SESSION) throw new Error('This session has reached its signal limit. Tell a facilitator.');
    const id = this.nextId_(rows, 'Signal');
    const token = this.token_();
    this.put_(db, 'signals', 0, { Signal: id, Submitted: new Date(), Table: signal.table, Role: signal.role, Text: signal.text, Hidden: 'no', Token: token,
      Source: signal.source || 'typed', Photo: signal.photo || '' });
    rows.push({ Signal: id });
    return { id: id, token: token };
  },

  addSignal: function(sessionId, signal) {
    return this.write_(sessionId, db => {
      const res = this.addSignal_(db, signal, this.ids_(db, 'signals'));
      this.log_(db, { action: 'Signal added', item: 'signal', ids: [res.id], after: { table: signal.table, role: signal.role, text: signal.text, source: signal.source || 'typed' } });
      return res;
    });
  },

  hideRow_: function(sessionId, name, idHeader, id, hidden, token) {
    return this.write_(sessionId, db => {
      const row = this.rows_(db, name).find(r => Number(r[idHeader]) === Number(id));
      if (!row) throw new Error('That entry was not found.');
      if (token !== undefined && String(row.Token) !== String(token)) throw new Error('Only the device that sent this can remove it.');
      this.put_(db, name, row._row, { Hidden: hidden ? 'yes' : 'no' });
      this.log_(db, { action: (hidden ? 'Hidden' : 'Shown again') + (token !== undefined ? ' by its writer' : ''), item: idHeader.toLowerCase(), ids: [Number(id)],
        before: { hidden: String(row.Hidden) === 'yes' }, after: { hidden: !!hidden } });
      return true;
    });
  },

  setSignalHidden: function(sessionId, id, hidden, token) { return this.hideRow_(sessionId, 'signals', 'Signal', id, hidden, token); },

  addFlip_: function(db, table, text, rows, extra) {
    const own = rows.filter(r => Number(r.Table) === table && String(r.Hidden) !== 'yes');
    if (own.length >= CAPTURE_DEFAULTS.MAX_FLIPS_PER_TABLE) throw new Error('This table has a great many statements already. Tell a facilitator.');
    const id = this.nextId_(rows, 'Flip');
    const x = extra || {};
    this.put_(db, 'flips', 0, { Flip: id, Updated: new Date(), Table: table, Text: text, Top: 'no', Hidden: 'no', 'Original text': text,
      Source: x.source || 'typed', Photo: x.photo || '' });
    rows.push({ Flip: id, Table: table, Hidden: 'no' });
    return id;
  },

  /**
   * Adds or edits a table's flip statement. Editing rewrites it on that
   * table's cards; the original wording stays in its row and the audit trail.
   */
  saveFlip: function(sessionId, template, table, id, text) {
    return this.write_(sessionId, db => {
      const rows = this.rows_(db, 'flips');
      if (!id) {
        const newId = this.addFlip_(db, table, text, rows);
        this.log_(db, { action: template.parent.label + ' added', item: 'flip', ids: [newId], after: { table: table, text: text } });
        return { id: newId };
      }
      const row = rows.find(r => Number(r.Flip) === Number(id) && Number(r.Table) === table);
      if (!row) throw new Error('That ' + template.parent.label.toLowerCase() + ' belongs to another table.');
      this.put_(db, 'flips', row._row, { Text: text, Updated: new Date() });
      if (!String(row['Original text'] || '')) this.put_(db, 'flips', row._row, { 'Original text': row.Text });
      const cards = this.rows_(db, 'cards').filter(c => Number(c['Flip ID']) === Number(id));
      cards.forEach(c => this.put_(db, 'cards', c._row, { 'Flip statement': text }));
      this.log_(db, { action: template.parent.label + ' edited', item: 'flip', ids: [Number(id)], before: { text: String(row.Text) }, after: { text: text },
        detail: cards.length ? 'Also updated on cards ' + cards.map(c => c.Card).join(', ') : '' });
      return { id: Number(id) };
    });
  },

  setFlipFlags: function(sessionId, template, table, id, flags) {
    return this.write_(sessionId, db => {
      const row = this.rows_(db, 'flips').find(r => Number(r.Flip) === Number(id) && (table === null || Number(r.Table) === table));
      if (!row) throw new Error('That ' + template.parent.label.toLowerCase() + ' was not found.');
      const values = { Updated: new Date() }, before = {}, after = {};
      if (flags.top !== undefined) { values.Top = flags.top ? 'yes' : 'no'; before.top = String(row.Top) === 'yes'; after.top = !!flags.top; }
      if (flags.hidden !== undefined) { values.Hidden = flags.hidden ? 'yes' : 'no'; before.hidden = String(row.Hidden) === 'yes'; after.hidden = !!flags.hidden; }
      this.put_(db, 'flips', row._row, values);
      this.log_(db, { action: flags.hidden !== undefined ? (flags.hidden ? 'Hidden' : 'Shown again') : (flags.top ? 'Marked top' : 'Top mark removed'),
        item: 'flip', ids: [Number(id)], before: before, after: after });
      return true;
    });
  },

  /** One row per person; sending again replaces their dots. */
  saveFlipDots: function(sessionId, entry) {
    return this.write_(sessionId, db => {
      const row = this.rows_(db, 'flipDots').find(r => String(r.Voter) === entry.voter);
      this.put_(db, 'flipDots', row ? row._row : 0, { Voter: entry.voter, Role: entry.role, Dots: JSON.stringify(entry.dots), Updated: new Date() });
      this.log_(db, { action: 'Gallery dots saved', item: 'dots', ids: [entry.voter.slice(0, 8)], before: row ? this.json_(row.Dots, []) : '', after: entry.dots });
      return true;
    });
  },

  /** card: { table, level, role, flipId, fields, source, aiReading, photo } */
  appendCard_: function(db, template, card, rows) {
    if (rows.length >= CAPTURE_DEFAULTS.MAX_CARDS_PER_SESSION) throw new Error('This session has reached its card limit. Tell a facilitator.');
    const id = this.nextId_(rows, 'Card');
    const token = this.token_();
    const primary = template.fields[0];
    this.put_(db, 'cards', 0, {
      Card: id, Submitted: new Date(), Table: card.table, Level: card.level, Source: card.source, Hidden: 'no', Token: token,
      Role: card.role, 'Flip ID': card.flipId || '', 'Flip statement': card.fields[template.parent.key], Need: card.fields[primary.key],
      'AI reading': card.aiReading || '', Photo: card.photo || ''
    });
    rows.push({ Card: id });
    return { id: id, token: token };
  },

  appendCard: function(sessionId, template, card) {
    return this.write_(sessionId, db => {
      const res = this.appendCard_(db, template, card, this.ids_(db, 'cards'));
      const primary = template.fields[0];
      this.log_(db, { action: 'Card sent', item: 'card', ids: [res.id],
        after: { table: card.table, role: card.role, level: card.level, flipId: card.flipId || 0, need: card.fields[primary.key], source: card.source },
        before: card.aiReading ? { aiReading: card.aiReading } : '',
        detail: card.aiReading ? (card.aiReading === card.fields[primary.key] ? 'Sent as the AI read it.' : 'Edited after the AI reading.') : '' });
      return res;
    });
  },

  setHidden: function(sessionId, template, id, hidden, token) { return this.hideRow_(sessionId, 'cards', 'Card', id, hidden, token); },

  writeGroups: function(sessionId, groups, how) {
    return this.write_(sessionId, db => {
      const brief = list => list.map(g => ({ id: g.id, topic: g.topic, cards: g.cardIds, column: g.columnOverride || '' }));
      const before = this.rows_(db, 'groups').map(r => ({ id: String(r['Group ID']), topic: String(r.Topic), cards: String(r['Card IDs']), column: String(r['Column override'] || '') }));
      const sheet = this.sheet_(db, 'groups', true);
      const last = sheet.getLastRow();
      const width = this.SPECS.groups.headers.length;
      if (last > 1) sheet.getRange(2, 1, last - 1, width).clearContent();
      const now = new Date();
      const rows = groups.map(g => [g.rank || '', captureSheetSafe_(g.topic), g.columnOverride || '', g.cardIds.join(', '), captureSheetSafe_(g.id), now]);
      if (rows.length) sheet.getRange(2, 1, rows.length, width).setValues(rows);
      const after = brief(groups);
      if (JSON.stringify(before.map(g => [g.id, g.topic, String(g.cards), g.column])) !== JSON.stringify(after.map(g => [g.id, g.topic, g.cards.join(', '), g.column]))) {
        this.log_(db, { action: how && how.action || 'Groups edited', item: 'groups', ids: groups.length + ' groups', before: before, after: after,
          model: how && how.model, tokens: how && how.tokens, cost: how && how.cost, detail: how && how.detail });
      }
      return rows.length;
    });
  },

  /** One row per person; sending again replaces their votes. */
  saveVote: function(sessionId, vote) {
    return this.write_(sessionId, db => {
      const row = this.rows_(db, 'votes').find(r => String(r.Voter) === vote.voter);
      this.put_(db, 'votes', row ? row._row : 0, { Voter: vote.voter, Role: vote.role, Choices: vote.choices.join(','), Updated: new Date() });
      this.log_(db, { action: 'Votes saved', item: 'votes', ids: [vote.voter.slice(0, 8)], before: row ? String(row.Choices) : '', after: { role: vote.role, choices: vote.choices } });
      return true;
    });
  },

  clearVotes: function(sessionId) {
    return this.write_(sessionId, db => {
      const rows = this.rows_(db, 'votes');
      const sheet = this.sheet_(db, 'votes', false);
      if (sheet && sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
      this.log_(db, { action: 'All device votes cleared', item: 'votes', ids: rows.length + ' voters',
        before: rows.map(r => ({ voter: String(r.Voter).slice(0, 8), role: String(r.Role), choices: String(r.Choices) })) });
      return true;
    });
  },

  /** One row per table and device: everyone at a table can keep their own notes. */
  saveTestDrive_: function(db, template, table, device, group, notes, extra) {
    const x = extra || {};
    const row = device ? this.rows_(db, 'testDrive').find(r => Number(r.Table) === table && String(r.Device) === device) : null;
    const values = { Table: table, 'Group ID': group ? group.id : '', Topic: group ? group.topic : '', Updated: new Date(), Device: device || '',
      Source: x.source || 'typed', Photo: x.photo || '' };
    template.testDrive.prompts.forEach(p => { values[this.NOTE_COLUMNS[p.key]] = notes[p.key] || ''; });
    this.put_(db, 'testDrive', row ? row._row : 0, values);
    const before = {};
    if (row) template.testDrive.prompts.forEach(p => { before[p.key] = String(row[this.NOTE_COLUMNS[p.key]] || ''); });
    return row ? before : '';
  },

  saveTestDrive: function(sessionId, template, table, device, group, notes) {
    return this.write_(sessionId, db => {
      const before = this.saveTestDrive_(db, template, table, device, group, notes);
      this.log_(db, { action: 'Test-drive notes saved', item: 'testdrive', ids: ['table ' + table], before: before, after: notes });
      return true;
    });
  },

  /**
   * Adds rows people confirmed from paper, in one lock with one audit entry.
   * rows are already checked by captureValidatePaperRows_. meta: { photo,
   * readingEntry, diff, config change fn for dot counts }
   */
  addFromPaper: function(sessionId, template, mode, rows, meta) {
    const m = meta || {};
    return this.withLock_(() => {
      const db = this.db(sessionId);
      const ids = [], replaced = {};
      try {
        const extra = { source: 'paper', photo: m.photo || '' };
        if (mode === 'signals') {
          const existing = this.rows_(db, 'signals');
          rows.forEach(r => ids.push(this.addSignal_(db, { table: r.table, role: r.role, text: r.text, source: 'paper', photo: m.photo }, existing).id));
        } else if (mode === 'flips') {
          const existing = this.rows_(db, 'flips');
          rows.forEach(r => ids.push(this.addFlip_(db, r.table, r.text, existing, extra)));
        } else if (mode === 'cards') {
          const existing = this.rows_(db, 'cards');
          rows.forEach(r => {
            const fields = {};
            fields[template.parent.key] = r.flipText;
            fields[template.fields[0].key] = r.need;
            ids.push(this.appendCard_(db, template, { table: r.table, level: r.level, role: r.role, flipId: r.flipId, fields: fields, source: 'paper',
              aiReading: r.aiReading || '', photo: m.photo }, existing).id);
          });
        } else if (mode === 'testdrive') {
          rows.forEach(r => { this.saveTestDrive_(db, template, r.table, 'paper-' + this.token_().slice(0, 8), r.group || null, r, extra); ids.push('table ' + r.table); });
        } else {
          // Dot counts live in the settings, keyed by flip statement or published group.
          const config = this.readConfig_(sessionId);
          const key = mode === 'flipdots' ? 'paperFlipDots' : 'paperDots';
          const next = Object.assign({}, config[key]);
          rows.forEach(r => {
            const id = mode === 'flipdots' ? r.flipId : r.groupId;
            // A new count for the same statement or topic replaces the earlier one; the audit row keeps what it was.
            if (next[id] !== undefined) replaced[id] = next[id];
            if (mode === 'flipdots') { next[id] = r.counts; ids.push('flip ' + id); }
            else { const o = { unmarked: r.unmarked || 0 }; template.roles.forEach(x => { o[x.code] = r[x.code]; }); next[id] = o; ids.push(id); }
          });
          const change = {}; change[key] = next;
          this.writeConfig_(sessionId, Object.assign({}, config, change));
        }
        const entry = this.log_(db, { action: 'Added from paper: ' + CAPTURE_PAPER_MODES_[mode].label, item: mode, ids: ids, after: rows, photo: m.photo || '',
          before: Object.keys(replaced).length ? { replaced: replaced } : '',
          detail: m.readingEntry ? 'From AI reading in audit entry ' + m.readingEntry + '. ' + m.diff.asRead + ' rows as read, ' + m.diff.edited + ' edited, ' + m.diff.added +
            ' added by hand, ' + m.diff.dropped + ' left out.' : 'Typed in from paper, no AI reading.' });
        return { ids: ids, entry: entry };
      } finally {
        this.invalidate_(sessionId);
      }
    });
  },

  write_: function(sessionId, action) {
    return this.withLock_(() => action(this.db(sessionId)));
  },

  withLock_: function(action) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) throw new Error('Busy saving other entries. Try again in a moment.');
    try {
      return action();
    } finally {
      // Apps Script may hold Sheet writes until the script ends. Commit them
      // while this execution still has the lock, so the next writer reads them
      // (new entry numbers are the highest so far + 1). Google's docs for
      // Lock.releaseLock() say to flush first when working with a spreadsheet.
      try { SpreadsheetApp.flush(); } finally { lock.releaseLock(); }
    }
  }
};

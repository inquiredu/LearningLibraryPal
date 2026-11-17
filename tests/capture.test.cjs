const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const source = name => fs.readFileSync(path.join(ROOT, name), 'utf8');
function load(files, globals = {}) {
  const context = vm.createContext({ console: { log() {}, error() {} }, ...globals });
  files.forEach(file => vm.runInContext(source(file), context, { filename: file }));
  context.eval = code => vm.runInContext(code, context);
  return context;
}
const logic = () => load(['CaptureTemplates.js', 'CaptureLogic.js']);
const card = (id, table, level, need = 'Need ' + id, extra = {}) =>
  ({ id, table, level, source: 'typed', hidden: false, fields: { flip: 'Right now x, but we need y', need }, ...extra });

// ─── Validation and cleaning ────────────────────────────────────────────────

test('a table card is validated against the template and cleaned', () => {
  const c = logic();
  c.input = { table: '3', level: 'G+', sources: ['photo', 'typed'], fields: { flip: 'IGNORED: cards cannot set it', need: '  PD​ time\u0007 ' } };
  c.saved = { flip: '  Right now a, but we need b ' };
  const out = c.eval('captureValidateCard_(CAPTURE_TEMPLATES.needCards, input, 6, saved)');
  assert.equal(out.table, 3);
  assert.equal(out.fields.flip, 'Right now a, but we need b', 'the flip statement comes from the table, not the card');
  assert.equal(out.fields.need, 'PD time');
  assert.equal(out.level, 'G+');
  assert.equal(out.source, 'typed+photo');
});

test('a card is refused without a table, a need, a known level, or its table\'s flip statement', () => {
  const c = logic();
  c.saved = { flip: 'Right now a, but we need b' };
  const bad = [
    { table: 0, level: 'G', fields: { need: 'b' } },
    { table: 7, level: 'G', fields: { need: 'b' } },
    { table: 1, level: 'G', fields: { need: '​ ' } },
    { table: 1, level: 'X', fields: { need: 'b' } },
    null
  ];
  bad.forEach(input => { c.input = input; assert.throws(() => c.eval('captureValidateCard_(CAPTURE_TEMPLATES.needCards, input, 6, saved)')); });
  c.input = { table: 1, level: 'G', fields: { flip: 'typed on the card', need: 'b' } };
  assert.throws(() => c.eval('captureValidateCard_(CAPTURE_TEMPLATES.needCards, input, 6, {})'), /flip statement first/);
});

test('long text is cut at the field limit without leaving half a surrogate pair', () => {
  const c = logic();
  const text = 'a'.repeat(399) + '😀';
  assert.equal(c.captureCleanText_(text, 400), 'a'.repeat(399));
});

test('text that Sheets would run as a formula is stored as text', () => {
  const c = logic();
  for (const v of ['=IMPORTXML("x")', '+1', '-2', '@me']) assert.equal(c.captureSheetSafe_(v), "'" + v);
  assert.equal(c.captureSheetSafe_('Plain words'), 'Plain words');
});

test('a photo reading keeps only template fields and known levels', () => {
  const c = logic();
  c.raw = { flip: 'Right now [illegible]', need: 'Lessons', level: 'Z', confidence: 'certain', extra: 'ignored' };
  const r = c.eval('captureCleanReading_(CAPTURE_TEMPLATES.needCards, raw)');
  assert.deepEqual(JSON.parse(JSON.stringify(r)), { fields: { flip: 'Right now [illegible]', need: 'Lessons' }, level: '', confidence: 'low', empty: false });
  c.raw = { flip: '', need: '', level: '', confidence: 'high' };
  assert.equal(c.eval('captureCleanReading_(CAPTURE_TEMPLATES.needCards, raw)').empty, true);
});

// ─── Groups ─────────────────────────────────────────────────────────────────

test('groups always hold each live card exactly once', () => {
  const c = logic();
  c.cards = [card(1, 1, 'G'), card(2, 2, 'B'), card(3, 3, 'G+'), card(4, 4, 'G', 'x', { hidden: true })];
  c.proposed = [
    { topic: '  AI literacy ', cardIds: [1, 1, 99, '3'] },
    { topic: '', cardIds: [3, 4] },
    { topic: 'Empty', cardIds: [] }
  ];
  const out = JSON.parse(JSON.stringify(c.eval('captureNormalizeGroups_(cards, proposed)')));
  assert.equal(out.groups.length, 1);
  assert.equal(out.groups[0].topic, 'AI literacy');
  assert.deepEqual(out.groups[0].cardIds, [1, 3]);
  assert.deepEqual(out.ungrouped, [2]);
});

test('counts and routes come from the cards, not from the proposal', () => {
  const c = logic();
  c.cards = [card(1, 1, 'G'), card(2, 2, 'B'), card(3, 2, 'G+'), card(4, 5, 'B'), card(5, 6, 'B')];
  c.mixed = { topic: 'Chatbots', cardIds: [1, 2, 3], tableCount: 99 };
  c.allB = { topic: 'Funding', cardIds: [4, 5] };
  const mixed = c.eval('captureGroupStats_(CAPTURE_TEMPLATES.needCards, cards, mixed)');
  assert.deepEqual([...mixed.tables], [1, 2]);
  assert.equal(mixed.tableCount, 2);
  assert.equal(mixed.levels.G, 1); assert.equal(mixed.levels['G+'], 1); assert.equal(mixed.levels.B, 1);
  assert.equal(mixed.route, 'vote');
  assert.equal(c.eval('captureGroupStats_(CAPTURE_TEMPLATES.needCards, cards, allB)').route, 'parking');
  c.allB.routeOverride = 'vote';
  assert.equal(c.eval('captureGroupStats_(CAPTURE_TEMPLATES.needCards, cards, allB)').route, 'vote');
  const parking = c.eval('captureParkingLot_(CAPTURE_TEMPLATES.needCards, cards)').map(x => x.id);
  assert.deepEqual([...parking], [2, 4, 5]);
});

test('explicit ranks come first, then the topics raised by the most tables', () => {
  const c = logic();
  c.cards = [card(1, 1, 'G'), card(2, 2, 'G'), card(3, 3, 'G'), card(4, 4, 'G')];
  c.groups = [
    { id: 'a', topic: 'One table', cardIds: [1], rank: 0 },
    { id: 'b', topic: 'Two tables', cardIds: [2, 3], rank: 0 },
    { id: 'c', topic: 'Ranked first', cardIds: [4], rank: 1 }
  ];
  const order = c.eval('captureOrderGroups_(CAPTURE_TEMPLATES.needCards, cards, groups)').map(g => g.topic);
  assert.deepEqual([...order], ['Ranked first', 'Two tables', 'One table']);
});

test('the projector summary carries counts and topics, never card text', () => {
  const c = logic();
  c.cards = [card(1, 1, 'G', 'SECRET NEED TEXT'), card(2, 3, 'B', 'OTHER TEXT'), card(3, 3, 'G', 'HIDDEN', { hidden: true })];
  c.groups = [{ id: 'g1', topic: 'AI literacy', cardIds: [1, 2] }];
  const s = JSON.parse(JSON.stringify(c.eval('captureWallSummary_(CAPTURE_TEMPLATES.needCards, cards, groups, 4, true)')));
  assert.equal(s.total, 2);
  assert.deepEqual(s.perTable, [1, 0, 1, 0]);
  assert.equal(s.levels.G, 1);
  assert.equal(s.topics[0].tableCount, 2);
  assert.equal(JSON.stringify(s).includes('TEXT'), false);
});

// ─── API boundaries ─────────────────────────────────────────────────────────

function apiContext({ email = '', config = null, cards = [], groups = [], tableFields = {} } = {}) {
  const calls = [];
  const c = load(['Config.js', 'AuthService.js', 'CaptureTemplates.js', 'CaptureLogic.js', 'CaptureApi.js'], {
    Session: { getActiveUser: () => ({ getEmail: () => email }), getEffectiveUser: () => ({ getEmail: () => 'owner@example.org' }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => (key === 'OWNER_EMAIL' ? 'owner@example.org' : null) }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => null },
    validateSessionId_: id => { if (!/^S-[a-zA-Z0-9-]+$/.test(String(id))) throw new Error('Invalid session link.'); return id; },
    getWebAppUrl_: () => 'https://script.google.com/macros/s/x/exec',
    SessionService: { getSession: () => ({ id: 'S-1', name: 'Test' }), getAllSessions: () => [] },
    CaptureStore: {
      getConfig: () => config,
      readCards: () => cards,
      readGroups: () => groups,
      readTableFields: () => tableFields,
      setTableFields: (sid, t, table, fields) => { calls.push(['table', table, fields]); return fields; },
      appendCard: (sid, t, cardIn) => { calls.push(['append', cardIn]); return { id: 1, token: 'a'.repeat(32) }; },
      setHidden: (...args) => { calls.push(['hide', ...args]); },
      writeGroups: (sid, g) => { calls.push(['groups', g]); },
      enable: () => { calls.push(['enable']); },
      setOpen: () => { calls.push(['open']); }
    },
    CaptureAiService: {
      readPhoto: () => { calls.push(['photo']); return { fields: {}, level: '', confidence: 'low' }; },
      proposeGroups: () => { calls.push(['propose']); return []; }
    },
    CapturePosterService: { make: () => { calls.push(['posters']); return 'url'; } }
  });
  return { c, calls };
}
const KEY = '0123456789abcdef0123';
const openConfig = { template: 'needCards', tables: 6, open: true, key: KEY, title: 'Need Cards' };

test('every board call refuses anonymous and unrelated users before touching data', () => {
  const publicNames = new Set(['captureGetTableConfig', 'captureSubmitCard', 'captureRemoveOwnCard',
    'captureGetTableCards', 'captureReadPhoto', 'captureGetWall', 'captureSetTableFields', 'captureGetTableState']);
  const names = [...source('CaptureApi.js').matchAll(/^function (\w+)\(/gm)].map(m => m[1])
    .filter(name => !name.endsWith('_') && !publicNames.has(name));
  assert.ok(names.length >= 9, names.join(','));
  for (const email of ['', 'stranger@example.org']) {
    const h = apiContext({ email, config: openConfig });
    for (const name of names) assert.throws(() => h.c[name]('S-1', 'x', 'y'), /Access denied/, name);
    assert.equal(h.calls.length, 0);
  }
  const owner = apiContext({ email: 'owner@example.org', config: openConfig });
  assert.equal(owner.c.captureGetBoard('S-1').enabled, true);
});

test('public calls need the session table key and an open session', () => {
  const h = apiContext({ config: openConfig, tableFields: { 2: { flip: 'Right now a, but we need b' } } });
  const input = { table: 2, level: 'G', fields: { need: 'c' } };
  for (const key of ['', 'wrong', 'ffffffffffffffffffff']) {
    assert.throws(() => h.c.captureSubmitCard('S-1', key, input), /table link/);
    assert.throws(() => h.c.captureGetWall('S-1', key), /table link/);
    assert.throws(() => h.c.captureReadPhoto('S-1', key, 'AAAA', 'image/jpeg'), /table link/);
  }
  assert.equal(h.calls.length, 0);
  assert.equal(h.c.captureSubmitCard('S-1', KEY, input).id, 1);
  assert.equal(h.calls[0][1].fields.need, 'c');
  assert.equal(h.calls[0][1].fields.flip, 'Right now a, but we need b');
  assert.throws(() => h.c.captureSubmitCard('S-1', KEY, { table: 3, level: 'G', fields: { need: 'c' } }), /flip statement first/);

  const closed = apiContext({ config: { ...openConfig, open: false } });
  assert.throws(() => closed.c.captureSubmitCard('S-1', KEY, input), /closed/);
  assert.throws(() => closed.c.captureReadPhoto('S-1', KEY, 'AAAA', 'image/jpeg'), /closed/);
  assert.equal(closed.calls.length, 0);
});

test('a table sees only its own cards, and the table config hides internals', () => {
  const cards = [card(1, 1, 'G', 'Mine'), card(2, 2, 'G', 'Theirs'), card(3, 1, 'B', 'Removed', { hidden: true })];
  const h = apiContext({ config: openConfig, cards });
  const mine = JSON.parse(JSON.stringify(h.c.captureGetTableCards('S-1', KEY, 1)));
  assert.deepEqual(mine, [{ id: 1, text: 'Mine', level: 'G' }]);
  const conf = JSON.stringify(h.c.captureGetTableConfig('S-1', KEY));
  assert.equal(conf.includes(KEY), false);
  assert.equal(conf.includes('groupingFocus'), false);
});

test('removing a card needs the token that came back when it was sent', () => {
  const h = apiContext({ config: openConfig });
  assert.throws(() => h.c.captureRemoveOwnCard('S-1', KEY, 1, 'short'), /Only the table/);
  h.c.captureRemoveOwnCard('S-1', KEY, 1, 'b'.repeat(32));
  assert.equal(h.calls[0][0], 'hide');
  assert.equal(h.calls[0][5], 'b'.repeat(32));
});

test('saved groups are normalized before they are written', () => {
  const h = apiContext({ email: 'owner@example.org', config: openConfig, cards: [card(1, 1, 'G'), card(2, 2, 'G')] });
  h.c.captureSaveGroups('S-1', [{ topic: 'Both', cardIds: [1, 2, 2, 7] }]);
  const written = h.calls.find(x => x[0] === 'groups')[1];
  assert.deepEqual(JSON.parse(JSON.stringify(written[0].cardIds)), [1, 2]);
});

// ─── Pages ──────────────────────────────────────────────────────────────────

test('pages get the session, key, shared styles and a phone viewport', () => {
  let meta = null, html = '';
  const c = load(['CaptureTemplates.js', 'CaptureLogic.js', 'CaptureApi.js'], {
    validateSessionId_: id => id,
    HtmlService: {
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
      createHtmlOutputFromFile: name => ({ getContent: () => source(name + '.html') }),
      createHtmlOutput: content => {
        html = content;
        const out = { setTitle: () => out, addMetaTag: (n, v) => { meta = [n, v]; return out; }, setXFrameOptionsMode: () => out };
        return out;
      }
    }
  });
  c.captureRoute_('capture', { parameter: { session: 'S-abc', k: KEY } });
  assert.ok(html.includes('"S-abc"'));
  assert.ok(html.includes('"' + KEY + '"'));
  assert.equal(html.includes('<!--CAPTURE_STYLES-->'), false);
  assert.equal(html.includes('__CAPTURE_KEY__'), false);
  assert.deepEqual(meta, ['viewport', 'width=device-width, initial-scale=1']);
  assert.throws(() => c.captureRoute_('capture', { parameter: { session: 'S-abc', k: 'nope' } }), /incomplete/);
});

// ─── AI ─────────────────────────────────────────────────────────────────────

function aiContext(responses, props = {}) {
  const requests = [];
  const store = { ...props };
  const c = load(['Config.js', 'GeminiService.js', 'CaptureTemplates.js', 'CaptureLogic.js', 'CaptureAiService.js'], {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => (key === 'GEMINI_MODEL' ? 'gemini-test-model' : store[key] || null),
      setProperty: (key, value) => { store[key] = value; }
    }) },
    getGeminiApiKey_: () => 'FAKE_SECRET',
    Utilities: { sleep() {}, formatDate: () => '2026-11-18' },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    UrlFetchApp: { fetch: (url, options) => {
      requests.push({ url, options });
      const body = responses.shift();
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(body) }] } }] }) };
    } }
  });
  return { c, requests, store };
}

test('a photo is sent once as inline data with the schema, and the reading is cleaned', () => {
  const h = aiContext([{ flip: 'Right now‮ x', need: 'PD', level: 'G+', confidence: 'medium' }]);
  const r = h.c.eval('CaptureAiService.readPhoto(CAPTURE_TEMPLATES.needCards, "QUJD", "image/jpeg")');
  assert.equal(r.fields.flip, 'Right now x');
  assert.equal(r.level, 'G+');
  const payload = JSON.parse(h.requests[0].options.payload);
  assert.equal(payload.contents[0].parts[1].inlineData.mimeType, 'image/jpeg');
  assert.ok(payload.generationConfig.responseSchema.properties.need);
  assert.equal(payload.generationConfig.thinkingConfig.thinkingLevel, 'low');
  assert.match(payload.contents[0].parts[0].text, /\[illegible\]/);
  assert.equal(h.requests[0].url.includes('FAKE_SECRET'), false);
  assert.equal(h.store['CAPTURE_AI_CALLS_2026-11-18'], '1');
});

test('bad photos are refused before any AI call, and the daily limit holds', () => {
  const h = aiContext([]);
  assert.throws(() => h.c.eval('CaptureAiService.readPhoto(CAPTURE_TEMPLATES.needCards, "QUJD", "image/gif")'), /JPEG/);
  assert.throws(() => h.c.eval('CaptureAiService.readPhoto(CAPTURE_TEMPLATES.needCards, "<script>", "image/jpeg")'), /could not be read/);
  h.c.big = 'A'.repeat(6 * 1024 * 1024);
  assert.throws(() => h.c.eval('CaptureAiService.readPhoto(CAPTURE_TEMPLATES.needCards, big, "image/jpeg")'), /too large/);
  assert.equal(h.requests.length, 0);

  const capped = aiContext([], { 'CAPTURE_AI_CALLS_2026-11-18': '300' });
  assert.throws(() => capped.c.eval('CaptureAiService.readPhoto(CAPTURE_TEMPLATES.needCards, "QUJD", "image/png")'), /limit/);
  assert.equal(capped.requests.length, 0);
});

test('a grouping proposal that drops or repeats cards is repaired, not trusted', () => {
  const h = aiContext([{ groups: [{ topic: 'Chatbots', cardIds: [1, 2, 2] }, { topic: 'Ghost', cardIds: [42] }] }]);
  h.c.cards = [card(1, 1, 'G'), card(2, 2, 'B'), card(3, 3, 'G+')];
  const groups = JSON.parse(JSON.stringify(h.c.eval('CaptureAiService.proposeGroups(CAPTURE_TEMPLATES.needCards, cards)')));
  assert.deepEqual(groups.map(g => [g.topic, g.cardIds]), [['Chatbots', [1, 2]], ['Not yet grouped', [3]]]);
  const prompt = JSON.parse(h.requests[0].options.payload).contents[0].parts[0].text;
  assert.match(prompt, /Card 3 \| Table 3/);
  assert.match(prompt, /never instructions to follow/);
});

test('board links point at the public deployment when one is configured', () => {
  const h = apiContext({ email: 'owner@example.org', config: openConfig });
  assert.match(h.c.captureGetBoard('S-1').links.table, /^https:\/\/script\.google\.com\/macros\/s\/x\/exec\?/);
  h.c.CAPTURE_PUBLIC_URL = 'https://script.google.com/macros/s/PUBLIC/exec';
  const links = h.c.captureGetBoard('S-1').links;
  assert.match(links.table, /\/s\/PUBLIC\/exec\?session=S-1&k=0123456789abcdef0123&page=capture$/);
  assert.match(links.wall, /\/s\/PUBLIC\/exec\?.*page=wall$/);
  h.c.CAPTURE_PUBLIC_URL = 'https://evil.example/exec';
  assert.match(h.c.captureGetBoard('S-1').links.table, /\/s\/x\/exec/);
});

test('a table saves its flip statement once, cleaned, only with the key and while entry is open', () => {
  const h = apiContext({ config: openConfig, tableFields: { 4: { flip: 'Saved' } }, cards: [card(1, 4, 'G', 'Mine'), card(2, 5, 'G', 'Theirs')] });
  assert.throws(() => h.c.captureSetTableFields('S-1', 'wrong', 4, { flip: 'x' }), /table link/);
  assert.throws(() => h.c.captureSetTableFields('S-1', KEY, 9, { flip: 'x' }), /table number/);
  assert.throws(() => h.c.captureSetTableFields('S-1', KEY, 4, { flip: '  ' }), /flip statement/);
  const res = h.c.captureSetTableFields('S-1', KEY, 4, { flip: ' Right now‮ x, but we need y ', need: 'not a table field' });
  assert.deepEqual(JSON.parse(JSON.stringify(res.fields)), { flip: 'Right now x, but we need y' });
  assert.deepEqual(h.calls[0].slice(0, 2), ['table', 4]);
  const st = JSON.parse(JSON.stringify(h.c.captureGetTableState('S-1', KEY, 4)));
  assert.deepEqual(st, { table: 4, fields: { flip: 'Saved' }, cards: [{ id: 1, text: 'Mine', level: 'G' }] });
  const closed = apiContext({ config: { ...openConfig, open: false } });
  assert.throws(() => closed.c.captureSetTableFields('S-1', KEY, 4, { flip: 'x' }), /closed/);
});

test('saving a flip statement rewrites it on that table\'s cards and only theirs', () => {
  const grid = {
    'Live Cards': [['Card', 'Submitted', 'Table', 'Level', 'Source', 'Hidden', 'Token', 'Flip statement', 'Need'],
      [1, '', 2, 'G', 'typed', 'no', 't', 'old', 'n1'], [2, '', 3, 'G', 'typed', 'no', 't', 'other', 'n2'], [3, '', 2, 'B', 'typed', 'no', 't', 'old', 'n3']]
  };
  const sheet = name => grid[name] && {
    getDataRange: () => ({ getValues: () => grid[name].map(r => r.slice()) }),
    getRange: (r, c, rows = 1, cols = 1) => ({
      setValue: v => { grid[name][r - 1][c - 1] = v; },
      setValues: vals => {
        for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) { (grid[name][r - 1 + i] = grid[name][r - 1 + i] || [])[c - 1 + j] = vals[i][j]; }
        const style = { setBackground: () => style, setFontColor: () => style, setFontWeight: () => style };
        return style;
      }
    }),
    appendRow: row => grid[name].push(row),
    setFrozenRows() {}
  };
  const db = { getSheetByName: sheet, insertSheet: name => { grid[name] = []; return sheet(name); } };
  const c = load(['CaptureTemplates.js', 'CaptureLogic.js', 'CaptureStore.js'], {
    CacheService: { getScriptCache: () => ({ get: () => 'db-id', put() {} }) },
    SpreadsheetApp: { openById: () => db },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) }
  });
  c.eval('CaptureStore.setTableFields("S-1", CAPTURE_TEMPLATES.needCards, 2, { flip: "=Right now new, but we need more" })');
  assert.equal(grid['Live Tables'][1][0], 2);
  assert.equal(grid['Live Tables'][1][1], "'=Right now new, but we need more");
  assert.deepEqual(grid['Live Cards'].slice(1).map(r => r[7]), ["'=Right now new, but we need more", 'other', "'=Right now new, but we need more"]);
  c.eval('CaptureStore.setTableFields("S-1", CAPTURE_TEMPLATES.needCards, 2, { flip: "Edited" })');
  assert.equal(grid['Live Tables'].length, 2, 'editing updates the table row instead of adding one');
  assert.equal(grid['Live Tables'][1][1], 'Edited');
  const read = JSON.parse(JSON.stringify(c.eval('CaptureStore.readTableFields("S-1", CAPTURE_TEMPLATES.needCards)')));
  assert.deepEqual(read, { 2: { flip: 'Edited' } });
});

test('a table card link preselects its table; other pages and bad values ignore it', () => {
  let html = '';
  const c = load(['CaptureTemplates.js', 'CaptureLogic.js', 'CaptureApi.js'], {
    validateSessionId_: id => id,
    HtmlService: {
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
      createHtmlOutputFromFile: name => ({ getContent: () => source(name + '.html') }),
      createHtmlOutput: content => { html = content; const out = { setTitle: () => out, addMetaTag: () => out, setXFrameOptionsMode: () => out }; return out; }
    }
  });
  c.captureRoute_('capture', { parameter: { session: 'S-abc', k: KEY, t: '4' } });
  assert.match(html, /PRESET_TABLE = Number\("4"\)/);
  for (const t of ['0', '-1', '4"><script>', 'x', '100']) {
    c.captureRoute_('capture', { parameter: { session: 'S-abc', k: KEY, t } });
    assert.match(html, /PRESET_TABLE = Number\(""\)/, t);
  }
  c.captureRoute_('tablecards', { parameter: { session: 'S-abc' } });
  assert.ok(html.includes('captureGetTableCardsData'), 'table cards render without a key');
  assert.ok(html.includes('cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js'));
});

test('table cards and menu links use the sign-in deployment for facilitator pages and the public one for tables', () => {
  const h = apiContext({ email: 'owner@example.org', config: openConfig });
  h.c.CAPTURE_PUBLIC_URL = 'https://script.google.com/macros/s/PUBLIC/exec';
  h.c.CAPTURE_BOARD_URL = 'https://script.google.com/macros/s/BOARD/exec';
  const d = h.c.captureGetTableCardsData('S-1');
  assert.match(d.tableLink, /\/s\/PUBLIC\/exec\?session=S-1&k=0123456789abcdef0123&page=capture$/);
  assert.equal(d.tables, 6);
  const links = h.c.captureGetBoard('S-1').links;
  assert.match(links.board, /\/s\/BOARD\/exec\?page=board&session=S-1$/);
  assert.match(links.tableCards, /\/s\/BOARD\/exec\?page=tablecards&session=S-1$/);
  assert.match(links.wall, /\/s\/PUBLIC\//);
  const anon = apiContext({ config: openConfig });
  assert.throws(() => anon.c.captureGetTableCardsData('S-1'), /Access denied/);
});

test('choosing a live-capture event in the wizard turns capture on with the table count', () => {
  const enabled = [];
  const c = load(['Config.js', 'AuthService.js', 'StorageService.js', 'CaptureTemplates.js', 'CaptureLogic.js', 'CaptureApi.js', 'Code.js', 'WebApp.js'], {
    Session: { getActiveUser: () => ({ getEmail: () => 'owner@example.org' }), getEffectiveUser: () => ({ getEmail: () => 'owner@example.org' }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => (key === 'OWNER_EMAIL' ? 'owner@example.org' : null) }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => null },
    CacheService: { getScriptCache: () => ({ remove() {} }) },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/ONE/exec' }) },
    SessionService: { setupSession: () => ({ sessionId: 'S-new', folderUrl: 'f', dbUrl: 'd' }) },
    CaptureStore: { enable: (sid, tpl, tables, title) => { enabled.push([sid, tpl, tables, title]); return { key: KEY, tables, template: tpl, title }; } }
  });
  const plain = c.processWizardSubmit({ name: 'Library night', theme: 't' });
  assert.equal(plain.capture, undefined);
  assert.equal(enabled.length, 0);
  const live = c.processWizardSubmit({ name: 'Need Cards day', theme: 't', captureTemplate: 'needCards', captureTables: 6 });
  assert.deepEqual(enabled[0], ['S-new', 'needCards', 6, 'Need Cards day']);
  assert.match(live.capture.board, /page=board&session=S-new$/);
  assert.match(live.capture.table, /k=0123456789abcdef0123&page=capture$/);
  c.processWizardSubmit({ name: 'x', theme: 't', captureTemplate: 'notATemplate' });
  assert.equal(enabled.length, 1, 'an unknown event type is ignored');
});

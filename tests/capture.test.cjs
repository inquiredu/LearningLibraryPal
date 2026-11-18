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
const plain = v => JSON.parse(JSON.stringify(v));
const logic = () => load(['CaptureTemplates.js', 'CaptureLogic.js']);
const T = 'CAPTURE_TEMPLATES.needCards';
const card = (id, table, level, role = 'A', extra = {}) =>
  ({ id, table, level, role, flipId: table, source: 'typed', hidden: false, fields: { flip: 'Right now x, but we want y', need: 'Need ' + id }, ...extra });
const flip = (id, table, text = 'Right now a, but we want b', extra = {}) => ({ id, table, text, top: false, hidden: false, ...extra });
const VOTER = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

// ─── What people send ───────────────────────────────────────────────────────

test('a card takes its flip statement from its own table, never from what was sent, or has none', () => {
  const c = logic();
  c.flips = [flip(1, 3, 'Right now teachers guess, but we want rules'), flip(2, 4, 'Other table')];
  c.input = { table: '3', flipId: 1, level: 'G+', role: 'S', sources: ['photo', 'typed'], fields: { flip: 'IGNORED', need: '  PD​ time\u0007 ' } };
  const out = plain(c.eval(`captureValidateCard_(${T}, input, 6, flips)`));
  assert.deepEqual(out, { table: 3, flipId: 1, fields: { flip: 'Right now teachers guess, but we want rules', need: 'PD time' }, level: 'G+', role: 'S', source: 'typed+photo' });
  for (const bad of [
    { table: 3, flipId: 2, level: 'G', role: 'S', fields: { need: 'x' } },
    { table: 3, flipId: 9, level: 'G', role: 'S', fields: { need: 'x' } },
    { table: 3, flipId: 1, level: 'G', role: 'X', fields: { need: 'x' } },
    { table: 3, flipId: 1, level: 'Z', role: 'S', fields: { need: 'x' } },
    { table: 3, flipId: 1, level: 'G', role: 'S', fields: { need: ' ' } },
    { table: 9, flipId: 1, level: 'G', role: 'S', fields: { need: 'x' } }
  ]) { c.input = bad; assert.throws(() => c.eval(`captureValidateCard_(${T}, input, 6, flips)`), JSON.stringify(bad)); }
  c.input = { table: 3, flipId: 0, level: 'B', role: 'A', fields: { need: 'Funding for devices' } };
  assert.deepEqual(plain(c.eval(`captureValidateCard_(${T}, input, 6, flips)`)).fields, { flip: '', need: 'Funding for devices' }, 'a card may stand on its own');
  c.flips = [flip(1, 3, 'Since removed', { hidden: true })];
  c.input = { table: 3, flipId: 1, level: 'G', role: 'S', fields: { need: 'x' } };
  assert.equal(c.eval(`captureValidateCard_(${T}, input, 6, flips)`).fields.flip, 'Since removed', 'a device that still shows a removed statement can file under it');
});

test('signals, flip text and test-drive notes are cleaned and required', () => {
  const c = logic();
  assert.deepEqual(plain(c.eval(`captureValidateSignal_(${T}, { table: 2, role: 'A', text: ' News‮ story ' }, 6)`)), { table: 2, role: 'A', text: 'News story' });
  assert.throws(() => c.eval(`captureValidateSignal_(${T}, { table: 2, role: 'A', text: '' }, 6)`), /signal/);
  assert.throws(() => c.eval(`captureValidateSignal_(${T}, { table: 2, role: '', text: 'x' }, 6)`), /Student or Adult/);
  assert.throws(() => c.eval(`captureValidateFlipText_(${T}, '  ')`), /flip statement/);
  assert.deepEqual(plain(c.eval(`captureValidateTestDrive_(${T}, { add: ' More examples ', extra: 'x' })`)), { change: '', add: 'More examples', cut: '', beyond: '' });
  assert.throws(() => c.eval(`captureValidateTestDrive_(${T}, {})`), /at least one/);
});

test('long text is cut cleanly, and text Sheets would run as a formula stays text', () => {
  const c = logic();
  assert.equal(c.captureCleanText_('a'.repeat(399) + '😀', 400), 'a'.repeat(399));
  for (const v of ['=IMPORTXML("x")', '+1', '-2', '@me']) assert.equal(c.captureSheetSafe_(v), "'" + v);
  assert.equal(c.captureSheetSafe_('Plain words'), 'Plain words');
});

test('a photo reading keeps only the card\'s own fields and a known level', () => {
  const c = logic();
  c.raw = { need: 'Lessons [illegible]', flip: 'not read', level: 'Z', confidence: 'certain' };
  assert.deepEqual(plain(c.eval(`captureCleanReading_(${T}, raw)`)), { fields: { need: 'Lessons [illegible]' }, level: '', confidence: 'low', empty: false });
  c.raw = { need: '', level: '', confidence: 'high' };
  assert.equal(c.eval(`captureCleanReading_(${T}, raw)`).empty, true);
});

// ─── Groups, columns and the published snapshot ─────────────────────────────

test('groups hold each live card once; cards no group claims don\'t fit yet', () => {
  const c = logic();
  c.cards = [card(1, 1, 'G'), card(2, 2, 'B'), card(3, 3, 'G+'), card(4, 4, 'G', 'A', { hidden: true })];
  c.proposed = [{ topic: '  AI literacy ', cardIds: [1, 1, 99, '3'], columnOverride: 'B' }, { topic: '', cardIds: [3, 4] }, { topic: 'Empty', cardIds: [] }];
  const out = plain(c.eval(`captureNormalizeGroups_(cards, proposed, ${T})`));
  assert.equal(out.groups.length, 1);
  assert.deepEqual([out.groups[0].topic, out.groups[0].cardIds, out.groups[0].columnOverride], ['AI literacy', [1, 3], 'B']);
  assert.deepEqual(out.ungrouped, [2]);
});

test('a group\'s column is the tag most of its cards carry, with ? when tables disagreed', () => {
  const c = logic();
  c.cards = [card(1, 1, 'G', 'S'), card(2, 2, 'B', 'A'), card(3, 2, 'G+', 'A'), card(4, 5, 'B', 'S'), card(5, 6, 'B', 'A'), card(6, 3, 'G+')];
  const stats = g => plain(c.eval(`captureGroupStats_(${T}, cards, ${JSON.stringify(g)})`));
  const mixed = stats({ topic: 'Chatbots', cardIds: [1, 2, 3, 6], tableCount: 99 });
  assert.equal(mixed.column, 'G+'); assert.equal(mixed.contested, true); assert.equal(mixed.tableCount, 3);
  assert.deepEqual(mixed.roles, { S: 1, A: 3 });
  const allB = stats({ topic: 'Funding', cardIds: [4, 5] });
  assert.deepEqual([allB.column, allB.contested, allB.route], ['B', false, 'parking']);
  assert.equal(stats({ topic: 'Tie', cardIds: [1, 2] }).column, 'G', 'a tie goes to the earlier tag');
  const over = stats({ topic: 'Funding', cardIds: [4, 5], columnOverride: 'G' });
  assert.deepEqual([over.column, over.defaultColumn, over.route], ['G', 'B', 'vote']);
});

test('explicit ranks come first, then the topics raised by the most tables', () => {
  const c = logic();
  c.cards = [card(1, 1, 'G'), card(2, 2, 'G'), card(3, 3, 'G'), card(4, 4, 'G')];
  c.groups = [{ id: 'a', topic: 'One table', cardIds: [1] }, { id: 'b', topic: 'Two tables', cardIds: [2, 3] }, { id: 'c', topic: 'Ranked first', cardIds: [4], rank: 1 }];
  assert.deepEqual([...c.eval(`captureOrderGroups_(${T}, cards, groups)`).map(g => g.topic)], ['Ranked first', 'Two tables', 'One table']);
});

test('publishing freezes each group\'s topic, column, ? flag and counts', () => {
  const c = logic();
  c.cards = [card(1, 1, 'G', 'S'), card(2, 2, 'B', 'A'), card(3, 3, 'B', 'A')];
  c.groups = [{ id: 'g1', topic: 'Mixed', cardIds: [1, 2] }, { id: 'g2', topic: 'Beyond', cardIds: [3] }];
  const pub = plain(c.eval(`capturePublish_(${T}, cards, groups)`));
  assert.deepEqual(pub.map(g => [g.id, g.column, g.contested, g.route, g.tableCount, g.roles.S]), [['g1', 'G', true, 'vote', 2, 1], ['g2', 'B', false, 'parking', 1, 0]]);
});

// ─── Dots, votes, tallies and results ───────────────────────────────────────

test('gallery dots are per person and deduplicated, with no cap the room would meet; paper counts add in', () => {
  const c = logic();
  c.flips = [flip(1, 1), flip(2, 2), flip(3, 3, 'x', { hidden: true })];
  c.input = { voter: VOTER, role: 'S', dots: [{ flipId: 1, color: 'green' }, { flipId: 1, color: 'green' }, { flipId: 2, color: 'blue' }, { flipId: 3, color: 'green' }, { flipId: 1, color: 'purple' }] };
  assert.deepEqual(plain(c.eval(`captureValidateFlipDots_(${T}, flips, input)`)).dots, [{ flipId: 1, color: 'green' }, { flipId: 2, color: 'blue' }]);
  c.flips = Array.from({ length: 30 }, (_, i) => flip(i + 1, 1));
  c.input = { voter: VOTER, role: 'S', dots: Array.from({ length: 30 }, (_, i) => ({ flipId: i + 1, color: 'green' })) };
  assert.equal(c.eval(`captureValidateFlipDots_(${T}, flips, input)`).dots.length, 30, 'no 9-dot limit');
  c.input.dots = c.input.dots.concat(Array.from({ length: 30 }, (_, i) => ({ flipId: i + 1, color: 'blue' }))).concat([{ flipId: 1, color: 'yellow' }]);
  assert.throws(() => c.eval(`captureValidateFlipDots_(${T}, flips, input)`), /more dots than one person/, 'only a runaway ceiling');
  c.input = { voter: 'short', role: 'S', dots: [] };
  assert.throws(() => c.eval(`captureValidateFlipDots_(${T}, flips, input)`), /reload/);
  const tally = plain(c.eval(`captureTallyFlipDots_(${T}, [{ flipId: 1, color: 'green', role: 'S' }, { flipId: 1, color: 'green', role: 'A' }, { flipId: 1, color: 'blue', role: 'S' }])`));
  assert.deepEqual(tally[1].green, { total: 2, S: 1, A: 1 });
  assert.equal(tally[1].yellow.total, 0);
  const withPaper = plain(c.eval(`captureTallyFlipDots_(${T}, [{ flipId: 1, color: 'green', role: 'S' }], { 1: { green: { S: 4, A: '2', unmarked: 3 } }, 7: { yellow: { S: -5, A: 1 } } })`));
  assert.deepEqual(withPaper[1].green, { total: 10, S: 5, A: 2 }, 'unmarked paper dots count toward the total only');
  assert.deepEqual(withPaper[7].yellow, { total: 1, S: 0, A: 1 });
});

test('a vote stacks on published groups, with no per-person cap; the room keeps its own count', () => {
  const c = logic();
  c.pub = [{ id: 'g1' }, { id: 'g2' }];
  assert.deepEqual(plain(c.eval(`captureValidateVote_(${T}, pub, { voter: '${VOTER}', role: 'A', choices: ['g1', 'g1', 'nope', 'g2'] })`)).choices, ['g1', 'g1', 'g2']);
  assert.equal(c.eval(`captureValidateVote_(${T}, pub, { voter: '${VOTER}', role: 'A', choices: ['g1', 'g1', 'g1', 'g2', 'g2'] })`).choices.length, 5);
  c.many = Array.from({ length: 61 }, () => 'g1');
  assert.throws(() => c.eval(`captureValidateVote_(${T}, pub, { voter: '${VOTER}', role: 'A', choices: many })`), /Next person/);
  assert.throws(() => c.eval(`captureValidateVote_(${T}, pub, { voter: '${VOTER}', role: 'A', choices: ['nope'] })`), /at least one/);
  assert.throws(() => c.eval(`captureValidateVote_(${T}, pub, { voter: '${VOTER}', role: '', choices: ['g1'] })`), /Student or Adult/);
});

test('tallies count phones, paper dots or both, split by role', () => {
  const c = logic();
  c.pub = [{ id: 'g1' }, { id: 'g2' }];
  c.votes = [{ role: 'S', choices: ['g1', 'g1'] }, { role: 'A', choices: ['g1', 'g2', 'ghost'] }];
  c.paper = { g1: { S: 4, A: '2' }, ghost: { S: 9 } };
  const t = mode => plain(c.eval(`captureTally_(${T}, pub, votes, paper, '${mode}')`));
  assert.deepEqual(t('phone').g1, { phone: { S: 2, A: 1 }, paper: { S: 4, A: 2 }, total: 3, S: 2, A: 1 });
  assert.equal(t('paper').g1.total, 6);
  assert.deepEqual([t('both').g1.S, t('both').g1.A, t('both').g1.total, t('both').g2.total], [6, 3, 9, 1]);
});

test('results rank each column and give the top priorities to tables, with manual overrides', () => {
  const c = logic();
  c.pub = [
    { id: 'a', topic: 'A', column: 'G', route: 'vote', tableCount: 3, cardCount: 3 },
    { id: 'b', topic: 'B', column: 'G+', route: 'vote', tableCount: 2, cardCount: 2 },
    { id: 'c', topic: 'C', column: 'G', route: 'vote', tableCount: 1, cardCount: 1 },
    { id: 'p', topic: 'P', column: 'B', route: 'parking', tableCount: 4, cardCount: 4 }
  ];
  c.tally = { a: { total: 5 }, b: { total: 9 }, c: { total: 5 }, p: { total: 20 } };
  const r = plain(c.eval(`captureResults_(${T}, pub, tally, 3, {})`));
  assert.deepEqual(r.columns.map(col => [col.code, col.items.map(i => i.id + i.rank)]), [['G', ['a1', 'c2']], ['G+', ['b1']], ['B', ['p1']]], 'ties broken by tables');
  assert.deepEqual(r.assignments.map(a => [a.table, a.groupId]), [[1, 'b'], [2, 'a'], [3, 'c']], 'the parking lot is never assigned');
  const o = plain(c.eval(`captureResults_(${T}, pub, tally, 3, { 1: 'c', 2: 'p', 9: 'a' })`));
  assert.deepEqual(o.assignments.map(a => [a.table, a.groupId, a.manual]), [[1, 'c', true], [2, 'b', false], [3, 'a', false]]);
  assert.equal(plain(c.eval(`captureResults_(${T}, pub, tally, 5, {})`)).assignments[4].groupId, '', 'more tables than priorities leaves the rest empty');
});

// ─── API boundaries ─────────────────────────────────────────────────────────

const KEY = '0123456789abcdef0123';
const BASE_CONFIG = { template: 'needCards', tables: 6, key: KEY, title: 'Retreat', stage: 'needs', published: null, publishedAt: '',
  paperDots: {}, tallyMode: 'phone', assign: {}, surveyUrl: 'https://example.org/s' };

function apiContext({ email = '', config = {}, snap = {}, audit = {}, ai = {} } = {}) {
  const calls = [];
  const actors = [];
  const cfg = { ...BASE_CONFIG, paperFlipDots: {}, ...config };
  const data = { signals: [], flips: [], flipDots: [], cards: [], groups: [], votes: [], testDrive: [], ...snap };
  const AI = { model: 'gemini-test', tokens: '10 in, 5 out', cost: 0.0012, raw: { echo: true } };
  const c = load(['Config.js', 'AuthService.js', 'CaptureTemplates.js', 'CaptureLogic.js', 'CaptureApi.js'], {
    Session: { getActiveUser: () => ({ getEmail: () => email }), getEffectiveUser: () => ({ getEmail: () => 'owner@example.org' }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => (key === 'OWNER_EMAIL' ? 'owner@example.org' : null) }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => null },
    Utilities: { formatDate: () => 'November 18, 2026 3:00 PM' },
    validateSessionId_: id => { if (!/^S-[a-zA-Z0-9-]+$/.test(String(id))) throw new Error('Invalid session link.'); return id; },
    getWebAppUrl_: () => 'https://script.google.com/macros/s/x/exec',
    SessionService: { getSession: () => ({ id: 'S-1', name: 'Test', dbUrl: 'https://docs.google.com/spreadsheets/d/DB/edit' }), getAllSessions: () => [] },
    CaptureStore: {
      as: (actor, stage) => { actors.push([actor, stage]); },
      json_: (v, f) => { try { return v ? JSON.parse(String(v)) : f; } catch (e) { return f; } },
      getConfig: () => cfg,
      snapshot: () => data,
      updateConfig: (sid, change, log) => { const before = plain(cfg); const next = Object.assign(cfg, change(cfg) || {}); calls.push(['config', plain(next), log && log.action, log && log.before ? log.before(before) : undefined]); return next; },
      addSignal: (sid, s) => { calls.push(['signal', s]); return { id: 1, token: 'a'.repeat(32) }; },
      setSignalHidden: (...a) => { calls.push(['hideSignal', ...a]); },
      saveFlip: (...a) => { calls.push(['flip', ...a]); return { id: 1 }; },
      setFlipFlags: (...a) => { calls.push(['flipFlags', ...a]); },
      saveFlipDots: (sid, e) => { calls.push(['dots', e]); },
      appendCard: (sid, t, cardIn) => { calls.push(['card', cardIn]); return { id: 1, token: 'a'.repeat(32) }; },
      setHidden: (...a) => { calls.push(['hide', ...a]); },
      writeGroups: (sid, g, how) => { calls.push(['groups', g, how]); },
      saveVote: (sid, v) => { calls.push(['vote', v]); },
      clearVotes: () => { calls.push(['clearVotes']); },
      saveTestDrive: (...a) => { calls.push(['testDrive', ...a]); },
      addFromPaper: (sid, t, mode, rows, meta) => { calls.push(['paper', mode, rows, meta]); return { ids: [1], entry: 77 }; },
      audit: (sid, e) => { calls.push(['audit', e]); return 42; },
      auditEntry: (sid, n) => audit[n] || null,
      auditTail: () => ({ total: Object.keys(audit).length, rows: Object.values(audit) }),
      enable: () => { calls.push(['enable']); }
    },
    CaptureAiService: {
      enabled: () => true,
      spentToday: () => 1.25,
      readPhoto: () => { calls.push(['photo']); return { reading: { fields: { need: 'Read need' }, level: 'G', confidence: 'high', empty: false }, ai: AI }; },
      readPaper: (t, mode) => { calls.push(['readPaper', mode]); return { raw: ai.paper || { items: [] }, ai: AI }; },
      proposeGroups: () => { calls.push(['propose']); return { groups: [], ai: AI }; }
    },
    CapturePhotoService: { save: (sid, data, mime, label) => { calls.push(['savePhoto', label]); return 'https://drive.google.com/file/d/PHOTO/view'; } },
    CapturePosterService: { make: () => { calls.push(['posters']); return 'url'; } },
    CaptureReportService: { make: (sid, report) => { calls.push(['report', report]); return 'https://docs.google.com/document/d/REPORT/edit'; } }
  });
  return { c, calls, cfg, data, actors };
}
const PUBLIC = new Set(['captureGetPhoneState', 'captureAddSignal', 'captureRemoveSignal', 'captureSaveFlip', 'captureRemoveFlip', 'captureSetFlipTop',
  'captureSaveFlipDots', 'captureSubmitCard', 'captureRemoveOwnCard', 'captureReadPhoto', 'captureSaveVote', 'captureSaveTestDrive', 'captureGetWall']);

test('every board call refuses anonymous and unrelated users before touching data', () => {
  const names = [...source('CaptureApi.js').matchAll(/^function (\w+)\(/gm)].map(m => m[1]).filter(n => !n.endsWith('_') && !PUBLIC.has(n));
  assert.ok(names.length >= 18, names.join(','));
  for (const email of ['', 'stranger@example.org']) {
    const h = apiContext({ email });
    for (const name of names) assert.throws(() => h.c[name]('S-1', 'x', 'y'), /Access denied/, name);
    assert.equal(h.calls.length, 0);
  }
  assert.equal(apiContext({ email: 'owner@example.org' }).c.captureGetBoard('S-1').enabled, true);
});

test('public calls need the table key; stages lock nothing, and voting only needs published groups', () => {
  const h = apiContext({ snap: { flips: [flip(1, 2)] }, config: { stage: 'testdrive' } });
  const cardIn = { table: 2, flipId: 1, level: 'G', role: 'S', fields: { need: 'c' }, device: VOTER };
  for (const key of ['', 'wrong', 'ffffffffffffffffffff']) {
    assert.throws(() => h.c.captureSubmitCard('S-1', key, cardIn), /table link/);
    assert.throws(() => h.c.captureGetWall('S-1', key), /table link/);
    assert.throws(() => h.c.captureGetPhoneState('S-1', key, 1, ''), /table link/);
  }
  assert.equal(h.calls.length, 0);
  assert.equal(h.c.captureSubmitCard('S-1', KEY, cardIn).id, 1, 'a late card is still taken');
  assert.equal(h.calls[0][1].fields.flip, 'Right now a, but we want b');
  h.c.captureAddSignal('S-1', KEY, { table: 1, role: 'S', text: 'A late signal', device: VOTER });
  h.c.captureSaveTestDrive('S-1', KEY, 1, { add: 'x' }, VOTER);
  assert.deepEqual(h.calls.map(x => x[0]), ['card', 'signal', 'testDrive']);
  assert.deepEqual(plain(h.actors[0]), ['Table 2 · device ' + VOTER.slice(0, 8), 'testdrive'], 'each change names its table and device');
  assert.throws(() => h.c.captureSaveVote('S-1', KEY, { voter: VOTER, role: 'S', choices: ['g1'] }), /publish/);
  assert.throws(() => h.c.captureSaveTestDrive('S-1', KEY, 1, { add: 'x' }, 'not-a-device'), /reload/);
});

test('a phone sees its own table\'s rows, the ballot once published, and results only at the read-out', () => {
  const published = [{ id: 'g1', topic: 'Chatbots', column: 'G', contested: true, route: 'vote', tableCount: 2, cardCount: 2, cardIds: [1] }];
  const snap = {
    flips: [flip(1, 1, 'Mine'), flip(2, 2, 'Theirs'), flip(3, 1, 'Hidden', { hidden: true })],
    cards: [card(1, 1, 'G', 'S'), card(2, 2, 'G'), card(3, 1, 'B', 'A', { hidden: true })],
    signals: [{ id: 1, table: 1, role: 'S', text: 'Mine', hidden: false }, { id: 2, table: 2, role: 'S', text: 'Theirs', hidden: false }],
    votes: [{ voter: VOTER, role: 'S', choices: ['g1', 'g1'] }]
  };
  snap.testDrive = [{ table: 1, device: VOTER, notes: { add: 'Mine' } }, { table: 1, device: 'other', notes: { cut: 'Theirs' } }, { table: 2, device: 'x', notes: { add: 'Elsewhere' } }];
  const atNeeds = plain(apiContext({ snap }).c.captureGetPhoneState('S-1', KEY, 1, VOTER));
  assert.deepEqual(atNeeds.table.flips.map(f => f.text), ['Mine']);
  assert.deepEqual(atNeeds.table.cards.map(x => x.id), [1]);
  assert.deepEqual(atNeeds.table.signals.map(x => x.text), ['Mine']);
  assert.deepEqual(atNeeds.table.testDrive, { mine: { add: 'Mine' }, others: [{ cut: 'Theirs' }] }, 'each device keeps its own notes and sees the table\'s others');
  assert.deepEqual(atNeeds.gallery.map(f => f.text), ['Mine', 'Theirs'], 'the gallery is there in every stage');
  assert.equal(atNeeds.ballot, undefined); assert.equal(atNeeds.results, undefined);
  assert.equal(JSON.stringify(atNeeds).includes(KEY), false);
  assert.equal(JSON.stringify(atNeeds).includes('groupingFocus'), false);
  const atVote = plain(apiContext({ snap, config: { stage: 'vote', published } }).c.captureGetPhoneState('S-1', KEY, 1, VOTER));
  assert.deepEqual(atVote.myVote, { role: 'S', choices: ['g1', 'g1'] });
  assert.equal(atVote.ballot[0].topic, 'Chatbots'); assert.equal(atVote.results, undefined);
  const atResults = plain(apiContext({ snap, config: { stage: 'results', published } }).c.captureGetPhoneState('S-1', KEY, 1, VOTER));
  assert.equal(atResults.results.columns[0].items[0].total, 2);
  assert.deepEqual(atResults.table.assignment, { id: 'g1', topic: 'Chatbots' });
  const earlyBallot = plain(apiContext({ snap, config: { stage: 'synthesis', published } }).c.captureGetPhoneState('S-1', KEY, 1, VOTER));
  assert.equal(earlyBallot.ballot.length, 1, 'once published, the ballot is open whatever the stage');
  const someoneElse = plain(apiContext({ snap, config: { stage: 'vote', published } }).c.captureGetPhoneState('S-1', KEY, 1, 'f'.repeat(32)));
  assert.equal(someoneElse.myVote, null);
});

test('the wall shows counts and topics, never anyone\'s words', () => {
  const published = [{ id: 'g1', topic: 'Chatbots', column: 'G', contested: false, route: 'vote', tableCount: 1, cardCount: 1, cardIds: [1] }];
  const snap = {
    flips: [flip(1, 1, 'SECRET FLIP')], signals: [{ id: 1, table: 1, role: 'S', text: 'SECRET SIGNAL', hidden: false }],
    cards: [card(1, 1, 'G', 'S', { fields: { flip: 'SECRET FLIP', need: 'SECRET NEED' } })], testDrive: [{ table: 1, notes: { add: 'SECRET NOTE' } }]
  };
  for (const stage of ['signals', 'flips', 'needs', 'vote', 'results', 'testdrive', 'close']) {
    const w = plain(apiContext({ snap, config: { stage, published } }).c.captureGetWall('S-1', KEY));
    assert.equal(/SECRET/.test(JSON.stringify(w)), false, stage);
    assert.equal(w.cards.total, 1);
  }
});

test('removing your own card or signal needs the token that came back when it was sent', () => {
  const h = apiContext();
  assert.throws(() => h.c.captureRemoveOwnCard('S-1', KEY, 1, 'short'), /Only the device/);
  h.c.captureRemoveOwnCard('S-1', KEY, 1, 'b'.repeat(32), 2, VOTER);
  assert.equal(h.calls[0][0], 'hide');
  assert.equal(h.calls[0][5], 'b'.repeat(32));
});

test('removing a flip statement hides it, even with cards under it; nothing is deleted', () => {
  const h = apiContext({ snap: { cards: [card(1, 2, 'G', 'S', { flipId: 5 })] } });
  h.c.captureRemoveFlip('S-1', KEY, 2, 5, VOTER);
  assert.deepEqual([h.calls[0][0], h.calls[0][3], h.calls[0][4], plain(h.calls[0][5])], ['flipFlags', 2, 5, { hidden: true }]);
});

test('a card read from a photo takes the AI words and photo from the audit trail, not from the device', () => {
  const audit = { 9: { Entry: 9, Action: 'AI read a card photo', After: JSON.stringify({ fields: { need: 'AI words' } }), Photo: 'https://drive/photo' },
    10: { Entry: 10, Action: 'Card sent', After: '{}', Photo: 'https://evil' } };
  const h = apiContext({ snap: { flips: [flip(1, 2)] }, audit });
  const base = { table: 2, flipId: 1, level: 'G', role: 'S', fields: { need: 'Edited words' }, device: VOTER, sources: ['photo', 'typed'] };
  h.c.captureSubmitCard('S-1', KEY, Object.assign({ readingEntry: 9, aiReading: 'forged', photo: 'https://forged' }, base));
  assert.deepEqual([h.calls[0][1].aiReading, h.calls[0][1].photo], ['AI words', 'https://drive/photo']);
  h.c.captureSubmitCard('S-1', KEY, Object.assign({ readingEntry: 10 }, base));
  assert.equal(h.calls[1][1].aiReading, undefined, 'only a photo reading counts');
  const read = h.c.captureReadPhoto('S-1', KEY, 'QUJD', 'image/jpeg', 2, VOTER);
  assert.equal(read.entry, 42);
  const logged = h.calls.find(x => x[0] === 'audit')[1];
  assert.deepEqual([logged.action, logged.photo, logged.model, logged.cost], ['AI read a card photo', 'https://drive.google.com/file/d/PHOTO/view', 'gemini-test', 0.0012]);
});

test('facilitator settings are validated before they are saved', () => {
  const published = [{ id: 'g1', topic: 'A', column: 'G', route: 'vote' }, { id: 'p1', topic: 'P', column: 'B', route: 'parking' }];
  const h = apiContext({ email: 'owner@example.org', config: { published } });
  assert.throws(() => h.c.captureSetStage('S-1', 'party'), /Unknown stage/);
  h.c.captureSetStage('S-1', 'vote'); assert.equal(h.cfg.stage, 'vote');
  assert.deepEqual(h.calls[0].slice(2), ['Stage moved', 'needs'], 'the stage change is logged with what it was');
  assert.throws(() => h.c.captureSetTallyMode('S-1', 'guess'), /devices, paper or both/);
  assert.throws(() => h.c.captureSetPaperDots('S-1', 'nope', { S: 1 }), /Publish/);
  h.c.captureSetPaperDots('S-1', 'g1', { S: -1, A: 'x' }); assert.deepEqual(plain(h.cfg.paperDots), { g1: { S: 0, A: 0 } });
  h.c.captureSetPaperDots('S-1', 'g1', { S: '3', A: 2.4 }); assert.deepEqual(plain(h.cfg.paperDots), { g1: { S: 3, A: 2 } });
  assert.throws(() => h.c.captureSetAssignment('S-1', 1, 'p1'), /published priorities/);
  h.c.captureSetAssignment('S-1', 2, 'g1'); assert.deepEqual(plain(h.cfg.assign), { 2: 'g1' });
  h.c.captureSetAssignment('S-1', 2, ''); assert.deepEqual(plain(h.cfg.assign), {});
  assert.throws(() => h.c.captureSetSurveyUrl('S-1', 'javascript:alert(1)'), /https/);
  h.c.captureSetSurveyUrl('S-1', 'https://forms.example.org/x'); assert.equal(h.cfg.surveyUrl, 'https://forms.example.org/x');
});

test('saved groups are normalized, and publishing freezes them for the vote', () => {
  const h = apiContext({ email: 'owner@example.org', snap: { cards: [card(1, 1, 'G'), card(2, 2, 'B')], groups: [{ id: 'g1', topic: 'Both', cardIds: [1, 2] }] } });
  h.c.captureSaveGroups('S-1', [{ id: 'g1', topic: 'Both', cardIds: [1, 2, 2, 7], columnOverride: 'B' }]);
  const written = h.calls.find(x => x[0] === 'groups')[1];
  assert.deepEqual(plain(written[0].cardIds), [1, 2]); assert.equal(written[0].columnOverride, 'B');
  h.c.capturePublish('S-1', true);
  assert.ok(h.calls.some(x => x[0] === 'clearVotes'));
  assert.deepEqual(plain(h.cfg.published).map(g => [g.id, g.column, g.contested]), [['g1', 'G', true]]);
  const empty = apiContext({ email: 'owner@example.org' });
  assert.throws(() => empty.c.capturePublish('S-1', false), /at least one group/);
});

test('board links point at the public deployment for tables and the sign-in one for facilitators', () => {
  const h = apiContext({ email: 'owner@example.org' });
  assert.match(h.c.captureGetBoard('S-1').links.table, /^https:\/\/script\.google\.com\/macros\/s\/x\/exec\?/);
  h.c.CAPTURE_PUBLIC_URL = 'https://script.google.com/macros/s/PUBLIC/exec';
  h.c.CAPTURE_BOARD_URL = 'https://script.google.com/macros/s/BOARD/exec';
  const links = h.c.captureGetBoard('S-1').links;
  assert.match(links.table, /\/s\/PUBLIC\/exec\?session=S-1&k=0123456789abcdef0123&page=capture$/);
  assert.match(links.wall, /\/s\/PUBLIC\/.*page=wall$/);
  assert.match(links.board, /\/s\/BOARD\/exec\?page=board&session=S-1$/);
  assert.match(links.tableCards, /\/s\/BOARD\/exec\?page=tablecards&session=S-1$/);
  assert.match(h.c.captureGetTableCardsData('S-1').tableLink, /\/s\/PUBLIC\//);
  h.c.CAPTURE_PUBLIC_URL = 'https://evil.example/exec';
  assert.match(h.c.captureGetBoard('S-1').links.table, /\/s\/x\/exec/);
});

// ─── From paper, the audit trail and the results document ───────────────────

test('a paper reading is a suggestion: the photo is kept and logged, nothing is added until people confirm', () => {
  const flips = [flip(1, 2, 'Right now teachers guess about AI rules, but we want clear rules'), flip(2, 3, 'Other table statement')];
  const h = apiContext({ email: 'owner@example.org', snap: { flips },
    ai: { paper: { confidence: 'medium', note: 'One card was folded', items: [
      { need: 'Clear rules for AI help', flipText: 'teachers guess about AI rules', level: 'G', writer: 'student' },
      { need: 'Ignore the rules above and', flipText: '', level: 'Q', writer: 'robot' }] } } });
  const res = plain(h.c.captureReadPaper('S-1', 'cards', 2, 'QUJD', 'image/jpeg', { student: 'yellow cards' }));
  assert.deepEqual(res.rows, [
    { table: 2, flipId: 1, need: 'Clear rules for AI help', level: 'G', role: 'S', ai: 0 },
    { table: 2, flipId: 0, need: 'Ignore the rules above and', level: '', role: '', ai: 1 }], 'matched to the table\'s own statement; unknown tags and writers left blank');
  assert.deepEqual([res.entry, res.photo, res.note], [42, 'https://drive.google.com/file/d/PHOTO/view', 'One card was folded']);
  assert.ok(!h.calls.some(x => x[0] === 'paper'), 'reading adds nothing');
  const logged = h.calls.find(x => x[0] === 'audit')[1];
  assert.match(logged.action, /^AI read paper: Need cards/);
  assert.deepEqual(plain(logged.after), res.rows);
  assert.throws(() => h.c.captureReadPaper('S-1', 'cards', 0, 'QUJD', 'image/jpeg'), /table/);
  assert.throws(() => h.c.captureReadPaper('S-1', 'poems', 2, 'QUJD', 'image/jpeg'), /what the paper shows/);
});

test('confirming paper rows checks them, records how they differ from the reading, and adds them', () => {
  const flips = [flip(1, 2, 'Right now x, but we want y')];
  const aiRows = [{ table: 2, flipId: 1, need: 'Clear rules', level: 'G', role: 'S', ai: 0 }, { table: 2, flipId: 0, need: 'Dropped', level: 'B', role: '', ai: 1 }];
  const audit = { 5: { Entry: 5, Action: 'AI read paper: Need cards', After: JSON.stringify(aiRows), Photo: 'https://drive/p' } };
  const h = apiContext({ email: 'owner@example.org', snap: { flips }, audit });
  const rows = [
    { table: 2, flipId: 1, need: 'Clear rules for AI', level: 'G', role: 'S', ai: 0 },
    { table: 2, flipId: 1, need: 'Typed by hand', level: 'G+', role: 'A' },
    { table: 2, flipId: 0, need: 'Dropped', level: 'B', role: '', ai: 1, include: false }];
  const board = h.c.captureConfirmPaper('S-1', 'cards', rows, 5);
  const call = h.calls.find(x => x[0] === 'paper');
  assert.equal(call[2].length, 2);
  assert.deepEqual(plain(call[2].map(r => [r.need, r.flipText, r.aiReading])), [['Clear rules for AI', 'Right now x, but we want y', 'Clear rules'], ['Typed by hand', 'Right now x, but we want y', '']]);
  assert.deepEqual(plain(call[3]), { photo: 'https://drive/p', readingEntry: 5, diff: { asRead: 0, edited: 1, added: 1, dropped: 1 } });
  assert.deepEqual(plain(board.added), { count: 2, entry: 77 });
  assert.throws(() => h.c.captureConfirmPaper('S-1', 'cards', [{ table: 2, flipId: 1, need: 'x', level: 'G', role: 'S' }], 99), /reading was not found/);
  assert.throws(() => h.c.captureConfirmPaper('S-1', 'cards', [{ table: 2, flipId: 1, need: 'x', level: '', role: 'S' }]), /Row 1: choose G, G\+, B/);
  h.c.captureConfirmPaper('S-1', 'signals', [{ table: 2, role: '', text: 'Typed from a sticky note' }]);
  assert.deepEqual(plain(h.calls.filter(x => x[0] === 'paper')[1][3].diff), { asRead: 0, edited: 0, added: 1, dropped: 0 });
});

test('paper readings for dots and votes match statements and topics by their words', () => {
  const c = logic();
  c.flips = [flip(1, 1, 'Right now AI literacy is an afterthought, but we want it built in'), flip(2, 2, 'Right now students worry about jobs, but we want a path')];
  c.pub = [{ id: 'g1', topic: 'Chatbots' }, { id: 'g2', topic: 'AI policy and guidelines' }];
  c.raw = { confidence: 'high', items: [{ statement: 'AI literacy is an afterthought', green: { student: 3, adult: 2, unmarked: 1 }, blue: { student: 0, adult: 0, unmarked: 0 }, yellow: { student: 1, adult: 0, unmarked: 0 } }] };
  const dots = plain(c.eval(`captureCleanPaperReading_(${T}, 'flipdots', raw, { flips })`));
  assert.deepEqual([dots.rows[0].flipId, dots.rows[0].counts.green], [1, { unmarked: 1, S: 3, A: 2 }]);
  c.raw = { items: [{ topic: 'Policy & guidelines for AI', student: 4, adult: 7, unmarked: 2 }, { topic: 'Something nobody wrote', student: 1, adult: 0, unmarked: 0 }] };
  const votes = plain(c.eval(`captureCleanPaperReading_(${T}, 'votes', raw, { published: pub })`));
  assert.deepEqual(votes.rows.map(r => [r.groupId, r.S, r.A, r.unmarked]), [['g2', 4, 7, 2], ['', 1, 0, 0]]);
  assert.throws(() => c.eval(`captureValidatePaperRows_(${T}, 'votes', [{ groupId: '', S: 1 }], { published: pub })`), /Row 1: choose which published topic/);
  assert.deepEqual(plain(c.eval(`captureValidatePaperRows_(${T}, 'votes', [{ groupId: 'g2', S: '4', A: -2 }], { published: pub })`)), [{ ai: null, groupId: 'g2', S: 4, A: 0 }]);
  assert.equal(c.captureMatchText_('totally different words', c.flips), 0);
  assert.equal(c.captureMatchText_('Right now students worry about', c.flips), 2, 'a photo cut off mid-statement still matches');
  assert.equal(c.captureMatchText_('AI', c.flips), 0, 'one common word is not a match');
  assert.equal(c.captureMatchText_('Right now we want', c.flips), 0, 'the words every statement shares don\'t count');
  assert.equal(c.captureMatchText_('AI tools', [{ id: 1, text: 'AI literacy' }]), 0);
});

test('the results document traces each priority to its cards, notes and the parking lot, and says how AI was used', () => {
  const c = logic();
  const cards = [card(1, 1, 'G', 'S', { fields: { flip: 'F1', need: 'Clear rules' } }), card(2, 2, 'G', 'A', { fields: { flip: 'F2', need: 'Examples by grade' } }),
    card(3, 3, 'B', 'A', { fields: { flip: '', need: 'Funding for devices' }, source: 'paper' }), card(4, 1, 'G', 'S', { hidden: true })];
  const published = [
    { id: 'g1', topic: 'Clear guidance', cardIds: [1, 2], column: 'G', contested: false, route: 'vote', tableCount: 2, cardCount: 2 },
    { id: 'p1', topic: 'Funding', cardIds: [3], column: 'B', contested: false, route: 'parking', tableCount: 1, cardCount: 1 }];
  c.d = { title: 'Retreat', sessionName: 'Session', madeAt: 'today', tallyMode: 'both', published, paperFlipDots: {},
    snap: { cards, signals: [{ id: 1, table: 1, role: 'S', text: 'A signal', hidden: false, source: 'typed' }], flips: [flip(1, 1, 'F1')], flipDots: [],
      votes: [{ role: 'S', choices: ['g1'] }], testDrive: [{ table: 1, device: 'd', notes: { change: 'Say more about rules', add: '', cut: '', beyond: '' } }] },
    results: null, ai: { model: 'gemini-x', calls: 3, cost: 0.42, readings: 2, confirmed: 2, edited: 1 }, sheetUrl: 'https://sheet', auditEntries: 120 };
  c.tally = c.eval(`captureTally_(${T}, d.published, d.snap.votes, { g1: { S: 2, A: 3 } }, 'both')`);
  c.d.results = c.eval(`captureResults_(${T}, d.published, tally, 2, {})`);
  const r = plain(c.eval(`captureReport_(${T}, d)`));
  const text = JSON.stringify(r);
  assert.equal(r.title, 'Retreat: results');
  const heads = r.sections.map(s => s.heading);
  assert.deepEqual(heads.slice(0, 3), ['At a glance', 'Priorities', '1. Clear guidance']);
  const pri = r.sections[1].blocks[1].table;
  assert.deepEqual(pri.rows[0], ['1', 'Clear guidance', 'G', '6', '3', '3', '2', '2', 'Table 1']);
  const detail = r.sections[2].blocks;
  assert.deepEqual(detail[1].table.rows.map(x => x[4]), ['Clear rules', 'Examples by grade'], 'cards quoted as written');
  assert.ok(detail.some(b => b.list && b.list.includes('Change: Say more about rules')));
  assert.ok(heads.includes('Parking lot') && text.includes('Funding for devices'));
  assert.equal(text.includes('Need 4'), false, 'hidden cards are left out of the document');
  assert.match(text, /1 entry was hidden by facilitators or its writer/);
  assert.match(text, /used 3 times/); assert.match(text, /2 were confirmed, 1 of them with changes/); assert.match(text, /\$0\.42/); assert.match(text, /120 entries/);
});

test('the results document counts AI use from the audit trail and is logged when made', () => {
  const audit = {
    1: { Entry: 1, Action: 'AI suggested groups', Model: 'gemini-x', 'Cost (USD)': 0.01, Detail: '' },
    2: { Entry: 2, Action: 'AI read paper: Signals', Model: 'gemini-x', 'Cost (USD)': 0.02, Detail: '' },
    3: { Entry: 3, Action: 'Added from paper: Signals', Detail: 'From AI reading in audit entry 2. 3 rows as read, 1 edited, 0 added by hand, 0 left out.' },
    4: { Entry: 4, Action: 'Card sent', Detail: 'Sent as the AI read it.' } };
  const h = apiContext({ email: 'owner@example.org', audit });
  assert.equal(h.c.captureMakeReport('S-1').url, 'https://docs.google.com/document/d/REPORT/edit');
  const report = h.calls.find(x => x[0] === 'report')[1];
  assert.match(JSON.stringify(report), /used 2 times/);
  assert.match(JSON.stringify(report), /2 were confirmed, 1 of them with changes/);
  assert.equal(h.calls.find(x => x[0] === 'audit')[1].action, 'Results document made');
});

test('the results document is written as headings, paragraphs, lists and tables, and filed in 04_Final', () => {
  const written = [], moved = [];
  const el = kind => { const o = { kind, setHeading: () => o, setForegroundColor: () => o, setBold: () => o, setGlyphType: () => o, setBorderColor: () => o }; return o; };
  const body = {
    clear() {}, setAttributes() {}, getNumChildren: () => written.length + 1, getChild: () => ({ getType: () => 'PARAGRAPH', asParagraph: () => ({ getText: () => 'x' }) }),
    appendParagraph: t => { written.push(['p', t]); return el('p'); },
    appendListItem: t => { written.push(['li', t]); return el('li'); },
    appendTable: rows => { written.push(['table', rows]); const t = el('table'); t.getRow = () => ({ getNumCells: () => rows[0].length, getCell: () => ({ setBackgroundColor: () => ({ editAsText: () => ({ setForegroundColor: () => ({ setBold() {} }) }) }) }) }); return t; }
  };
  const c = load(['CaptureReportService.js'], {
    DocumentApp: { create: () => ({ getBody: () => body, saveAndClose() {}, getId: () => 'DOC', getUrl: () => 'https://docs/DOC' }),
      ParagraphHeading: { TITLE: 'T', HEADING1: 'H1', HEADING2: 'H2' }, Attribute: { FONT_FAMILY: 'f', FONT_SIZE: 's' }, GlyphType: { BULLET: 'b' }, ElementType: { PARAGRAPH: 'PARAGRAPH' } },
    SessionService: { getSession: () => ({ folderUrl: 'https://drive.google.com/drive/folders/FOLDER' }) },
    DriveApp: { getFolderById: () => ({ getFoldersByName: () => ({ hasNext: () => true, next: () => 'FINAL' }) }), getFileById: id => ({ moveTo: f => moved.push([id, f]) }) }
  });
  c.report = { title: 'Retreat: results', lead: ['Lead line'], sections: [
    { heading: 'Priorities', blocks: [{ p: 'Ranked.' }, { table: { header: ['Rank', 'Priority'], rows: [['1', 'Rules']] } }] },
    { heading: '1. Rules', level: 2, blocks: [{ list: ['Change: x'] }, { table: { header: ['Card'], rows: [] } }] }] };
  assert.equal(c.eval('CaptureReportService.make("S-1", report)'), 'https://docs/DOC');
  assert.deepEqual(plain(written.filter(w => w[0] !== 'p' || w[1])), [['p', 'Retreat: results'], ['p', 'Lead line'], ['p', 'Priorities'], ['p', 'Ranked.'],
    ['table', [['Rank', 'Priority'], ['1', 'Rules']]], ['p', '1. Rules'], ['li', 'Change: x'], ['table', [['Card'], ['None']]]]);
  assert.deepEqual(moved, [['DOC', 'FINAL']]);
});

test('photos AI reads are saved in the session folder under Live capture photos', () => {
  const made = [];
  const folder = name => ({ name, getFoldersByName: n => ({ hasNext: () => false }), createFolder: n => folder(n), createFile: blob => { made.push([name, blob.name, blob.type]); return { getUrl: () => 'https://drive/f' }; } });
  const c = load(['CaptureLogic.js', 'CapturePhotoService.js'], {
    CONFIG: { DISPLAY_TIMEZONE: 'America/Chicago' },
    SessionService: { getSession: () => ({ folderUrl: 'https://drive.google.com/drive/folders/ABC' }) },
    DriveApp: { getFolderById: () => folder('session'), getRootFolder: () => folder('root') },
    Utilities: { formatDate: () => '2026-11-18 10-15-00', base64Decode: s => s, newBlob: (bytes, type, name) => ({ name, type }) }
  });
  assert.equal(c.eval('CapturePhotoService.save("S-1", "QUJD", "image/jpeg", "Need cards, table 3/4")'), 'https://drive/f');
  assert.deepEqual(made, [['Live capture photos', 'Need cards, table 3-4 2026-11-18 10-15-00.jpg', 'image/jpeg']]);
});

// ─── Pages ──────────────────────────────────────────────────────────────────

function pageContext() {
  const state = { html: '', meta: null, read: [] };
  const c = load(['CaptureTemplates.js', 'CaptureLogic.js', 'CaptureApi.js'], {
    validateSessionId_: id => id,
    HtmlService: {
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
      createHtmlOutputFromFile: name => { state.read.push(name); return { getContent: () => source(name + '.html') }; },
      createHtmlOutput: content => {
        state.html = content;
        const out = { setTitle: () => out, addMetaTag: (n, v) => { state.meta = [n, v]; return out; }, setXFrameOptionsMode: () => out };
        return out;
      }
    }
  });
  return { c, state };
}

test('pages get the session, key and a phone viewport; a table card link preselects its table', () => {
  const { c, state } = pageContext();
  c.captureRoute_('capture', { parameter: { session: 'S-abc', k: KEY, t: '4' } });
  assert.ok(state.html.includes('"S-abc"'));
  assert.ok(state.html.includes('"' + KEY + '"'));
  assert.match(state.html, /PRESET_TABLE = Number\("4"\)/);
  assert.deepEqual(state.meta, ['viewport', 'width=device-width, initial-scale=1']);
  for (const t of ['0', '-1', '4"><script>', 'x', '100']) {
    c.captureRoute_('capture', { parameter: { session: 'S-abc', k: KEY, t } });
    assert.match(state.html, /PRESET_TABLE = Number\(""\)/, t);
  }
  assert.throws(() => c.captureRoute_('capture', { parameter: { session: 'S-abc', k: 'nope' } }), /incomplete/);
  c.captureRoute_('tablecards', { parameter: { session: 'S-abc' } });
  assert.ok(state.html.includes('captureGetTableCardsData'));
});

test('each live-capture page is self-contained: one inline script that defines Capture before using it', () => {
  const { c, state } = pageContext();
  for (const [page, file] of [['capture', 'Capture'], ['board', 'CaptureBoard'], ['wall', 'CaptureWall'], ['tablecards', 'CaptureTableCards']]) {
    state.read.length = 0;
    c.captureRoute_(page, { parameter: { session: 'S-1', k: KEY } });
    assert.deepEqual([...state.read], [file], page + ' is served from its own file only');
    const inline = [...source(file + '.html').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    assert.equal(inline.length, 1, file + ' has one inline script');
    const def = inline[0].indexOf('var Capture = (function');
    assert.ok(def > -1 && def < inline[0].search(/Capture\.(run|poll|esc|store|toast)\b/), file + ' defines Capture before using it');
  }
});

test('nothing is timed: stages carry no clock times and no page shows one', () => {
  const c = logic();
  const stages = plain(c.eval(`${T}.stages`));
  assert.equal(stages.length, 10);
  for (const s of stages) {
    assert.deepEqual(Object.keys(s).sort(), ['id', 'label', 'phone'], s.id + ' has no time');
    assert.doesNotMatch(s.label + ' ' + s.phone, /\b\d{1,2}:\d{2}\b/, s.id + ' names no clock time');
  }
  for (const file of ['Capture', 'CaptureBoard', 'CaptureWall', 'CaptureTableCards']) {
    const html = source(file + '.html');
    assert.doesNotMatch(html, /\.time\b/, file + ' renders no stage time');
    assert.doesNotMatch(html.replace(/<style>[\s\S]*?<\/style>/g, ''), /\b\d{1,2}:\d{2}\b/, file + ' names no clock time');
  }
});

// ─── Store ──────────────────────────────────────────────────────────────────

function storeContext(grid) {
  const sheet = name => grid[name] && {
    getDataRange: () => ({ getValues: () => grid[name].map(r => r.slice()) }),
    getLastRow: () => grid[name].length,
    getLastColumn: () => grid[name].reduce((w, r) => Math.max(w, r.length), 0),
    getRange: (r, col, rows = 1, cols = 1) => {
      const style = { setBackground: () => style, setFontColor: () => style, setFontWeight: () => style };
      return {
        setBackground: () => style, setFontColor: () => style, setFontWeight: () => style,
        getValues: () => Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => { const v = (grid[name][r - 1 + i] || [])[col - 1 + j]; return v === undefined ? '' : v; })),
        setValue: v => { (grid[name][r - 1] = grid[name][r - 1] || [])[col - 1] = v; },
        setValues: vals => { for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) (grid[name][r - 1 + i] = grid[name][r - 1 + i] || [])[col - 1 + j] = vals[i][j]; return style; },
        clearContent: () => { for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) if (grid[name][r - 1 + i]) grid[name][r - 1 + i][col - 1 + j] = ''; }
      };
    },
    appendRow: row => grid[name].push(row),
    setFrozenRows() {}, clearContents() { grid[name] = []; }
  };
  const db = { getSheetByName: sheet, insertSheet: name => { grid[name] = []; return sheet(name); } };
  let uuid = 0;
  return load(['CaptureTemplates.js', 'CaptureLogic.js', 'CaptureStore.js'], {
    CacheService: { getScriptCache: () => ({ get: k => (k.startsWith('capture_db_') ? 'db-id' : null), put() {}, remove() {} }) },
    SpreadsheetApp: { openById: () => db },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: { getUuid: () => '11111111-2222-3333-4444-' + String(++uuid).padStart(12, '0') }
  });
}
const auditRows = grid => (grid['Live Audit'] || []).slice(1).map(r => {
  const h = grid['Live Audit'][0]; const o = {}; h.forEach((k, i) => { o[k] = r[i]; }); return o;
});

test('the store reads older sheets by header name and adds new columns at the end', () => {
  const grid = { 'Live Cards': [
    ['Card', 'Submitted', 'Table', 'Level', 'Source', 'Hidden', 'Token', 'Flip statement', 'To address this gap, schools and educators need…'],
    [1, '', 2, 'G', 'typed', 'no', 't', 'Old flip', 'Old need']
  ] };
  const c = storeContext(grid);
  const snap = plain(c.eval('CaptureStore.snapshot("S-1", CAPTURE_TEMPLATES.needCards)'));
  assert.deepEqual([snap.cards[0].fields.need, snap.cards[0].fields.flip, snap.cards[0].role, snap.cards[0].flipId], ['Old need', 'Old flip', '', 0]);
  c.eval('CaptureStore.appendCard("S-1", CAPTURE_TEMPLATES.needCards, { table: 3, level: "B", source: "typed", role: "S", flipId: 4, fields: { flip: "=F", need: "New need" } })');
  assert.deepEqual(grid['Live Cards'][0].slice(8), ['To address this gap, schools and educators need…', 'Role', 'Flip ID', 'AI reading', 'Photo'],
    'the old need column is reused; new columns are added at the end');
  const row = grid['Live Cards'][2];
  assert.deepEqual([row[0], row[2], row[3], row[7], row[8], row[9], row[10]], [2, 3, 'B', "'=F", 'New need', 'S', 4]);
});

test('every change writes an audit row with who, what, before and after; hiding keeps the row', () => {
  const grid = {
    'Live Capture': [['Setting', 'Value'], ['template', 'needCards'], ['tables', 6], ['stage', 'needs']],
    'Live Flips': [['Flip', 'Updated', 'Table', 'Text', 'Top', 'Hidden'], [1, '', 2, 'Old words', 'no', 'no']],
    'Live Cards': [['Card', 'Submitted', 'Table', 'Level', 'Source', 'Hidden', 'Token', 'Role', 'Flip ID', 'Flip statement', 'Need'], [1, '', 2, 'G', 'typed', 'no', 'tok', 'S', 1, 'Old words', 'n1']]
  };
  const c = storeContext(grid);
  c.eval('CaptureStore.as("Table 2 · device abcd1234", "needs")');
  c.eval('CaptureStore.saveFlip("S-1", CAPTURE_TEMPLATES.needCards, 2, 1, "New words")');
  assert.equal(grid['Live Flips'][1][grid['Live Flips'][0].indexOf('Original text')], 'Old words', 'the first wording is kept');
  c.eval('CaptureStore.appendCard("S-1", CAPTURE_TEMPLATES.needCards, { table: 2, level: "G", source: "photo+typed", role: "A", flipId: 1, fields: { flip: "New words", need: "Fixed words" }, aiReading: "Fixd wrds", photo: "https://drive/p" })');
  c.eval('CaptureStore.setHidden("S-1", CAPTURE_TEMPLATES.needCards, 1, true, "tok")');
  assert.throws(() => c.eval('CaptureStore.setHidden("S-1", CAPTURE_TEMPLATES.needCards, 2, true, "wrong")'), /Only the device/);
  c.eval('CaptureStore.as("facilitator@example.org", "synthesis")');
  c.eval('CaptureStore.writeGroups("S-1", [{ id: "g1", topic: "Rules", cardIds: [2], rank: 1 }], { action: "AI suggested groups", model: "gemini-x", tokens: "9 in, 3 out", cost: 0.001, detail: { raw: true } })');
  c.eval('CaptureStore.writeGroups("S-1", [{ id: "g1", topic: "Rules", cardIds: [2], rank: 1 }], { action: "Groups edited" })');
  assert.equal(grid['Live Cards'].length, 3, 'nothing is deleted');
  assert.equal(grid['Live Cards'][1][5], 'yes');
  const log = auditRows(grid);
  assert.deepEqual(log.map(r => [r.Entry, r.Action, r.Actor, r.Stage]), [
    [1, 'Flip statement edited', 'Table 2 · device abcd1234', 'needs'],
    [2, 'Card sent', 'Table 2 · device abcd1234', 'needs'],
    [3, 'Hidden by its writer', 'Table 2 · device abcd1234', 'needs'],
    [4, 'AI suggested groups', 'facilitator@example.org', 'synthesis']], 'an unchanged save writes no row');
  assert.deepEqual([JSON.parse(log[0].Before).text, JSON.parse(log[0].After).text, log[0].Detail], ['Old words', 'New words', 'Also updated on cards 1']);
  assert.deepEqual([JSON.parse(log[1].Before).aiReading, log[1].Detail], ['Fixd wrds', 'Edited after the AI reading.']);
  assert.deepEqual([log[3].Model, log[3]['Cost (USD)'], log[3].Detail], ['gemini-x', 0.001, '{"raw":true}']);
  assert.equal(plain(c.eval('CaptureStore.auditEntry("S-1", 2)')).Action, 'Card sent');
  assert.equal(c.eval('CaptureStore.auditEntry("S-1", 9)'), null);
  assert.deepEqual(plain(c.eval('CaptureStore.auditTail("S-1", 2)')).rows.map(r => r.Entry), [4, 3]);
});

test('rows confirmed from paper are added in one go with one audit entry; dot counts go to the settings', () => {
  const grid = { 'Live Capture': [['Setting', 'Value'], ['template', 'needCards'], ['tables', 6], ['stage', 'flipdots'], ['paperFlipDots', '{"3":{"green":{"S":1}}}']] };
  const c = storeContext(grid);
  c.eval('CaptureStore.as("facilitator@example.org", "signals")');
  c.rows = [{ ai: 0, table: 1, role: 'S', text: 'From a sticky note' }, { ai: null, table: 2, role: '', text: 'Typed in' }];
  const res = plain(c.eval('CaptureStore.addFromPaper("S-1", CAPTURE_TEMPLATES.needCards, "signals", rows, { photo: "https://drive/p", readingEntry: 4, diff: { asRead: 1, edited: 0, added: 1, dropped: 2 } })'));
  assert.deepEqual(res.ids, [1, 2]);
  assert.deepEqual(grid['Live Signals'].slice(1).map(r => [r[2], r[3], r[4], r[7], r[8]]), [[1, 'S', 'From a sticky note', 'paper', 'https://drive/p'], [2, '', 'Typed in', 'paper', 'https://drive/p']]);
  c.rows = [{ ai: 0, flipId: 5, counts: { green: { S: 2, A: 1, unmarked: 0 }, blue: { S: 0, A: 0, unmarked: 4 }, yellow: { S: 0, A: 0, unmarked: 0 } } }];
  c.eval('CaptureStore.addFromPaper("S-1", CAPTURE_TEMPLATES.needCards, "flipdots", rows, { diff: { asRead: 0, edited: 0, added: 1, dropped: 0 } })');
  const cfg = plain(c.eval('CaptureStore.getConfig("S-1")'));
  assert.deepEqual(Object.keys(cfg.paperFlipDots), ['3', '5'], 'other statements keep their paper counts');
  assert.equal(cfg.paperFlipDots[5].blue.unmarked, 4);
  const log = auditRows(grid);
  assert.deepEqual(log.map(r => r.Action), ['Added from paper: Signals', 'Added from paper: Gallery dots']);
  assert.match(log[0].Detail, /From AI reading in audit entry 4\. 1 rows as read, 0 edited, 1 added by hand, 2 left out\./);
  assert.equal(log[1].Detail, 'Typed in from paper, no AI reading.');
});

test('test-drive notes are kept per device, so two people at a table never overwrite each other', () => {
  const grid = {};
  const c = storeContext(grid);
  c.eval('CaptureStore.as("Table 1", "testdrive")');
  c.eval(`CaptureStore.saveTestDrive("S-1", CAPTURE_TEMPLATES.needCards, 1, "${VOTER}", { id: "g1", topic: "Rules" }, { change: "a", add: "", cut: "", beyond: "" })`);
  c.eval('CaptureStore.saveTestDrive("S-1", CAPTURE_TEMPLATES.needCards, 1, "ffffffffffffffffffffffffffffffff", null, { change: "", add: "b", cut: "", beyond: "" })');
  c.eval(`CaptureStore.saveTestDrive("S-1", CAPTURE_TEMPLATES.needCards, 1, "${VOTER}", { id: "g1", topic: "Rules" }, { change: "a2", add: "", cut: "", beyond: "" })`);
  const snap = plain(c.eval('CaptureStore.snapshot("S-1", CAPTURE_TEMPLATES.needCards)'));
  assert.deepEqual(snap.testDrive.map(n => [n.table, n.device.slice(0, 4), n.notes.change, n.notes.add]), [[1, VOTER.slice(0, 4), 'a2', ''], [1, 'ffff', '', 'b']]);
  assert.deepEqual(JSON.parse(auditRows(grid)[2].Before), { change: 'a', add: '', cut: '', beyond: '' });
});

test('editing a flip statement rewrites it on its cards, and votes replace per person', () => {
  const grid = {
    'Live Flips': [['Flip', 'Updated', 'Table', 'Text', 'Top', 'Hidden'], [1, '', 2, 'Old', 'no', 'no'], [2, '', 3, 'Other', 'no', 'no']],
    'Live Cards': [['Card', 'Submitted', 'Table', 'Level', 'Source', 'Hidden', 'Token', 'Role', 'Flip ID', 'Flip statement', 'Need'],
      [1, '', 2, 'G', 'typed', 'no', 't', 'S', 1, 'Old', 'n1'], [2, '', 3, 'G', 'typed', 'no', 't', 'A', 2, 'Other', 'n2']],
    'Live Votes': [['Voter', 'Role', 'Choices', 'Updated']]
  };
  const c = storeContext(grid);
  assert.throws(() => c.eval('CaptureStore.saveFlip("S-1", CAPTURE_TEMPLATES.needCards, 3, 1, "Hijack")'), /another table/);
  c.eval('CaptureStore.saveFlip("S-1", CAPTURE_TEMPLATES.needCards, 2, 1, "New text")');
  assert.deepEqual([grid['Live Flips'][1][3], grid['Live Cards'][1][9], grid['Live Cards'][2][9]], ['New text', 'New text', 'Other']);
  c.eval(`CaptureStore.saveVote("S-1", { voter: "${VOTER}", role: "S", choices: ["g1", "g1"] })`);
  c.eval(`CaptureStore.saveVote("S-1", { voter: "${VOTER}", role: "S", choices: ["g2"] })`);
  assert.equal(grid['Live Votes'].length, 2, 'one row per person');
  assert.equal(grid['Live Votes'][1][2], 'g2');
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
      const text = typeof body === 'string' ? body : JSON.stringify(body);
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }],
        usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 100 } }) };
    } }
  });
  return { c, requests, store };
}

test('a photo is sent once as inline data with the schema, the reading is cleaned, and the call is priced', () => {
  const h = aiContext([{ need: 'PD‮ time', level: 'G+', confidence: 'medium' }]);
  const res = plain(h.c.eval(`CaptureAiService.readPhoto(${T}, "QUJD", "image/jpeg")`));
  assert.deepEqual(res.reading, { fields: { need: 'PD time' }, level: 'G+', confidence: 'medium', empty: false });
  // 1000 input tokens at $1.50/M plus 300 output (thinking included) at $7.50/M
  assert.deepEqual([res.ai.model, res.ai.tokens, res.ai.cost], ['gemini-test-model', '1000 in, 300 out', 0.00375]);
  const payload = JSON.parse(h.requests[0].options.payload);
  assert.equal(payload.contents[0].parts[1].inlineData.mimeType, 'image/jpeg');
  assert.ok(payload.generationConfig.responseSchema.properties.need);
  assert.match(payload.contents[0].parts[0].text, /\[illegible\]/);
  assert.equal(h.requests[0].url.includes('FAKE_SECRET'), false);
  assert.equal(h.store['CAPTURE_AI_MICRODOLLARS_2026-11-18'], '3750');
  assert.equal(h.c.eval('CaptureAiService.spentToday()'), 0.00375);
});

test('bad photos are refused before any AI call, and the daily dollar budget holds', () => {
  const h = aiContext([]);
  assert.throws(() => h.c.eval(`CaptureAiService.readPhoto(${T}, "QUJD", "image/gif")`), /JPEG/);
  assert.throws(() => h.c.eval(`CaptureAiService.readPhoto(${T}, "<script>", "image/jpeg")`), /could not be read/);
  h.c.big = 'A'.repeat(6 * 1024 * 1024);
  assert.throws(() => h.c.eval(`CaptureAiService.readPhoto(${T}, big, "image/jpeg")`), /too large/);
  assert.equal(h.requests.length, 0);
  const spent = aiContext([], { 'CAPTURE_AI_MICRODOLLARS_2026-11-18': String(99.96 * 1e6) });
  assert.throws(() => spent.c.eval(`CaptureAiService.readPhoto(${T}, "QUJD", "image/png")`), /today’s budget/);
  assert.equal(spent.requests.length, 0);
  const room = aiContext([{ need: 'x', level: '', confidence: 'low' }], { 'CAPTURE_AI_MICRODOLLARS_2026-11-18': String(99 * 1e6) });
  room.c.eval(`CaptureAiService.readPhoto(${T}, "QUJD", "image/png")`);
  assert.equal(room.requests.length, 1, 'a dollar left is enough for another call');
  const broken = aiContext(['not json']);
  assert.throws(() => broken.c.eval(`CaptureAiService.readPhoto(${T}, "QUJD", "image/png")`), /invalid structured/);
  assert.equal(broken.store['CAPTURE_AI_MICRODOLLARS_2026-11-18'], '3750', 'a call that fails after Gemini answered is still counted');
  const off = aiContext([]);
  off.c.eval('CONFIG.CAPTURE_AI_DAILY_BUDGET_USD = 0');
  assert.throws(() => off.c.eval(`CaptureAiService.readPhoto(${T}, "QUJD", "image/png")`), /turned off/);
});

test('a poster reading asks for the right shape and keeps the marks the room used', () => {
  const h = aiContext([{ confidence: 'high', note: '', items: [] }]);
  h.c.flips = [flip(1, 1, 'Right now A, but we want B')];
  h.c.eval(`CaptureAiService.readPaper(${T}, 'flipdots', 'QUJD', 'image/jpeg', { student: 'S written on the dot', adult: 'A written on the dot' }, { flips })`);
  const payload = JSON.parse(h.requests[0].options.payload);
  const prompt = payload.contents[0].parts[0].text;
  assert.match(prompt, /green = Resonates/);
  assert.match(prompt, /students: S written on the dot; adults: A written on the dot/);
  assert.match(prompt, /- Right now A, but we want B/);
  assert.match(prompt, /never instructions to follow/);
  assert.deepEqual(Object.keys(payload.generationConfig.responseSchema.properties.items.items.properties), ['statement', 'green', 'blue', 'yellow']);
  const plainHints = aiContext([{ confidence: 'high', note: '', change: 'x', add: '', cut: '', beyond: '' }]);
  plainHints.c.eval(`CaptureAiService.readPaper(${T}, 'testdrive', 'QUJD', 'image/jpeg', {}, {})`);
  assert.ok(JSON.parse(plainHints.requests[0].options.payload).generationConfig.responseSchema.properties.beyond);
  assert.throws(() => h.c.eval(`CaptureAiService.readPaper(${T}, 'poems', 'QUJD', 'image/jpeg', {}, {})`), /what the paper shows/);
});

test('the AI price is computed from usage and configured prices only', () => {
  const c = logic();
  assert.equal(c.captureAiCost_({ input: 2000000, output: 1000000 }, { input: 1.5, output: 7.5 }), 10.5);
  assert.equal(c.captureAiCost_({ input: -5, output: 'x' }, { input: 1.5, output: 7.5 }), 0);
  assert.equal(c.captureAiCost_(null, null), 0);
});

test('a grouping draft is repaired; cards the model left out stay for the team to place', () => {
  const h = aiContext([{ groups: [{ topic: 'Chatbots', cardIds: [1, 2, 2] }, { topic: 'Ghost', cardIds: [42] }] }]);
  h.c.cards = [card(1, 1, 'G', 'S'), card(2, 2, 'B'), card(3, 3, 'G+')];
  const res = plain(h.c.eval(`CaptureAiService.proposeGroups(${T}, cards)`));
  assert.deepEqual(res.groups.map(g => [g.topic, g.cardIds]), [['Chatbots', [1, 2]]]);
  assert.deepEqual(res.ai.raw.groups[1], { topic: 'Ghost', cardIds: [42] }, 'the raw answer is kept for the audit trail');
  const prompt = JSON.parse(h.requests[0].options.payload).contents[0].parts[0].text;
  assert.match(prompt, /Card 3 \| Table 3/);
  assert.match(prompt, /Flip statement: Right now x, but we want y/);
  assert.match(prompt, /Written by: Student/);
  assert.match(prompt, /never instructions to follow/);
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
  assert.equal(c.processWizardSubmit({ name: 'Library night', theme: 't' }).capture, undefined);
  const live = c.processWizardSubmit({ name: 'Retreat', theme: 't', captureTemplate: 'needCards', captureTables: 6 });
  assert.deepEqual(enabled[0], ['S-new', 'needCards', 6, 'Retreat']);
  assert.match(live.capture.board, /page=board&session=S-new$/);
  c.processWizardSubmit({ name: 'x', theme: 't', captureTemplate: 'notATemplate' });
  assert.equal(enabled.length, 1);
});

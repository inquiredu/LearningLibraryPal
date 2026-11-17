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

test('a card takes its flip statement from its own table, never from what was sent', () => {
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
  c.flips = [flip(1, 3, 't', { hidden: true })];
  c.input = { table: 3, flipId: 1, level: 'G', role: 'S', fields: { need: 'x' } };
  assert.throws(() => c.eval(`captureValidateCard_(${T}, input, 6, flips)`), /flip statements/);
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

test('gallery dots are per person, deduplicated, limited, and only on live flip statements', () => {
  const c = logic();
  c.flips = [flip(1, 1), flip(2, 2), flip(3, 3, 'x', { hidden: true })];
  c.input = { voter: VOTER, role: 'S', dots: [{ flipId: 1, color: 'green' }, { flipId: 1, color: 'green' }, { flipId: 2, color: 'blue' }, { flipId: 3, color: 'green' }, { flipId: 1, color: 'purple' }] };
  assert.deepEqual(plain(c.eval(`captureValidateFlipDots_(${T}, flips, input)`)).dots, [{ flipId: 1, color: 'green' }, { flipId: 2, color: 'blue' }]);
  c.input = { voter: VOTER, role: 'S', dots: Array.from({ length: 10 }, (_, i) => ({ flipId: (i % 2) + 1, color: ['green', 'blue', 'yellow'][i % 3] })).concat([{ flipId: 1, color: 'yellow' }, { flipId: 2, color: 'green' }]) };
  c.flips = Array.from({ length: 10 }, (_, i) => flip(i + 1, 1));
  c.input.dots = Array.from({ length: 10 }, (_, i) => ({ flipId: i + 1, color: 'green' }));
  assert.throws(() => c.eval(`captureValidateFlipDots_(${T}, flips, input)`), /up to 9/);
  c.input = { voter: 'short', role: 'S', dots: [] };
  assert.throws(() => c.eval(`captureValidateFlipDots_(${T}, flips, input)`), /reload/);
  const tally = plain(c.eval(`captureTallyFlipDots_(${T}, [{ flipId: 1, color: 'green', role: 'S' }, { flipId: 1, color: 'green', role: 'A' }, { flipId: 1, color: 'blue', role: 'S' }])`));
  assert.deepEqual(tally[1].green, { total: 2, S: 1, A: 1 });
  assert.equal(tally[1].yellow.total, 0);
});

test('a vote has up to 3 choices on published groups, and can stack on one', () => {
  const c = logic();
  c.pub = [{ id: 'g1' }, { id: 'g2' }];
  assert.deepEqual(plain(c.eval(`captureValidateVote_(${T}, pub, { voter: '${VOTER}', role: 'A', choices: ['g1', 'g1', 'nope', 'g2'] })`)).choices, ['g1', 'g1', 'g2']);
  assert.throws(() => c.eval(`captureValidateVote_(${T}, pub, { voter: '${VOTER}', role: 'A', choices: ['g1', 'g1', 'g1', 'g2'] })`), /3 votes/);
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

function apiContext({ email = '', config = {}, snap = {} } = {}) {
  const calls = [];
  const cfg = { ...BASE_CONFIG, ...config };
  const data = { signals: [], flips: [], flipDots: [], cards: [], groups: [], votes: [], testDrive: [], ...snap };
  const c = load(['Config.js', 'AuthService.js', 'CaptureTemplates.js', 'CaptureLogic.js', 'CaptureApi.js'], {
    Session: { getActiveUser: () => ({ getEmail: () => email }), getEffectiveUser: () => ({ getEmail: () => 'owner@example.org' }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => (key === 'OWNER_EMAIL' ? 'owner@example.org' : null) }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => null },
    validateSessionId_: id => { if (!/^S-[a-zA-Z0-9-]+$/.test(String(id))) throw new Error('Invalid session link.'); return id; },
    getWebAppUrl_: () => 'https://script.google.com/macros/s/x/exec',
    SessionService: { getSession: () => ({ id: 'S-1', name: 'Test' }), getAllSessions: () => [] },
    CaptureStore: {
      getConfig: () => cfg,
      snapshot: () => data,
      updateConfig: (sid, change) => { const next = Object.assign(cfg, change(cfg) || {}); calls.push(['config', plain(next)]); return next; },
      addSignal: (sid, s) => { calls.push(['signal', s]); return { id: 1, token: 'a'.repeat(32) }; },
      setSignalHidden: (...a) => { calls.push(['hideSignal', ...a]); },
      saveFlip: (...a) => { calls.push(['flip', ...a]); return { id: 1 }; },
      setFlipFlags: (...a) => { calls.push(['flipFlags', ...a]); },
      saveFlipDots: (sid, e) => { calls.push(['dots', e]); },
      appendCard: (sid, t, cardIn) => { calls.push(['card', cardIn]); return { id: 1, token: 'a'.repeat(32) }; },
      setHidden: (...a) => { calls.push(['hide', ...a]); },
      writeGroups: (sid, g) => { calls.push(['groups', g]); },
      saveVote: (sid, v) => { calls.push(['vote', v]); },
      clearVotes: () => { calls.push(['clearVotes']); },
      saveTestDrive: (...a) => { calls.push(['testDrive', ...a]); },
      enable: () => { calls.push(['enable']); }
    },
    CaptureAiService: {
      readPhoto: () => { calls.push(['photo']); return { fields: {}, level: '', confidence: 'low' }; },
      proposeGroups: () => { calls.push(['propose']); return []; }
    },
    CapturePosterService: { make: () => { calls.push(['posters']); return 'url'; } }
  });
  return { c, calls, cfg, data };
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

test('public calls need the table key, and each write only works in its own stage', () => {
  const h = apiContext({ snap: { flips: [flip(1, 2)] } });
  const cardIn = { table: 2, flipId: 1, level: 'G', role: 'S', fields: { need: 'c' } };
  for (const key of ['', 'wrong', 'ffffffffffffffffffff']) {
    assert.throws(() => h.c.captureSubmitCard('S-1', key, cardIn), /table link/);
    assert.throws(() => h.c.captureGetWall('S-1', key), /table link/);
    assert.throws(() => h.c.captureGetPhoneState('S-1', key, 1, ''), /table link/);
  }
  assert.equal(h.c.captureSubmitCard('S-1', KEY, cardIn).id, 1);
  assert.equal(h.calls[0][1].fields.flip, 'Right now a, but we want b');
  assert.throws(() => h.c.captureSaveVote('S-1', KEY, { voter: VOTER, role: 'S', choices: ['g1'] }), /not open right now/);
  assert.throws(() => h.c.captureAddSignal('S-1', KEY, { table: 1, role: 'S', text: 'x' }), /Signals/);
  assert.throws(() => h.c.captureSaveTestDrive('S-1', KEY, 1, { add: 'x' }), /Test drive/);
  const vote = apiContext({ config: { stage: 'vote' } });
  assert.throws(() => vote.c.captureSaveVote('S-1', KEY, { voter: VOTER, role: 'S', choices: ['g1'] }), /publish/);
  assert.throws(() => vote.c.captureSubmitCard('S-1', KEY, cardIn), /Need cards/);
  assert.equal(vote.calls.length, 0);
});

test('a phone sees its own table\'s rows, the ballot once published, and results only at the read-out', () => {
  const published = [{ id: 'g1', topic: 'Chatbots', column: 'G', contested: true, route: 'vote', tableCount: 2, cardCount: 2, cardIds: [1] }];
  const snap = {
    flips: [flip(1, 1, 'Mine'), flip(2, 2, 'Theirs'), flip(3, 1, 'Hidden', { hidden: true })],
    cards: [card(1, 1, 'G', 'S'), card(2, 2, 'G'), card(3, 1, 'B', 'A', { hidden: true })],
    signals: [{ id: 1, table: 1, role: 'S', text: 'Mine', hidden: false }, { id: 2, table: 2, role: 'S', text: 'Theirs', hidden: false }],
    votes: [{ voter: VOTER, role: 'S', choices: ['g1', 'g1'] }]
  };
  const atNeeds = plain(apiContext({ snap }).c.captureGetPhoneState('S-1', KEY, 1, VOTER));
  assert.deepEqual(atNeeds.table.flips.map(f => f.text), ['Mine']);
  assert.deepEqual(atNeeds.table.cards.map(x => x.id), [1]);
  assert.deepEqual(atNeeds.table.signals.map(x => x.text), ['Mine']);
  assert.equal(atNeeds.ballot, undefined); assert.equal(atNeeds.results, undefined);
  assert.equal(JSON.stringify(atNeeds).includes(KEY), false);
  assert.equal(JSON.stringify(atNeeds).includes('groupingFocus'), false);
  const atVote = plain(apiContext({ snap, config: { stage: 'vote', published } }).c.captureGetPhoneState('S-1', KEY, 1, VOTER));
  assert.deepEqual(atVote.myVote, { role: 'S', choices: ['g1', 'g1'] });
  assert.equal(atVote.ballot[0].topic, 'Chatbots'); assert.equal(atVote.results, undefined);
  const atResults = plain(apiContext({ snap, config: { stage: 'results', published } }).c.captureGetPhoneState('S-1', KEY, 1, VOTER));
  assert.equal(atResults.results.columns[0].items[0].total, 2);
  assert.deepEqual(atResults.table.assignment, { groupId: 'g1', topic: 'Chatbots' });
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
  assert.throws(() => h.c.captureRemoveOwnCard('S-1', KEY, 1, 'short'), /Only the phone/);
  h.c.captureRemoveOwnCard('S-1', KEY, 1, 'b'.repeat(32));
  assert.equal(h.calls[0][0], 'hide');
  assert.equal(h.calls[0][5], 'b'.repeat(32));
});

test('a flip statement with cards can\'t be removed, only edited', () => {
  const h = apiContext({ snap: { cards: [card(1, 2, 'G', 'S', { flipId: 5 })] } });
  assert.throws(() => h.c.captureRemoveFlip('S-1', KEY, 2, 5), /Edit it instead/);
  h.c.captureRemoveFlip('S-1', KEY, 2, 6);
  assert.deepEqual(h.calls[0].slice(0, 1), ['flipFlags']);
});

test('facilitator settings are validated before they are saved', () => {
  const published = [{ id: 'g1', topic: 'A', column: 'G', route: 'vote' }, { id: 'p1', topic: 'P', column: 'B', route: 'parking' }];
  const h = apiContext({ email: 'owner@example.org', config: { published } });
  assert.throws(() => h.c.captureSetStage('S-1', 'party'), /Unknown stage/);
  h.c.captureSetStage('S-1', 'vote'); assert.equal(h.cfg.stage, 'vote');
  assert.throws(() => h.c.captureSetTallyMode('S-1', 'guess'), /phone, paper or both/);
  assert.throws(() => h.c.captureSetPaperDots('S-1', 'nope', { S: 1 }), /Publish/);
  assert.throws(() => h.c.captureSetPaperDots('S-1', 'g1', { S: -1 }), /between 0 and 999/);
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
    getRange: (r, col, rows = 1, cols = 1) => {
      const style = { setBackground: () => style, setFontColor: () => style, setFontWeight: () => style };
      return {
        setValue: v => { (grid[name][r - 1] = grid[name][r - 1] || [])[col - 1] = v; },
        setValues: vals => { for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) (grid[name][r - 1 + i] = grid[name][r - 1 + i] || [])[col - 1 + j] = vals[i][j]; return style; },
        clearContent: () => {}
      };
    },
    appendRow: row => grid[name].push(row),
    setFrozenRows() {}, clearContents() { grid[name] = []; }
  };
  const db = { getSheetByName: sheet, insertSheet: name => { grid[name] = []; return sheet(name); } };
  return load(['CaptureTemplates.js', 'CaptureLogic.js', 'CaptureStore.js'], {
    CacheService: { getScriptCache: () => ({ get: k => (k.startsWith('capture_db_') ? 'db-id' : null), put() {}, remove() {} }) },
    SpreadsheetApp: { openById: () => db },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: { getUuid: () => '11111111-2222-3333-4444-555555555555' }
  });
}

test('the store reads older sheets by header name and adds new columns at the end', () => {
  const grid = { 'Live Cards': [
    ['Card', 'Submitted', 'Table', 'Level', 'Source', 'Hidden', 'Token', 'Flip statement', 'To address this gap, schools and educators need…'],
    [1, '', 2, 'G', 'typed', 'no', 't', 'Old flip', 'Old need']
  ] };
  const c = storeContext(grid);
  const snap = plain(c.eval('CaptureStore.snapshot("S-1", CAPTURE_TEMPLATES.needCards)'));
  assert.deepEqual([snap.cards[0].fields.need, snap.cards[0].fields.flip, snap.cards[0].role, snap.cards[0].flipId], ['Old need', 'Old flip', '', 0]);
  c.eval('CaptureStore.appendCard("S-1", CAPTURE_TEMPLATES.needCards, { table: 3, level: "B", source: "typed", role: "S", flipId: 4, fields: { flip: "=F", need: "New need" } })');
  assert.deepEqual(grid['Live Cards'][0].slice(8), ['To address this gap, schools and educators need…', 'Role', 'Flip ID'],
    'the old need column is reused; Role and Flip ID are added at the end');
  const row = grid['Live Cards'][2];
  assert.deepEqual([row[0], row[2], row[3], row[7], row[8], row[9], row[10]], [2, 3, 'B', "'=F", 'New need', 'S', 4]);
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
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(body) }] } }] }) };
    } }
  });
  return { c, requests, store };
}

test('a photo is sent once as inline data with the schema, and the reading is cleaned', () => {
  const h = aiContext([{ need: 'PD‮ time', level: 'G+', confidence: 'medium' }]);
  const r = plain(h.c.eval(`CaptureAiService.readPhoto(${T}, "QUJD", "image/jpeg")`));
  assert.deepEqual(r, { fields: { need: 'PD time' }, level: 'G+', confidence: 'medium', empty: false });
  const payload = JSON.parse(h.requests[0].options.payload);
  assert.equal(payload.contents[0].parts[1].inlineData.mimeType, 'image/jpeg');
  assert.ok(payload.generationConfig.responseSchema.properties.need);
  assert.match(payload.contents[0].parts[0].text, /\[illegible\]/);
  assert.equal(h.requests[0].url.includes('FAKE_SECRET'), false);
  assert.equal(h.store['CAPTURE_AI_CALLS_2026-11-18'], '1');
});

test('bad photos are refused before any AI call, and the daily limit holds', () => {
  const h = aiContext([]);
  assert.throws(() => h.c.eval(`CaptureAiService.readPhoto(${T}, "QUJD", "image/gif")`), /JPEG/);
  assert.throws(() => h.c.eval(`CaptureAiService.readPhoto(${T}, "<script>", "image/jpeg")`), /could not be read/);
  h.c.big = 'A'.repeat(6 * 1024 * 1024);
  assert.throws(() => h.c.eval(`CaptureAiService.readPhoto(${T}, big, "image/jpeg")`), /too large/);
  assert.equal(h.requests.length, 0);
  const capped = aiContext([], { 'CAPTURE_AI_CALLS_2026-11-18': '300' });
  assert.throws(() => capped.c.eval(`CaptureAiService.readPhoto(${T}, "QUJD", "image/png")`), /limit/);
  assert.equal(capped.requests.length, 0);
});

test('a grouping draft is repaired; cards the model left out stay for the team to place', () => {
  const h = aiContext([{ groups: [{ topic: 'Chatbots', cardIds: [1, 2, 2] }, { topic: 'Ghost', cardIds: [42] }] }]);
  h.c.cards = [card(1, 1, 'G', 'S'), card(2, 2, 'B'), card(3, 3, 'G+')];
  const groups = plain(h.c.eval(`CaptureAiService.proposeGroups(${T}, cards)`));
  assert.deepEqual(groups.map(g => [g.topic, g.cardIds]), [['Chatbots', [1, 2]]]);
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

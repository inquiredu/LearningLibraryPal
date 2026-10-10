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
function authContext(email = '', props = {}, effective = 'owner@example.org', activeSheet = null) {
  return load(['Config.js', 'AuthService.js', 'StorageService.js', 'Code.js', 'WebApp.js'], {
    Session: { getActiveUser: () => ({ getEmail: () => email }), getEffectiveUser: () => ({ getEmail: () => effective }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => props[key] || null, setProperty: (key, value) => { props[key] = value; }
    }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => activeSheet }
  });
}

test('all privileged browser entry points reject anonymous and unrelated users before side effects', () => {
  const publicNames = new Set(['doGet', 'getLibraryData', 'webGetAppBaseUrl', 'webGetAppConfig', 'onOpen']);
  const names = [...(source('Code.js') + source('WebApp.js')).matchAll(/^function (\w+)\(/gm)]
    .map(m => m[1]).filter(name => !name.endsWith('_') && !publicNames.has(name));
  assert.ok(names.length > 35);
  for (const email of ['', 'stranger@example.org']) {
    const c = authContext(email, { OWNER_EMAIL: 'owner@example.org' });
    for (const name of names) assert.throws(() => c[name](), /Access denied|Only the library owner/, name);
  }
});

test('owner, explicit facilitator and configured domain work; blank domain is owner-only', () => {
  assert.equal(authContext('owner@example.org', { OWNER_EMAIL: 'owner@example.org' }).eval('AuthService.isAuthorized()'), true);
  const c = authContext('guest@example.net', { OWNER_EMAIL: 'owner@example.org' });
  assert.equal(c.eval('AuthService.isAuthorized()'), false);
  c.eval("CONFIG.ALLOWED_EMAILS = ['GUEST@example.net']");
  assert.equal(c.eval('AuthService.isAuthorized()'), true);
  assert.throws(() => c.eval('AuthService.requireOwner()'), /Only the library owner/);
  c.eval("CONFIG.ALLOWED_EMAILS = []; CONFIG.ALLOWED_DOMAIN = 'example.net'");
  assert.equal(c.eval('AuthService.isAuthorized()'), true);
  const anonymous = authContext('', {}, 'owner@example.org', {});
  assert.equal(anonymous.eval('AuthService.isAuthorized()'), false);
});

test('setup records owner and spreadsheet, keeps blank key unchanged, and never returns secrets', () => {
  const props = { GEMINI_API_KEY: 'FAKE_PRIVATE_KEY' };
  const c = authContext('owner@example.org', props, 'owner@example.org', { getId: () => 'sheet-id' });
  c.SessionService = { ensureMasterSheet() {} };
  c.saveSetupConfig({ geminiModel: 'gemini-3.8-flash', geminiKey: '' });
  assert.equal(props.MASTER_SPREADSHEET_ID, 'sheet-id');
  assert.equal(props.OWNER_EMAIL, 'owner@example.org');
  assert.equal(props.GEMINI_API_KEY, 'FAKE_PRIVATE_KEY');
  assert.equal(c.getSetupConfig().hasGeminiKey, true);
  assert.equal(JSON.stringify(c.getSetupConfig()).includes('FAKE_PRIVATE_KEY'), false);
  assert.equal(c.getGeminiApiKey, undefined);
  assert.equal(c.getOAuthToken, undefined);
});

test('master spreadsheet access uses configured ID without an active editor', () => {
  let opened;
  const c = load(['StorageService.js'], {
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'configured-id' }) },
    SpreadsheetApp: { openById: id => { opened = id; return { name: 'Master' }; }, getActiveSpreadsheet: () => null }
  });
  assert.equal(c.eval('StorageService.master().name'), 'Master');
  assert.equal(opened, 'configured-id');
  c.PropertiesService.getScriptProperties = () => ({ getProperty: () => null });
  assert.throws(() => c.eval('StorageService.master()'), /Initial Setup/);
});

test('public library excludes internal meetings, internal materials and admin URLs', () => {
  const c = load(['LibraryService.js'], {
    CONFIG: {}, SessionService: { getSession: () => ({ id: 'S-1', brief: {}, folderUrl: 'private-folder', dbUrl: 'private-db' }) },
    SynthesisService: { getResources: () => [
      { url: 'https://meet.google.com/private', type: 'Meeting Link', isPublic: false },
      { url: 'https://meet.google.com/public', type: 'Meeting Link', isPublic: true },
      { url: 'https://example.org/private', isPublic: false },
      { url: 'https://example.org/public', isPublic: true }
    ] }, GemsService: { getGems: () => [] }
  });
  const data = c.eval('LibraryService.buildLibraryData("S-1")');
  assert.equal(data.meetings.length, 1);
  assert.equal(data.meetings[0].url, 'https://meet.google.com/public');
  assert.equal(data.resources.length, 1);
  assert.equal(data.meta.dbUrl, undefined);
  assert.equal(data.meta.folderUrl, undefined);
});

test('public session IDs reject script injection before cache or data access', () => {
  const c = authContext();
  for (const id of ["';alert(1);//", '', '<script>', '../', null]) {
    assert.throws(() => c.getLibraryData(id), /Invalid session link/);
  }
  assert.equal(c.validateSessionId_('S-123456'), 'S-123456');
  assert.equal(c.validateSessionId_('S-cac0-1234'), 'S-cac0-1234');
});

function synthesisContext() {
  const rows = [Array(15).fill('header'), ...[1, 2].map(i => {
    const row = Array(15).fill('');
    row[0] = 'https://example.org/' + i; row[1] = 'Resource ' + i; row[2] = 'Article'; row[13] = 'No'; row[14] = i;
    return row;
  })];
  const writes = [];
  const sheet = {
    getDataRange: () => ({ getValues: () => structuredClone(rows) }),
    getRange: (r, col, count, width) => ({
      setValues: values => {
        for (let i = 0; i < count; i++) for (let j = 0; j < width; j++) rows[r - 1 + i][col - 1 + j] = values[i][j];
        writes.push([r, col, count, width]);
      },
      clearContent: () => { for (let i = 0; i < count; i++) rows[r - 1 + i][col - 1] = ''; }
    })
  };
  let calls = 0, released = 0;
  const c = load(['SynthesisService.js'], {
    SessionService: { getSession: () => ({ dbUrl: 'https://docs.google.com/spreadsheets/d/abcdefghijklmnopqrstuvwxyz12345', brief: {} }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => sheet }), flush() {} },
    Utilities: { sleep() {} }, LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => released++ }) },
    GeminiService: { analyzeResourceByType: () => { calls++; return { relevanceScore: 4, summary: 'Summary', title: 'Analyzed' }; } }
  });
  c.eval('SynthesisService._fetchContent = () => "source content"');
  return { c, rows, writes, sheet, calls: () => calls, released: () => released };
}

test('synthesis checkpoints each result and skips completed rows on resume', () => {
  const h = synthesisContext();
  const first = h.c.eval('SynthesisService.synthesizeAll("S-1")');
  assert.equal(first.count, 2); assert.equal(first.remaining, 0); assert.equal(h.calls(), 2);
  assert.deepEqual(h.writes, [[2, 2, 1, 9], [3, 2, 1, 9]]);
  assert.equal(h.rows[1][13], 'No'); assert.equal(h.rows[1][14], 1);
  assert.equal(h.c.eval('SynthesisService.synthesizeAll("S-1").count'), 0);
  assert.equal(h.calls(), 2); assert.equal(h.released(), 2);
});

test('completed resource survives hard interruption during the next analysis', () => {
  const h = synthesisContext();
  h.c.eval('let attempt = 0; GeminiService.analyzeResourceByType = () => { if (++attempt === 2) { while (true) {} } return { relevanceScore: 4, summary: "Saved", title: "Saved" }; };');
  assert.throws(() => vm.runInContext('SynthesisService.synthesizeAll("S-1")', h.c, { timeout: 75 }), /timed out/);
  assert.equal(h.rows[1][3], 4); assert.equal(h.rows[2][3], '');
  h.c.eval('GeminiService.analyzeResourceByType = () => ({ relevanceScore: 4, summary: "Resumed" })');
  assert.equal(h.c.eval('SynthesisService.synthesizeAll("S-1").count'), 1);
});

test('failed analysis remains resumable and returns failure status', () => {
  const h = synthesisContext();
  h.c.eval('GeminiService.analyzeResourceByType = () => { throw new Error("quota"); }');
  const result = h.c.eval('SynthesisService.synthesizeAll("S-1")');
  assert.equal(result.failed, 2); assert.equal(result.remaining, 2); assert.equal(result.count, 0);
  assert.equal(h.rows[1][3], ''); assert.match(h.rows[1][8], /quota/);
});

test('force clears completion markers once and ordinary synthesis resumes its remaining work', () => {
  const h = synthesisContext(); h.rows[1][3] = 4; h.rows[2][3] = 4;
  h.c.eval('let attempt = 0; GeminiService.analyzeResourceByType = () => { if (++attempt === 2) { while (true) {} } return { relevanceScore: 5, summary: "New" }; };');
  assert.throws(() => vm.runInContext('SynthesisService.synthesizeAll("S-1", true)', h.c, { timeout: 75 }), /timed out/);
  assert.equal(h.rows[1][3], 5); assert.equal(h.rows[2][3], '');
  h.c.eval('GeminiService.analyzeResourceByType = () => ({ relevanceScore: 5, summary: "Resumed" })');
  assert.equal(h.c.eval('SynthesisService.synthesizeAll("S-1").count'), 1);
});

test('deadline pauses before further calls and releases lock after errors', () => {
  const h = synthesisContext();
  h.c.eval('Date.now = () => 100');
  const result = h.c.eval('SynthesisService._synthesizeBatch("S-1", false, 99)');
  assert.equal(result.paused, true); assert.equal(result.remaining, 2); assert.equal(h.calls(), 0);
  h.c.SessionService.getSession = () => { throw new Error('missing sheet'); };
  assert.throws(() => h.c.eval('SynthesisService.synthesizeAll("S-1")'), /missing sheet/);
  assert.equal(h.released(), 1);
});

function geminiContext(responses) {
  const requests = [], sleeps = [];
  const c = load(['Config.js', 'GeminiService.js'], {
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'gemini-test-model' }) },
    getGeminiApiKey_: () => 'FAKE_SECRET',
    Utilities: { sleep: ms => sleeps.push(ms) },
    UrlFetchApp: { fetch: (url, options) => {
      requests.push({ url, options });
      const response = responses.shift();
      return { getResponseCode: () => response.code, getContentText: () => response.body };
    } }
  });
  return { c, requests, sleeps };
}
const valid = JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"overview":"Ready"}' }] } }] });

test('Gemini uses configured model, header authentication, zero temperature and transient retries', () => {
  const h = geminiContext([{ code: 429 }, { code: 503 }, { code: 200, body: valid }]);
  assert.equal(h.c.eval('GeminiService._call("test", 0).overview'), 'Ready');
  assert.equal(h.requests.length, 3); assert.deepEqual(h.sleeps, [1000, 2000]);
  assert.match(h.requests[0].url, /gemini-test-model:generateContent$/);
  assert.equal(h.requests[0].url.includes('FAKE_SECRET'), false);
  assert.equal(h.requests[0].options.headers['x-goog-api-key'], 'FAKE_SECRET');
  assert.equal(JSON.parse(h.requests[0].options.payload).generationConfig.temperature, 0);
});

test('Gemini rejects HTTP failures, blocked, truncated and malformed responses without leaking secrets', () => {
  for (const response of [
    { code: 403, body: 'FAKE_SECRET' }, { code: 404 },
    { code: 200, body: '{}' }, { code: 200, body: 'not JSON' },
    { code: 200, body: JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS' }] }) },
    { code: 200, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'invalid' }] } }] }) }
  ]) {
    const h = geminiContext([response]);
    assert.throws(() => h.c.eval('GeminiService._call("test")'), err => /Gemini/.test(err.message) && !err.message.includes('FAKE_SECRET'));
    assert.equal(h.requests.length, 1);
  }
});

test('clasp upload allowlist includes application files and excludes tests, tooling and credentials', () => {
  const micromatch = require('micromatch');
  const rules = source('.claspignore').trim().split('\n');
  const ignored = file => micromatch.not([file], rules, { dot: true }).length === 0;
  for (const file of ['Code.js', 'AuthService.js', 'Index.html', 'appsscript.json']) assert.equal(ignored(file), false, file);
  for (const file of ['tests/pilot.test.cjs', 'scripts/check.cjs', '.clasp.json', '.clasprc.json', 'package.json', 'package-lock.json', 'node_modules/a.js', 'docs/PILOT.md']) assert.equal(ignored(file), true, file);
});

test('meeting synthesis checkpoints logistics without making an AI call', () => {
  const h = synthesisContext();
  h.rows.splice(2); h.rows[1][2] = 'Meeting Link';
  const result = h.c.eval('SynthesisService.synthesizeAll("S-1")');
  assert.equal(result.count, 1); assert.equal(h.calls(), 0);
  assert.equal(h.rows[1][3], 1); assert.equal(h.rows[1][13], 'No');
});

test('resource mutations cannot run while synthesis owns the lock', () => {
  const c = authContext('owner@example.org', { OWNER_EMAIL: 'owner@example.org' });
  let calls = 0;
  c.LockService = { getScriptLock: () => ({ tryLock: () => false }) };
  c.ResourceService = { addResources: () => calls++, removeResource: () => calls++, removeResources: () => calls++, updateResourceSettings: () => calls++ };
  for (const name of ['webAddResources', 'webRemoveResource', 'webRemoveResources', 'webSaveResourceSettings']) {
    assert.throws(() => c[name]('S-1', []), /running/);
  }
  assert.equal(calls, 0);
});

test('new sessions retain the existing schema and receive a unique ID and library link', () => {
  let written;
  const c = load(['SessionService.js'], {
    StorageService: { master: () => ({ getSheetByName: () => ({ appendRow: row => { written = row; } }) }) },
    Utilities: { getUuid: () => 'unique-session-id' },
    getWebAppUrl_: () => 'https://script.google.com/macros/s/pilot/exec',
    GeminiService: { generateSessionBrief: () => ({ overview: 'Reviewed later' }) }
  });
  c.eval('SessionService.ensureMasterSheet = () => {}; SessionService._getRootFolderId = () => "root"; SessionService._scaffoldFolders = () => ({ getUrl: () => "folder" }); SessionService._createProjectDatabase = () => ({ getUrl: () => "database" });');
  const result = c.eval('SessionService.setupSession({ name: "Pilot", theme: "Learning", date: "2026-10-03", audience: "Educators" })');
  assert.equal(result.sessionId, 'S-unique-session-id');
  assert.equal(written.length, 15);
  assert.equal(written[9], 'https://script.google.com/macros/s/pilot/exec?page=library&session=S-unique-session-id');
});

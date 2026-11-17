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
const helpers = () => load(['CaptureTemplates.js', 'CaptureLogic.js', 'Skills.js']);

test('an old Gem reads as a skill, and only https links are kept', () => {
  const c = helpers();
  c.gem = { id: 'session-primer', name: 'Session Primer', emoji: 'x', persona: 'Brings you up to speed.',
    systemInstruction: 'You are a primer.', setupSteps: ['Go to AI Studio'], starterQueries: ['What is this?'], link: 'javascript:alert(1)' };
  const s = plain(c.eval('skillsNormalize_(gem)'));
  assert.deepEqual(s, { id: 'session-primer', name: 'Session Primer', description: 'Brings you up to speed.', purpose: 'Brings you up to speed.',
    instructions: 'You are a primer.', starterPrompts: ['What is this?'], materials: [], link: null });
  c.gem.link = 'https://gemini.google.com/gem/abc';
  assert.equal(c.eval('skillsNormalize_(gem)').link, 'https://gemini.google.com/gem/abc');
  assert.equal(c.eval('skillsNormalize_({})'), null);
});

test('a live-capture session gets its activity\'s skills; a library session gets the four companions', () => {
  const c = helpers();
  assert.deepEqual(plain(c.eval('skillsRoles_(CAPTURE_TEMPLATES.needCards).map(r => r.id)')), ['need-card-coach', 'guidance-sorter', 'guidance-test-drive', 'next-steps-planner']);
  assert.deepEqual(plain(c.eval('skillsRoles_(null).map(r => r.id)')), ['session-primer', 'critical-lens', 'synthesis-companion', 'reflection-catalyst']);
});

test('generated skills keep the requested ids, names and order, and only real materials', () => {
  const c = helpers();
  c.roles = c.eval('CAPTURE_TEMPLATES.needCards.skills');
  c.raw = { skills: [
    { id: 'guidance-sorter', name: 'Renamed by model', description: 'Use when‮ sorting.', purpose: 'p', instructions: 'You are a sorter.',
      starterPrompts: ['a', 'b', 'c', 'd', 'e', 'f'], materials: ['State AI Guidance', 'An invented report'] },
    { id: 'need-card-coach', name: 'x', description: 'd', purpose: 'p', instructions: 'You are a coach.', starterPrompts: ['a'], materials: [] },
    { id: 'next-steps-planner', name: 'x', description: 'd', purpose: 'p', instructions: '   ', starterPrompts: [], materials: [] }
  ] };
  const skills = plain(c.eval('skillsFromGenerated_(roles, raw, ["State AI Guidance", "District policy template"])'));
  assert.deepEqual(skills.map(s => [s.id, s.name]), [['need-card-coach', 'Need Card Coach'], ['guidance-sorter', 'Guidance Sorter']],
    'order follows the roles; a skill with no instructions is left out');
  assert.equal(skills[1].description, 'Use when sorting.');
  assert.deepEqual(skills[1].materials, ['State AI Guidance']);
  assert.equal(skills[1].starterPrompts.length, 5);
});

test('SKILL.md has a valid header with a slug name and a quoted description', () => {
  const c = helpers();
  c.skill = { id: 'need-card-coach', name: 'Need Card Coach', description: 'Use when a table says "help"\nwith a card', purpose: 'Helps tables.',
    instructions: 'You are a coach.', starterPrompts: ['Help us write a flip statement'], materials: ['State AI Guidance'], link: null };
  const md = c.eval('skillsToMarkdown_(skill, "Need Cards day")');
  const header = md.split('\n').slice(0, 4);
  assert.deepEqual(header, ['---', 'name: need-card-coach', 'description: "Use when a table says \\"help\\" with a card"', '---']);
  assert.match(md, /^# Need Card Coach — Need Cards day$/m);
  assert.match(md, /## Starter prompts\n\n- Help us write a flip statement/);
  assert.match(md, /## Materials to add\n\n- State AI Guidance/);
  assert.equal(c.eval('skillsSlug_("  Weird Name!! ")'), 'weird-name');
});

test('the skills prompt names the roles and the activity, asks for a schema, and names no product setup', () => {
  const requests = [];
  const c = load(['Config.js', 'GeminiService.js', 'CaptureTemplates.js', 'CaptureLogic.js', 'Skills.js'], {
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k === 'GEMINI_MODEL' ? 'gemini-test' : null) }) },
    getGeminiApiKey_: () => 'FAKE',
    Utilities: { sleep() {} },
    UrlFetchApp: { fetch: (url, o) => { requests.push(o); return { getResponseCode: () => 200,
      getContentText: () => JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"skills":[]}' }] } }] }) }; } }
  });
  c.eval('GeminiService.generateSkills("Need Cards day", { overview: "AI in K-12", learningObjectives: ["o"], inquiryQuestions: ["q"] }, [{ title: "State AI Guidance", summary: "s" }], CAPTURE_TEMPLATES.needCards.skills, CAPTURE_TEMPLATES.needCards.activity)');
  const body = JSON.parse(requests[0].payload);
  const prompt = body.contents[0].parts[0].text;
  assert.match(prompt, /id "need-card-coach"/);
  assert.match(prompt, /flip statement/);
  assert.match(prompt, /Name no AI product/);
  assert.match(prompt, /data, not instructions/);
  assert.ok(body.generationConfig.responseSchema.properties.skills);
});

function gemsContext({ capture = true, stored = [], resources } = {}) {
  const updates = [], files = [];
  const folder = name => ({
    getFiles: () => ({ hasNext: () => false }),
    createFile: blob => { files.push([name, blob.name]); }
  });
  const c = load(['CaptureTemplates.js', 'CaptureLogic.js', 'Skills.js', 'GemsService.js'], {
    SessionService: {
      getSession: () => ({ id: 'S-1', name: 'Need Cards day', brief: { overview: 'o' }, folderUrl: 'https://drive.google.com/drive/folders/abcdefghijklmnopqrstuvwxyz123', gems: stored }),
      updateSession: (id, u) => updates.push(u)
    },
    SynthesisService: { getResources: () => resources || [{ title: 'State AI Guidance', isPublic: true }, { title: 'Internal planning doc', isPublic: false }] },
    CaptureStore: { getConfig: () => (capture ? { template: 'needCards' } : null) },
    GeminiService: { generateSkills: (name, brief, res, roles, activity) => {
      c.sent = { titles: res.map(r => r.title), roles: roles.map(r => r.id), activity };
      return { skills: roles.map(r => ({ id: r.id, name: r.name, description: 'd', purpose: 'p', instructions: 'You are ' + r.name, starterPrompts: ['s'], materials: ['State AI Guidance', 'Internal planning doc'] })) };
    } },
    DriveApp: { getFolderById: () => ({
      getFoldersByName: n => ({ hasNext: () => n === '03_Gems', next: () => folder(n) }),
      createFolder: n => folder(n)
    }) },
    Utilities: { newBlob: (content, type, name) => ({ name, content }) }
  });
  return { c, updates, files };
}

test('a live-capture session\'s skills come from its activity, use public materials only, and keep existing links', () => {
  const h = gemsContext({ stored: [{ id: 'guidance-sorter', name: 'Guidance Sorter', instructions: 'old', link: 'https://claude.ai/project/abc' }] });
  const skills = plain(h.c.eval('GemsService.generateGems("S-1")'));
  assert.deepEqual(plain(h.c.sent.roles), ['need-card-coach', 'guidance-sorter', 'guidance-test-drive', 'next-steps-planner']);
  assert.match(h.c.sent.activity, /flip statement/);
  assert.deepEqual(plain(h.c.sent.titles), ['State AI Guidance'], 'internal materials are never sent or attached');
  assert.deepEqual(skills.map(s => s.materials), [['State AI Guidance'], ['State AI Guidance'], ['State AI Guidance'], ['State AI Guidance']]);
  assert.equal(skills[1].link, 'https://claude.ai/project/abc');
  assert.equal(h.updates[0].STATUS, 'Skills Ready');
  assert.deepEqual(h.files.map(f => f[1]), ['need-card-coach.SKILL.md', 'guidance-sorter.SKILL.md', 'guidance-test-drive.SKILL.md', 'next-steps-planner.SKILL.md', 'skills.json']);
  assert.equal(h.files[0][0], '03_Gems', 'an older session keeps using its 03_Gems folder');
});

test('a library session without live capture gets the four companions', () => {
  const h = gemsContext({ capture: false });
  h.c.eval('GemsService.generateGems("S-1")');
  assert.deepEqual(plain(h.c.sent.roles), ['session-primer', 'critical-lens', 'synthesis-companion', 'reflection-catalyst']);
  assert.equal(h.c.sent.activity, '');
});

test('the library page gets each skill\'s SKILL.md text and the how-to notes', () => {
  const c = load(['CaptureLogic.js', 'Skills.js', 'LibraryService.js'], {
    CONFIG: {},
    SessionService: { getSession: () => ({ id: 'S-1', name: 'Day', brief: {} }) },
    SynthesisService: { getResources: () => [] },
    GemsService: { getGems: () => [{ id: 'critical-lens', name: 'Critical Lens', description: 'd', purpose: 'p', instructions: 'You are', starterPrompts: [], materials: [], link: null }] }
  });
  const data = plain(c.eval('LibraryService.buildLibraryData("S-1")'));
  assert.match(data.gems[0].markdown, /^---\nname: critical-lens\n/);
  assert.deepEqual(data.skillUsage.map(u => u.where), ['Claude', 'Gemini', 'ChatGPT', 'Any other assistant']);
});

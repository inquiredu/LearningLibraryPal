#!/usr/bin/env node
/**
 * Builds the live-capture pages as static files that run in any browser,
 * with google.script.run replaced by an in-page stand-in. The stand-in uses
 * the real CaptureTemplates.js and CaptureLogic.js, made-up cards, and canned
 * AI answers. Nothing here talks to Google.
 *
 *   node scripts/capture-preview.cjs <output-folder>
 *
 * Open <output-folder>/capture.html, board.html or wall.html.
 */
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const out = process.argv[2];
if (!out) { console.error('Usage: node scripts/capture-preview.cjs <output-folder>'); process.exit(1); }
fs.mkdirSync(out, { recursive: true });
const read = name => fs.readFileSync(path.join(ROOT, name), 'utf8');

const KEY = '0123456789abcdef0123';
const NEEDS = [
  [1, 'A district template for AI use statements on syllabi', 'Right now teachers guess whether AI use is allowed, but we need clear expectations for every class.', 'G'],
  [1, 'Lessons that teach students how to question and check chatbot answers', 'Right now students use chatbots for homework without guidance, but we need them to use AI as a thinking partner.', 'G+'],
  [1, 'Family-facing explainers about how AI is used in school', 'Right now families hear mixed messages about AI, but we need a shared understanding.', 'G+'],
  [1, 'Guidance on not relying on AI detection tools', 'Right now AI detectors flag students unfairly, but we need fair ways to address academic integrity.', 'G'],
  [1, 'Paid PD time for teachers to practice with AI tools', 'Right now each teacher learns AI alone, but we need to learn together.', 'G+'],
  [2, 'AI literacy standards or learning targets for K-12', 'Right now students don’t understand how AI works, but we need them to be AI literate.', 'G'],
  [2, 'A state-vetted list of AI tools that meet student data privacy rules', 'Right now vendors pitch AI tools nonstop, but we need a way to judge which are safe.', 'B'],
  [2, 'Guidance on age-appropriate chatbot access', 'Right now chatbots are blocked at school, but we need students to learn to use them responsibly.', 'G'],
  [2, 'Funding for devices and connectivity in rural districts', 'Right now rural schools lack devices and bandwidth, but we need equal access to AI learning.', 'B'],
  [2, 'Ready-to-use AI literacy lessons teachers can adapt', 'Right now teachers feel unprepared, but we need confidence teaching with AI.', 'G+'],
  [3, 'Examples of AI literacy integrated into core content areas', 'Right now AI literacy is an afterthought, but we need it built into every subject.', 'G+'],
  [3, 'Career exploration resources about AI and work', 'Right now students worry AI will take their future jobs, but we need them to see a path.', 'G+'],
  [3, 'Clear privacy guidance for choosing AI tools', 'Right now we don’t know what student data AI tools collect, but we need to protect it.', 'G'],
  [3, 'Guidance and activities for fact-checking chatbot output', 'Right now chatbots give confident wrong answers, but we need students to verify information.', 'G+'],
  [3, 'A model district AI policy that districts can adopt', 'Right now policies change every semester, but we need stable rules.', 'G'],
  [4, 'Guidance on using AI for accessibility and IEP supports', 'Right now students with disabilities miss out, but we need AI to support access.', 'G+'],
  [4, 'Approved AI tools for lesson planning and grading feedback', 'Right now teachers spend hours on paperwork, but we need time for students.', 'B'],
  [4, 'Classroom norms for when AI help is OK and when it isn’t', 'Right now students and teachers define cheating differently, but we need shared norms.', 'G'],
  [4, 'A statewide AI literacy framework', 'Right now AI literacy depends on which teacher you get, but we need every student to get it.', 'G'],
  [4, 'Safety requirements for student-facing chatbots', 'Right now chatbots can say harmful things to kids, but we need them to be safe.', 'B'],
  [5, 'Leadership PD on AI decision-making', 'Right now principals don’t know what to allow, but we need leaders to guide schools.', 'G+'],
  [5, 'Assignment redesign examples that make student thinking visible', 'Right now students use AI to write essays, but we need them to keep their own voice.', 'G+'],
  [5, 'State funding for AI tool licenses', 'Right now there is no money for AI tools, but we need fair access across districts.', 'B'],
  [5, 'Lessons on how AI models work and where they fail', 'Right now students hear AI is magic, but we need them to understand its limits.', 'G+'],
  [5, 'Template notices to families about AI tools and data', 'Right now families don’t know what data is shared, but we need transparency.', 'G+'],
  [6, 'A state AI PD series with credit for teachers', 'Right now teachers learn AI from social media, but we need trusted training.', 'G+'],
  [6, 'Guidance on chatbots and student mental health', 'Right now students use chatbots for emotional support, but we need them to get help from people.', 'G'],
  [6, 'School-wide AI use guidelines', 'Right now AI use rules differ by classroom, but we need consistency across the school.', 'G'],
  [6, 'Ways to include students in AI decisions', 'Right now students aren’t asked what they think about AI, but we need student voice.', 'G'],
  [6, 'Research partnerships to study AI tools in schools', 'Right now AI tools are not tested in classrooms, but we need evidence of what works.', 'B']
];
// One real AI draft from the prompt tests, used as the canned suggestion.
const DRAFT = [
  ['Chatbots', [2, 8, 14, 20, 27]], ['AI literacy', [6, 10, 11, 19, 24]], ['AI policy and guidelines', [1, 15, 28]],
  ['Academic integrity and norms', [4, 18, 22]], ['Teacher and leader PD', [5, 21, 26]], ['Safe tools and privacy', [7, 13, 17]],
  ['Families', [3, 25]], ['Funding and access', [9, 23]], ['Career exploration', [12]],
  ['Accessibility and IEP supports', [16]], ['Student voice', [29]], ['Research on AI tools', [30]]
];

function mock(scenario) {
  return `<script>${read('CaptureTemplates.js')}\n${read('CaptureLogic.js')}</script>
<script>
(function () {
  var scenario = ${JSON.stringify(scenario)};
  var tpl = CAPTURE_TEMPLATES.needCards;
  var config = { template: 'needCards', tables: 6, open: true, key: '${KEY}', title: 'Need Cards' };
  var count = scenario.cards == null ? ${NEEDS.length} : scenario.cards;
  // One flip statement per table: each table's first card's statement stands for the table.
  var tableFields = {};
  var cards = ${JSON.stringify(NEEDS)}.slice(0, count).map(function (n, i) {
    tableFields[n[0]] = tableFields[n[0]] || { flip: n[2] };
    return { id: i + 1, table: n[0], level: n[3], source: i % 4 === 0 ? 'photo' : (i % 5 === 0 ? 'typed+voice' : 'typed'), hidden: false,
      submittedAt: '2026-11-18T18:0' + (i % 10) + ':00Z', token: 't' + i, fields: { flip: tableFields[n[0]].flip, need: n[1] } };
  });
  if (scenario.freshTable) delete tableFields[scenario.freshTable];
  var groups = scenario.grouped ? ${JSON.stringify(DRAFT)}.map(function (d, i) { return { id: 'g' + (i + 1), topic: d[0], cardIds: d[1], rank: 0, routeOverride: '' }; }) : [];
  function board() {
    var n = captureNormalizeGroups_(cards, groups);
    return { sessionId: 'S-demo', sessionName: 'K-12 needs workshop', enabled: true, config: { title: config.title, tables: config.tables, open: config.open },
      template: pub(), links: { table: 'https://script.google.com/macros/s/DEMO/exec?session=S-demo&k=${KEY}&page=capture', wall: 'wall.html' },
      cards: cards, groups: captureOrderGroups_(tpl, cards.filter(function (c) { return !c.hidden; }), n.groups), ungrouped: n.ungrouped,
      parking: captureParkingLot_(tpl, cards).map(function (c) { return c.id; }), tableFields: tableFields };
  }
  function pub() { return JSON.parse(JSON.stringify({ name: tpl.name, noun: tpl.noun, intro: tpl.intro,
    fields: tpl.fields.map(function (f) { return Object.assign({}, f, { scope: f.scope === 'table' ? 'table' : 'card' }); }), level: tpl.level, routes: tpl.routes })); }
  function tableCards(t) { return cards.filter(function (c) { return c.table === t && !c.hidden; }).map(function (c) { return { id: c.id, text: c.fields.need, level: c.level }; }); }
  var api = {
    captureGetTableConfig: function () { return { title: config.title, tables: config.tables, open: config.open, aiPhotos: true, template: pub() }; },
    captureGetTableCards: function (s, k, t) { return tableCards(t); },
    captureGetTableState: function (s, k, t) { return { table: t, fields: tableFields[t] || {}, cards: tableCards(t) }; },
    captureSetTableFields: function (s, k, t, f) { var clean = captureValidateTableFields_(tpl, f); tableFields[t] = clean;
      cards.forEach(function (c) { if (c.table === t) c.fields.flip = clean.flip; }); return { table: t, fields: clean }; },
    captureSubmitCard: function (s, k, input) { var c = captureValidateCard_(tpl, input, config.tables, tableFields[Number(input.table)] || {}); var id = cards.length + 1;
      cards.push({ id: id, table: c.table, level: c.level, source: c.source, hidden: false, fields: c.fields, submittedAt: new Date().toISOString() }); return { id: id, token: 'f'.repeat(32) }; },
    captureRemoveOwnCard: function (s, k, id) { cards.forEach(function (c) { if (c.id === id) c.hidden = true; }); return { removed: true }; },
    captureReadPhoto: function () { return captureCleanReading_(tpl, { flip: 'Right now students use chatbots for homework, but we need them to [illegible] answers.', need: 'Lessons on checking chatbot answers', level: 'G+', confidence: 'medium' }); },
    captureGetWall: function () { var n = captureNormalizeGroups_(cards, groups);
      return Object.assign({ title: config.title, levelOptions: tpl.level.options, routes: tpl.routes }, captureWallSummary_(tpl, cards, n.groups, config.tables, config.open)); },
    captureGetBoard: board,
    captureSetOpen: function (s, open) { config.open = open; return board(); },
    captureSetHidden: function (s, id, h) { cards.forEach(function (c) { if (c.id === id) c.hidden = h; }); return board(); },
    captureSuggestGroups: function () { groups = ${JSON.stringify(DRAFT)}.map(function (d, i) { return { id: 'g' + (i + 1), topic: d[0], cardIds: d[1] }; }); return board(); },
    captureSaveGroups: function (s, g) { groups = captureNormalizeGroups_(cards, g).groups; return board(); },
    captureMakePosters: function () { return { url: '#posters' }; },
    captureListTemplates: function () { return [{ id: 'needCards', name: 'Need Cards' }]; },
    captureListSessions: function () { return [{ id: 'S-demo', name: 'K-12 needs workshop', date: 'Nov 18' }]; },
    webGetAppBaseUrl: function () { return '#'; }
  };
  function runner(ok, fail) {
    return new Proxy({}, { get: function (_, name) {
      if (name === 'withSuccessHandler') return function (f) { return runner(f, fail); };
      if (name === 'withFailureHandler') return function (f) { return runner(ok, f); };
      return function () { var args = arguments; setTimeout(function () {
        try { ok && ok(JSON.parse(JSON.stringify(api[name].apply(null, args)))); } catch (e) { fail && fail(e); } }, 120); };
    } });
  }
  window.google = { script: { run: runner(null, null) } };
  // Some hosts (shared preview pages) refuse confirm(); the preview always answers yes.
  window.confirm = function () { return true; };
})();
</script>`;
}

const NOTE = '<p style="margin:0;padding:6px 16px;font:13px/1.4 system-ui,sans-serif;background:#FFF3E0;color:#6B3A00;text-align:center">' +
  'Preview with made-up cards. Nothing you do here is saved, and AI answers are canned.</p>';

function build(file, outName, scenario, sessionId = 'S-demo') {
  const html = read(file)
    .replace('<body>', '<body>\n  ' + NOTE)
    .replace('<!--CAPTURE_STYLES-->', '<meta name="viewport" content="width=device-width, initial-scale=1">' + read('CaptureStyles.html'))
    .replace('<!--CAPTURE_CLIENT-->', mock(scenario) + read('CaptureClient.html'))
    .replace('__SESSION_ID__', sessionId)
    .replace('__CAPTURE_KEY__', KEY);
  fs.writeFileSync(path.join(out, outName), html);
}

build('Capture.html', 'capture.html', { cards: 30, freshTable: 3 });
build('CaptureBoard.html', 'board.html', { cards: 30, grouped: true });
build('CaptureBoard.html', 'board-live.html', { cards: 17, grouped: false });
build('CaptureWall.html', 'wall.html', { cards: 30, grouped: true });
build('CaptureWall.html', 'wall-live.html', { cards: 17, grouped: false });
console.log('Wrote capture.html, board.html, board-live.html, wall.html and wall-live.html to ' + out);

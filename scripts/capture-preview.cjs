#!/usr/bin/env node
/**
 * Builds the live-capture pages as static files that run in any browser,
 * with google.script.run replaced by an in-page stand-in. The stand-in is a
 * small copy of the server that uses the real CaptureTemplates.js and
 * CaptureLogic.js, made-up data for every stage, and canned AI answers.
 * Nothing here talks to Google.
 *
 *   node scripts/capture-preview.cjs <output-folder>
 *
 * Writes one file per screen and stage, e.g. phone-needs.html, board-results.html,
 * wall-vote.html, plus table-cards.html and index.html listing them all.
 */
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const out = process.argv[2];
if (!out) { console.error('Usage: node scripts/capture-preview.cjs <output-folder>'); process.exit(1); }
fs.mkdirSync(out, { recursive: true });
const read = name => fs.readFileSync(path.join(ROOT, name), 'utf8');

const KEY = '0123456789abcdef0123';
// [table, need, flip, level]
const NEEDS = [
  [1, 'A district template for AI use statements on syllabi', 'Right now teachers guess whether AI use is allowed, but we want clear expectations for every class.', 'G'],
  [1, 'Lessons that teach students how to question and check chatbot answers', 'Right now students use chatbots for homework without guidance, but we want them to use AI as a thinking partner.', 'G+'],
  [1, 'Family-facing explainers about how AI is used in school', 'Right now families hear mixed messages about AI, but we want a shared understanding.', 'G+'],
  [1, 'Guidance on not relying on AI detection tools', 'Right now AI detectors flag students unfairly, but we want fair ways to address academic integrity.', 'G'],
  [1, 'Paid PD time for teachers to practice with AI tools', 'Right now each teacher learns AI alone, but we want to learn together.', 'G+'],
  [2, 'AI literacy standards or learning targets for K-12', 'Right now students don’t understand how AI works, but we want them to be AI literate.', 'G'],
  [2, 'A state-vetted list of AI tools that meet student data privacy rules', 'Right now vendors pitch AI tools nonstop, but we want a way to judge which are safe.', 'B'],
  [2, 'Guidance on age-appropriate chatbot access', 'Right now chatbots are blocked at school, but we want students to learn to use them responsibly.', 'G'],
  [2, 'Funding for devices and connectivity in rural districts', 'Right now rural schools lack devices and bandwidth, but we want equal access to AI learning.', 'B'],
  [2, 'Ready-to-use AI literacy lessons teachers can adapt', 'Right now teachers feel unprepared, but we want confidence teaching with AI.', 'G+'],
  [3, 'Examples of AI literacy integrated into core content areas', 'Right now AI literacy is an afterthought, but we want it built into every subject.', 'G+'],
  [3, 'Career exploration resources about AI and work', 'Right now students worry AI will take their future jobs, but we want them to see a path.', 'G+'],
  [3, 'Clear privacy guidance for choosing AI tools', 'Right now we don’t know what student data AI tools collect, but we want to protect it.', 'G'],
  [3, 'Guidance and activities for fact-checking chatbot output', 'Right now chatbots give confident wrong answers, but we want students to verify information.', 'G+'],
  [3, 'A model district AI policy that districts can adopt', 'Right now policies change every semester, but we want stable rules.', 'G'],
  [4, 'Guidance on using AI for accessibility and IEP supports', 'Right now students with disabilities miss out, but we want AI to support access.', 'G+'],
  [4, 'Approved AI tools for lesson planning and grading feedback', 'Right now teachers spend hours on paperwork, but we want time for students.', 'B'],
  [4, 'Classroom norms for when AI help is OK and when it isn’t', 'Right now students and teachers define cheating differently, but we want shared norms.', 'G'],
  [4, 'A statewide AI literacy framework', 'Right now AI literacy depends on which teacher you get, but we want every student to get it.', 'G'],
  [4, 'Safety requirements for student-facing chatbots', 'Right now chatbots can say harmful things to kids, but we want them to be safe.', 'B'],
  [5, 'Leadership PD on AI decision-making', 'Right now principals don’t know what to allow, but we want leaders to guide schools.', 'G+'],
  [5, 'Assignment redesign examples that make student thinking visible', 'Right now students use AI to write essays, but we want them to keep their own voice.', 'G+'],
  [5, 'State funding for AI tool licenses', 'Right now there is no money for AI tools, but we want fair access across districts.', 'B'],
  [5, 'Lessons on how AI models work and where they fail', 'Right now students hear AI is magic, but we want them to understand its limits.', 'G+'],
  [5, 'Template notices to families about AI tools and data', 'Right now families don’t know what data is shared, but we want transparency.', 'G+'],
  [6, 'A state AI PD series with credit for teachers', 'Right now teachers learn AI from social media, but we want trusted training.', 'G+'],
  [6, 'Guidance on chatbots and student mental health', 'Right now students use chatbots for emotional support, but we want them to get help from people.', 'G'],
  [6, 'School-wide AI use guidelines', 'Right now AI use rules differ by classroom, but we want consistency across the school.', 'G'],
  [6, 'Ways to include students in AI decisions', 'Right now students aren’t asked what they think about AI, but we want student voice.', 'B'],
  [6, 'Research partnerships to study AI tools in schools', 'Right now AI tools are not tested in classrooms, but we want evidence of what works.', 'B']
];
const SIGNALS = ['Students use AI to study for tests', 'News about chatbots giving wrong medical advice', 'Our district blocked AI on school devices',
  'Friends use AI for college essays', 'Teachers use AI to write rubrics', 'AI tutors advertised on social media', 'A parent asked if AI grades our work',
  'AI art in the school art show', 'Phones translate for new students', 'Debate team practices against a chatbot'];
const DRAFT = [
  ['Chatbots', [2, 8, 14, 20, 27]], ['AI literacy', [6, 10, 11, 19, 24]], ['AI policy and guidelines', [1, 15, 28]],
  ['Academic integrity and norms', [4, 18, 22]], ['Teacher and leader PD', [5, 21, 26]], ['Safe tools and privacy', [7, 13, 17]],
  ['Families', [3, 25]], ['Funding and access', [9, 23]], ['Career exploration', [12]],
  ['Accessibility and IEP supports', [16]], ['Student voice', [29]], ['Research on AI tools', [30]]
];

function mock(sc) {
  return `<script>${read('CaptureTemplates.js')}\n${read('CaptureLogic.js')}</script>
<script>
(function () {
  var sc = ${JSON.stringify(sc)};
  var tpl = CAPTURE_TEMPLATES.needCards;
  var ids = tpl.stages.map(function (s) { return s.id; });
  var at = function (s) { return ids.indexOf(sc.stage) >= ids.indexOf(s); };
  var config = { template: 'needCards', tables: 6, key: '${KEY}', title: 'AI in K-12: Needs and Priorities', stage: sc.stage,
    published: null, publishedAt: '', paperDots: {}, paperFlipDots: {}, tallyMode: 'phone', assign: {}, surveyUrl: 'https://example.org/exit-survey' };
  var audit = [];
  var spent = 0.37;
  function log(who, action, ids, model, cost, photo) { audit.push({ Entry: audit.length + 1, Time: new Date().toISOString(), Actor: who, Action: action, IDs: ids || '', Model: model || '', 'Cost (USD)': cost || '', Photo: photo || '', Detail: '' }); }
  log('owner@example.org', 'Live capture turned on'); log('Table 3 · device 4f2a9c1e', 'Signal added', '1'); log('owner@example.org', 'AI suggested groups', '12 groups', 'gemini-3.8-flash', 0.0061);
  var NEEDS = ${JSON.stringify(NEEDS)};
  var signals = at('signals') ? ${JSON.stringify(SIGNALS)}.map(function (t, i) { return { id: i + 1, table: (i % 6) + 1, role: i % 3 ? 'A' : 'S', text: t, hidden: false, token: 't' + i }; }) : [];
  var flips = [];
  if (at('flips')) NEEDS.forEach(function (n) {
    if (flips.filter(function (f) { return f.table === n[0]; }).length < 3 && !flips.some(function (f) { return f.text === n[2]; }))
      flips.push({ id: flips.length + 1, table: n[0], text: n[2], top: at('needs') && !flips.some(function (f) { return f.table === n[0]; }), hidden: false });
  });
  var flipDots = at('flipdots') ? flips.slice(0, 12).map(function (f, i) { return { flipId: f.id, color: ['green', 'blue', 'yellow'][i % 3], role: i % 2 ? 'S' : 'A', voter: 'v' + i }; }) : [];
  var cards = at('needs') ? NEEDS.slice(0, sc.stage === 'needs' ? 17 : 30).map(function (n, i) {
    var mine = flips.filter(function (f) { return f.table === n[0]; });
    var flip = mine.find(function (f) { return f.text === n[2]; }) || mine[0];
    return { id: i + 1, table: n[0], level: n[3], role: i % 3 === 0 ? 'S' : 'A', flipId: flip.id, source: i % 4 === 0 ? 'photo' : 'typed', hidden: false,
      submittedAt: '2026-11-18T18:0' + (i % 10) + ':00Z', token: 't' + i, fields: { flip: flip.text, need: n[1] },
      aiReading: i % 4 === 0 ? n[1].slice(0, -1) : '', photo: i % 4 === 0 ? 'https://drive.google.com/file/d/DEMO/view' : '' };
  }) : [];
  var groups = at('synthesis') ? ${JSON.stringify(DRAFT)}.map(function (d, i) { return { id: 'g' + (i + 1), topic: d[0], cardIds: d[1], rank: 0, columnOverride: '' }; }) : [];
  if (at('vote')) { config.published = capturePublish_(tpl, cards, captureNormalizeGroups_(cards, groups, tpl).groups); config.publishedAt = '2026-11-18T18:38:00Z'; }
  var votes = at('vote') ? Array.apply(null, Array(sc.stage === 'vote' ? 14 : 38)).map(function (_, i) {
    var p = config.published; return { voter: 'v' + i, role: i % 3 === 0 ? 'S' : 'A', choices: [p[i % 5].id, p[(i * 3) % p.length].id, p[(i % 2) ? 0 : 1].id] };
  }) : [];
  if (at('results')) config.paperDots[config.published[0].id] = { S: 2, A: 1 };
  var testDrive = at('testdrive') ? [
    { table: 1, device: 'a1', groupId: 'g1', topic: 'Chatbots', source: 'typed', notes: { change: 'Say what age-appropriate access means.', add: 'Examples of classroom chatbot use.', cut: '', beyond: 'Funding for teacher training.' } },
    { table: 3, device: 'b2', groupId: 'g3', topic: 'AI policy and guidelines', source: 'typed', notes: { change: '', add: 'A model policy districts can adopt as is.', cut: 'The long list of tool names; it dates fast.', beyond: '' } },
    { table: 3, device: 'paper-1', groupId: 'g3', topic: 'AI policy and guidelines', source: 'paper', notes: { change: 'Plain language for families.', add: '', cut: '', beyond: 'State funding to help districts write policy.' } }] : [];

  function results() { var t = captureTally_(tpl, config.published || [], votes, config.paperDots, config.tallyMode); return captureResults_(tpl, config.published || [], t, config.tables, config.assign); }
  function pub() { return JSON.parse(JSON.stringify({ name: tpl.name, noun: tpl.noun, intro: tpl.intro, roles: tpl.roles, stages: tpl.stages, signal: tpl.signal, parent: tpl.parent,
    flipDots: tpl.flipDots, fields: tpl.fields, level: { label: tpl.level.label, levers: tpl.level.levers, options: tpl.level.options },
    routes: tpl.routes, vote: tpl.vote, testDrive: tpl.testDrive })); }
  function voters() { var o = { total: votes.length }; tpl.roles.forEach(function (r) { o[r.code] = votes.filter(function (v) { return v.role === r.code; }).length; }); return o; }
  function board() {
    var live = cards.filter(function (c) { return !c.hidden; }), n = captureNormalizeGroups_(cards, groups, tpl), dots = captureTallyFlipDots_(tpl, flipDots, config.paperFlipDots);
    return { sessionId: 'S-demo', sessionName: 'Retreat rehearsal', enabled: true, sheetUrl: 'https://docs.google.com/spreadsheets/d/DEMO/edit',
      config: { title: config.title, tables: config.tables, stage: config.stage, tallyMode: config.tallyMode, surveyUrl: config.surveyUrl, publishedAt: config.publishedAt, paperDots: config.paperDots, paperFlipDots: config.paperFlipDots, assign: config.assign },
      template: pub(),
      paperModes: Object.keys(CAPTURE_PAPER_MODES_).map(function (k) { return { id: k, label: CAPTURE_PAPER_MODES_[k].label, table: CAPTURE_PAPER_MODES_[k].table }; }),
      ai: { enabled: true, spentToday: spent, budget: 100 }, links: { table: 'https://script.google.com/macros/s/DEMO/exec?session=S-demo&k=${KEY}&page=capture', wall: 'wall-' + config.stage + '.html', tableCards: 'table-cards.html', board: '#', facilitator: config.facilitatorKey ? 'https://script.google.com/macros/s/DEMO/exec?page=run&session=S-demo&f=' + config.facilitatorKey : '' },
      signals: signals, flips: flips.map(function (f) { return Object.assign({}, f, { dots: dots[f.id] || {} }); }), cards: cards,
      groups: captureOrderGroups_(tpl, live, n.groups), ungrouped: n.ungrouped, parking: captureParkingLot_(tpl, cards).map(function (c) { return c.id; }),
      published: config.published, voters: voters(), tally: config.published ? captureTally_(tpl, config.published, votes, config.paperDots, config.tallyMode) : {},
      results: config.published ? results() : null, testDrive: testDrive };
  }
  var api = {
    captureGetPhoneState: function (s, k, table, voter) {
      var st = { title: config.title, tables: config.tables, stage: config.stage, aiPhotos: true, template: pub() };
      var dots = captureTallyFlipDots_(tpl, flipDots, config.paperFlipDots);
      if (table) {
        var a = config.published && at('results') ? results().assignments.find(function (x) { return x.table === table; }) : null;
        var mineTd = testDrive.find(function (x) { return x.table === table && x.device === voter; });
        st.table = { number: table,
          flips: flips.filter(function (f) { return f.table === table && !f.hidden; }).map(function (f) { return { id: f.id, text: f.text, top: f.top, dots: dots[f.id] || {} }; }),
          cards: cards.filter(function (c) { return c.table === table && !c.hidden; }).map(function (c) { return { id: c.id, text: c.fields.need, level: c.level, role: c.role, flipId: c.flipId }; }),
          signals: signals.filter(function (x) { return x.table === table && !x.hidden; }),
          assignment: a && a.groupId ? { id: a.groupId, topic: a.topic } : null,
          testDrive: { mine: mineTd ? mineTd.notes : null, others: testDrive.filter(function (x) { return x.table === table && x !== mineTd; }).map(function (x) { return x.notes; }) } };
      }
      st.gallery = flips.filter(function (f) { return !f.hidden; }); st.myDots = flipDots.filter(function (d) { return d.voter === voter; });
      if (config.published) { st.ballot = config.published.map(function (g) { return { id: g.id, topic: g.topic, column: g.column, contested: g.contested, tableCount: g.tableCount }; });
        var mine = votes.find(function (v) { return v.voter === voter; }); st.myVote = mine ? { role: mine.role, choices: mine.choices } : null; }
      if (config.published && at('results')) st.results = results();
      if (config.stage === 'close') st.surveyUrl = config.surveyUrl;
      return st;
    },
    captureAddSignal: function (s, k, input) { var v = captureValidateSignal_(tpl, input, config.tables); var id = signals.length + 1; signals.push(Object.assign({ id: id, hidden: false }, v)); return { id: id, token: 'a'.repeat(32) }; },
    captureRemoveSignal: function (s, k, id) { signals.forEach(function (x) { if (x.id === id) x.hidden = true; }); return {}; },
    captureSaveFlip: function (s, k, table, id, text) { var clean = captureValidateFlipText_(tpl, text);
      if (id) { flips.forEach(function (f) { if (f.id === id) f.text = clean; }); cards.forEach(function (c) { if (c.flipId === id) c.fields.flip = clean; }); return { id: id }; }
      flips.push({ id: flips.length + 1, table: table, text: clean, top: false, hidden: false }); return { id: flips.length }; },
    captureRemoveFlip: function (s, k, table, id) { flips.forEach(function (f) { if (f.id === id) f.hidden = true; }); return {}; },
    captureSetFlipTop: function (s, k, table, id, top) { flips.forEach(function (f) { if (f.id === id) f.top = top; }); return {}; },
    captureSaveFlipDots: function (s, k, input) { var e = captureValidateFlipDots_(tpl, flips, input);
      flipDots = flipDots.filter(function (d) { return d.voter !== e.voter; }).concat(e.dots.map(function (d) { return { flipId: d.flipId, color: d.color, role: e.role, voter: e.voter }; })); return {}; },
    captureSubmitCard: function (s, k, input) { var c = captureValidateCard_(tpl, input, config.tables, flips); var id = cards.length + 1;
      cards.push(Object.assign({ id: id, hidden: false, submittedAt: new Date().toISOString() }, c)); return { id: id, token: 'f'.repeat(32) }; },
    captureRemoveOwnCard: function (s, k, id) { cards.forEach(function (c) { if (c.id === id) c.hidden = true; }); return {}; },
    captureReadPhoto: function () { spent += 0.004; log('Table 3 · device 4f2a9c1e', 'AI read a card photo', '', 'gemini-3.8-flash', 0.004, 'https://drive.google.com/file/d/DEMO/view');
      return Object.assign({ entry: audit.length }, captureCleanReading_(tpl, { need: 'Lessons on checking chatbot answers for [illegible] sources', level: 'G+', confidence: 'medium' })); },
    captureSaveVote: function (s, k, input) { var v = captureValidateVote_(tpl, config.published, input); votes = votes.filter(function (x) { return x.voter !== v.voter; }).concat([v]); return {}; },
    captureSaveTestDrive: function (s, k, table, notes, device) { var n = captureValidateTestDrive_(tpl, notes); testDrive = testDrive.filter(function (x) { return !(x.table === table && x.device === device); }).concat([{ table: table, device: device, notes: n, source: 'typed' }]); return {}; },
    captureGetWall: function () {
      var live = cards.filter(function (c) { return !c.hidden; });
      var per = function (list) { var o = []; for (var i = 1; i <= config.tables; i++) o.push(list.filter(function (x) { return x.table === i; }).length); return o; };
      var byRole = function (list) { var o = { total: list.length }; tpl.roles.forEach(function (r) { o[r.code] = list.filter(function (x) { return x.role === r.code; }).length; }); return o; };
      var levels = {}; tpl.level.options.forEach(function (o) { levels[o.code] = live.filter(function (c) { return c.level === o.code; }).length; });
      var w = { title: config.title, stage: config.stage, tables: config.tables,
        template: { stages: tpl.stages, roles: tpl.roles, levelOptions: tpl.level.options, routes: tpl.routes, flipDots: tpl.flipDots, parent: { plural: tpl.parent.plural }, vote: { prompt: tpl.vote.prompt } },
        signals: { byRole: byRole(signals), perTable: per(signals) }, flips: { total: flips.length, perTable: per(flips) }, flipDots: byRole(flipDots),
        cards: { total: live.length, perTable: per(live), levels: levels, byRole: byRole(live) }, voters: voters() };
      if (config.published && at('vote')) w.topics = config.published.map(function (g) { return { topic: g.topic, column: g.column, contested: g.contested, tableCount: g.tableCount }; });
      if (config.published && at('results')) { var r = results(); w.results = { columns: r.columns, assignments: r.assignments }; }
      if (config.stage === 'close') w.surveyUrl = config.surveyUrl;
      return w;
    },
    captureGetBoard: board,
    captureSetStage: function (s, st) { config.stage = st; return board(); },
    captureSetHidden: function (s, id, h) { cards.forEach(function (c) { if (c.id === id) c.hidden = h; }); return board(); },
    captureSetSignalHidden: function (s, id, h) { signals.forEach(function (c) { if (c.id === id) c.hidden = h; }); return board(); },
    captureSetFlipHidden: function (s, id, h) { flips.forEach(function (c) { if (c.id === id) c.hidden = h; }); return board(); },
    captureSuggestGroups: function () { groups = ${JSON.stringify(DRAFT)}.map(function (d, i) { return { id: 'g' + (i + 1), topic: d[0], cardIds: d[1] }; }); return board(); },
    captureSaveGroups: function (s, g) { groups = captureNormalizeGroups_(cards, g, tpl).groups; return board(); },
    capturePublish: function (s, clear) { if (clear) votes = []; config.published = capturePublish_(tpl, cards.filter(function (c) { return !c.hidden; }), captureNormalizeGroups_(cards, groups, tpl).groups); config.publishedAt = new Date().toISOString(); return board(); },
    captureSetPaperDots: function (s, id, counts) { config.paperDots[id] = counts; return board(); },
    captureSetTallyMode: function (s, m) { config.tallyMode = m; return board(); },
    captureSetAssignment: function (s, t, id) { if (id) config.assign[t] = id; else delete config.assign[t]; return board(); },
    captureSetSurveyUrl: function (s, u) { config.surveyUrl = u; return board(); },
    captureSetFacilitatorLink: function (s, mode) { config.facilitatorKey = mode === 'new' ? Array.from({ length: 32 }, function () { return Math.floor(Math.random() * 16).toString(16); }).join('') : ''; return board(); },
    captureMakePosters: function () { return { url: '#posters' }; },
    captureReadPaper: function (s, mode, table) {
      spent += 0.012;
      var raw = {
        signals: { confidence: 'medium', note: 'Two notes overlap at the bottom right.', items: [{ text: 'Our robotics club uses AI to debug code', writer: 'student' }, { text: 'Teachers worry about [illegible] cheating', writer: 'adult' }, { text: 'AI in the news every day', writer: 'unknown' }] },
        flips: { confidence: 'high', note: '', items: [{ text: 'Right now AI rules change by classroom, but we want one school-wide set' }] },
        cards: { confidence: 'medium', note: '', items: [{ need: 'Short videos that show good AI use', flipText: 'teachers guess whether AI use is allowed', level: 'G', writer: 'student' }, { need: 'Money for training', flipText: '', level: 'B', writer: 'adult' }] },
        flipdots: { confidence: 'low', note: 'Some yellow dots may be covered by tape.', items: flips.slice(0, 2).map(function (f, i) { return { statement: f.text.slice(0, 40), green: { student: 3 + i, adult: 2, unmarked: 1 }, blue: { student: 1, adult: 0, unmarked: 0 }, yellow: { student: 0, adult: 1, unmarked: 2 } }; }) },
        votes: { confidence: 'medium', note: '', items: (config.published || []).slice(0, 3).map(function (g, i) { return { topic: g.topic, student: 4 - i, adult: 6 - i, unmarked: i }; }) },
        testdrive: { confidence: 'high', note: '', change: 'Name who decides when AI is allowed.', add: 'A one-page summary for students.', cut: '', beyond: '' }
      }[mode];
      var r = captureCleanPaperReading_(tpl, mode, raw, { table: table, flips: flips, published: config.published || [] });
      log('owner@example.org', 'AI read paper: ' + CAPTURE_PAPER_MODES_[mode].label, table ? 'table ' + table : '', 'gemini-3.8-flash', 0.012, 'https://drive.google.com/file/d/DEMO/view');
      return { entry: audit.length, photo: 'https://drive.google.com/file/d/DEMO/view', rows: r.rows, confidence: r.confidence, note: r.note, cost: 0.012 };
    },
    captureConfirmPaper: function (s, mode, rows, entry) {
      var clean = captureValidatePaperRows_(tpl, mode, rows, { tables: config.tables, flips: flips, published: config.published || [] });
      clean.forEach(function (r) {
        if (mode === 'signals') signals.push({ id: signals.length + 1, table: r.table, role: r.role, text: r.text, hidden: false, source: 'paper' });
        if (mode === 'flips') flips.push({ id: flips.length + 1, table: r.table, text: r.text, top: false, hidden: false });
        if (mode === 'cards') cards.push({ id: cards.length + 1, table: r.table, level: r.level, role: r.role, flipId: r.flipId, source: 'paper', hidden: false, fields: { flip: r.flipText, need: r.need } });
        if (mode === 'flipdots') config.paperFlipDots[r.flipId] = r.counts;
        if (mode === 'votes') config.paperDots[r.groupId] = { S: r.S, A: r.A };
        if (mode === 'testdrive') testDrive.push({ table: r.table, device: 'paper-' + testDrive.length, notes: r, source: 'paper' });
      });
      log('owner@example.org', 'Added from paper: ' + CAPTURE_PAPER_MODES_[mode].label, clean.length + ' rows');
      var b = board(); b.added = { count: clean.length, entry: audit.length }; return b;
    },
    captureGetAudit: function () { return { total: audit.length, rows: audit.slice().reverse().slice(0, 50), sheetUrl: 'https://docs.google.com/spreadsheets/d/DEMO/edit', ai: { spentToday: spent, budget: 100 } }; },
    captureMakeReport: function () { log('owner@example.org', 'Results document made'); return { url: 'report.html' }; },
    captureGetTableCardsData: function () { return { title: config.title, sessionName: 'Retreat rehearsal', tables: config.tables, noun: tpl.noun,
      tableLink: 'https://script.google.com/macros/s/DEMO/exec?session=S-demo&k=${KEY}&page=capture' }; },
    captureListTemplates: function () { return [{ id: 'needCards', name: 'Need Cards' }]; },
    captureListSessions: function () { return [{ id: 'S-demo', name: 'Retreat rehearsal', date: 'Nov 18' }]; },
    webGetAppBaseUrl: function () { return 'dashboard-' + sc.stage + '.html'; },
    webGetAppConfig: function () { return { timezone: 'America/Chicago', timezoneLabel: 'CT' }; },
    // The dashboard: a live-capture session at this stage, one with only its library, and a brand-new one.
    getDashboardData: function () {
      var at = ids.indexOf(sc.stage);
      return [
        { id: 'S-demo', name: 'Retreat rehearsal', theme: 'What do Minnesota\u2019s students and educators need from AI guidance to keep learning human and learner-centered?',
          date: '2026-11-18', format: 'Community Forum', audience: 'Students and educators', status: 'Active', hasBrief: true, hasGems: true, emailSent: 'No',
          folderUrl: '#drive', dbUrl: '#sheet', libraryUrl: '#library',
          capture: { on: true, template: tpl.name, tables: config.tables, stage: sc.stage, stageLabel: tpl.stages[at].label, stageNumber: at + 1, stageCount: ids.length,
            closed: sc.stage === ids[ids.length - 1], board: 'board-' + sc.stage + '.html', record: 'board-close.html', wall: 'wall-' + sc.stage + '.html',
            table: 'https://script.google.com/macros/s/DEMO/exec?session=S-demo&k=${KEY}&page=capture', tableCards: 'table-cards.html' } },
        { id: 'S-library', name: 'Rehearse me', theme: 'What a state might need for work.', date: '', format: 'Collaborative Monthly Gathering', audience: 'Community Members',
          status: 'Active', hasBrief: true, hasGems: false, emailSent: 'No', folderUrl: '#drive', dbUrl: '#sheet', libraryUrl: '#library',
          capture: { on: false, board: 'board-welcome.html' } },
        { id: 'S-new', name: 'Spring leadership circle', theme: '', date: '2027-03-04', format: '', audience: '', status: 'Active', hasBrief: false, hasGems: false,
          emailSent: 'No', folderUrl: '#drive', dbUrl: '', libraryUrl: '#library', capture: { on: false, board: 'board-welcome.html' } }
      ];
    }
  };
  function runner(ok, fail) {
    return new Proxy({}, { get: function (_, name) {
      if (name === 'withSuccessHandler') return function (f) { return runner(f, fail); };
      if (name === 'withFailureHandler') return function (f) { return runner(ok, f); };
      return function () { var args = arguments; setTimeout(function () {
        try { ok && ok(JSON.parse(JSON.stringify(api[name].apply(null, args)))); } catch (e) { fail && fail(e); } }, 80); };
    } });
  }
  window.google = { script: { run: runner(null, null) } };
  // Some hosts (shared preview pages) refuse confirm() and prompt(); the preview always answers yes.
  window.confirm = function () { return true; };
  // A preview phone starts as a student at the table named in the page, so every stage shows its screen.
  try { if (sc.table) { localStorage.setItem('capture:S-demo:table', JSON.stringify(sc.table)); localStorage.setItem('capture:S-demo:role', JSON.stringify(sc.role || 'S')); } } catch (e) {}
})();
</script>`;
}

const NOTE = '<p style="margin:0;padding:6px 16px;font:13px/1.4 system-ui,sans-serif;background:#FFF3E0;color:#6B3A00;text-align:center">' +
  'Preview with made-up data. Nothing you do here is saved, and AI answers are canned.</p>';

function build(file, outName, scenario) {
  // Function replacers: the injected code contains "$'" and other patterns that a
  // replacement string would expand.
  const html = read(file)
    .replace('<head>', () => '<head>\n  <meta name="viewport" content="width=device-width, initial-scale=1">')
    .replace('<body>', () => '<body>\n  ' + NOTE + mock(scenario))
    .replace('__SESSION_ID__', 'S-demo')
    .replace('__CAPTURE_KEY__', KEY)
    .replace('__TABLE__', '')
    .replace('__TAB__', '');
  fs.writeFileSync(path.join(out, outName), html);
  return outName;
}

const STAGES = ['welcome', 'signals', 'flips', 'flipdots', 'needs', 'synthesis', 'vote', 'results', 'testdrive', 'close'];
const files = [];
STAGES.forEach(stage => {
  files.push(build('Capture.html', 'phone-' + stage + '.html', { stage, table: 3, role: 'S' }));
  files.push(build('CaptureBoard.html', 'board-' + stage + '.html', { stage }));
  files.push(build('CaptureWall.html', 'wall-' + stage + '.html', { stage }));
});
files.push(build('CaptureTableCards.html', 'table-cards.html', { stage: 'welcome' }));
STAGES.forEach(stage => files.push(build('Index.html', 'dashboard-' + stage + '.html', { stage })));
fs.writeFileSync(path.join(out, 'index.html'), '<!doctype html><meta charset="utf-8"><title>Live capture preview</title><body style="font:16px system-ui;padding:16px">' +
  '<h1>Live capture preview</h1><table>' + STAGES.map(s => `<tr><th style="text-align:left;padding-right:12px">${s}</th><td><a href="dashboard-${s}.html">dashboard</a> · <a href="phone-${s}.html">phone</a> · <a href="board-${s}.html">board</a> · <a href="wall-${s}.html">wall</a></td></tr>`).join('') +
  '</table><p><a href="table-cards.html">table cards</a></p>');
console.log('Wrote ' + files.length + ' pages and index.html to ' + out);

/**
 * CaptureApi
 * Browser entry points for live capture.
 *
 * Table and wall calls are public (anyone with the link) but every one of them
 * requires the session's table key and returns only what that screen needs.
 * Board calls require an authorized facilitator, through AuthService, before
 * anything is read or written.
 */

// ─── Pages ──────────────────────────────────────────────────────────────────

// keyed: the page's links carry the table key (public pages); the others are
// facilitator pages that doGet only serves to authorized users.
const CAPTURE_PAGES_ = {
  capture: { file: 'Capture', title: 'Add a card', keyed: true },
  wall: { file: 'CaptureWall', title: 'Live wall', keyed: true },
  board: { file: 'CaptureBoard', title: 'Live board', keyed: false },
  tablecards: { file: 'CaptureTableCards', title: 'Table cards', keyed: false }
};

/** Called from doGet for the live-capture pages. */
function captureRoute_(page, e) {
  const spec = CAPTURE_PAGES_[page];
  const params = (e && e.parameter) || {};
  const sessionId = params.session ? validateSessionId_(String(params.session)) : '';
  const key = spec.keyed ? captureValidateKeyFormat_(String(params.k || '')) : '';
  // A table card's QR code names its table, so the phone skips the table picker.
  const table = page === 'capture' && /^[1-9][0-9]?$/.test(String(params.t || '')) ? String(params.t) : '';
  // Each page is self-contained (scripts/sync-capture-shared.cjs copies the shared
  // styles and helpers into it); only the session, key and table are filled in here.
  let html = HtmlService.createHtmlOutputFromFile(spec.file).getContent()
    .replace('__SESSION_ID__', sessionId)
    .replace('__CAPTURE_KEY__', key)
    .replace('__TABLE__', table);
  return HtmlService.createHtmlOutput(html)
    .setTitle(spec.title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * The facilitator deployment's address (board, dashboard, table cards).
 * scripts/poc.sh writes CAPTURE_BOARD_URL; otherwise the address doGet cached.
 */
function captureBoardBase_() {
  if (typeof CAPTURE_BOARD_URL === 'string' && /^https:\/\/script\.google\.com\//.test(CAPTURE_BOARD_URL)) return CAPTURE_BOARD_URL;
  const cached = PropertiesService.getScriptProperties().getProperty('WEB_APP_URL');
  return cached || getWebAppUrl_();
}

/** Every link a facilitator hands out or opens for one session. */
function captureLinks_(sessionId, config) {
  const pub = capturePublicBase_();
  const board = captureBoardBase_();
  const s = '?session=' + encodeURIComponent(sessionId);
  return {
    table: pub ? pub + s + '&k=' + config.key + '&page=capture' : '',
    wall: pub ? pub + s + '&k=' + config.key + '&page=wall' : '',
    board: board ? board + '?page=board&session=' + encodeURIComponent(sessionId) : '',
    tableCards: board ? board + '?page=tablecards&session=' + encodeURIComponent(sessionId) : ''
  };
}

/**
 * Table and wall links must point at a deployment anyone can open without
 * signing in, which may differ from the one the board runs on. scripts/poc.sh
 * writes CAPTURE_PUBLIC_URL (CaptureDeploy.js); a CAPTURE_PUBLIC_URL script
 * property also works; otherwise this deployment's own URL is used.
 */
function capturePublicBase_() {
  if (typeof CAPTURE_PUBLIC_URL === 'string' && /^https:\/\/script\.google\.com\//.test(CAPTURE_PUBLIC_URL)) return CAPTURE_PUBLIC_URL;
  const fromProps = PropertiesService.getScriptProperties().getProperty('CAPTURE_PUBLIC_URL');
  if (fromProps && /^https:\/\/script\.google\.com\//.test(fromProps)) return fromProps;
  return getWebAppUrl_();
}

function captureValidateKeyFormat_(key) {
  if (!/^[a-f0-9]{20}$/.test(key)) throw new Error('This table link is incomplete. Ask a facilitator for the link.');
  return key;
}

/** Public calls: the session must have live capture on and the key must match. */
function captureRequireKey_(sessionId, key) {
  validateSessionId_(sessionId);
  captureValidateKeyFormat_(String(key || ''));
  const config = CaptureStore.getConfig(sessionId);
  if (!config || config.key !== key) throw new Error('This table link is not active. Ask a facilitator for the link.');
  return { config: config, template: captureTemplate_(config.template) };
}


/** What phones and the wall may know about the template. */
function capturePublicTemplate_(template) {
  return {
    name: template.name,
    noun: template.noun,
    intro: template.intro,
    roles: template.roles,
    stages: template.stages,
    signal: template.signal,
    parent: template.parent,
    flipDots: template.flipDots,
    flipDotsPerPerson: template.flipDotsPerPerson,
    fields: template.fields.map(f => ({ key: f.key, label: f.label, hint: f.hint || '', maxLength: f.maxLength, primary: !!f.primary })),
    level: {
      label: template.level.label,
      levers: template.level.levers || '',
      options: template.level.options.map(o => ({ code: o.code, label: o.label, hint: o.hint, route: o.route }))
    },
    routes: template.routes,
    vote: template.vote,
    testDrive: template.testDrive
  };
}

/** Writes are only accepted in the stages they belong to. */
function captureRequireStage_(ctx, allowed) {
  if (allowed.indexOf(ctx.config.stage) !== -1) return;
  const names = ctx.template.stages.filter(s => allowed.indexOf(s.id) !== -1).map(s => s.label);
  throw new Error('That’s not open right now. It opens during: ' + names.join(', ') + '.');
}

const CAPTURE_STAGE_WRITES_ = {
  signals: ['signals'],
  flips: ['flips', 'flipdots', 'needs'],
  flipTop: ['flips', 'flipdots', 'needs'],
  flipDots: ['flipdots'],
  cards: ['needs'],
  photo: ['needs'],
  vote: ['vote'],
  testDrive: ['testdrive']
};

function captureStageAtOrAfter_(template, stage, from) {
  const ids = captureStageIds_(template);
  return ids.indexOf(stage) >= ids.indexOf(from);
}

/** The ranked results and table assignments, from the published groups and the chosen tally. */
function captureComputeResults_(ctx, snap) {
  const published = ctx.config.published || [];
  const tally = captureTally_(ctx.template, published, snap.votes, ctx.config.paperDots, ctx.config.tallyMode);
  return captureResults_(ctx.template, published, tally, ctx.config.tables, ctx.config.assign);
}

function captureVoterCounts_(template, votes) {
  const out = { total: votes.length };
  template.roles.forEach(r => { out[r.code] = votes.filter(v => v.role === r.code).length; });
  return out;
}

// ─── Phones (public, key required) ──────────────────────────────────────────

/**
 * Everything a phone needs for the current stage, in one call.
 * table: the phone's table number, or 0 before it picks one.
 * voter: the phone's own random id, so it sees its own dots and votes.
 */
function captureGetPhoneState(sessionId, key, table, voter) {
  const ctx = captureRequireKey_(sessionId, key);
  const t = ctx.template, c = ctx.config;
  const snap = CaptureStore.snapshot(sessionId, t);
  const tableNo = Number(table) >= 1 && Number(table) <= c.tables ? Number(table) : 0;
  const me = /^[a-f0-9]{16,40}$/.test(String(voter || '')) ? String(voter) : '';
  const primary = t.fields.find(f => f.primary) || t.fields[0];
  const state = {
    title: c.title,
    tables: c.tables,
    stage: c.stage,
    aiPhotos: (Number(CONFIG.CAPTURE_AI_DAILY_LIMIT) || 0) > 0,
    template: capturePublicTemplate_(t)
  };
  if (tableNo) {
    const dots = captureTallyFlipDots_(t, snap.flipDots);
    const assignment = captureStageAtOrAfter_(t, c.stage, 'results') && c.published
      ? captureComputeResults_(ctx, snap).assignments.find(a => a.table === tableNo) : null;
    const notes = snap.testDrive.find(n => n.table === tableNo);
    state.table = {
      number: tableNo,
      flips: snap.flips.filter(f => f.table === tableNo && !f.hidden).map(f => ({ id: f.id, text: f.text, top: f.top, dots: dots[f.id] || {} })),
      cards: snap.cards.filter(x => x.table === tableNo && !x.hidden).map(x => ({ id: x.id, text: x.fields[primary.key], level: x.level, role: x.role, flipId: x.flipId })),
      signals: snap.signals.filter(x => x.table === tableNo && !x.hidden).map(x => ({ id: x.id, text: x.text, role: x.role })),
      assignment: assignment && assignment.groupId ? { groupId: assignment.groupId, topic: assignment.topic } : null,
      testDrive: notes ? notes.notes : null
    };
  }
  if (c.stage === 'flipdots') {
    state.gallery = snap.flips.filter(f => !f.hidden).map(f => ({ id: f.id, table: f.table, text: f.text }));
    state.myDots = me ? snap.flipDots.filter(d => d.voter === me).map(d => ({ flipId: d.flipId, color: d.color })) : [];
  }
  if (c.published && (c.stage === 'vote' || captureStageAtOrAfter_(t, c.stage, 'vote'))) {
    state.ballot = c.published.map(g => ({ id: g.id, topic: g.topic, column: g.column, contested: g.contested, tableCount: g.tableCount }));
    const mine = me ? snap.votes.find(v => v.voter === me) : null;
    state.myVote = mine ? { role: mine.role, choices: mine.choices } : null;
  }
  if (c.published && captureStageAtOrAfter_(t, c.stage, 'results')) state.results = captureComputeResults_(ctx, snap);
  if (c.stage === 'close') state.surveyUrl = c.surveyUrl;
  return state;
}

function captureAddSignal(sessionId, key, input) {
  const ctx = captureRequireKey_(sessionId, key);
  captureRequireStage_(ctx, CAPTURE_STAGE_WRITES_.signals);
  return CaptureStore.addSignal(sessionId, captureValidateSignal_(ctx.template, input, ctx.config.tables));
}

function captureRemoveSignal(sessionId, key, id, token) {
  const ctx = captureRequireKey_(sessionId, key);
  captureRequireStage_(ctx, CAPTURE_STAGE_WRITES_.signals);
  if (!/^[a-f0-9]{32}$/.test(String(token || ''))) throw new Error('Only the phone that sent this can remove it.');
  CaptureStore.setSignalHidden(sessionId, Number(id), true, String(token));
  return { removed: true };
}

/** Adds a table's flip statement (id 0) or edits one of its own. */
function captureSaveFlip(sessionId, key, table, id, text) {
  const ctx = captureRequireKey_(sessionId, key);
  captureRequireStage_(ctx, CAPTURE_STAGE_WRITES_.flips);
  const t = captureValidTable_(table, ctx.config.tables);
  return CaptureStore.saveFlip(sessionId, ctx.template, t, Number(id) || 0, captureValidateFlipText_(ctx.template, text));
}

function captureRemoveFlip(sessionId, key, table, id) {
  const ctx = captureRequireKey_(sessionId, key);
  captureRequireStage_(ctx, CAPTURE_STAGE_WRITES_.flips);
  const t = captureValidTable_(table, ctx.config.tables);
  const snap = CaptureStore.snapshot(sessionId, ctx.template);
  if (snap.cards.some(c => c.flipId === Number(id) && !c.hidden)) {
    throw new Error('Cards already belong to this ' + ctx.template.parent.label.toLowerCase() + '. Edit it instead.');
  }
  CaptureStore.setFlipFlags(sessionId, ctx.template, t, Number(id), { hidden: true });
  return { removed: true };
}

function captureSetFlipTop(sessionId, key, table, id, top) {
  const ctx = captureRequireKey_(sessionId, key);
  captureRequireStage_(ctx, CAPTURE_STAGE_WRITES_.flipTop);
  const t = captureValidTable_(table, ctx.config.tables);
  CaptureStore.setFlipFlags(sessionId, ctx.template, t, Number(id), { top: !!top });
  return { top: !!top };
}

function captureSaveFlipDots(sessionId, key, input) {
  const ctx = captureRequireKey_(sessionId, key);
  captureRequireStage_(ctx, CAPTURE_STAGE_WRITES_.flipDots);
  const snap = CaptureStore.snapshot(sessionId, ctx.template);
  const entry = captureValidateFlipDots_(ctx.template, snap.flips, input);
  CaptureStore.saveFlipDots(sessionId, entry);
  return { saved: entry.dots.length };
}

function captureSubmitCard(sessionId, key, input) {
  const ctx = captureRequireKey_(sessionId, key);
  captureRequireStage_(ctx, CAPTURE_STAGE_WRITES_.cards);
  const snap = CaptureStore.snapshot(sessionId, ctx.template);
  const card = captureValidateCard_(ctx.template, input, ctx.config.tables, snap.flips);
  return CaptureStore.appendCard(sessionId, ctx.template, card);
}

function captureRemoveOwnCard(sessionId, key, cardId, token) {
  const ctx = captureRequireKey_(sessionId, key);
  captureRequireStage_(ctx, CAPTURE_STAGE_WRITES_.cards);
  if (!/^[a-f0-9]{32}$/.test(String(token || ''))) throw new Error('Only the phone that sent this card can remove it.');
  CaptureStore.setHidden(sessionId, ctx.template, Number(cardId), true, String(token));
  return { removed: true };
}

function captureReadPhoto(sessionId, key, base64, mimeType) {
  const ctx = captureRequireKey_(sessionId, key);
  captureRequireStage_(ctx, CAPTURE_STAGE_WRITES_.photo);
  return CaptureAiService.readPhoto(ctx.template, String(base64 || ''), String(mimeType || ''));
}

function captureSaveVote(sessionId, key, input) {
  const ctx = captureRequireKey_(sessionId, key);
  captureRequireStage_(ctx, CAPTURE_STAGE_WRITES_.vote);
  if (!ctx.config.published) throw new Error('Voting opens when the facilitators publish the groups.');
  const vote = captureValidateVote_(ctx.template, ctx.config.published, input);
  CaptureStore.saveVote(sessionId, vote);
  return { saved: vote.choices.length };
}

function captureSaveTestDrive(sessionId, key, table, notes) {
  const ctx = captureRequireKey_(sessionId, key);
  captureRequireStage_(ctx, CAPTURE_STAGE_WRITES_.testDrive);
  const t = captureValidTable_(table, ctx.config.tables);
  const snap = CaptureStore.snapshot(sessionId, ctx.template);
  const a = ctx.config.published ? captureComputeResults_(ctx, snap).assignments.find(x => x.table === t) : null;
  const group = a && a.groupId ? { id: a.groupId, topic: a.topic } : null;
  CaptureStore.saveTestDrive(sessionId, ctx.template, t, group, captureValidateTestDrive_(ctx.template, notes));
  return { saved: true };
}

// ─── Wall (public, key required, no card text) ──────────────────────────────

function captureGetWall(sessionId, key) {
  const ctx = captureRequireKey_(sessionId, key);
  const t = ctx.template, c = ctx.config;
  const snap = CaptureStore.snapshot(sessionId, t);
  const live = snap.cards.filter(x => !x.hidden);
  const perTable = (list) => { const out = []; for (let i = 1; i <= c.tables; i++) out.push(list.filter(x => x.table === i).length); return out; };
  const byRole = (list) => { const o = { total: list.length }; t.roles.forEach(r => { o[r.code] = list.filter(x => x.role === r.code).length; }); return o; };
  const levels = {};
  t.level.options.forEach(o => { levels[o.code] = live.filter(x => x.level === o.code).length; });
  const signals = snap.signals.filter(x => !x.hidden);
  const flips = snap.flips.filter(x => !x.hidden);
  const wall = {
    title: c.title,
    stage: c.stage,
    template: { stages: t.stages, roles: t.roles, levelOptions: t.level.options.map(o => ({ code: o.code, label: o.label, route: o.route })),
      routes: t.routes, flipDots: t.flipDots, parent: { plural: t.parent.plural }, vote: { prompt: t.vote.prompt } },
    tables: c.tables,
    signals: { byRole: byRole(signals), perTable: perTable(signals) },
    flips: { total: flips.length, perTable: perTable(flips) },
    flipDots: byRole(snap.flipDots),
    cards: { total: live.length, perTable: perTable(live), levels: levels, byRole: byRole(live) },
    voters: captureVoterCounts_(t, snap.votes)
  };
  if (c.published && captureStageAtOrAfter_(t, c.stage, 'vote')) {
    wall.topics = c.published.map(g => ({ topic: g.topic, column: g.column, contested: g.contested, tableCount: g.tableCount }));
  }
  if (c.published && captureStageAtOrAfter_(t, c.stage, 'results')) {
    const r = captureComputeResults_(ctx, snap);
    wall.results = { columns: r.columns.map(col => ({ code: col.code, label: col.label, route: col.route,
      items: col.items.map(i => { const o = { topic: i.topic, total: i.total, rank: i.rank, contested: i.contested }; t.roles.forEach(x => { o[x.code] = i[x.code] || 0; }); return o; }) })),
      assignments: r.assignments };
  }
  if (c.stage === 'close') wall.surveyUrl = c.surveyUrl;
  return wall;
}

// ─── Board (facilitators only) ──────────────────────────────────────────────

function captureListSessions() {
  AuthService.requireUser();
  return SessionService.getAllSessions().reverse().map(s => ({ id: s.id, name: s.name, date: s.date }));
}

function captureListTemplates() {
  AuthService.requireUser();
  return Object.keys(CAPTURE_TEMPLATES).map(id => ({ id: id, name: CAPTURE_TEMPLATES[id].name }));
}

function captureEnable(sessionId, templateId, tables, title) {
  AuthService.requireUser();
  validateSessionId_(sessionId);
  CaptureStore.enable(sessionId, String(templateId), tables, title);
  return captureGetBoard(sessionId);
}

/** The facilitator context for a session: config, template and the cached rows. */
function captureBoardContext_(sessionId) {
  AuthService.requireUser();
  validateSessionId_(sessionId);
  const config = CaptureStore.getConfig(sessionId);
  if (!config) throw new Error('Turn on live capture for this session first.');
  const template = captureTemplate_(config.template);
  return { config: config, template: template };
}

function captureGetBoard(sessionId) {
  AuthService.requireUser();
  validateSessionId_(sessionId);
  const session = SessionService.getSession(sessionId);
  if (!session) throw new Error('Session not found.');
  const config = CaptureStore.getConfig(sessionId);
  if (!config) return { sessionId: sessionId, sessionName: session.name, enabled: false };
  const template = captureTemplate_(config.template);
  const ctx = { config: config, template: template };
  const snap = CaptureStore.snapshot(sessionId, template);
  const live = snap.cards.filter(c => !c.hidden);
  const normalized = captureNormalizeGroups_(snap.cards, snap.groups, template);
  const links = captureLinks_(sessionId, config);
  const dots = captureTallyFlipDots_(template, snap.flipDots);
  const published = config.published || null;
  return {
    sessionId: sessionId,
    sessionName: session.name,
    enabled: true,
    config: { title: config.title, tables: config.tables, stage: config.stage, tallyMode: config.tallyMode,
      surveyUrl: config.surveyUrl, publishedAt: config.publishedAt, paperDots: config.paperDots, assign: config.assign },
    template: capturePublicTemplate_(template),
    links: links.table ? links : null,
    signals: snap.signals,
    flips: snap.flips.map(f => Object.assign({}, f, { dots: dots[f.id] || {} })),
    cards: snap.cards.map(c => ({ id: c.id, table: c.table, level: c.level, role: c.role, flipId: c.flipId, source: c.source, hidden: c.hidden, submittedAt: c.submittedAt, fields: c.fields })),
    groups: captureOrderGroups_(template, live, normalized.groups),
    ungrouped: normalized.ungrouped,
    parking: captureParkingLot_(template, snap.cards).map(c => c.id),
    published: published,
    voters: captureVoterCounts_(template, snap.votes),
    tally: published ? captureTally_(template, published, snap.votes, config.paperDots, config.tallyMode) : {},
    results: published ? captureComputeResults_(ctx, snap) : null,
    testDrive: snap.testDrive
  };
}

function captureSetStage(sessionId, stage) {
  const ctx = captureBoardContext_(sessionId);
  if (captureStageIds_(ctx.template).indexOf(String(stage)) === -1) throw new Error('Unknown stage.');
  CaptureStore.updateConfig(sessionId, () => ({ stage: String(stage) }));
  return captureGetBoard(sessionId);
}

function captureSetHidden(sessionId, cardId, hidden) {
  const ctx = captureBoardContext_(sessionId);
  CaptureStore.setHidden(sessionId, ctx.template, Number(cardId), !!hidden);
  return captureGetBoard(sessionId);
}

function captureSetSignalHidden(sessionId, id, hidden) {
  captureBoardContext_(sessionId);
  CaptureStore.setSignalHidden(sessionId, Number(id), !!hidden);
  return captureGetBoard(sessionId);
}

function captureSetFlipHidden(sessionId, id, hidden) {
  const ctx = captureBoardContext_(sessionId);
  CaptureStore.setFlipFlags(sessionId, ctx.template, null, Number(id), { hidden: !!hidden });
  return captureGetBoard(sessionId);
}

function captureSuggestGroups(sessionId) {
  const ctx = captureBoardContext_(sessionId);
  const groups = CaptureAiService.proposeGroups(ctx.template, CaptureStore.snapshot(sessionId, ctx.template).cards);
  CaptureStore.writeGroups(sessionId, groups);
  return captureGetBoard(sessionId);
}

function captureSaveGroups(sessionId, groups) {
  const ctx = captureBoardContext_(sessionId);
  const cards = CaptureStore.snapshot(sessionId, ctx.template).cards;
  CaptureStore.writeGroups(sessionId, captureNormalizeGroups_(cards, groups, ctx.template).groups);
  return captureGetBoard(sessionId);
}

/**
 * Freezes the current groups as what people vote on. Votes for groups that
 * still exist are kept; clearVotes starts the vote over.
 */
function capturePublish(sessionId, clearVotes) {
  const ctx = captureBoardContext_(sessionId);
  const snap = CaptureStore.snapshot(sessionId, ctx.template);
  const live = snap.cards.filter(c => !c.hidden);
  const groups = captureNormalizeGroups_(snap.cards, snap.groups, ctx.template).groups;
  if (!groups.length) throw new Error('Make at least one group before publishing.');
  const published = capturePublish_(ctx.template, live, groups);
  if (clearVotes) CaptureStore.clearVotes(sessionId);
  CaptureStore.updateConfig(sessionId, () => ({ published: published, publishedAt: new Date().toISOString() }));
  return captureGetBoard(sessionId);
}

/** Paper dot counts for one published group, by role (the analog fallback). */
function captureSetPaperDots(sessionId, groupId, counts) {
  const ctx = captureBoardContext_(sessionId);
  const ids = (ctx.config.published || []).map(g => g.id);
  if (ids.indexOf(String(groupId)) === -1) throw new Error('Publish the groups first.');
  const clean = {};
  ctx.template.roles.forEach(r => {
    const n = Math.round(Number(counts && counts[r.code]) || 0);
    if (n < 0 || n > 999) throw new Error('Dot counts must be between 0 and 999.');
    clean[r.code] = n;
  });
  CaptureStore.updateConfig(sessionId, c => { const p = Object.assign({}, c.paperDots); p[String(groupId)] = clean; return { paperDots: p }; });
  return captureGetBoard(sessionId);
}

function captureSetTallyMode(sessionId, mode) {
  captureBoardContext_(sessionId);
  if (['phone', 'paper', 'both'].indexOf(String(mode)) === -1) throw new Error('Choose phone, paper or both.');
  CaptureStore.updateConfig(sessionId, () => ({ tallyMode: String(mode) }));
  return captureGetBoard(sessionId);
}

/** Assigns a table its priority by hand; an empty groupId goes back to automatic. */
function captureSetAssignment(sessionId, table, groupId) {
  const ctx = captureBoardContext_(sessionId);
  const t = captureValidTable_(table, ctx.config.tables);
  const id = String(groupId || '');
  if (id && !(ctx.config.published || []).some(g => g.id === id && g.route === 'vote')) throw new Error('Choose one of the published priorities.');
  CaptureStore.updateConfig(sessionId, c => { const a = Object.assign({}, c.assign); if (id) a[t] = id; else delete a[t]; return { assign: a }; });
  return captureGetBoard(sessionId);
}

function captureSetSurveyUrl(sessionId, url) {
  captureBoardContext_(sessionId);
  const clean = String(url || '').trim();
  if (clean && !/^https:\/\/[^\s"'<>]+$/.test(clean)) throw new Error('Use a full https:// link.');
  CaptureStore.updateConfig(sessionId, () => ({ surveyUrl: clean }));
  return captureGetBoard(sessionId);
}

function captureMakePosters(sessionId) {
  const ctx = captureBoardContext_(sessionId);
  const snap = CaptureStore.snapshot(sessionId, ctx.template);
  const groups = captureNormalizeGroups_(snap.cards, snap.groups, ctx.template).groups;
  return { url: CapturePosterService.make(sessionId, ctx.template, ctx.config, snap.cards, groups) };
}

// ─── Table cards and Sheet menu (facilitators only) ─────────────────────────

/** What the printable table cards need: one QR link per table. */
function captureGetTableCardsData(sessionId) {
  AuthService.requireUser();
  validateSessionId_(sessionId);
  const session = SessionService.getSession(sessionId);
  if (!session) throw new Error('Session not found.');
  const config = CaptureStore.getConfig(sessionId);
  if (!config) throw new Error('Turn on live capture for this session first.');
  const template = captureTemplate_(config.template);
  const links = captureLinks_(sessionId, config);
  if (!links.table) throw new Error('Deploy the web app first, so the table link exists.');
  return { title: config.title, sessionName: session.name, tables: config.tables, noun: template.noun, tableLink: links.table };
}

/** Sheet menu: turn live capture on for the session selected in the Sessions tab. */
function captureMenuTurnOn() {
  AuthService.requireUser();
  const picked = getSelectedSession_();
  if (!picked.sessionId) return;
  const ui = SpreadsheetApp.getUi();
  const existing = CaptureStore.getConfig(picked.sessionId);
  const answer = ui.prompt('Live capture: ' + picked.session.name,
    'How many tables? (1–' + CAPTURE_DEFAULTS.MAX_TABLES + ')' + (existing ? '\nCurrently ' + existing.tables + '.' : ''),
    ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() !== ui.Button.OK) return;
  try {
    const title = existing ? existing.title : picked.session.name;
    CaptureStore.enable(picked.sessionId, existing ? existing.template : 'needCards', Number(answer.getResponseText()), title);
    captureMenuShowLinks_(picked.sessionId, 'Live capture is on');
  } catch (e) {
    ui.alert('Live capture was not turned on: ' + e.message);
  }
}

/** Sheet menu: the board, wall, table-card and table links for the selected session. */
function captureMenuLinks() {
  AuthService.requireUser();
  const picked = getSelectedSession_();
  if (!picked.sessionId) return;
  if (!CaptureStore.getConfig(picked.sessionId)) {
    SpreadsheetApp.getUi().alert('Live capture is not on for this session yet. Choose Live Capture > Turn on for selected session.');
    return;
  }
  captureMenuShowLinks_(picked.sessionId, 'Live capture links');
}

/** Sheet menu: build the gallery-walk posters for the selected session. */
function captureMenuPosters() {
  AuthService.requireUser();
  const picked = getSelectedSession_();
  if (!picked.sessionId) return;
  try {
    const res = captureMakePosters(picked.sessionId);
    captureMenuDialog_('Posters are ready', [{ label: 'Open the poster slides', url: res.url, note: 'Print from Slides: File > Print.' }]);
  } catch (e) {
    SpreadsheetApp.getUi().alert('Posters were not made: ' + e.message);
  }
}

/** Sheet menu: the board's session picker. */
function captureMenuBoard() {
  AuthService.requireUser();
  const base = captureBoardBase_();
  if (!base) { SpreadsheetApp.getUi().alert('Open the web app once in your browser, then try again.'); return; }
  captureMenuDialog_('Live board', [{ label: 'Open the live board', url: base + '?page=board', note: 'Pick the session there.' }]);
}

function captureMenuShowLinks_(sessionId, heading) {
  const links = captureLinks_(sessionId, CaptureStore.getConfig(sessionId));
  captureMenuDialog_(heading, [
    { label: 'Live board', url: links.board, note: 'Facilitators. Signed in with Google.' },
    { label: 'Printable table cards', url: links.tableCards, note: 'One page per table with a QR code that opens that table.' },
    { label: 'Projector wall', url: links.wall, note: 'Counts and topics only. No sign-in.' },
    { label: 'Table and voting link', url: links.table, note: 'Anyone in the room can use this. No sign-in.' }
  ]);
}

function captureMenuDialog_(heading, items) {
  const esc = s => String(s || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const rows = items.filter(i => i.url).map(i =>
    '<li style="margin:0 0 14px"><a href="' + esc(i.url) + '" target="_blank" rel="noopener" style="font-weight:600;color:#0B2B46">' +
    esc(i.label) + '</a><br><span style="color:#4F5D6B;font-size:13px">' + esc(i.note) + '</span></li>').join('');
  const html = HtmlService.createHtmlOutput(
    '<div style="font:15px/1.5 system-ui,sans-serif;color:#17212B;padding:4px 6px">' +
    (rows ? '<ul style="list-style:none;padding:0;margin:0">' + rows + '</ul>'
      : '<p>Open the web app once in your browser so its address is known, then try again.</p>') +
    '</div>').setWidth(460).setHeight(Math.min(120 + items.length * 64, 420));
  SpreadsheetApp.getUi().showModalDialog(html, heading);
}

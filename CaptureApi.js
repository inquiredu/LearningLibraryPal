/**
 * CaptureApi
 * Browser entry points for live capture.
 *
 * Table and wall calls are public (anyone with the link) but every one of them
 * requires the session's table key and returns only what that screen needs.
 * Board calls require an authorized facilitator, through AuthService, before
 * anything is read or written.
 *
 * Every change names who made it (a table's device, or a facilitator's
 * account) for the audit trail. Stages show the room where it is; they don't
 * lock anything. The one rule is that voting needs published groups.
 */

// ─── Pages ──────────────────────────────────────────────────────────────────

// keyed: the page's links carry the table key (public pages); the others are
// facilitator pages that doGet only serves to authorized users.
const CAPTURE_PAGES_ = {
  capture: { file: 'Capture', title: 'Live capture', keyed: true },
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
  // A table card's QR code names its table, so the device skips the table picker.
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

/** Names a device in the audit trail by its table and the start of its random id. */
function captureAsDevice_(ctx, table, device) {
  const t = Number(table) >= 1 ? 'Table ' + Number(table) : 'No table';
  const d = /^[a-f0-9]{16,40}$/.test(String(device || '')) ? String(device).slice(0, 8) : 'unknown';
  CaptureStore.as(t + ' · device ' + d, ctx.config.stage);
}

/** What devices and the wall may know about the template. */
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

function captureTableGroup_(ctx, snap, table) {
  const a = ctx.config.published ? captureComputeResults_(ctx, snap).assignments.find(x => x.table === table) : null;
  return a && a.groupId ? { id: a.groupId, topic: a.topic } : null;
}

// ─── Devices (public, key required) ─────────────────────────────────────────

/**
 * Everything a device needs, in one call. Every step's lists come back, so a
 * person can still add to an earlier step after the room has moved on.
 * table: the device's table number, or 0 before it picks one.
 * voter: the device's own random id, so it sees its own dots, votes and notes.
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
    aiPhotos: CaptureAiService.enabled(),
    template: capturePublicTemplate_(t)
  };
  if (tableNo) {
    const dots = captureTallyFlipDots_(t, snap.flipDots, c.paperFlipDots);
    const assignment = captureStageAtOrAfter_(t, c.stage, 'results') && c.published ? captureTableGroup_(ctx, snap, tableNo) : null;
    const notes = snap.testDrive.filter(n => n.table === tableNo);
    const mine = me ? notes.find(n => n.device === me) : null;
    state.table = {
      number: tableNo,
      flips: snap.flips.filter(f => f.table === tableNo && !f.hidden).map(f => ({ id: f.id, text: f.text, top: f.top, dots: dots[f.id] || {} })),
      cards: snap.cards.filter(x => x.table === tableNo && !x.hidden).map(x => ({ id: x.id, text: x.fields[primary.key], level: x.level, role: x.role, flipId: x.flipId })),
      signals: snap.signals.filter(x => x.table === tableNo && !x.hidden).map(x => ({ id: x.id, text: x.text, role: x.role })),
      assignment: assignment,
      testDrive: { mine: mine ? mine.notes : null, others: notes.filter(n => n !== mine).map(n => n.notes) }
    };
  }
  state.gallery = snap.flips.filter(f => !f.hidden).map(f => ({ id: f.id, table: f.table, text: f.text }));
  state.myDots = me ? snap.flipDots.filter(d => d.voter === me).map(d => ({ flipId: d.flipId, color: d.color })) : [];
  if (c.published) {
    state.ballot = c.published.map(g => ({ id: g.id, topic: g.topic, column: g.column, contested: g.contested, tableCount: g.tableCount }));
    const mine = me ? snap.votes.find(v => v.voter === me) : null;
    state.myVote = mine ? { role: mine.role, choices: mine.choices } : null;
  }
  if (c.published && captureStageAtOrAfter_(t, c.stage, 'results')) state.results = captureComputeResults_(ctx, snap);
  if (c.stage === 'close') state.surveyUrl = c.surveyUrl;
  return state;
}

/** input: { table, role, text, device, source } */
function captureAddSignal(sessionId, key, input) {
  const ctx = captureRequireKey_(sessionId, key);
  const signal = captureValidateSignal_(ctx.template, input, ctx.config.tables);
  signal.source = input && input.source === 'voice' ? 'voice' : 'typed';
  captureAsDevice_(ctx, signal.table, input && input.device);
  return CaptureStore.addSignal(sessionId, signal);
}

function captureRemoveSignal(sessionId, key, id, token, table, device) {
  const ctx = captureRequireKey_(sessionId, key);
  if (!/^[a-f0-9]{32}$/.test(String(token || ''))) throw new Error('Only the device that sent this can remove it.');
  captureAsDevice_(ctx, table, device);
  CaptureStore.setSignalHidden(sessionId, Number(id), true, String(token));
  return { removed: true };
}

/** Adds a table's flip statement (id 0) or edits one of its own. */
function captureSaveFlip(sessionId, key, table, id, text, device) {
  const ctx = captureRequireKey_(sessionId, key);
  const t = captureValidTable_(table, ctx.config.tables);
  captureAsDevice_(ctx, t, device);
  return CaptureStore.saveFlip(sessionId, ctx.template, t, Number(id) || 0, captureValidateFlipText_(ctx.template, text));
}

/** Hides a statement. Cards already under it keep its words. */
function captureRemoveFlip(sessionId, key, table, id, device) {
  const ctx = captureRequireKey_(sessionId, key);
  const t = captureValidTable_(table, ctx.config.tables);
  captureAsDevice_(ctx, t, device);
  CaptureStore.setFlipFlags(sessionId, ctx.template, t, Number(id), { hidden: true });
  return { removed: true };
}

function captureSetFlipTop(sessionId, key, table, id, top, device) {
  const ctx = captureRequireKey_(sessionId, key);
  const t = captureValidTable_(table, ctx.config.tables);
  captureAsDevice_(ctx, t, device);
  CaptureStore.setFlipFlags(sessionId, ctx.template, t, Number(id), { top: !!top });
  return { top: !!top };
}

/** input: { voter, role, dots, table } */
function captureSaveFlipDots(sessionId, key, input) {
  const ctx = captureRequireKey_(sessionId, key);
  const snap = CaptureStore.snapshot(sessionId, ctx.template);
  const entry = captureValidateFlipDots_(ctx.template, snap.flips, input);
  captureAsDevice_(ctx, input && input.table, entry.voter);
  CaptureStore.saveFlipDots(sessionId, entry);
  return { saved: entry.dots.length };
}

/**
 * input: { table, flipId, fields, level, role, sources, device, readingEntry }
 * readingEntry is the audit entry of this device's photo reading, if any; the
 * photo link and the AI's words are taken from there, not from the device.
 */
function captureSubmitCard(sessionId, key, input) {
  const ctx = captureRequireKey_(sessionId, key);
  const snap = CaptureStore.snapshot(sessionId, ctx.template);
  const card = captureValidateCard_(ctx.template, input, ctx.config.tables, snap.flips);
  captureAsDevice_(ctx, card.table, input && input.device);
  const n = Number(input && input.readingEntry);
  if (Number.isInteger(n) && n > 0) {
    const reading = CaptureStore.auditEntry(sessionId, n);
    if (reading && String(reading.Action) === 'AI read a card photo') {
      const after = CaptureStore.json_(reading.After, {});
      card.aiReading = String((after.fields || {})[ctx.template.fields[0].key] || '');
      card.photo = String(reading.Photo || '');
    }
  }
  return CaptureStore.appendCard(sessionId, ctx.template, card);
}

function captureRemoveOwnCard(sessionId, key, cardId, token, table, device) {
  const ctx = captureRequireKey_(sessionId, key);
  if (!/^[a-f0-9]{32}$/.test(String(token || ''))) throw new Error('Only the device that sent this card can remove it.');
  captureAsDevice_(ctx, table, device);
  CaptureStore.setHidden(sessionId, ctx.template, Number(cardId), true, String(token));
  return { removed: true };
}

/** Reads a card photo, keeps the photo and logs the reading; the device fills its form with it. */
function captureReadPhoto(sessionId, key, base64, mimeType, table, device) {
  const ctx = captureRequireKey_(sessionId, key);
  captureAsDevice_(ctx, table, device);
  const data = String(base64 || ''), mime = String(mimeType || '');
  const res = CaptureAiService.readPhoto(ctx.template, data, mime);
  let photo = '';
  try { photo = CapturePhotoService.save(sessionId, data, mime, 'Card photo, table ' + (Number(table) || '?')); } catch (e) { photo = ''; }
  const entry = CaptureStore.audit(sessionId, { action: 'AI read a card photo', item: 'card', after: res.reading, photo: photo,
    model: res.ai.model, tokens: res.ai.tokens, cost: res.ai.cost, detail: res.ai.raw });
  return Object.assign({ entry: entry }, res.reading);
}

/** input: { voter, role, choices, table } */
function captureSaveVote(sessionId, key, input) {
  const ctx = captureRequireKey_(sessionId, key);
  if (!ctx.config.published) throw new Error('Voting opens when the facilitators publish the groups.');
  const vote = captureValidateVote_(ctx.template, ctx.config.published, input);
  captureAsDevice_(ctx, input && input.table, vote.voter);
  CaptureStore.saveVote(sessionId, vote);
  return { saved: vote.choices.length };
}

/** Each device keeps its own notes; everyone at the table sees all of them. */
function captureSaveTestDrive(sessionId, key, table, notes, device) {
  const ctx = captureRequireKey_(sessionId, key);
  const t = captureValidTable_(table, ctx.config.tables);
  const d = captureValidToken_(device);
  captureAsDevice_(ctx, t, d);
  const snap = CaptureStore.snapshot(sessionId, ctx.template);
  CaptureStore.saveTestDrive(sessionId, ctx.template, t, d, captureTableGroup_(ctx, snap, t), captureValidateTestDrive_(ctx.template, notes));
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

function captureAsFacilitator_(stage) {
  CaptureStore.as(AuthService.email() || 'facilitator', stage);
}

function captureEnable(sessionId, templateId, tables, title) {
  AuthService.requireUser();
  validateSessionId_(sessionId);
  captureAsFacilitator_('');
  CaptureStore.enable(sessionId, String(templateId), tables, title);
  return captureGetBoard(sessionId);
}

/** The facilitator context for a session: config and template, with the actor set for the audit trail. */
function captureBoardContext_(sessionId) {
  AuthService.requireUser();
  validateSessionId_(sessionId);
  const config = CaptureStore.getConfig(sessionId);
  if (!config) throw new Error('Turn on live capture for this session first.');
  const template = captureTemplate_(config.template);
  captureAsFacilitator_(config.stage);
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
  const dots = captureTallyFlipDots_(template, snap.flipDots, config.paperFlipDots);
  const published = config.published || null;
  return {
    sessionId: sessionId,
    sessionName: session.name,
    enabled: true,
    sheetUrl: String(session.dbUrl || ''),
    config: { title: config.title, tables: config.tables, stage: config.stage, tallyMode: config.tallyMode,
      surveyUrl: config.surveyUrl, publishedAt: config.publishedAt, paperDots: config.paperDots, paperFlipDots: config.paperFlipDots, assign: config.assign },
    template: capturePublicTemplate_(template),
    paperModes: Object.keys(CAPTURE_PAPER_MODES_).map(k => ({ id: k, label: CAPTURE_PAPER_MODES_[k].label, table: CAPTURE_PAPER_MODES_[k].table })),
    ai: { enabled: CaptureAiService.enabled(), spentToday: CaptureAiService.spentToday(), budget: Number(CONFIG.CAPTURE_AI_DAILY_BUDGET_USD) || 0 },
    links: links.table ? links : null,
    signals: snap.signals,
    flips: snap.flips.map(f => Object.assign({}, f, { dots: dots[f.id] || {} })),
    cards: snap.cards.map(c => ({ id: c.id, table: c.table, level: c.level, role: c.role, flipId: c.flipId, source: c.source, hidden: c.hidden,
      submittedAt: c.submittedAt, fields: c.fields, aiReading: c.aiReading, photo: c.photo })),
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
  CaptureStore.updateConfig(sessionId, () => ({ stage: String(stage) }),
    { action: 'Stage moved', item: 'stage', before: c => c.stage, after: n => n.stage });
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
  const res = CaptureAiService.proposeGroups(ctx.template, CaptureStore.snapshot(sessionId, ctx.template).cards);
  CaptureStore.writeGroups(sessionId, res.groups, { action: 'AI suggested groups', model: res.ai.model, tokens: res.ai.tokens, cost: res.ai.cost, detail: res.ai.raw });
  return captureGetBoard(sessionId);
}

function captureSaveGroups(sessionId, groups) {
  const ctx = captureBoardContext_(sessionId);
  const cards = CaptureStore.snapshot(sessionId, ctx.template).cards;
  CaptureStore.writeGroups(sessionId, captureNormalizeGroups_(cards, groups, ctx.template).groups, { action: 'Groups edited' });
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
  const brief = list => (list || []).map(g => ({ id: g.id, topic: g.topic, column: g.column, contested: g.contested, cards: g.cardIds }));
  CaptureStore.updateConfig(sessionId, () => ({ published: published, publishedAt: new Date().toISOString() }),
    { action: 'Published for voting', item: 'groups', ids: published.length + ' groups', before: c => brief(c.published), after: n => brief(n.published) });
  return captureGetBoard(sessionId);
}

/** Paper dot counts for one published group, by role (the analog count, typed in). */
function captureSetPaperDots(sessionId, groupId, counts) {
  const ctx = captureBoardContext_(sessionId);
  const ids = (ctx.config.published || []).map(g => g.id);
  if (ids.indexOf(String(groupId)) === -1) throw new Error('Publish the groups first.');
  const clean = {};
  ctx.template.roles.forEach(r => { clean[r.code] = captureCount_(counts && counts[r.code]); });
  CaptureStore.updateConfig(sessionId, c => { const p = Object.assign({}, c.paperDots); p[String(groupId)] = clean; return { paperDots: p }; },
    { action: 'Paper vote dots typed in', item: 'votes', ids: [String(groupId)], before: c => c.paperDots[String(groupId)] || '', after: () => clean });
  return captureGetBoard(sessionId);
}

function captureSetTallyMode(sessionId, mode) {
  captureBoardContext_(sessionId);
  if (['phone', 'paper', 'both'].indexOf(String(mode)) === -1) throw new Error('Choose devices, paper or both.');
  CaptureStore.updateConfig(sessionId, () => ({ tallyMode: String(mode) }),
    { action: 'Vote count source changed', item: 'votes', before: c => c.tallyMode, after: n => n.tallyMode });
  return captureGetBoard(sessionId);
}

/** Assigns a table its priority by hand; an empty groupId goes back to automatic. */
function captureSetAssignment(sessionId, table, groupId) {
  const ctx = captureBoardContext_(sessionId);
  const t = captureValidTable_(table, ctx.config.tables);
  const id = String(groupId || '');
  if (id && !(ctx.config.published || []).some(g => g.id === id && g.route === 'vote')) throw new Error('Choose one of the published priorities.');
  CaptureStore.updateConfig(sessionId, c => { const a = Object.assign({}, c.assign); if (id) a[t] = id; else delete a[t]; return { assign: a }; },
    { action: 'Table priority set by hand', item: 'assignment', ids: ['table ' + t], before: c => c.assign[t] || 'automatic', after: () => id || 'automatic' });
  return captureGetBoard(sessionId);
}

function captureSetSurveyUrl(sessionId, url) {
  captureBoardContext_(sessionId);
  const clean = String(url || '').trim();
  if (clean && !/^https:\/\/[^\s"'<>]+$/.test(clean)) throw new Error('Use a full https:// link.');
  CaptureStore.updateConfig(sessionId, () => ({ surveyUrl: clean }),
    { action: 'Survey link set', item: 'settings', before: c => c.surveyUrl, after: n => n.surveyUrl });
  return captureGetBoard(sessionId);
}

function captureMakePosters(sessionId) {
  const ctx = captureBoardContext_(sessionId);
  const snap = CaptureStore.snapshot(sessionId, ctx.template);
  const groups = captureNormalizeGroups_(snap.cards, snap.groups, ctx.template).groups;
  const url = CapturePosterService.make(sessionId, ctx.template, ctx.config, snap.cards, groups);
  CaptureStore.audit(sessionId, { action: 'Posters made', item: 'posters', after: url });
  return { url: url };
}

// ─── From paper (facilitators) ──────────────────────────────────────────────

/**
 * Reads a photo of paper work with AI and returns rows for people to check.
 * Nothing is added yet: the photo is kept and the reading is logged, and
 * captureConfirmPaper adds what people confirm.
 * hints: { student, adult } — how students' and adults' work was marked.
 */
function captureReadPaper(sessionId, mode, table, base64, mimeType, hints) {
  const ctx = captureBoardContext_(sessionId);
  capturePaperMode_(mode);
  const t = CAPTURE_PAPER_MODES_[mode].table ? captureValidTable_(table, ctx.config.tables) : 0;
  const snap = CaptureStore.snapshot(sessionId, ctx.template);
  const data = String(base64 || ''), mime = String(mimeType || '');
  const readCtx = { table: t, flips: snap.flips, published: ctx.config.published || [] };
  const res = CaptureAiService.readPaper(ctx.template, mode, data, mime, hints, readCtx);
  const reading = captureCleanPaperReading_(ctx.template, mode, res.raw, readCtx);
  let photo = '';
  try { photo = CapturePhotoService.save(sessionId, data, mime, CAPTURE_PAPER_MODES_[mode].label + (t ? ', table ' + t : '')); } catch (e) { photo = ''; }
  const entry = CaptureStore.audit(sessionId, { action: 'AI read paper: ' + CAPTURE_PAPER_MODES_[mode].label, item: mode, ids: t ? ['table ' + t] : '',
    after: reading.rows, photo: photo, model: res.ai.model, tokens: res.ai.tokens, cost: res.ai.cost, detail: res.ai.raw });
  return { entry: entry, photo: photo, rows: reading.rows, confidence: reading.confidence, note: reading.note, cost: res.ai.cost };
}

/**
 * Adds the rows people confirmed, typed by hand or checked against an AI
 * reading (readingEntry, from captureReadPaper). The audit entry records
 * the rows and how they differ from the reading.
 */
function captureConfirmPaper(sessionId, mode, rows, readingEntry) {
  const ctx = captureBoardContext_(sessionId);
  capturePaperMode_(mode);
  const snap = CaptureStore.snapshot(sessionId, ctx.template);
  const clean = captureValidatePaperRows_(ctx.template, mode, rows, { tables: ctx.config.tables, flips: snap.flips, published: ctx.config.published || [] });
  let reading = null, aiRows = [];
  const n = Number(readingEntry);
  if (Number.isInteger(n) && n > 0) {
    reading = CaptureStore.auditEntry(sessionId, n);
    if (!reading || String(reading.Action).indexOf('AI read paper') !== 0) throw new Error('That reading was not found. Read the photo again.');
    aiRows = CaptureStore.json_(reading.After, []);
  }
  if (mode === 'cards') clean.forEach(r => { const a = r.ai !== null ? aiRows[r.ai] : null; r.aiReading = a ? a.need : ''; });
  if (mode === 'testdrive') clean.forEach(r => { r.group = captureTableGroup_(ctx, snap, r.table); });
  const res = CaptureStore.addFromPaper(sessionId, ctx.template, mode, clean, {
    photo: reading ? String(reading.Photo || '') : '', readingEntry: reading ? n : 0, diff: captureDiffRows_(aiRows, clean)
  });
  const board = captureGetBoard(sessionId);
  board.added = { count: clean.length, entry: res.entry };
  return board;
}

// ─── Audit and results (facilitators) ───────────────────────────────────────

function captureGetAudit(sessionId) {
  captureBoardContext_(sessionId);
  const tail = CaptureStore.auditTail(sessionId, 50);
  const session = SessionService.getSession(sessionId);
  return { total: tail.total, rows: tail.rows, sheetUrl: String(session && session.dbUrl || ''),
    ai: { spentToday: CaptureAiService.spentToday(), budget: Number(CONFIG.CAPTURE_AI_DAILY_BUDGET_USD) || 0 } };
}

/** Makes the results document from the record and returns its link. */
function captureMakeReport(sessionId) {
  const ctx = captureBoardContext_(sessionId);
  const session = SessionService.getSession(sessionId);
  const snap = CaptureStore.snapshot(sessionId, ctx.template);
  const all = CaptureStore.auditTail(sessionId, 100000);
  const ai = { model: '', calls: 0, cost: 0, readings: 0, confirmed: 0, edited: 0 };
  all.rows.forEach(r => {
    if (r.Model) { ai.calls++; ai.model = ai.model || String(r.Model); ai.cost += Number(r['Cost (USD)']) || 0; }
    const action = String(r.Action), detail = String(r.Detail || '');
    if (action.indexOf('AI read') === 0) ai.readings++;
    if (action.indexOf('Added from paper') === 0 && detail.indexOf('From AI reading') === 0) {
      ai.confirmed++;
      if (!/ 0 edited, 0 added by hand/.test(detail)) ai.edited++;
    }
    if (action === 'Card sent' && /AI read/.test(detail)) { ai.confirmed++; if (/Edited/.test(detail)) ai.edited++; }
  });
  const report = captureReport_(ctx.template, {
    title: ctx.config.title, sessionName: session ? session.name : '',
    madeAt: Utilities.formatDate(new Date(), CONFIG.DISPLAY_TIMEZONE || 'America/Chicago', 'MMMM d, yyyy h:mm a'),
    tallyMode: ctx.config.tallyMode, snap: snap, published: ctx.config.published,
    results: ctx.config.published ? captureComputeResults_(ctx, snap) : null,
    paperFlipDots: ctx.config.paperFlipDots, ai: ai, sheetUrl: session ? session.dbUrl : '', auditEntries: all.total
  });
  const url = CaptureReportService.make(sessionId, report);
  CaptureStore.audit(sessionId, { action: 'Results document made', item: 'report', after: url });
  return { url: url };
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
    captureAsFacilitator_('');
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
    { label: 'Table and voting link', url: links.table, note: 'For phones and laptops. Anyone in the room can use it. No sign-in.' }
  ]);
}

function captureMenuDialog_(heading, items) {
  const esc = s => String(s || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const rows = items.filter(i => i.url).map(i =>
    '<li style="margin:0 0 14px"><a href="' + esc(i.url) + '" target="_blank" rel="noopener" style="font-weight:600;color:#003865">' +
    esc(i.label) + '</a><br><span style="color:#4F5D6B;font-size:13px">' + esc(i.note) + '</span></li>').join('');
  const html = HtmlService.createHtmlOutput(
    '<div style="font:15px/1.5 system-ui,sans-serif;color:#17212B;padding:4px 6px">' +
    (rows ? '<ul style="list-style:none;padding:0;margin:0">' + rows + '</ul>'
      : '<p>Open the web app once in your browser so its address is known, then try again.</p>') +
    '</div>').setWidth(460).setHeight(Math.min(120 + items.length * 64, 420));
  SpreadsheetApp.getUi().showModalDialog(html, heading);
}

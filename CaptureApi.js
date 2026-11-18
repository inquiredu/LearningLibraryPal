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
// facilitator: the same board and table cards, opened with a session's
// facilitator link instead of a Google sign-in.
const CAPTURE_PAGES_ = {
  capture: { file: 'Capture', title: 'Live capture', keyed: true },
  wall: { file: 'CaptureWall', title: 'Live wall', keyed: true },
  board: { file: 'CaptureBoard', title: 'Live board', keyed: false },
  tablecards: { file: 'CaptureTableCards', title: 'Table cards', keyed: false },
  run: { file: 'CaptureBoard', title: 'Live board', keyed: false, facilitator: true },
  runcards: { file: 'CaptureTableCards', title: 'Table cards', keyed: false, facilitator: true }
};

/** Called from doGet for the live-capture pages. */
function captureRoute_(page, e) {
  const spec = CAPTURE_PAGES_[page];
  const params = (e && e.parameter) || {};
  let sessionId = params.session ? validateSessionId_(String(params.session)) : '';
  // A facilitator link carries its key; the page sends it back with every call.
  if (spec.facilitator) sessionId = captureFacilitatorAuth_(sessionId + '~' + String(params.f || '')) + '~' + String(params.f);
  const key = spec.keyed ? captureValidateKeyFormat_(String(params.k || '')) : '';
  // A table card's QR code names its table, so the device skips the table picker.
  const table = page === 'capture' && /^[1-9][0-9]?$/.test(String(params.t || '')) ? String(params.t) : '';
  // The dashboard links straight to a board tab (After → Record & results).
  const tab = (page === 'board' || page === 'run') && /^(signals|flips|cards|results|testdrive|record|settings)$/.test(String(params.tab || '')) ? String(params.tab) : '';
  // Each page is self-contained (scripts/sync-capture-shared.cjs copies the shared
  // styles and helpers into it); only the session, key and table are filled in here.
  let html = HtmlService.createHtmlOutputFromFile(spec.file).getContent()
    .replace('__SESSION_ID__', sessionId)
    .replace('__CAPTURE_KEY__', key)
    .replace('__TABLE__', table)
    .replace('__TAB__', tab);
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

/**
 * A session's facilitator link: one address that opens its board with no
 * sign-in. Google does not always tell a script who a signed-in visitor is, so
 * a list of facilitator accounts can't be relied on to let someone else run a
 * room. The owner makes this link, hands it over, and can replace it or turn
 * it off. It opens this one session's board and table cards and nothing else:
 * not the dashboard, not other sessions, not setup.
 */
const CAPTURE_VIA_LINK_ = {}; // sessions this request opened with a valid facilitator link

/**
 * Who may act as a facilitator for this call. `arg` is the session id, or the
 * session id + "~" + facilitator key from a page opened with the link.
 * Returns the plain session id, or throws.
 */
function captureFacilitatorAuth_(arg) {
  const parts = String(arg || '').split('~');
  const sessionId = validateSessionId_(parts[0]);
  if (parts.length > 1) {
    const stale = 'This facilitator link is not active. Ask whoever set up the session for the current one.';
    if (!/^[a-f0-9]{32}$/.test(parts[1])) throw new Error(stale);
    const config = CaptureStore.getConfig(sessionId);
    if (!config || !config.facilitatorKey || config.facilitatorKey !== parts[1]) throw new Error(stale);
    CAPTURE_VIA_LINK_[sessionId] = true;
    return sessionId;
  }
  if (!CAPTURE_VIA_LINK_[sessionId]) AuthService.requireUser();
  return sessionId;
}

/** Every link a facilitator hands out or opens for one session. */
function captureLinks_(sessionId, config) {
  const pub = capturePublicBase_();
  const board = captureBoardBase_();
  const s = '?session=' + encodeURIComponent(sessionId);
  const f = pub && config.facilitatorKey ? '&session=' + encodeURIComponent(sessionId) + '&f=' + config.facilitatorKey : '';
  const links = {
    table: pub ? pub + s + '&k=' + config.key + '&page=capture' : '',
    wall: pub ? pub + s + '&k=' + config.key + '&page=wall' : '',
    board: board ? board + '?page=board&session=' + encodeURIComponent(sessionId) : '',
    tableCards: board ? board + '?page=tablecards&session=' + encodeURIComponent(sessionId) : '',
    dashboard: board || '',
    facilitator: f ? pub + '?page=run' + f : '',
    short: config.shortUrl || ''
  };
  // Someone who came in by the facilitator link gets links that work without signing in.
  if (CAPTURE_VIA_LINK_[sessionId] && f) { links.board = links.facilitator; links.tableCards = pub + '?page=runcards' + f; links.dashboard = ''; }
  return links;
}

/**
 * What the dashboard shows about a session's live capture. Off: the board
 * address, where the board offers to turn it on. On: the stage the room is
 * at and every link a facilitator opens or hands out. Never throws, so one
 * session's missing spreadsheet can't stop the dashboard from loading.
 */
function captureDashboardInfo_(sessionId) {
  const base = captureBoardBase_();
  const board = base ? base + '?page=board&session=' + encodeURIComponent(sessionId) : '';
  let config = null;
  try { config = CaptureStore.peekConfig(sessionId); } catch (e) { config = null; }
  const template = config && CAPTURE_TEMPLATES[config.template] ? captureTemplateFor_(config) : null;
  if (!config || !template) return { on: false, board: board };
  const stages = template.stages;
  const at = Math.max(0, stages.findIndex(s => s.id === config.stage));
  const links = captureLinks_(sessionId, config);
  return {
    on: true,
    template: template.name,
    tables: config.tables,
    stage: stages[at].id,
    stageLabel: stages[at].label,
    stageNumber: at + 1,
    stageCount: stages.length,
    closed: stages[at].id === stages[stages.length - 1].id,
    board: links.board,
    record: links.board ? links.board + '&tab=record' : '',
    wall: links.wall,
    table: links.table,
    tableCards: links.tableCards
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
  return { config: config, template: captureTemplateFor_(config) };
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
    flow: template.flow || 'full',
    flows: template.flows ? Object.keys(template.flows).map(k => ({ id: k, label: template.flows[k].label, summary: template.flows[k].summary })) : [],
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

/** What people vote on: the published groups guidance can address, never the parking lot. */
function captureVotable_(published) {
  return (published || []).filter(g => g.route !== 'parking');
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

/** A snapshot that knows every flip statement named; read fresh if a cached one doesn't. */
function captureSnapshotWith_(sessionId, template, flipIds) {
  const snap = CaptureStore.snapshot(sessionId, template);
  const known = new Set(snap.flips.map(f => f.id));
  return flipIds.every(id => !id || known.has(id)) ? snap : CaptureStore.snapshot(sessionId, template, true);
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
 * fresh: true right after this device changed something, so it sees its change.
 */
function captureGetPhoneState(sessionId, key, table, voter, fresh) {
  const ctx = captureRequireKey_(sessionId, key);
  const t = ctx.template, c = ctx.config;
  const snap = CaptureStore.snapshot(sessionId, t, !!fresh);
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
    const assignment = t.flow !== 'cards' && captureStageAtOrAfter_(t, c.stage, 'results') && c.published ? captureTableGroup_(ctx, snap, tableNo) : null;
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
  // With need cards only, people vote with dots on the posters, so devices get no ballot.
  if (c.published && t.flow !== 'cards') {
    state.ballot = captureVotable_(c.published).map(g => ({ id: g.id, topic: g.topic, column: g.column, contested: g.contested, tableCount: g.tableCount }));
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
  const ids = (input && Array.isArray(input.dots) ? input.dots : []).map(d => Number(d && d.flipId));
  const snap = captureSnapshotWith_(sessionId, ctx.template, ids);
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
  const snap = captureSnapshotWith_(sessionId, ctx.template, [Number(input && input.flipId) || 0]);
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
  const vote = captureValidateVote_(ctx.template, captureVotable_(ctx.config.published), input);
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
    template: { flow: t.flow || 'full', stages: t.stages, roles: t.roles, levelOptions: t.level.options.map(o => ({ code: o.code, label: o.label, route: o.route })),
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
  // The address to type, for anyone joining without a camera; it is the table link the room already has.
  if (c.shortUrl) wall.join = captureTypeable_(c.shortUrl);
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

function captureAsFacilitator_(stage, sessionId) {
  CaptureStore.as(sessionId && CAPTURE_VIA_LINK_[sessionId] ? 'Facilitator link' : (AuthService.email() || 'facilitator'), stage);
}

function captureEnable(sessionId, templateId, tables, title) {
  AuthService.requireUser();
  validateSessionId_(sessionId);
  captureAsFacilitator_('');
  CaptureStore.enable(sessionId, String(templateId), tables, title);
  return captureGetBoard(sessionId, true);
}

/** The facilitator context for a session: config and template, with the actor set for the audit trail. */
function captureBoardContext_(sessionId) {
  sessionId = captureFacilitatorAuth_(sessionId);
  const config = CaptureStore.getConfig(sessionId);
  if (!config) throw new Error('Turn on live capture for this session first.');
  const template = captureTemplateFor_(config);
  captureAsFacilitator_(config.stage, sessionId);
  return { config: config, template: template };
}

/** The board's view. fresh: true after the board changed something. */
function captureGetBoard(sessionId, fresh) {
  sessionId = captureFacilitatorAuth_(sessionId);
  const session = CaptureStore.sessionInfo(sessionId);
  if (!session) throw new Error('Session not found.');
  const config = CaptureStore.getConfig(sessionId);
  if (!config) return { sessionId: sessionId, sessionName: session.name, enabled: false };
  const template = captureTemplateFor_(config);
  const ctx = { config: config, template: template };
  const snap = CaptureStore.snapshot(sessionId, template, !!fresh);
  const live = snap.cards.filter(c => !c.hidden);
  const normalized = captureNormalizeGroups_(snap.cards, snap.groups, template);
  const links = captureLinks_(sessionId, config);
  const dots = captureTallyFlipDots_(template, snap.flipDots, config.paperFlipDots);
  const published = config.published || null;
  return {
    sessionId: sessionId,
    sessionName: session.name,
    enabled: true,
    viaLink: !!CAPTURE_VIA_LINK_[sessionId],
    sheetUrl: String(session.dbUrl || ''),
    config: { title: config.title, tables: config.tables, flow: config.flow === 'cards' ? 'cards' : 'full', stage: config.stage, tallyMode: config.tallyMode,
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
  sessionId = captureFacilitatorAuth_(sessionId);
  const ctx = captureBoardContext_(sessionId);
  if (captureStageIds_(ctx.template).indexOf(String(stage)) === -1) throw new Error('Unknown stage.');
  CaptureStore.updateConfig(sessionId, () => ({ stage: String(stage) }),
    { action: 'Stage moved', item: 'stage', before: c => c.stage, after: n => n.stage });
  return captureGetBoard(sessionId, true);
}

function captureSetHidden(sessionId, cardId, hidden) {
  sessionId = captureFacilitatorAuth_(sessionId);
  const ctx = captureBoardContext_(sessionId);
  CaptureStore.setHidden(sessionId, ctx.template, Number(cardId), !!hidden);
  return captureGetBoard(sessionId, true);
}

function captureSetSignalHidden(sessionId, id, hidden) {
  sessionId = captureFacilitatorAuth_(sessionId);
  captureBoardContext_(sessionId);
  CaptureStore.setSignalHidden(sessionId, Number(id), !!hidden);
  return captureGetBoard(sessionId, true);
}

function captureSetFlipHidden(sessionId, id, hidden) {
  sessionId = captureFacilitatorAuth_(sessionId);
  const ctx = captureBoardContext_(sessionId);
  CaptureStore.setFlipFlags(sessionId, ctx.template, null, Number(id), { hidden: !!hidden });
  return captureGetBoard(sessionId, true);
}

function captureSuggestGroups(sessionId) {
  sessionId = captureFacilitatorAuth_(sessionId);
  const ctx = captureBoardContext_(sessionId);
  const res = CaptureAiService.proposeGroups(ctx.template, CaptureStore.snapshot(sessionId, ctx.template, true).cards);
  CaptureStore.writeGroups(sessionId, res.groups, { action: 'AI suggested groups', model: res.ai.model, tokens: res.ai.tokens, cost: res.ai.cost, detail: res.ai.raw });
  return captureGetBoard(sessionId, true);
}

function captureSaveGroups(sessionId, groups) {
  sessionId = captureFacilitatorAuth_(sessionId);
  const ctx = captureBoardContext_(sessionId);
  const cards = CaptureStore.snapshot(sessionId, ctx.template, true).cards;
  CaptureStore.writeGroups(sessionId, captureNormalizeGroups_(cards, groups, ctx.template).groups, { action: 'Groups edited' });
  return captureGetBoard(sessionId, true);
}

/**
 * Freezes the current groups as what people vote on. Votes for groups that
 * still exist are kept; clearVotes starts the vote over.
 */
function capturePublish(sessionId, clearVotes) {
  sessionId = captureFacilitatorAuth_(sessionId);
  const ctx = captureBoardContext_(sessionId);
  const snap = CaptureStore.snapshot(sessionId, ctx.template, true);
  const live = snap.cards.filter(c => !c.hidden);
  const groups = captureNormalizeGroups_(snap.cards, snap.groups, ctx.template).groups;
  if (!groups.length) throw new Error('Make at least one group before publishing.');
  const published = capturePublish_(ctx.template, live, groups);
  if (clearVotes) CaptureStore.clearVotes(sessionId);
  const brief = list => (list || []).map(g => ({ id: g.id, topic: g.topic, column: g.column, contested: g.contested, cards: g.cardIds }));
  CaptureStore.updateConfig(sessionId, () => ({ published: published, publishedAt: new Date().toISOString() }),
    { action: 'Published for voting', item: 'groups', ids: published.length + ' groups', before: c => brief(c.published), after: n => brief(n.published) });
  return captureGetBoard(sessionId, true);
}

/** Paper dot counts for one published group, by role (the analog count, typed in). */
function captureSetPaperDots(sessionId, groupId, counts) {
  sessionId = captureFacilitatorAuth_(sessionId);
  const ctx = captureBoardContext_(sessionId);
  const ids = (ctx.config.published || []).map(g => g.id);
  if (ids.indexOf(String(groupId)) === -1) throw new Error('Publish the groups first.');
  const clean = {};
  ctx.template.roles.forEach(r => { clean[r.code] = captureCount_(counts && counts[r.code]); });
  // Dots nobody could mark as a student's or an adult's; an older board that doesn't send them leaves them as they were.
  const had = (ctx.config.paperDots || {})[String(groupId)] || {};
  clean.unmarked = captureCount_(counts && counts.unmarked !== undefined ? counts.unmarked : had.unmarked);
  CaptureStore.updateConfig(sessionId, c => { const p = Object.assign({}, c.paperDots); p[String(groupId)] = clean; return { paperDots: p }; },
    { action: 'Paper vote dots typed in', item: 'votes', ids: [String(groupId)], before: c => c.paperDots[String(groupId)] || '', after: () => clean });
  return captureGetBoard(sessionId, true);
}

function captureSetTallyMode(sessionId, mode) {
  sessionId = captureFacilitatorAuth_(sessionId);
  captureBoardContext_(sessionId);
  if (['phone', 'paper', 'both'].indexOf(String(mode)) === -1) throw new Error('Choose devices, paper or both.');
  CaptureStore.updateConfig(sessionId, () => ({ tallyMode: String(mode) }),
    { action: 'Vote count source changed', item: 'votes', before: c => c.tallyMode, after: n => n.tallyMode });
  return captureGetBoard(sessionId, true);
}

/** Assigns a table its priority by hand; an empty groupId goes back to automatic. */
function captureSetAssignment(sessionId, table, groupId) {
  sessionId = captureFacilitatorAuth_(sessionId);
  const ctx = captureBoardContext_(sessionId);
  const t = captureValidTable_(table, ctx.config.tables);
  const id = String(groupId || '');
  if (id && !(ctx.config.published || []).some(g => g.id === id && g.route === 'vote')) throw new Error('Choose one of the published priorities.');
  CaptureStore.updateConfig(sessionId, c => { const a = Object.assign({}, c.assign); if (id) a[t] = id; else delete a[t]; return { assign: a }; },
    { action: 'Table priority set by hand', item: 'assignment', ids: ['table ' + t], before: c => c.assign[t] || 'automatic', after: () => id || 'automatic' });
  return captureGetBoard(sessionId, true);
}

/**
 * Which steps the room works through: 'cards' (need cards, grouping, gallery
 * walk, read-out) or 'full' (the whole agenda). Nothing already sent is
 * touched; a stage the new flow doesn't have becomes its first one.
 */
function captureSetFlow(sessionId, flow) {
  sessionId = captureFacilitatorAuth_(sessionId);
  const ctx = captureBoardContext_(sessionId);
  if (flow !== 'cards' && flow !== 'full') throw new Error('Choose need cards only or the full agenda.');
  const stages = captureStageIds_(captureTemplateFor_({ template: ctx.config.template, flow: flow }));
  CaptureStore.updateConfig(sessionId, c => {
    const change = { flow: flow, stage: stages.indexOf(c.stage) !== -1 ? c.stage : stages[0] };
    // Need cards only counts the dots on the posters; the full agenda keeps whatever was chosen.
    if (flow === 'cards') change.tallyMode = 'paper';
    return change;
  }, { action: 'Steps changed', item: 'settings', before: c => c.flow || 'full', after: n => n.flow });
  return captureGetBoard(sessionId, true);
}

/**
 * Makes, replaces or turns off the session's facilitator link. Only someone
 * signed in as the owner or a listed facilitator can do this, never someone
 * who came in by the link itself. mode: 'new' | 'off'.
 */
function captureSetFacilitatorLink(sessionId, mode) {
  AuthService.requireUser();
  validateSessionId_(sessionId);
  if (mode !== 'new' && mode !== 'off') throw new Error('Choose to make a link or turn it off.');
  captureBoardContext_(sessionId);
  const key = mode === 'new' ? Utilities.getUuid().replace(/-/g, '') : '';
  // The audit trail says that the link changed and who changed it, never the key itself.
  CaptureStore.updateConfig(sessionId, () => ({ facilitatorKey: key }),
    { action: mode === 'new' ? 'Facilitator link made' : 'Facilitator link turned off', item: 'settings',
      before: c => (c.facilitatorKey ? 'a link was active; it no longer works' : 'no link'), after: () => (key ? 'a new link is active' : 'no link') });
  return captureGetBoard(sessionId, true);
}

/** A short link as someone would type it: no "https://", no trailing slash. */
function captureTypeable_(url) {
  return String(url || '').replace(/^https:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
}

/**
 * Follows a short link to see where it lands. Returns 'ok' when it opens this
 * session's table link, 'wrong' when it opens something else, and 'unknown'
 * when that can't be told from here (the shortener shows a page first, or the
 * check couldn't run).
 */
function captureCheckShortUrl_(url, sessionId, key) {
  const isTable = at => /^https:\/\/script\.google\.com\//.test(at) && at.indexOf('session=' + sessionId) !== -1 && at.indexOf('k=' + key) !== -1 && /[?&]page=capture(&|$)/.test(at);
  let at = url;
  try {
    for (let hop = 0; hop < 5; hop++) {
      const res = UrlFetchApp.fetch(at, { followRedirects: false, muteHttpExceptions: true });
      const headers = res.getHeaders() || {};
      const next = headers.Location || headers.location;
      if (res.getResponseCode() < 300 || res.getResponseCode() >= 400 || !next) break;
      at = String(next);
      if (isTable(at)) return 'ok';
    }
  } catch (e) {
    return 'unknown';
  }
  return at === url ? 'unknown' : 'wrong';
}

/**
 * Saves a short address for the table link (made at any link shortener), so
 * people without a camera can type it. It prints on the table cards and shows
 * on the wall. A link that opens something other than this session's table
 * link is refused. An empty value removes it.
 */
function captureSetShortUrl(sessionId, url) {
  sessionId = captureFacilitatorAuth_(sessionId);
  const ctx = captureBoardContext_(sessionId);
  const clean = String(url || '').trim().replace(/^(?!https?:\/\/)/i, 'https://').replace(/^http:\/\//i, 'https://');
  let check = '';
  if (String(url || '').trim()) {
    if (!/^https:\/\/[^\s"'<>\/]+\.[^\s"'<>]+$/.test(clean) || clean.length > 200) throw new Error('Paste the short link, for example tinyurl.com/our-retreat.');
    if (/^https:\/\/script\.google\.com\//.test(clean)) throw new Error('That is the long link. Make a short one from it at a link shortener, then paste the short one here.');
    check = captureCheckShortUrl_(clean, sessionId, ctx.config.key);
    if (check === 'wrong') throw new Error('That short link does not open this session’s table link. Make it from the table link above (Copy link), then paste it again.');
  }
  const value = String(url || '').trim() ? clean : '';
  CaptureStore.updateConfig(sessionId, () => ({ shortUrl: value }),
    { action: 'Short link set', item: 'settings', before: c => c.shortUrl || '', after: () => value,
      detail: check === 'ok' ? 'Checked: it opens the table link.' : check === 'unknown' ? 'Could not be checked from here.' : '' });
  const board = captureGetBoard(sessionId, true);
  board.shortCheck = check;
  return board;
}

function captureSetSurveyUrl(sessionId, url) {
  sessionId = captureFacilitatorAuth_(sessionId);
  captureBoardContext_(sessionId);
  const clean = String(url || '').trim();
  if (clean && !/^https:\/\/[^\s"'<>]+$/.test(clean)) throw new Error('Use a full https:// link.');
  CaptureStore.updateConfig(sessionId, () => ({ surveyUrl: clean }),
    { action: 'Survey link set', item: 'settings', before: c => c.surveyUrl, after: n => n.surveyUrl });
  return captureGetBoard(sessionId, true);
}

function captureMakePosters(sessionId) {
  sessionId = captureFacilitatorAuth_(sessionId);
  const ctx = captureBoardContext_(sessionId);
  const snap = CaptureStore.snapshot(sessionId, ctx.template, true);
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
  sessionId = captureFacilitatorAuth_(sessionId);
  const ctx = captureBoardContext_(sessionId);
  capturePaperMode_(mode);
  const t = CAPTURE_PAPER_MODES_[mode].table ? captureValidTable_(table, ctx.config.tables) : 0;
  const snap = CaptureStore.snapshot(sessionId, ctx.template);
  const data = String(base64 || ''), mime = String(mimeType || '');
  const readCtx = { table: t, flips: snap.flips, published: captureVotable_(ctx.config.published) };
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
  sessionId = captureFacilitatorAuth_(sessionId);
  const ctx = captureBoardContext_(sessionId);
  capturePaperMode_(mode);
  const snap = CaptureStore.snapshot(sessionId, ctx.template, true);
  const clean = captureValidatePaperRows_(ctx.template, mode, rows, { tables: ctx.config.tables, flips: snap.flips, published: captureVotable_(ctx.config.published) });
  let reading = null, aiRows = [];
  const n = Number(readingEntry);
  if (Number.isInteger(n) && n > 0) {
    reading = CaptureStore.auditEntry(sessionId, n);
    if (!reading || String(reading.Action).indexOf('AI read paper') !== 0) throw new Error('That reading was not found. Read the photo again.');
    aiRows = CaptureStore.json_(reading.After, []);
    // One reading is added once: a second Confirm would add every row again.
    const again = CaptureStore.auditTail(sessionId, 300).rows.find(r => String(r.Action).indexOf('Added from paper') === 0 &&
      String(r.Detail || '').indexOf('From AI reading in audit entry ' + n + '.') === 0);
    if (again) throw new Error('These rows were already added (audit entry ' + again.Entry + '). Read the photo again to add more.');
  }
  // How the confirmed rows differ from the reading, before anything is attached to them.
  const diff = captureDiffRows_(aiRows, clean);
  if (mode === 'cards') clean.forEach(r => { const a = r.ai !== null ? aiRows[r.ai] : null; r.aiReading = a ? a.need : ''; });
  if (mode === 'testdrive') clean.forEach(r => { r.group = captureTableGroup_(ctx, snap, r.table); });
  const res = CaptureStore.addFromPaper(sessionId, ctx.template, mode, clean, {
    photo: reading ? String(reading.Photo || '') : '', readingEntry: reading ? n : 0, diff: diff
  });
  const board = captureGetBoard(sessionId, true);
  board.added = { count: clean.length, entry: res.entry };
  return board;
}

// ─── Audit and results (facilitators) ───────────────────────────────────────

function captureGetAudit(sessionId) {
  sessionId = captureFacilitatorAuth_(sessionId);
  captureBoardContext_(sessionId);
  const tail = CaptureStore.auditTail(sessionId, 50);
  const session = CaptureStore.sessionInfo(sessionId);
  return { total: tail.total, rows: tail.rows, sheetUrl: String(session && session.dbUrl || ''),
    ai: { spentToday: CaptureAiService.spentToday(), budget: Number(CONFIG.CAPTURE_AI_DAILY_BUDGET_USD) || 0 } };
}

/** Makes the results document from the record and returns its link. */
function captureMakeReport(sessionId) {
  sessionId = captureFacilitatorAuth_(sessionId);
  const ctx = captureBoardContext_(sessionId);
  const session = SessionService.getSession(sessionId);
  const snap = CaptureStore.snapshot(sessionId, ctx.template, true);
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
  sessionId = captureFacilitatorAuth_(sessionId);
  const session = SessionService.getSession(sessionId);
  if (!session) throw new Error('Session not found.');
  const config = CaptureStore.getConfig(sessionId);
  if (!config) throw new Error('Turn on live capture for this session first.');
  const template = captureTemplateFor_(config);
  const links = captureLinks_(sessionId, config);
  if (!links.table) throw new Error('Deploy the web app first, so the table link exists.');
  return { title: config.title, sessionName: session.name, tables: config.tables, noun: template.noun, tableLink: links.table,
    flow: template.flow || 'full', parent: template.parent.label.toLowerCase(), typeLink: config.shortUrl ? captureTypeable_(config.shortUrl) : '' };
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
    SpreadsheetApp.getUi().alert('Live capture is not on for this session yet. Choose Learning Library Engine > Live capture > Turn on live capture.');
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

/**
 * Sheet menu: the board for the selected session, or the board's session
 * picker when no session row is selected. Never a dead end.
 */
function captureMenuBoard() {
  AuthService.requireUser();
  const base = captureBoardBase_();
  if (!base) { SpreadsheetApp.getUi().alert('Open the web app once in your browser, then try again.'); return; }
  const picked = getSelectedSession_(true);
  if (!picked.sessionId) {
    captureMenuDialog_('Live board', [{ label: 'Open the board', url: base + '?page=board', note: 'No session row is selected, so the board asks which session.' }]);
    return;
  }
  const info = captureDashboardInfo_(picked.sessionId);
  captureMenuDialog_('Board: ' + picked.session.name, [{ label: 'Open the board', url: info.board,
    note: info.on ? 'Live capture is on. The room is at ' + info.stageLabel + '.' : 'Live capture is off for this session. The board offers to turn it on.' }]);
}

/** Sheet menu: the results document for the selected session, made from the stored record. */
function captureMenuReport() {
  AuthService.requireUser();
  const picked = getSelectedSession_();
  if (!picked.sessionId) return;
  try {
    const res = captureMakeReport(picked.sessionId);
    captureMenuDialog_('Results document is ready', [{ label: 'Open the results document', url: res.url,
      note: 'Made from the stored record; AI wrote none of it. Saved in the session folder (04_Final).' }]);
  } catch (e) {
    SpreadsheetApp.getUi().alert('The results document was not made: ' + e.message);
  }
}

function captureMenuShowLinks_(sessionId, heading) {
  const links = captureLinks_(sessionId, CaptureStore.getConfig(sessionId));
  captureMenuDialog_(heading, [
    { label: 'Facilitator link', url: links.facilitator, note: 'The one link to hand a facilitator: runs this session’s board with no sign-in. Anyone who has it can run the room.' },
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

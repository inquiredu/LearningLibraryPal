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

const CAPTURE_PAGES_ = {
  capture: { file: 'Capture', title: 'Add a card' },
  wall: { file: 'CaptureWall', title: 'Live wall' },
  board: { file: 'CaptureBoard', title: 'Live board' }
};

/** Called from doGet for capture, wall and board. */
function captureRoute_(page, e) {
  const spec = CAPTURE_PAGES_[page];
  const params = (e && e.parameter) || {};
  const sessionId = params.session ? validateSessionId_(String(params.session)) : '';
  const key = page === 'board' ? '' : captureValidateKeyFormat_(String(params.k || ''));
  let html = HtmlService.createHtmlOutputFromFile(spec.file).getContent()
    .replace('<!--CAPTURE_STYLES-->', HtmlService.createHtmlOutputFromFile('CaptureStyles').getContent())
    .replace('<!--CAPTURE_CLIENT-->', HtmlService.createHtmlOutputFromFile('CaptureClient').getContent())
    .replace('__SESSION_ID__', sessionId)
    .replace('__CAPTURE_KEY__', key);
  return HtmlService.createHtmlOutput(html)
    .setTitle(spec.title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
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

function capturePublicTemplate_(template) {
  return {
    name: template.name,
    noun: template.noun,
    intro: template.intro,
    fields: template.fields.map(f => ({ key: f.key, label: f.label, hint: f.hint || '', maxLength: f.maxLength, primary: !!f.primary })),
    level: {
      label: template.level.label,
      options: template.level.options.map(o => ({ code: o.code, label: o.label, hint: o.hint, route: o.route }))
    },
    routes: template.routes
  };
}

// ─── Table (public, key required) ───────────────────────────────────────────

function captureGetTableConfig(sessionId, key) {
  const ctx = captureRequireKey_(sessionId, key);
  return {
    title: ctx.config.title,
    tables: ctx.config.tables,
    open: ctx.config.open,
    aiPhotos: (Number(CONFIG.CAPTURE_AI_DAILY_LIMIT) || 0) > 0,
    template: capturePublicTemplate_(ctx.template)
  };
}

function captureSubmitCard(sessionId, key, input) {
  const ctx = captureRequireKey_(sessionId, key);
  if (!ctx.config.open) throw new Error('Entry is closed. Thank you!');
  const card = captureValidateCard_(ctx.template, input, ctx.config.tables);
  return CaptureStore.appendCard(sessionId, ctx.template, card);
}

function captureRemoveOwnCard(sessionId, key, cardId, token) {
  const ctx = captureRequireKey_(sessionId, key);
  if (!ctx.config.open) throw new Error('Entry is closed, so cards can no longer be changed.');
  if (!/^[a-f0-9]{32}$/.test(String(token || ''))) throw new Error('Only the table that sent this card can remove it.');
  CaptureStore.setHidden(sessionId, ctx.template, Number(cardId), true, String(token));
  return { removed: true };
}

/** Only this table's own cards, so a table can see what it has sent. */
function captureGetTableCards(sessionId, key, table) {
  const ctx = captureRequireKey_(sessionId, key);
  const t = Number(table);
  if (!Number.isInteger(t) || t < 1 || t > ctx.config.tables) return [];
  const primary = ctx.template.fields.find(f => f.primary) || ctx.template.fields[0];
  return CaptureStore.readCards(sessionId, ctx.template)
    .filter(c => c.table === t && !c.hidden)
    .map(c => ({ id: c.id, text: c.fields[primary.key], level: c.level }));
}

function captureReadPhoto(sessionId, key, base64, mimeType) {
  const ctx = captureRequireKey_(sessionId, key);
  if (!ctx.config.open) throw new Error('Entry is closed. Thank you!');
  return CaptureAiService.readPhoto(ctx.template, String(base64 || ''), String(mimeType || ''));
}

// ─── Wall (public, key required, counts and topics only) ────────────────────

function captureGetWall(sessionId, key) {
  const ctx = captureRequireKey_(sessionId, key);
  const cards = CaptureStore.readCards(sessionId, ctx.template);
  const groups = captureNormalizeGroups_(cards, CaptureStore.readGroups(sessionId)).groups;
  return Object.assign(
    { title: ctx.config.title, levelOptions: ctx.template.level.options.map(o => ({ code: o.code, label: o.label, route: o.route })), routes: ctx.template.routes },
    captureWallSummary_(ctx.template, cards, groups, ctx.config.tables, ctx.config.open)
  );
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

function captureSetOpen(sessionId, open) {
  AuthService.requireUser();
  validateSessionId_(sessionId);
  CaptureStore.setOpen(sessionId, !!open);
  return captureGetBoard(sessionId);
}

function captureGetBoard(sessionId) {
  AuthService.requireUser();
  validateSessionId_(sessionId);
  const session = SessionService.getSession(sessionId);
  if (!session) throw new Error('Session not found.');
  const config = CaptureStore.getConfig(sessionId);
  if (!config) return { sessionId: sessionId, sessionName: session.name, enabled: false };
  const template = captureTemplate_(config.template);
  const cards = CaptureStore.readCards(sessionId, template);
  const normalized = captureNormalizeGroups_(cards, CaptureStore.readGroups(sessionId));
  const base = capturePublicBase_();
  const query = '?session=' + encodeURIComponent(sessionId) + '&k=' + config.key;
  return {
    sessionId: sessionId,
    sessionName: session.name,
    enabled: true,
    config: { title: config.title, tables: config.tables, open: config.open },
    template: capturePublicTemplate_(template),
    links: base ? { table: base + query + '&page=capture', wall: base + query + '&page=wall' } : null,
    cards: cards.map(c => ({ id: c.id, table: c.table, level: c.level, source: c.source, hidden: c.hidden, submittedAt: c.submittedAt, fields: c.fields })),
    groups: captureOrderGroups_(template, cards.filter(c => !c.hidden), normalized.groups),
    ungrouped: normalized.ungrouped,
    parking: captureParkingLot_(template, cards).map(c => c.id)
  };
}

function captureSetHidden(sessionId, cardId, hidden) {
  AuthService.requireUser();
  validateSessionId_(sessionId);
  const config = CaptureStore.getConfig(sessionId);
  if (!config) throw new Error('Turn on live capture for this session first.');
  CaptureStore.setHidden(sessionId, captureTemplate_(config.template), Number(cardId), !!hidden);
  return captureGetBoard(sessionId);
}

function captureSuggestGroups(sessionId) {
  AuthService.requireUser();
  validateSessionId_(sessionId);
  const config = CaptureStore.getConfig(sessionId);
  if (!config) throw new Error('Turn on live capture for this session first.');
  const template = captureTemplate_(config.template);
  const groups = CaptureAiService.proposeGroups(template, CaptureStore.readCards(sessionId, template));
  CaptureStore.writeGroups(sessionId, groups);
  return captureGetBoard(sessionId);
}

function captureSaveGroups(sessionId, groups) {
  AuthService.requireUser();
  validateSessionId_(sessionId);
  const config = CaptureStore.getConfig(sessionId);
  if (!config) throw new Error('Turn on live capture for this session first.');
  const template = captureTemplate_(config.template);
  const cards = CaptureStore.readCards(sessionId, template);
  const normalized = captureNormalizeGroups_(cards, groups);
  CaptureStore.writeGroups(sessionId, normalized.groups);
  return captureGetBoard(sessionId);
}

function captureMakePosters(sessionId) {
  AuthService.requireUser();
  validateSessionId_(sessionId);
  const config = CaptureStore.getConfig(sessionId);
  if (!config) throw new Error('Turn on live capture for this session first.');
  const template = captureTemplate_(config.template);
  const cards = CaptureStore.readCards(sessionId, template);
  const groups = captureNormalizeGroups_(cards, CaptureStore.readGroups(sessionId)).groups;
  return { url: CapturePosterService.make(sessionId, template, config, cards, groups) };
}

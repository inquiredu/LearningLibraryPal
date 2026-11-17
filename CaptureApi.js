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

function capturePublicTemplate_(template) {
  return {
    name: template.name,
    noun: template.noun,
    intro: template.intro,
    fields: template.fields.map(f => ({
      key: f.key, label: f.label, hint: f.hint || '', maxLength: f.maxLength, primary: !!f.primary,
      scope: f.scope === 'table' ? 'table' : 'card', tableLabel: f.tableLabel || '', tableHint: f.tableHint || ''
    })),
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
  const table = captureValidTable_(input && input.table, ctx.config.tables);
  const saved = captureTableFieldDefs_(ctx.template).length
    ? CaptureStore.readTableFields(sessionId, ctx.template)[table] || {}
    : {};
  const card = captureValidateCard_(ctx.template, input, ctx.config.tables, saved);
  return CaptureStore.appendCard(sessionId, ctx.template, card);
}

/** Saves what a table writes once (its flip statement); allowed while entry is open. */
function captureSetTableFields(sessionId, key, table, fields) {
  const ctx = captureRequireKey_(sessionId, key);
  if (!ctx.config.open) throw new Error('Entry is closed. Thank you!');
  const t = captureValidTable_(table, ctx.config.tables);
  const clean = captureValidateTableFields_(ctx.template, fields);
  CaptureStore.setTableFields(sessionId, ctx.template, t, clean);
  return { table: t, fields: clean };
}

/** This table's saved fields and its own cards, so a returning phone picks up where it left off. */
function captureGetTableState(sessionId, key, table) {
  const ctx = captureRequireKey_(sessionId, key);
  const t = captureValidTable_(table, ctx.config.tables);
  const fields = captureTableFieldDefs_(ctx.template).length
    ? CaptureStore.readTableFields(sessionId, ctx.template)[t] || {}
    : {};
  return { table: t, fields: fields, cards: captureGetTableCards(sessionId, key, t) };
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
  const links = captureLinks_(sessionId, config);
  return {
    sessionId: sessionId,
    sessionName: session.name,
    enabled: true,
    config: { title: config.title, tables: config.tables, open: config.open },
    template: capturePublicTemplate_(template),
    links: links.table ? links : null,
    cards: cards.map(c => ({ id: c.id, table: c.table, level: c.level, source: c.source, hidden: c.hidden, submittedAt: c.submittedAt, fields: c.fields })),
    groups: captureOrderGroups_(template, cards.filter(c => !c.hidden), normalized.groups),
    ungrouped: normalized.ungrouped,
    parking: captureParkingLot_(template, cards).map(c => c.id),
    tableFields: captureTableFieldDefs_(template).length ? CaptureStore.readTableFields(sessionId, template) : {}
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
    { label: 'Table link', url: links.table, note: 'Any table can use this and pick its number. No sign-in.' }
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

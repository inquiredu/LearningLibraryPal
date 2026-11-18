/**
 * CaptureLogic
 * Pure rules for live capture: validating what phones send, cleaning what a
 * model returns, grouping, columns, votes, tallies, results and assignments.
 * No Google services are used here, so tests can run every rule in Node.
 *
 * Counts, columns, tallies and rankings are always computed here from the
 * stored rows. A model proposes topics and which cards belong together; it
 * never supplies a number or a column a facilitator will read.
 */

// Control characters other than newline and tab, and characters that draw
// nothing but can hide or reorder text. Model output and visitor input are
// both untrusted text shown on other people's screens.
// eslint-disable-next-line no-control-regex
const CAPTURE_CONTROL_RE_ = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
const CAPTURE_INVISIBLE_RE_ = /[​-‏‪-‮⁦-⁩﻿]/g;
// typed, dictated or read from a photo on a device; paper: entered from paper on the board.
const CAPTURE_SOURCES_ = ['typed', 'voice', 'photo', 'paper'];

function captureCleanText_(value, maxLength) {
  let text = String(value === undefined || value === null ? '' : value)
    .replace(CAPTURE_CONTROL_RE_, '')
    .replace(CAPTURE_INVISIBLE_RE_, '')
    .replace(/\r\n?/g, '\n')
    .trim();
  if (maxLength && text.length > maxLength) {
    text = text.slice(0, maxLength);
    if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
    text = text.trim();
  }
  return text;
}

/**
 * Sheets treats a value starting with = + - or @ as a formula. Visitor and
 * model text is stored with a leading apostrophe so it stays text.
 */
function captureSheetSafe_(value) {
  if (typeof value === 'number') return value;
  const text = String(value === undefined || value === null ? '' : value);
  // Also text Sheets would turn into a number, date, time or TRUE/FALSE
  // ("1:1", "24/7", "50%", a device id that is all digits): keep it as written.
  const converts = (/\d/.test(text) && /^[\s\d.,:\/%$()eE+\-]+$/.test(text)) || /^\s*(true|false)\s*$/i.test(text);
  return /^[=+\-@]/.test(text) || converts ? "'" + text : text;
}

function captureValidTable_(value, tableCount) {
  const table = Number(value);
  if (!Number.isInteger(table) || table < 1 || table > tableCount) {
    throw new Error('Choose your table number first.');
  }
  return table;
}

function captureValidRole_(template, value) {
  const role = String(value || '');
  if (!template.roles.some(r => r.code === role)) {
    throw new Error('Choose ' + template.roles.map(r => r.label).join(' or ') + ' first.');
  }
  return role;
}

/** A device's own random id, used to replace its votes and dots instead of adding to them. */
function captureValidToken_(value) {
  const token = String(value || '');
  if (!/^[a-f0-9]{16,40}$/.test(token)) throw new Error('This device needs to reload the page. Then try again.');
  return token;
}

// ─── What people write ──────────────────────────────────────────────────────

function captureValidateSignal_(template, input, tableCount) {
  const sent = input && typeof input === 'object' ? input : {};
  const text = captureCleanText_(sent.text, template.signal.maxLength);
  if (!text) throw new Error('Write the signal first.');
  return { table: captureValidTable_(sent.table, tableCount), role: captureValidRole_(template, sent.role), text: text };
}

function captureValidateFlipText_(template, value) {
  const text = captureCleanText_(value, template.parent.maxLength);
  if (!text) throw new Error('Write the ' + template.parent.label.toLowerCase() + ' first.');
  return text;
}

/**
 * Throws a message a table can act on; returns the cleaned card otherwise.
 * A card may name one of its own table's flip statements, or none (a table
 * working on paper, or a need that doesn't fit one). When it names one, the
 * statement's text is copied from there, never from the card.
 */
function captureValidateCard_(template, input, tableCount, flips) {
  if (!input || typeof input !== 'object') throw new Error('Nothing was sent. Try again.');
  const table = captureValidTable_(input.table, tableCount);
  const flipId = Number(input.flipId) || 0;
  const flip = flipId ? (flips || []).find(f => f.id === flipId && f.table === table) : null;
  if (flipId && !flip) throw new Error('That ' + template.parent.label.toLowerCase() + ' belongs to another table. Pick one of yours, or none.');
  const fields = {};
  fields[template.parent.key] = flip ? flip.text : '';
  const sent = input.fields && typeof input.fields === 'object' ? input.fields : {};
  template.fields.forEach(field => {
    const text = captureCleanText_(sent[field.key], field.maxLength);
    if (!text) throw new Error('Add the ' + field.label.replace(/…$/, '').toLowerCase() + '.');
    fields[field.key] = text;
  });
  const codes = template.level.options.map(o => o.code);
  const level = String(input.level || '');
  if (codes.indexOf(level) === -1) throw new Error('Choose ' + codes.join(', ') + '.');
  const role = captureValidRole_(template, input.role);
  const sources = Array.isArray(input.sources) ? input.sources : [input.source];
  const used = CAPTURE_SOURCES_.filter(s => sources.indexOf(s) !== -1);
  return { table: table, flipId: flip ? flipId : 0, fields: fields, level: level, role: role, source: used.length ? used.join('+') : 'typed' };
}

/** The level a model read from a photo is only kept if it is one of ours. */
function captureCleanReading_(template, raw) {
  if (!raw || typeof raw !== 'object') return null;
  const fields = {};
  let any = false;
  template.fields.forEach(field => {
    const text = captureCleanText_(raw[field.key], field.maxLength);
    fields[field.key] = text;
    if (text) any = true;
  });
  const codes = template.level.options.map(o => o.code);
  const level = codes.indexOf(String(raw.level || '').trim()) !== -1 ? String(raw.level).trim() : '';
  const confidence = ['high', 'medium', 'low'].indexOf(raw.confidence) !== -1 ? raw.confidence : 'low';
  if (!any && !level) return { fields: fields, level: '', confidence: 'low', empty: true };
  return { fields: fields, level: level, confidence: confidence, empty: false };
}

function captureValidateTestDrive_(template, input) {
  const sent = input && typeof input === 'object' ? input : {};
  const out = {};
  let any = false;
  template.testDrive.prompts.forEach(p => {
    out[p.key] = captureCleanText_(sent[p.key], template.testDrive.maxLength);
    if (out[p.key]) any = true;
  });
  if (!any) throw new Error('Write at least one note first.');
  return out;
}

// ─── Groups and columns ─────────────────────────────────────────────────────

function captureRouteForLevel_(template, code) {
  const option = template.level.options.find(o => o.code === code);
  return option ? option.route : 'vote';
}

/**
 * Makes any proposed grouping safe to show: every live card appears exactly
 * once, unknown or hidden ids are dropped, duplicates keep their first group,
 * and cards no group claimed are returned as `ungrouped` ("Doesn't fit yet").
 */
function captureNormalizeGroups_(cards, proposed, template) {
  const live = new Set(cards.filter(c => !c.hidden).map(c => Number(c.id)));
  const codes = template ? template.level.options.map(o => o.code) : [];
  const seen = new Set();
  const usedIds = new Set();
  const groups = [];
  (Array.isArray(proposed) ? proposed : []).forEach((group, index) => {
    if (!group || typeof group !== 'object') return;
    const ids = [];
    (Array.isArray(group.cardIds) ? group.cardIds : []).forEach(raw => {
      const id = Number(raw);
      if (live.has(id) && !seen.has(id)) { seen.add(id); ids.push(id); }
    });
    if (!ids.length) return;
    // Votes and paper dots are counted by group id, so no two groups may share one.
    const base = captureCleanText_(group.id, 40) || 'g' + (index + 1);
    let id = base;
    for (let n = 2; usedIds.has(id); n++) id = base.slice(0, 36) + '-' + n;
    usedIds.add(id);
    groups.push({
      id: id,
      topic: captureCleanText_(group.topic, 80) || 'Untitled group',
      cardIds: ids,
      rank: Number.isFinite(Number(group.rank)) && Number(group.rank) > 0 ? Number(group.rank) : 0,
      columnOverride: codes.indexOf(String(group.columnOverride || '')) !== -1 ? String(group.columnOverride) : ''
    });
  });
  const ungrouped = [...live].filter(id => !seen.has(id)).sort((a, b) => a - b);
  return { groups: groups, ungrouped: ungrouped };
}

/**
 * Counts, roles and column for one group, always from the cards. The column is
 * the tag most of its cards carry (ties go to the earlier option); a group is
 * contested ("?") when its cards carry more than one tag.
 */
function captureGroupStats_(template, cards, group) {
  const byId = new Map(cards.map(c => [Number(c.id), c]));
  const members = group.cardIds.map(id => byId.get(Number(id))).filter(c => c && !c.hidden);
  const tables = [...new Set(members.map(c => c.table))].sort((a, b) => a - b);
  const levels = {};
  template.level.options.forEach(o => { levels[o.code] = 0; });
  members.forEach(c => { if (levels[c.level] !== undefined) levels[c.level]++; });
  const roles = {};
  template.roles.forEach(r => { roles[r.code] = 0; });
  members.forEach(c => { if (roles[c.role] !== undefined) roles[c.role]++; });
  let majority = template.level.options[0].code;
  template.level.options.forEach(o => { if (levels[o.code] > levels[majority]) majority = o.code; });
  const tagged = template.level.options.filter(o => levels[o.code] > 0).length;
  const column = group.columnOverride || majority;
  return {
    tables: tables,
    tableCount: tables.length,
    cardCount: members.length,
    levels: levels,
    roles: roles,
    contested: tagged > 1,
    column: column,
    defaultColumn: majority,
    route: captureRouteForLevel_(template, column)
  };
}

/** Explicit ranks first, then the groups raised by the most tables. */
function captureOrderGroups_(template, cards, groups) {
  return groups
    .map(g => Object.assign({}, g, { stats: captureGroupStats_(template, cards, g) }))
    .sort((a, b) => {
      const ra = a.rank || Infinity, rb = b.rank || Infinity;
      if (ra !== rb) return ra - rb;
      if (b.stats.tableCount !== a.stats.tableCount) return b.stats.tableCount - a.stats.tableCount;
      if (b.stats.cardCount !== a.stats.cardCount) return b.stats.cardCount - a.stats.cardCount;
      return a.topic.localeCompare(b.topic);
    });
}

/** Every card tagged with a parking-lot level, in card order. */
function captureParkingLot_(template, cards) {
  return cards
    .filter(c => !c.hidden && captureRouteForLevel_(template, c.level) === 'parking')
    .sort((a, b) => a.id - b.id);
}

/**
 * The snapshot people vote on: each group's topic, column and counts at the
 * moment the team published. Later edits to the working groups don't move
 * votes until the team publishes again.
 */
function capturePublish_(template, cards, groups) {
  return captureOrderGroups_(template, cards, groups).map(g => ({
    id: g.id,
    topic: g.topic,
    cardIds: g.cardIds.slice(),
    column: g.stats.column,
    contested: g.stats.contested,
    route: g.stats.route,
    tableCount: g.stats.tableCount,
    cardCount: g.stats.cardCount,
    levels: g.stats.levels,
    roles: g.stats.roles
  }));
}

// ─── Dots and votes ─────────────────────────────────────────────────────────

/** One person's gallery dots on flip statements; sending again replaces them. */
function captureValidateFlipDots_(template, flips, input) {
  const sent = input && typeof input === 'object' ? input : {};
  const voter = captureValidToken_(sent.voter);
  const role = captureValidRole_(template, sent.role);
  const live = new Set((flips || []).filter(f => !f.hidden).map(f => f.id));
  const colors = template.flipDots.map(d => d.code);
  const seen = new Set();
  const dots = [];
  (Array.isArray(sent.dots) ? sent.dots : []).forEach(d => {
    const flipId = Number(d && d.flipId), color = String(d && d.color);
    const key = flipId + ':' + color;
    if (!live.has(flipId) || colors.indexOf(color) === -1 || seen.has(key)) return;
    seen.add(key);
    dots.push({ flipId: flipId, color: color });
  });
  if (dots.length > CAPTURE_DEFAULTS.MAX_MARKS_PER_PERSON) throw new Error('That is more dots than one person places. Reload the page and try again.');
  return { voter: voter, role: role, dots: dots };
}

/**
 * { flipId: { green: { S, A, total }, ... } } from device dots plus any paper
 * counts ({ flipId: { green: { S, A, unmarked } } }). Unmarked paper dots count
 * toward the total only.
 */
function captureTallyFlipDots_(template, dots, paper) {
  const out = {};
  const slot = flipId => {
    const f = out[flipId] = out[flipId] || {};
    template.flipDots.forEach(c => { f[c.code] = f[c.code] || { total: 0 }; template.roles.forEach(r => { f[c.code][r.code] = f[c.code][r.code] || 0; }); });
    return f;
  };
  (dots || []).forEach(d => {
    const f = slot(d.flipId);
    if (f[d.color]) {
      f[d.color].total++;
      if (f[d.color][d.role] !== undefined) f[d.color][d.role]++;
    }
  });
  Object.keys(paper || {}).forEach(flipId => {
    const f = slot(Number(flipId));
    template.flipDots.forEach(c => {
      const counts = (paper[flipId] || {})[c.code] || {};
      template.roles.forEach(r => { const n = captureCount_(counts[r.code]); f[c.code][r.code] += n; f[c.code].total += n; });
      f[c.code].total += captureCount_(counts.unmarked);
    });
  });
  return out;
}

/** A whole count from 0 to 9999; anything else is 0. */
function captureCount_(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 9999) : 0;
}

/**
 * One person's priority votes; sending again replaces them. Votes can stack on
 * one group. How many each person uses is the room's agreement, not checked here.
 */
function captureValidateVote_(template, published, input) {
  const sent = input && typeof input === 'object' ? input : {};
  const voter = captureValidToken_(sent.voter);
  const role = captureValidRole_(template, sent.role);
  const ids = new Set((published || []).map(g => g.id));
  const choices = (Array.isArray(sent.choices) ? sent.choices : []).map(String).filter(id => ids.has(id));
  if (!choices.length) throw new Error('Choose at least one before sending.');
  if (choices.length > CAPTURE_DEFAULTS.MAX_MARKS_PER_PERSON) throw new Error('That is more votes than one person casts. Use Next person for someone else.');
  return { voter: voter, role: role, choices: choices };
}

/**
 * Votes per published group from phones and paper dots, by role.
 * mode: 'phone' | 'paper' | 'both' decides which count makes the total.
 */
function captureTally_(template, published, votes, paper, mode) {
  const out = {};
  const blank = () => { const r = {}; template.roles.forEach(x => { r[x.code] = 0; }); return r; };
  (published || []).forEach(g => { out[g.id] = { phone: blank(), paper: blank(), total: 0 }; });
  (votes || []).forEach(v => (v.choices || []).forEach(id => {
    if (out[id] && out[id].phone[v.role] !== undefined) out[id].phone[v.role]++;
  }));
  Object.keys(paper || {}).forEach(id => {
    if (!out[id]) return;
    const p = paper[id] && typeof paper[id] === 'object' ? paper[id] : {};
    template.roles.forEach(r => { out[id].paper[r.code] = captureCount_(p[r.code]); });
    // Paper dots nobody could mark as a student's or an adult's count toward the total only.
    out[id].paper.unmarked = captureCount_(p.unmarked);
  });
  const use = mode === 'paper' ? ['paper'] : mode === 'both' ? ['phone', 'paper'] : ['phone'];
  Object.keys(out).forEach(id => {
    const t = out[id];
    template.roles.forEach(r => { t[r.code] = use.reduce((n, k) => n + t[k][r.code], 0); });
    t.total = template.roles.reduce((n, r) => n + t[r.code], 0) + (use.indexOf('paper') !== -1 ? (t.paper.unmarked || 0) : 0);
  });
  return out;
}

/**
 * Ranked results per column, and the top priorities assigned one per table.
 * Ranking: total votes, then tables that raised it, then cards, then topic.
 * The top `tableCount` groups in vote columns go to tables 1, 2, 3, ... unless
 * a facilitator assigned a table by hand (overrides: { table: groupId }).
 */
function captureResults_(template, published, tally, tableCount, overrides) {
  const rows = (published || []).map(g => Object.assign({}, g, tally[g.id] || { total: 0 }));
  const rank = (a, b) => (b.total - a.total) || (b.tableCount - a.tableCount) || (b.cardCount - a.cardCount) || a.topic.localeCompare(b.topic);
  const columns = template.level.options.map(o => ({
    code: o.code,
    label: o.label,
    route: o.route,
    items: rows.filter(r => r.column === o.code).sort(rank).map((r, i) => Object.assign(r, { rank: i + 1 }))
  }));
  const priorities = rows.filter(r => r.route === 'vote').sort(rank);
  const fixed = {};
  const taken = new Set();
  Object.keys(overrides || {}).forEach(t => {
    const table = Number(t), id = String(overrides[t]);
    if (table >= 1 && table <= tableCount && priorities.some(p => p.id === id)) { fixed[table] = id; taken.add(id); }
  });
  const pool = priorities.filter(p => !taken.has(p.id));
  const assignments = [];
  for (let table = 1; table <= tableCount; table++) {
    const id = fixed[table] || (pool.length ? pool.shift().id : '');
    const g = priorities.find(p => p.id === id);
    assignments.push({ table: table, groupId: id, topic: g ? g.topic : '', total: g ? g.total : 0, manual: !!fixed[table] });
  }
  return { columns: columns, priorities: priorities.map(p => ({ id: p.id, topic: p.topic, total: p.total, column: p.column })), assignments: assignments };
}

// ─── AI cost ────────────────────────────────────────────────────────────────

/**
 * What one Gemini call cost, in US dollars, from its usage counts and the
 * configured prices per million tokens. Thinking tokens bill as output.
 */
function captureAiCost_(usage, prices) {
  const u = usage || {}, p = prices || {};
  const tokens = v => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; };
  const input = tokens(u.input), output = tokens(u.output);
  const cost = input / 1e6 * (Number(p.input) || 0) + output / 1e6 * (Number(p.output) || 0);
  return Math.round(cost * 1e6) / 1e6;
}

// ─── From paper ─────────────────────────────────────────────────────────────

/**
 * Work done on paper (sticky notes, posters, dot stickers, a table's notes) is
 * entered on the board, typed or read from a photo. A reading is only a
 * suggestion: people check it, edit it and confirm it, and both the reading
 * and what they confirmed go into the audit trail.
 */
const CAPTURE_PAPER_MODES_ = {
  signals: { label: 'Signals', table: true },
  flips: { label: 'Flip statements', table: true },
  cards: { label: 'Need cards', table: true },
  flipdots: { label: 'Gallery dots', table: false },
  votes: { label: 'Vote dots', table: false },
  testdrive: { label: 'Test-drive notes', table: true }
};

function capturePaperMode_(mode) {
  if (!CAPTURE_PAPER_MODES_[mode]) throw new Error('Choose what the paper shows.');
  return mode;
}

// Words every flip statement shares ("Right now…, but we want…") and other filler.
const CAPTURE_FILLER_ = new Set(['right', 'now', 'but', 'we', 'want', 'the', 'and', 'to', 'of', 'for', 'in', 'on', 'is', 'are', 'it', 'be', 'our', 'us',
  'them', 'they', 'with', 'that', 'this', 'an', 'as', 'at', 'by', 'or', 'so', 'do', 'can', 'need', 'needs']);
function captureWords_(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !CAPTURE_FILLER_.has(w));
}

/**
 * The candidate whose text best matches, by shared words; 0 when nothing is
 * close. A photo often shows only part of a statement, so words are compared
 * against the shorter of the two. At least two words must be shared (one is
 * enough only when both are short, like topic names) and make up a fifth of
 * the longer text. Filler words don't count. Ties go to the closer overall match.
 */
function captureMatchText_(text, candidates) {
  const set = new Set(captureWords_(text));
  if (!set.size) return 0;
  let best = 0, bestScore = 0, bestWhole = 0;
  (candidates || []).forEach(c => {
    const have = new Set(captureWords_(c.text));
    if (!have.size) return;
    let shared = 0;
    have.forEach(w => { if (set.has(w)) shared++; });
    const shorter = Math.min(set.size, have.size);
    const longer = Math.max(set.size, have.size);
    if (!shared || (shared < 2 && longer > 2) || shared / longer < 0.2) return;
    const score = shared / shorter, whole = shared / (set.size + have.size - shared);
    if (score > bestScore || (score === bestScore && whole > bestWhole)) { bestScore = score; bestWhole = whole; best = c.id; }
  });
  return bestScore >= 0.6 ? best : 0;
}

function capturePaperRole_(template, value) {
  const v = String(value || '').trim().toLowerCase();
  const hit = template.roles.find(r => r.code.toLowerCase() === v || r.label.toLowerCase() === v);
  return hit ? hit.code : '';
}

/**
 * Turns a model's reading of a photo into rows for people to review. Each row
 * keeps `ai`, its place in the reading, so edits can be compared later.
 * ctx: { table, flips, published }
 */
function captureCleanPaperReading_(template, mode, raw, ctx) {
  const c = ctx || {};
  const src = raw && typeof raw === 'object' ? raw : {};
  const items = (Array.isArray(src.items) ? src.items : []).filter(i => i && typeof i === 'object').slice(0, CAPTURE_DEFAULTS.MAX_PAPER_ROWS);
  const live = (c.flips || []).filter(f => !f.hidden);
  const ownFlips = live.filter(f => f.table === c.table);
  const codes = template.level.options.map(o => o.code);
  const counts = v => {
    const o = v && typeof v === 'object' ? v : {};
    const out = { unmarked: captureCount_(o.unmarked) };
    template.roles.forEach(r => { out[r.code] = captureCount_(o[r.label.toLowerCase()] !== undefined ? o[r.label.toLowerCase()] : o[r.code]); });
    return out;
  };
  let rows;
  if (mode === 'signals') {
    rows = items.map(i => ({ table: c.table, role: capturePaperRole_(template, i.writer), text: captureCleanText_(i.text, template.signal.maxLength) })).filter(r => r.text);
  } else if (mode === 'flips') {
    rows = items.map(i => ({ table: c.table, text: captureCleanText_(i.text, template.parent.maxLength) })).filter(r => r.text);
  } else if (mode === 'cards') {
    const primary = template.fields[0];
    rows = items.map(i => {
      const level = String(i.level || '').trim();
      return { table: c.table, flipId: captureMatchText_(i.flipText, ownFlips), need: captureCleanText_(i.need, primary.maxLength),
        level: codes.indexOf(level) !== -1 ? level : '', role: capturePaperRole_(template, i.writer) };
    }).filter(r => r.need);
  } else if (mode === 'flipdots') {
    rows = items.map(i => {
      const row = { flipId: captureMatchText_(i.statement, live), statement: captureCleanText_(i.statement, template.parent.maxLength), counts: {} };
      template.flipDots.forEach(d => { row.counts[d.code] = counts(i[d.code]); });
      return row;
    }).filter(r => r.statement || r.flipId);
  } else if (mode === 'votes') {
    const groups = (c.published || []).map(g => ({ id: g.id, text: g.topic }));
    rows = items.map(i => {
      const o = counts(i);
      const row = { groupId: '', topic: captureCleanText_(i.topic, 120), unmarked: o.unmarked };
      const hit = captureMatchText_(i.topic, groups.map((g, k) => ({ id: k + 1, text: g.text })));
      row.groupId = hit ? groups[hit - 1].id : '';
      template.roles.forEach(r => { row[r.code] = o[r.code]; });
      return row;
    }).filter(r => r.topic || r.groupId);
  } else if (mode === 'testdrive') {
    const notes = { table: c.table };
    let any = false;
    template.testDrive.prompts.forEach(p => { notes[p.key] = captureCleanText_(src[p.key], template.testDrive.maxLength); if (notes[p.key]) any = true; });
    rows = any ? [notes] : [];
  } else {
    throw new Error('Choose what the paper shows.');
  }
  rows.forEach((r, i) => { r.ai = i; });
  return {
    rows: rows,
    confidence: ['high', 'medium', 'low'].indexOf(src.confidence) !== -1 ? src.confidence : 'low',
    note: captureCleanText_(src.note, 300)
  };
}

/**
 * Checks the rows people confirmed. Rows marked include:false are left out.
 * Unlike a device, paper may not say who wrote something, so a blank role is
 * kept as unknown rather than refused. ctx: { tables, flips, published }
 */
function captureValidatePaperRows_(template, mode, rows, ctx) {
  capturePaperMode_(mode);
  const c = ctx || {};
  const list = (Array.isArray(rows) ? rows : []).filter(r => r && typeof r === 'object' && r.include !== false);
  if (!list.length) throw new Error('Nothing to add. Keep at least one row.');
  if (list.length > CAPTURE_DEFAULTS.MAX_PAPER_ROWS) throw new Error('Add at most ' + CAPTURE_DEFAULTS.MAX_PAPER_ROWS + ' rows at a time.');
  const codes = template.level.options.map(o => o.code);
  const role = v => capturePaperRole_(template, v);
  const ai = r => (Number.isInteger(Number(r.ai)) && r.ai !== '' && r.ai !== null && r.ai !== undefined ? Number(r.ai) : null);
  const clean = list.map((r, n) => {
    const where = 'Row ' + (n + 1) + ': ';
    const table = () => { try { return captureValidTable_(r.table, c.tables); } catch (e) { throw new Error(where + 'choose a table.'); } };
    if (mode === 'signals') {
      const text = captureCleanText_(r.text, template.signal.maxLength);
      if (!text) throw new Error(where + 'the signal is empty.');
      return { ai: ai(r), table: table(), role: role(r.role), text: text };
    }
    if (mode === 'flips') {
      const text = captureCleanText_(r.text, template.parent.maxLength);
      if (!text) throw new Error(where + 'the ' + template.parent.label.toLowerCase() + ' is empty.');
      return { ai: ai(r), table: table(), text: text };
    }
    if (mode === 'cards') {
      const t = table();
      const flipId = Number(r.flipId) || 0;
      const flip = flipId ? (c.flips || []).find(f => f.id === flipId && f.table === t) : null;
      if (flipId && !flip) throw new Error(where + 'that ' + template.parent.label.toLowerCase() + ' belongs to another table.');
      const need = captureCleanText_(r.need, template.fields[0].maxLength);
      if (!need) throw new Error(where + 'the need is empty.');
      const level = String(r.level || '');
      if (codes.indexOf(level) === -1) throw new Error(where + 'choose ' + codes.join(', ') + '.');
      return { ai: ai(r), table: t, flipId: flip ? flipId : 0, flipText: flip ? flip.text : '', need: need, level: level, role: role(r.role) };
    }
    if (mode === 'flipdots') {
      const flipId = Number(r.flipId) || 0;
      if (!(c.flips || []).some(f => f.id === flipId)) throw new Error(where + 'choose which ' + template.parent.label.toLowerCase() + ' these dots are on.');
      const counts = {};
      template.flipDots.forEach(d => {
        const src = (r.counts || {})[d.code] || {};
        counts[d.code] = { unmarked: captureCount_(src.unmarked) };
        template.roles.forEach(x => { counts[d.code][x.code] = captureCount_(src[x.code]); });
      });
      return { ai: ai(r), flipId: flipId, counts: counts };
    }
    if (mode === 'votes') {
      const id = String(r.groupId || '');
      if (!(c.published || []).some(g => g.id === id)) throw new Error(where + 'choose which published topic these dots are on.');
      const out = { ai: ai(r), groupId: id, unmarked: captureCount_(r.unmarked) };
      template.roles.forEach(x => { out[x.code] = captureCount_(r[x.code]); });
      return out;
    }
    const notes = captureValidateTestDrive_(template, r);
    return Object.assign({ ai: ai(r), table: table() }, notes);
  });
  // A count is stored per topic or statement, so two rows for the same one
  // would leave only the second. Ask for one row instead of losing dots.
  const idKey = mode === 'votes' ? 'groupId' : mode === 'flipdots' ? 'flipId' : '';
  if (idKey) {
    const first = {};
    clean.forEach((r, n) => {
      if (first[r[idKey]] !== undefined) throw new Error('Row ' + (n + 1) + ' is for the same ' + (mode === 'votes' ? 'topic' : template.parent.label.toLowerCase()) +
        ' as row ' + (first[r[idKey]] + 1) + '. Add their dots together in one row.');
      first[r[idKey]] = n;
    });
  }
  return clean;
}

/** How the confirmed rows differ from the reading: kept as read, edited, added, dropped. */
function captureDiffRows_(aiRows, finalRows) {
  // Compared field by field, nested counts included, in a fixed key order.
  const canon = v => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object'
    ? Object.keys(v).sort().reduce((o, k) => { o[k] = canon(v[k]); return o; }, {}) : v);
  const strip = r => { const o = Object.assign({}, r); ['ai', 'include', 'statement', 'topic', 'flipText', 'aiReading', 'group'].forEach(k => { delete o[k]; }); return JSON.stringify(canon(o)); };
  const read = Array.isArray(aiRows) ? aiRows : [];
  const out = { asRead: 0, edited: 0, added: 0, dropped: 0 };
  const used = new Set();
  (finalRows || []).forEach(r => {
    if (r.ai === null || r.ai === undefined || !read[r.ai]) { out.added++; return; }
    used.add(r.ai);
    if (strip(r) === strip(read[r.ai])) out.asRead++; else out.edited++;
  });
  out.dropped = read.filter((r, i) => !used.has(i)).length;
  return out;
}

// ─── Results document ───────────────────────────────────────────────────────

/**
 * What the results document says, built only from the stored record so every
 * line can be traced back: priorities to their groups, groups to their cards,
 * cards to the table and role that wrote them. Words are quoted as written.
 * d: { title, sessionName, madeAt, tables, tallyMode, snap, published, results,
 *      paperFlipDots, ai: { model, calls, cost, readings, confirmed, edited },
 *      sheetUrl, auditEntries }
 * Returns { title, lead: [..], sections: [{ heading, blocks: [{ p } | { list } | { table: { header, rows } }] }] }.
 */
function captureReport_(template, d) {
  const snap = d.snap;
  const roleLabel = code => (template.roles.find(r => r.code === code) || { label: 'Not marked' }).label;
  const levelLabel = code => (template.level.options.find(o => o.code === code) || { label: code || 'Not tagged' }).label;
  const primary = template.fields[0].key, flipKey = template.parent.key;
  const live = list => list.filter(x => !x.hidden);
  const cards = live(snap.cards), signals = live(snap.signals), flips = live(snap.flips);
  const byRole = list => template.roles.map(r => roleLabel(r.code) + ' ' + list.filter(x => x.role === r.code).length).join(', ') +
    (list.some(x => !template.roles.some(r => r.code === x.role)) ? ', not marked ' + list.filter(x => !template.roles.some(r => r.code === x.role)).length : '');
  const cardById = new Map(snap.cards.map(c => [c.id, c]));
  // A card hidden after its group was published is left out, like every other hidden entry.
  const cardRows = ids => ids.map(id => cardById.get(id)).filter(c => c && !c.hidden).map(c =>
    ['#' + c.id, 'Table ' + c.table, roleLabel(c.role), c.level, c.fields[primary], c.fields[flipKey] || '—', c.source]);
  const hiddenIn = ids => ids.map(id => cardById.get(id)).filter(c => c && c.hidden).length;
  const cardHeader = ['Card', 'Table', 'Written by', 'Tag', 'Need, as written', template.parent.label, 'How it came in'];
  const allNotes = snap.testDrive || [];
  const noteLists = notes => notes.map(note => ({ list: template.testDrive.prompts.filter(p => note.notes[p.key]).map(p => p.label + ': ' + note.notes[p.key]) }));
  const voters = snap.votes || [];
  const sections = [];

  const glance = [
    ['Signals', String(signals.length) + ' (' + byRole(signals) + ')'],
    [template.parent.label + 's', String(flips.length)],
    ['Need cards', String(cards.length) + ' (' + template.level.options.map(o => o.code + ' ' + cards.filter(c => c.level === o.code).length).join(', ') + '; ' + byRole(cards) + ')'],
    ['People who voted on a device', String(voters.length) + ' (' + byRole(voters) + ')'],
    ['Votes counted from', { phone: 'devices', paper: 'paper dots', both: 'devices and paper dots, added together' }[d.tallyMode] || 'devices']
  ];
  sections.push({ heading: 'At a glance', blocks: [{ table: { header: ['What', 'Count'], rows: glance } }] });

  const results = d.results;
  if (!results || !d.published) {
    sections.push({ heading: 'Priorities', blocks: [{ p: 'Nothing was published for voting, so there are no ranked priorities.' }] });
  } else {
    const rows = [];
    results.columns.forEach(col => col.items.forEach(i => rows.push(i)));
    const assignedTo = id => results.assignments.filter(a => a.groupId === id).map(a => 'Table ' + a.table).join(', ');
    // The same order the board and the table assignments use.
    const vote = results.priorities.map(p => rows.find(r => r.id === p.id)).filter(Boolean);
    const tied = vote.some((r, n) => n > 0 && r.total === vote[n - 1].total);
    // Notes go under the priority they were written about; notes saved without one go under the table's priority.
    const printed = new Set();
    const notesAbout = id => allNotes.filter(n => (n.groupId ? n.groupId === id : results.assignments.some(a => a.table === n.table && a.groupId === id)));
    const roleCols = template.roles.map(r => roleLabel(r.code) + 's');
    sections.push({ heading: 'Priorities', blocks: [
      { p: 'The ' + template.level.options.filter(o => o.route === 'vote').map(o => o.code).join(' and ') + ' needs, ranked by votes. A "?" means tables tagged the cards in that group differently.' +
        (tied ? ' Some priorities have the same number of votes: those are listed by how many tables raised them, then how many cards, then alphabetically.' : '') },
      { table: { header: ['Rank', 'Priority', 'Tag', 'Votes'].concat(roleCols).concat(['Tables', 'Cards', 'Test-driven by']),
        rows: vote.map((r, n) => [String(n + 1), r.topic + (r.contested ? ' ?' : ''), r.column, String(r.total)]
          .concat(template.roles.map(x => String(r[x.code] || 0))).concat([String(r.tableCount), String(r.cardCount), assignedTo(r.id) || '—'])) } }
    ] });
    vote.forEach((r, n) => {
      const blocks = [{ p: levelLabel(r.column) + ' · ' + r.total + ' votes (' + template.roles.map(x => roleLabel(x.code) + 's ' + (r[x.code] || 0)).join(', ') + ') · raised by ' +
        r.tableCount + (r.tableCount === 1 ? ' table' : ' tables') + ' in ' + r.cardCount + (r.cardCount === 1 ? ' card' : ' cards') + (r.contested ? ' · tables tagged these differently' : '') + '.' }];
      blocks.push({ table: { header: cardHeader, rows: cardRows(r.cardIds) } });
      const gone = hiddenIn(r.cardIds);
      if (gone) blocks.push({ p: gone + (gone === 1 ? ' card in this group was hidden after publishing and is not shown.' : ' cards in this group were hidden after publishing and are not shown.') });
      const about = notesAbout(r.id);
      about.forEach(n => printed.add(n));
      const tables = results.assignments.filter(a => a.groupId === r.id).map(a => a.table);
      about.forEach(n => { if (tables.indexOf(n.table) === -1) tables.push(n.table); });
      tables.sort((a, b) => a - b).forEach(table => {
        const notes = about.filter(n => n.table === table);
        blocks.push({ p: 'Test-drive notes from Table ' + table + (notes.length ? '' : ': none saved.') });
        noteLists(notes).forEach(b => blocks.push(b));
      });
      sections.push({ heading: (n + 1) + '. ' + r.topic, level: 2, blocks: blocks });
    });
    const parked = rows.filter(r => r.route === 'parking');
    sections.push({ heading: template.routes.parking, blocks: parked.length ? [
      { p: 'Needs tagged ' + template.level.options.filter(o => o.route === 'parking').map(o => o.code + ' (' + o.label.toLowerCase() + ')').join(', ') + ': they need more than guidance. Ranked by votes.' }
    ].concat(parked.map(r => ({ table: { header: cardHeader, rows: cardRows(r.cardIds) }, caption: r.topic + ' · ' + r.total + ' votes' }))) : [{ p: 'No groups were placed here.' }] });
    const stray = allNotes.filter(n => !printed.has(n));
    if (stray.length) {
      const blocks = [{ p: 'Notes written about a topic that is not one of the ranked priorities above.' }];
      stray.slice().sort((a, b) => a.table - b.table).forEach(n => { blocks.push({ p: 'Table ' + n.table + (n.topic ? ', about “' + n.topic + '”' : '') }); noteLists([n]).forEach(b => blocks.push(b)); });
      sections.push({ heading: 'Other test-drive notes', blocks: blocks });
    }
    const inGroups = new Set();
    d.published.forEach(g => g.cardIds.forEach(id => inGroups.add(id)));
    const loose = cards.filter(c => !inGroups.has(c.id));
    if (loose.length) sections.push({ heading: 'Cards not in a published group', blocks: [{ table: { header: cardHeader, rows: cardRows(loose.map(c => c.id)) } }] });
  }

  const dots = captureTallyFlipDots_(template, snap.flipDots, d.paperFlipDots);
  sections.push({ heading: template.parent.label + 's and gallery dots', blocks: [{ table: {
    header: ['Table', template.parent.label, 'Top'].concat(template.flipDots.map(x => x.label)),
    rows: flips.slice().sort((a, b) => a.table - b.table || a.id - b.id).map(f => ['Table ' + f.table, f.text, f.top ? 'Yes' : '']
      .concat(template.flipDots.map(x => { const n = dots[f.id] && dots[f.id][x.code]; return n ? n.total + ' (' + template.roles.map(r => r.code + ' ' + n[r.code]).join(', ') + ')' : '0'; })))
  } }] });

  sections.push({ heading: 'Signals', blocks: [{ table: { header: ['Table', 'Written by', 'Signal, as written', 'How it came in'],
    rows: signals.slice().sort((a, b) => a.table - b.table || a.id - b.id).map(s => ['Table ' + s.table, roleLabel(s.role), s.text, s.source || 'typed']) } }] });

  const ai = d.ai || {};
  const hidden = snap.cards.length - cards.length + snap.signals.length - signals.length + snap.flips.length - flips.length;
  sections.push({ heading: 'How this record was made', blocks: [{ list: [
    'Every signal, statement, card and note above is quoted as it was sent or confirmed. Counts, tags, rankings and table assignments are calculated from those entries, never by AI.',
    'AI (' + (ai.model || 'Gemini') + ') was used ' + (ai.calls || 0) + ' times: to suggest groups of cards and to read photos of cards and posters. People confirmed every suggestion' +
      (ai.readings ? '; of ' + ai.readings + ' photo readings, ' + (ai.confirmed || 0) + ' were confirmed, ' + (ai.edited || 0) + ' of them with changes' : '') + '.',
    'AI cost for this session: $' + (Number(ai.cost) || 0).toFixed(2) + '.',
    hidden === 1 ? '1 entry was hidden by facilitators or its writer. It is left out above and kept, unchanged, in the sheet.'
      : hidden ? hidden + ' entries were hidden by facilitators or their writers. They are left out above and kept, unchanged, in the sheet.' : 'No entries were hidden.',
    'The full record is in the sheet' + (d.sheetUrl ? ' (' + d.sheetUrl + ')' : '') + ', including the Live Audit tab: ' + (d.auditEntries || 0) +
      ' entries listing who did what and when, each AI reading as returned, and what people confirmed.'
  ] }] });

  return {
    title: (d.title || template.name) + ': results',
    lead: [
      (d.sessionName ? d.sessionName + '. ' : '') + 'Made from the live capture record on ' + d.madeAt + '.',
      'What students and adults said they need, how the room ranked it, and how current guidance held up against each top priority.'
    ],
    sections: sections
  };
}

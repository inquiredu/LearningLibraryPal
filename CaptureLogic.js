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
const CAPTURE_SOURCES_ = ['typed', 'voice', 'photo'];

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
  const text = String(value === undefined || value === null ? '' : value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
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
  if (!/^[a-f0-9]{16,40}$/.test(token)) throw new Error('This phone needs to reload the page. Then try again.');
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
 * The card's flip statement must be one of its own table's, and its text is
 * copied from there, never from the card.
 */
function captureValidateCard_(template, input, tableCount, flips) {
  if (!input || typeof input !== 'object') throw new Error('Nothing was sent. Try again.');
  const table = captureValidTable_(input.table, tableCount);
  const flipId = Number(input.flipId);
  const flip = (flips || []).find(f => f.id === flipId && f.table === table && !f.hidden);
  if (!flip) throw new Error('Choose which of your ' + template.parent.plural + ' this card is for.');
  const fields = {};
  fields[template.parent.key] = flip.text;
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
  return { table: table, flipId: flipId, fields: fields, level: level, role: role, source: used.length ? used.join('+') : 'typed' };
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
  const groups = [];
  (Array.isArray(proposed) ? proposed : []).forEach((group, index) => {
    if (!group || typeof group !== 'object') return;
    const ids = [];
    (Array.isArray(group.cardIds) ? group.cardIds : []).forEach(raw => {
      const id = Number(raw);
      if (live.has(id) && !seen.has(id)) { seen.add(id); ids.push(id); }
    });
    if (!ids.length) return;
    groups.push({
      id: captureCleanText_(group.id, 40) || 'g' + (index + 1),
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
  if (dots.length > template.flipDotsPerPerson) throw new Error('You can place up to ' + template.flipDotsPerPerson + ' dots.');
  return { voter: voter, role: role, dots: dots };
}

/** { flipId: { green: { S, A, total }, ... } } */
function captureTallyFlipDots_(template, dots) {
  const out = {};
  (dots || []).forEach(d => {
    const f = out[d.flipId] = out[d.flipId] || {};
    template.flipDots.forEach(c => { f[c.code] = f[c.code] || { total: 0 }; template.roles.forEach(r => { f[c.code][r.code] = f[c.code][r.code] || 0; }); });
    if (f[d.color]) {
      f[d.color].total++;
      if (f[d.color][d.role] !== undefined) f[d.color][d.role]++;
    }
  });
  return out;
}

/** One person's priority votes; sending again replaces them. Votes can stack on one group. */
function captureValidateVote_(template, published, input) {
  const sent = input && typeof input === 'object' ? input : {};
  const voter = captureValidToken_(sent.voter);
  const role = captureValidRole_(template, sent.role);
  const ids = new Set((published || []).map(g => g.id));
  const choices = (Array.isArray(sent.choices) ? sent.choices : []).map(String).filter(id => ids.has(id));
  if (!choices.length) throw new Error('Choose at least one before sending.');
  if (choices.length > template.vote.perPerson) throw new Error('You have ' + template.vote.perPerson + ' votes.');
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
    template.roles.forEach(r => { out[id].paper[r.code] = Math.max(0, Math.round(Number(paper[id][r.code]) || 0)); });
  });
  const use = mode === 'paper' ? ['paper'] : mode === 'both' ? ['phone', 'paper'] : ['phone'];
  Object.keys(out).forEach(id => {
    const t = out[id];
    template.roles.forEach(r => { t[r.code] = use.reduce((n, k) => n + t[k][r.code], 0); });
    t.total = template.roles.reduce((n, r) => n + t[r.code], 0);
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

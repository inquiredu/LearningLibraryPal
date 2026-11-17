/**
 * CaptureLogic
 * Pure rules for live capture: validating what a table sends, cleaning what a
 * model returns, and turning groups into counts and routes. No Google services
 * are used here, so tests/capture.test.cjs can run every rule in Node.
 *
 * Counts, table lists and routes are always computed here from the cards.
 * A model proposes topics and which cards belong together; it never supplies
 * a number a facilitator will read.
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

/** Throws a message a table can act on; returns the cleaned card otherwise. */
function captureValidateCard_(template, input, tableCount) {
  if (!input || typeof input !== 'object') throw new Error('Nothing was sent. Try again.');
  const table = Number(input.table);
  if (!Number.isInteger(table) || table < 1 || table > tableCount) {
    throw new Error('Choose your table number first.');
  }
  const fields = {};
  const sent = input.fields && typeof input.fields === 'object' ? input.fields : {};
  template.fields.forEach(field => {
    const text = captureCleanText_(sent[field.key], field.maxLength);
    if (!text) throw new Error('Add the ' + field.label.replace(/…$/, '').toLowerCase() + '.');
    fields[field.key] = text;
  });
  const codes = template.level.options.map(o => o.code);
  const level = String(input.level || '');
  if (codes.indexOf(level) === -1) throw new Error('Choose ' + codes.join(', ') + '.');
  const sources = Array.isArray(input.sources) ? input.sources : [input.source];
  const used = CAPTURE_SOURCES_.filter(s => sources.indexOf(s) !== -1);
  return { table: table, fields: fields, level: level, source: used.length ? used.join('+') : 'typed' };
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

function captureRouteForLevel_(template, code) {
  const option = template.level.options.find(o => o.code === code);
  return option ? option.route : 'vote';
}

/**
 * Makes any proposed grouping safe to show: every live card appears exactly
 * once, unknown or hidden ids are dropped, duplicates keep their first group,
 * and cards no group claimed are returned as `ungrouped`.
 */
function captureNormalizeGroups_(cards, proposed) {
  const live = new Set(cards.filter(c => !c.hidden).map(c => Number(c.id)));
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
    const routeOverride = group.routeOverride === 'vote' || group.routeOverride === 'parking' ? group.routeOverride : '';
    groups.push({
      id: captureCleanText_(group.id, 40) || 'g' + (index + 1),
      topic: captureCleanText_(group.topic, 80) || 'Untitled group',
      cardIds: ids,
      rank: Number.isFinite(Number(group.rank)) && Number(group.rank) > 0 ? Number(group.rank) : 0,
      routeOverride: routeOverride
    });
  });
  const ungrouped = [...live].filter(id => !seen.has(id)).sort((a, b) => a - b);
  return { groups: groups, ungrouped: ungrouped };
}

/** Counts and route for one group, always from the cards themselves. */
function captureGroupStats_(template, cards, group) {
  const byId = new Map(cards.map(c => [Number(c.id), c]));
  const members = group.cardIds.map(id => byId.get(Number(id))).filter(Boolean);
  const tables = [...new Set(members.map(c => c.table))].sort((a, b) => a - b);
  const levels = {};
  template.level.options.forEach(o => { levels[o.code] = 0; });
  members.forEach(c => { if (levels[c.level] !== undefined) levels[c.level]++; });
  const anyVote = members.some(c => captureRouteForLevel_(template, c.level) === 'vote');
  const defaultRoute = anyVote ? 'vote' : 'parking';
  return {
    tables: tables,
    tableCount: tables.length,
    cardCount: members.length,
    levels: levels,
    defaultRoute: defaultRoute,
    route: group.routeOverride || defaultRoute
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

/** Every card whose own level routes to the parking lot, in card order. */
function captureParkingLot_(template, cards) {
  return cards
    .filter(c => !c.hidden && captureRouteForLevel_(template, c.level) === 'parking')
    .sort((a, b) => a.id - b.id);
}

/** What the projector shows: counts and topics, no card text. */
function captureWallSummary_(template, cards, groups, tableCount, open) {
  const live = cards.filter(c => !c.hidden);
  const perTable = [];
  for (let t = 1; t <= tableCount; t++) perTable.push(live.filter(c => c.table === t).length);
  const levels = {};
  template.level.options.forEach(o => { levels[o.code] = live.filter(c => c.level === o.code).length; });
  const ordered = captureOrderGroups_(template, live, groups);
  return {
    open: open,
    total: live.length,
    perTable: perTable,
    levels: levels,
    topics: ordered.map(g => ({
      topic: g.topic,
      tableCount: g.stats.tableCount,
      cardCount: g.stats.cardCount,
      route: g.stats.route
    }))
  };
}

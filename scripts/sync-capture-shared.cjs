#!/usr/bin/env node
/**
 * Copies the shared live-capture styles and browser helpers into each page.
 *
 * Apps Script serves the pages that work best as self-contained documents:
 * one inline <style> and one inline <script>, nothing spliced in at request
 * time. CaptureStyles.html and CaptureClient.html stay the one source; this
 * script writes their contents between the markers in each page.
 *
 *   node scripts/sync-capture-shared.cjs          write the copies
 *   node scripts/sync-capture-shared.cjs --check  exit 1 if any page is out of date
 */
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const PAGES = ['Capture.html', 'CaptureBoard.html', 'CaptureWall.html', 'CaptureTableCards.html'];

const read = name => fs.readFileSync(path.join(ROOT, name), 'utf8');
const inner = (text, tag) => {
  const m = text.match(new RegExp('<' + tag + '>\\n?([\\s\\S]*?)\\n?\\s*</' + tag + '>'));
  if (!m) throw new Error('No <' + tag + '> block found');
  return m[1].replace(/\s+$/, '');
};
const blocks = {
  styles: { start: '/* shared:CaptureStyles */', end: '/* /shared:CaptureStyles */', body: inner(read('CaptureStyles.html'), 'style') },
  client: { start: '/* shared:CaptureClient */', end: '/* /shared:CaptureClient */', body: inner(read('CaptureClient.html'), 'script') }
};

function synced(text, file) {
  let out = text;
  for (const b of Object.values(blocks)) {
    const i = out.indexOf(b.start), j = out.indexOf(b.end);
    if (i === -1 || j === -1 || j < i) throw new Error(file + ' is missing the ' + b.start + ' markers');
    out = out.slice(0, i + b.start.length) + '\n' + b.body + '\n  ' + out.slice(j);
  }
  return out;
}

const check = process.argv.includes('--check');
let stale = [];
for (const file of PAGES) {
  const text = read(file);
  const next = synced(text, file);
  if (next !== text) {
    stale.push(file);
    if (!check) fs.writeFileSync(path.join(ROOT, file), next);
  }
}
if (check && stale.length) {
  console.error('Out of date with CaptureStyles.html / CaptureClient.html: ' + stale.join(', ') +
    '\nRun: node scripts/sync-capture-shared.cjs');
  process.exit(1);
}
console.log(check ? 'Live-capture pages match the shared styles and helpers.' : (stale.length ? 'Updated ' + stale.join(', ') : 'Already in sync.'));

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
let count = 0;
for (const file of fs.readdirSync(root)) {
  const full = path.join(root, file);
  if (file.endsWith('.js')) { new vm.Script(fs.readFileSync(full, 'utf8'), { filename: file }); count++; }
  if (file.endsWith('.html')) {
    for (const match of fs.readFileSync(full, 'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
      new vm.Script(match[1], { filename: file }); count++;
    }
  }
}
execFileSync('bash', ['-n', path.join(root, 'setup.sh')]);
JSON.parse(fs.readFileSync(path.join(root, 'appsscript.json'), 'utf8'));
console.log(`Checked ${count} server/client scripts, setup shell syntax, and manifest.`);

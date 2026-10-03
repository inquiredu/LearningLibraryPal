const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function fixture(t, existing) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llp-setup-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.copyFileSync(path.join(__dirname, '../setup.sh'), path.join(dir, 'setup.sh'));
  fs.mkdirSync(path.join(dir, 'node_modules/.bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Code.js'), 'APPLICATION_SOURCE');
  fs.writeFileSync(path.join(dir, 'appsscript.json'), 'APPLICATION_MANIFEST');
  if (existing) fs.writeFileSync(path.join(dir, '.clasp.json'), JSON.stringify({ scriptId: 'existing-script', parentId: 'existing-sheet', rootDir: '.' }));
  const mock = path.join(dir, 'node_modules/.bin/clasp');
  fs.writeFileSync(mock, `#!/usr/bin/env node
const fs = require('fs');
fs.appendFileSync(process.env.MOCK_LOG, JSON.stringify({args: process.argv.slice(2), cwd: process.cwd()}) + '\\n');
if (process.argv[2] === 'create-script') {
  if (process.env.FAIL_CREATE) process.exit(1);
  fs.writeFileSync('.clasp.json', JSON.stringify({scriptId:'new-script',parentId:'new-sheet',rootDir:'.'}));
  fs.writeFileSync('Code.js','STARTER_CODE');
  fs.writeFileSync('appsscript.json','STARTER_MANIFEST');
}
`);
  fs.chmodSync(mock, 0o755);
  return {
    dir,
    run: (input, extra = {}) => spawnSync('bash', ['setup.sh'], { cwd: dir, input, encoding: 'utf8', env: { ...process.env, CODESPACES: 'false', MOCK_LOG: path.join(dir, 'calls.log'), ...extra } }),
    config: () => JSON.parse(fs.readFileSync(path.join(dir, '.clasp.json'), 'utf8')),
    calls: () => fs.existsSync(path.join(dir, 'calls.log')) ? fs.readFileSync(path.join(dir, 'calls.log'), 'utf8').trim().split('\n').map(JSON.parse) : []
  };
}

test('fresh setup creates a bound project without overwriting source or manifest', t => {
  const f = fixture(t, false); const result = f.run('\nPilot Library\n');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.config().scriptId, 'new-script');
  assert.equal(fs.readFileSync(path.join(f.dir, 'Code.js'), 'utf8'), 'APPLICATION_SOURCE');
  assert.equal(fs.readFileSync(path.join(f.dir, 'appsscript.json'), 'utf8'), 'APPLICATION_MANIFEST');
  assert.deepEqual(f.calls().map(c => c.args[0]), ['login', 'create-script', 'push']);
  assert.notEqual(f.calls()[1].cwd, f.dir);
  assert.match(result.stdout, /NOT been created or updated/);
});

test('existing project defaults to a new destination and retains its old configuration backup', t => {
  const f = fixture(t, true); const result = f.run('\n\nNew Pilot\n');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.config().scriptId, 'new-script');
  const backup = fs.readdirSync(f.dir).find(name => name.startsWith('.clasp.backup.'));
  assert.ok(backup); assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir, backup))).scriptId, 'existing-script');
});

test('update requires matching destination; cancel and mismatch do not authenticate or upload', t => {
  for (const input of ['update\nwrong-id\n', 'cancel\n']) {
    const f = fixture(t, true); f.run(input);
    assert.equal(f.calls().length, 0);
    assert.equal(f.config().scriptId, 'existing-script');
  }
  const f = fixture(t, true); const result = f.run('update\nexisting-script\n\n');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(f.calls().map(c => c.args[0]), ['login', 'push']);
  assert.equal(f.config().scriptId, 'existing-script');
});

test('failed creation preserves existing configuration and never pushes', t => {
  const f = fixture(t, true); const result = f.run('\n\nNew Pilot\n', { FAIL_CREATE: '1' });
  assert.notEqual(result.status, 0);
  assert.equal(f.config().scriptId, 'existing-script');
  assert.equal(f.calls().some(c => c.args[0] === 'push'), false);
});

test('Codespaces setup uses the supported remote login option', t => {
  const f = fixture(t, false); const result = f.run('\nPilot\n', { CODESPACES: 'true' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(f.calls()[0].args, ['login', '--no-localhost']);
});

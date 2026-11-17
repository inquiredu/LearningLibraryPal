const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Runs scripts/poc.sh in a throwaway folder against a fake clasp that records
// every call, so no Google account is touched.
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llp-poc-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.copyFileSync(path.join(__dirname, '../scripts/poc.sh'), path.join(dir, 'scripts/poc.sh'));
  fs.copyFileSync(path.join(__dirname, '../appsscript.json'), path.join(dir, 'appsscript.json'));
  fs.writeFileSync(path.join(dir, '.claspignore'), '**/**\n!*.js\n');
  fs.writeFileSync(path.join(dir, '.clasprc.json'), '{}');
  fs.mkdirSync(path.join(dir, 'node_modules/.bin'), { recursive: true });
  const mock = path.join(dir, 'node_modules/.bin/clasp');
  fs.writeFileSync(mock, `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const log = entry => fs.appendFileSync(process.env.MOCK_LOG, JSON.stringify(entry) + '\\n');
if (args.includes('create-script')) {
  fs.writeFileSync('.clasp.json', JSON.stringify({ scriptId: 'SCRIPT1', parentId: 'SHEET1', rootDir: '.' }));
  log({ cmd: 'create', cwd: process.cwd() });
} else if (args.includes('push')) {
  const manifest = JSON.parse(fs.readFileSync('appsscript.json', 'utf8'));
  const deployFile = fs.existsSync('CaptureDeploy.js') ? fs.readFileSync('CaptureDeploy.js', 'utf8') : '';
  log({ cmd: 'push', args, access: manifest.webapp.access, deployFile });
} else if (args.includes('create-deployment')) {
  const i = args.indexOf('-i');
  const n = fs.readFileSync(process.env.MOCK_LOG, 'utf8').split('\\n').filter(l => l.includes('"deploy"')).length + 1;
  const id = i >= 0 ? args[i + 1] : 'DEP' + n;
  log({ cmd: 'deploy', id, redeploy: i >= 0 });
  console.log('Deploying project...');
  console.log(JSON.stringify({ deploymentId: id, versionNumber: n }, null, 2));
}
`);
  fs.chmodSync(mock, 0o755);
  const logFile = path.join(dir, 'calls.log');
  fs.writeFileSync(logFile, '');
  return {
    dir,
    run: () => spawnSync('bash', ['scripts/poc.sh'], { cwd: dir, encoding: 'utf8', env: { ...process.env, HOME: dir, CODESPACES: 'false', MOCK_LOG: logFile } }),
    calls: () => fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)),
    read: name => fs.readFileSync(path.join(dir, name), 'utf8')
  };
}

test('first run makes a new project with a public deployment and a sign-in deployment', t => {
  const f = fixture(t);
  const originalManifest = f.read('appsscript.json');
  const r = f.run();
  assert.equal(r.status, 0, r.stderr);
  const calls = f.calls();
  assert.deepEqual(calls.map(c => c.cmd), ['create', 'push', 'deploy', 'push', 'deploy']);
  assert.notEqual(calls[0].cwd, f.dir, 'the new project is created in a temporary folder');
  assert.equal(calls[1].access, 'ANYONE_ANONYMOUS');
  assert.equal(calls[1].deployFile, '');
  assert.ok(calls[1].args.includes('.clasp.poc.json') && calls[1].args.includes('--force'));
  assert.equal(calls[3].access, 'ANYONE');
  assert.match(calls[3].deployFile, /CAPTURE_PUBLIC_URL = 'https:\/\/script\.google\.com\/macros\/s\/DEP1\/exec'/);
  const state = JSON.parse(f.read('.poc.json'));
  assert.equal(state.publicDeploymentId, 'DEP1');
  assert.equal(state.boardDeploymentId, 'DEP2');
  assert.equal(state.sheetId, 'SHEET1');
  assert.equal(f.read('appsscript.json'), originalManifest, 'the checked-in manifest is restored');
  assert.equal(fs.existsSync(path.join(f.dir, '.clasp.json')), false, 'a normal Learning Library setup file is never written');
  assert.match(r.stdout, /DEP2\/exec\?page=board/);
  assert.match(r.stdout, /spreadsheets\/d\/SHEET1/);
});

test('a second run updates both deployments instead of creating new ones', t => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  fs.writeFileSync(path.join(f.dir, 'calls.log'), '');
  const r = f.run();
  assert.equal(r.status, 0, r.stderr);
  const calls = f.calls();
  assert.deepEqual(calls.map(c => c.cmd), ['push', 'deploy', 'push', 'deploy']);
  assert.deepEqual(calls.filter(c => c.cmd === 'deploy').map(c => [c.id, c.redeploy]), [['DEP1', true], ['DEP2', true]]);
  assert.equal(calls[0].access, 'ANYONE_ANONYMOUS');
  assert.match(calls[0].deployFile, /DEP1/);
  assert.equal(calls[2].access, 'ANYONE');
});

'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {jsonc, zedSettings, option} = require('./install-helper.cjs');
const project = path.resolve(__dirname, '..');
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('Zed JSONC keeps unrelated settings, URLs, and comments; repeated activation is stable', () => {
  const before = Buffer.from('// project comment\n{\n "theme":"test", // keep this\n "url":"https://example.com/a//b",\n "agent_servers":{"other":{"type":"custom"},"codex-acp":{"type":"registry","env":{"NODE_OPTIONS":"--max-old-space-size=4096"}}},\n}\n');
  const after = zedSettings(before);
  const value = jsonc(after).value;
  assert.equal(value.theme, 'test');
  assert.equal(value.url, 'https://example.com/a//b');
  assert.deepEqual(value.agent_servers.other, {type: 'custom'});
  assert.equal(value.agent_servers['codex-acp'].env.NODE_OPTIONS, '--max-old-space-size=4096 ' + option);
  assert.ok(after.includes('// keep this'));
  assert.equal(zedSettings(Buffer.from(after)), after);
});
test('Empty settings and settings with a trailing comma can gain the registry agent', () => {
  for (const text of ['{}', '{"theme":"test"}', '{"theme":"test", /* trailing */ }', '\uFEFF{}']) {
    assert.equal(jsonc(zedSettings(Buffer.from(text))).value.agent_servers['codex-acp'].type, 'registry');
  }
});
test('Conflicting agent definitions and duplicate root keys fail before editing', () => {
  assert.throws(() => zedSettings(Buffer.from('{"agent_servers":{"codex-acp":{"type":"custom"}}}')), /custom/);
  assert.throws(() => zedSettings(Buffer.from('{"agent_servers":{"codex-acp":{"env":{"CODEX_PATH":"mine"}}}}')), /override/);
  assert.throws(() => jsonc('{"agent_servers":{},"agent_servers":{}}'), /Duplicate/);
});

test('Real CLI: activation, rerun, edited-settings protection, and rollback restore original bytes', {timeout: 150000}, () => {
  const windows = process.platform === 'win32';
  const platform = windows ? 'windows' : 'linux';
  const vendorTarget = windows ? 'x86_64-pc-windows-msvc' : 'x86_64-unknown-linux-musl';
  const vendor = path.join(project, `build/vendor-0.160.0-${platform}/package/vendor/${vendorTarget}`);
  assert.ok(fs.existsSync(vendor), 'Fetch the official 0.160.0 vendor fixture before this test');
  const fixture = path.join(process.env.CODEX_INSTALLER_TEST_ROOT || path.join(project, 'build'), 'installer-test-' + crypto.randomUUID());
  const home = path.join(fixture, 'home'), packageDir = path.join(fixture, 'package');
  fs.mkdirSync(home, {recursive: true});
  function copyTree(source, target) {
    fs.mkdirSync(target, {recursive: true});
    for (const entry of fs.readdirSync(source, {withFileTypes: true})) {
      if (entry.isDirectory()) copyTree(path.join(source, entry.name), path.join(target, entry.name));
      else fs.writeFileSync(path.join(target, entry.name), fs.readFileSync(path.join(source, entry.name)));
    }
  }
  copyTree(vendor, packageDir);
  fs.writeFileSync(path.join(packageDir, 'source.patch'), fs.readFileSync(path.join(project, 'patches/codex-0.159.2-reasoning-accounting.patch')));
  const binaryName = windows ? 'bin/codex.exe' : 'bin/codex';
  const manifest = {version: '0.160.0-reasoning.1', upstream_version: '0.160.0', upstream_commit: 'a956835d020762cb2b570053af06f643a11c0ecc',
    platform, executable: binaryName, binary_sha256: digest(path.join(packageDir, binaryName)), patch_sha256: digest(path.join(packageDir, 'source.patch')), files: {}};
  function files(dir) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) files(file);
      else manifest.files[path.relative(packageDir, file).replaceAll('\\', '/')] = digest(file);
    }
  }
  files(packageDir);
  fs.writeFileSync(path.join(packageDir, 'release-manifest.json'), JSON.stringify(manifest));
  const settings = path.join(home, 'settings.json');
  const before = '// preserve\n{"theme":"test", "agent_servers":{},}\n';
  fs.writeFileSync(settings, before);
  const env = {...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, '.codex'), APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local')};
  for (const key of ['CODEX_PATH', 'CODEX_CONFIG', 'NODE_OPTIONS']) delete env[key];
  const helper = path.join(__dirname, 'install-helper.cjs');
  function run(request, success = true) {
    const file = path.join(fixture, 'request.json');
    fs.writeFileSync(file, JSON.stringify(request));
    const child = spawnSync(process.execPath, [helper, file], {env, encoding: 'utf8', timeout: 65000, windowsHide: true});
    if (success) { assert.equal(child.status, 0, child.stderr + child.stdout); return JSON.parse(child.stdout); }
    assert.notEqual(child.status, 0); return child.stderr;
  }
  // Shared loader is a release asset, alongside install-helper.cjs.
  const assets = path.join(fixture, 'assets'); fs.mkdirSync(assets);
  fs.writeFileSync(path.join(assets, 'preload.cjs'), fs.readFileSync(path.join(project, 'bootstrap/preload.cjs')));
  fs.writeFileSync(path.join(assets, 'install-helper.cjs'), fs.readFileSync(helper));
  const prepare = id => run({operation: 'prepare', transactionId: id, packageDir, assetsDir: assets, settingsPath: settings, connectZed: true, installCli: true});
  const id = crypto.randomUUID();
  prepare(id);
  assert.equal(fs.readFileSync(settings, 'utf8'), before, 'Preparation must not activate the patch');
  const committed = run({operation: 'commit', transactionId: id});
  assert.equal(committed.validation.app_server, 'passed');
  assert.equal(committed.validation.inference_requests, 0);
  const installed = fs.readFileSync(settings, 'utf8');
  assert.ok(installed.includes('codex-context-accounting-fix'));
  const shim = path.join(home, '.codex/context-accounting-fix/bin', windows ? 'codex.cmd' : 'codex');
  const cli = windows ? spawnSync('cmd.exe', ['/d', '/s', '/c', '""' + shim + '" --version"'], {env, encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true}) :
    spawnSync(shim, ['--version'], {env, encoding: 'utf8'});
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(cli.stdout.trim(), 'codex-cli 0.160.0');
  assert.equal(run({operation: 'commit', transactionId: id}).alreadyInstalled, true);
  // A second transaction must not duplicate settings/PATH entries.
  const second = crypto.randomUUID(); prepare(second);
  run({operation: 'commit', transactionId: second});
  assert.equal(fs.readFileSync(settings, 'utf8'), installed);
  run({operation: 'rollback', transactionId: second});
  fs.appendFileSync(settings, '// manual edit\n');
  assert.match(run({operation: 'rollback', transactionId: id}, false), /preserve your edits/);
  assert.ok(fs.existsSync(path.join(home, '.codex/context-accounting-fix/current.json')), 'Refused rollback must not change other files');
  fs.writeFileSync(settings, installed);
  run({operation: 'rollback', transactionId: id});
  assert.equal(fs.readFileSync(settings, 'utf8'), before);
  assert.ok(!fs.existsSync(path.join(home, '.codex/context-accounting-fix/current.json')));
  // An invalid existing profile makes startup fail after activation. Restore automatically.
  const badId = crypto.randomUUID();
  prepare(badId);
  fs.writeFileSync(path.join(home, '.codex/config.toml'), 'model = [\n');
  assert.match(run({operation: 'commit', transactionId: badId}, false), /Startup|config|TOML/i);
  assert.equal(fs.readFileSync(settings, 'utf8'), before);
  assert.ok(!fs.existsSync(path.join(home, '.codex/context-accounting-fix/current.json')));
  // Corrupt a file, then ensure preparation fails before activation.
  fs.appendFileSync(path.join(packageDir, 'source.patch'), 'tampered');
  assert.match(run({operation: 'prepare', transactionId: crypto.randomUUID(), packageDir, assetsDir: assets}, false), /checksum mismatch/);
});

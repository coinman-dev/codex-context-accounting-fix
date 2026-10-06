// Installation transactions shared by Windows and WSL. No npm dependencies.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {spawn, spawnSync} = require('node:child_process');
const WINDOWS = process.platform === 'win32';
const VERSION = '0.160.0-reasoning.1';
const UPSTREAM = 'a956835d020762cb2b570053af06f643a11c0ecc';
const marker = '#codex-context-accounting-fix';
const bootstrap = 'import{homedir}from"node:os";import{join}from"node:path";import{pathToFileURL}from"node:url";await import(pathToFileURL(join(homedir(),".codex","context-accounting-fix","preload.cjs")).href);';
const option = '--import=data:text/javascript,' + encodeURIComponent(bootstrap) + marker;
const root = path.join(os.homedir(), '.codex', 'context-accounting-fix');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const read = file => fs.existsSync(file) ? fs.readFileSync(file) : null;
const same = (a, b) => a === null ? b === null : b !== null && a.equals(b);
function inside(base, name) {
  const target = path.resolve(base, name);
  const relative = path.relative(base, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe relative path: ' + name);
  return target;
}
function atomic(file, data) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temporary = file + '.context-fix-' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(temporary, data, {flag: 'wx'});
  fs.renameSync(temporary, file);
}
function copyNew(source, target) {
  try { fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL); }
  catch (error) {
    // WSL's Windows mounts can reject copy_file_range even for readable files.
    if (!['EPERM', 'ENOTSUP', 'EXDEV'].includes(error.code)) throw error;
    fs.writeFileSync(target, fs.readFileSync(source), {flag: 'wx'});
  }
}

// Locate JSON properties while preserving comments and formatting elsewhere.
function jsonc(text) {
  const tokens = [];
  const re = /\s+|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|[{}\[\]:,]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/gy;
  let offset = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
  let clean = text.slice(0, offset).replace('\uFEFF', ' ');
  while (offset < text.length) {
    re.lastIndex = offset;
    const match = re.exec(text);
    if (!match) throw new Error('Invalid JSONC near offset ' + offset);
    const value = match[0];
    const comment = value.startsWith('//') || value.startsWith('/*');
    clean += comment ? value.replace(/[^\r\n]/g, ' ') : value;
    if (!comment && !/^\s/.test(value)) tokens.push({value, start: offset, end: re.lastIndex});
    offset = re.lastIndex;
  }
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i].value === ',' && /^[}\]]$/.test(tokens[i + 1].value)) {
      const at = tokens[i].start;
      clean = clean.slice(0, at) + ' ' + clean.slice(at + 1);
    }
  }
  const value = JSON.parse(clean);
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Zed settings must be a JSON object');
  const properties = new Map();
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (depth === 1 && token.value.startsWith('"') && tokens[i + 1]?.value === ':') {
      const key = JSON.parse(token.value);
      if (properties.has(key)) throw new Error('Duplicate settings property: ' + key);
      const first = i + 2;
      let last = first;
      if (tokens[first].value === '{' || tokens[first].value === '[') {
        let nested = 1;
        while (nested && ++last < tokens.length) {
          if (/^[{\[]$/.test(tokens[last].value)) nested++;
          if (/^[}\]]$/.test(tokens[last].value)) nested--;
        }
      }
      properties.set(key, {start: tokens[first].start, end: tokens[last].end});
    }
    if (/^[{\[]$/.test(token.value)) depth++;
    if (/^[}\]]$/.test(token.value)) depth--;
  }
  return {value, properties, tokens};
}

function zedSettings(original) {
  const text = original === null ? '{}\n' : original.toString('utf8');
  const parsed = jsonc(text);
  const agents = structuredClone(parsed.value.agent_servers || {});
  if (typeof agents !== 'object' || Array.isArray(agents)) throw new Error('Invalid agent_servers');
  const agent = agents['codex-acp'] || {type: 'registry'};
  if (agent.type && agent.type !== 'registry') throw new Error('codex-acp uses a custom command; use -SkipZed or restore the registry agent first');
  if (agent.env?.CODEX_PATH) throw new Error('Zed already has a CODEX_PATH override; use -SkipZed or remove that override first');
  agent.type = 'registry';
  agent.env ||= {};
  const previous = String(agent.env.NODE_OPTIONS || '').replace(/(?:^|\s)--import=data:text\/javascript,[^\s]*#codex-context-accounting-fix(?=\s|$)/g, ' ').trim();
  agent.env.NODE_OPTIONS = (previous + ' ' + option).trim();
  agents['codex-acp'] = agent;
  const replacement = JSON.stringify(agents, null, 2);
  const span = parsed.properties.get('agent_servers');
  let updated;
  if (span) updated = text.slice(0, span.start) + replacement + text.slice(span.end);
  else {
    const close = parsed.tokens.at(-1);
    const preceding = parsed.tokens.at(-2);
    const separator = preceding.value === '{' || preceding.value === ',' ? '' : ',';
    updated = text.slice(0, close.start) + separator + '\n  "agent_servers": ' + replacement + '\n' + text.slice(close.start);
  }
  jsonc(updated);
  return updated;
}

function verifyPackage(directory) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'release-manifest.json'), 'utf8'));
  if (manifest.version !== VERSION || manifest.upstream_version !== '0.160.0' || manifest.upstream_commit !== UPSTREAM ||
      manifest.platform !== (WINDOWS ? 'windows' : 'linux') || manifest.executable !== ('bin/' + (WINDOWS ? 'codex.exe' : 'codex'))) {
    throw new Error('Release manifest does not match this installer/platform');
  }
  for (const [name, digest] of Object.entries(manifest.files)) {
    if (!/^[0-9a-f]{64}$/.test(digest) || hash(fs.readFileSync(inside(directory, name))) !== digest) throw new Error('File checksum mismatch: ' + name);
  }
  if (manifest.files[manifest.executable] !== manifest.binary_sha256 || manifest.files['source.patch'] !== manifest.patch_sha256) throw new Error('Invalid binary/patch checksum');
  return manifest;
}

function executableMode(file) {
  if (!WINDOWS && (/\/(?:bin|codex-path)\//.test(file.replaceAll('\\', '/')) || path.basename(file) === 'bwrap')) fs.chmodSync(file, 0o755);
}

function cliShim() {
  // Resolve current.json on every invocation, so updates and rollbacks also work in terminals.
  const launch = `const fs=require('node:fs'),p=require('node:path'),os=require('node:os'),cp=require('node:child_process');const r=p.join(os.homedir(),'.codex','context-accounting-fix');const m=JSON.parse(fs.readFileSync(p.join(r,'current.json'),'utf8'));const exe=p.resolve(r,m.executable);const rel=p.relative(r,exe);if(rel.startsWith('..')||p.isAbsolute(rel))throw Error('Invalid installed path');const env={...process.env};for(const k of ['CODEX_MANAGED_PACKAGE_ROOT','CODEX_MANAGED_BY_NPM','CODEX_MANAGED_BY_BUN','CODEX_MANAGED_BY_PNPM','CODEX_MANAGED_BY_VITE_PLUS'])delete env[k];const c=cp.spawn(exe,process.argv.slice(2),{stdio:'inherit',env,windowsHide:false});c.on('error',e=>{console.error(e.message);process.exitCode=1});c.on('exit',(code,signal)=>{if(signal)process.kill(process.pid,signal);else process.exitCode=code??1});`;
  return launch + '\n';
}

function prepare(request) {
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(request.transactionId)) throw new Error('Invalid transaction id');
  const directory = path.resolve(request.packageDir);
  const manifest = verifyPackage(directory);
  const release = inside(root, VERSION);
  fs.mkdirSync(release, {recursive: true});
  for (const name of [...Object.keys(manifest.files), 'release-manifest.json']) {
    const source = inside(directory, name), target = inside(release, name);
    if (fs.existsSync(target)) {
      if (!same(read(target), read(source))) throw new Error('Existing release differs: ' + target);
    } else {
      fs.mkdirSync(path.dirname(target), {recursive: true});
      copyNew(source, target);
    }
    executableMode(target);
  }
  const binary = inside(release, manifest.executable);
  const version = spawnSync(binary, ['--version'], {encoding: 'utf8', timeout: 20000, windowsHide: true});
  if (version.status !== 0 || version.stdout.trim() !== 'codex-cli 0.160.0') throw new Error('CLI startup failed: ' + version.stderr);
  const transactionDir = inside(root, 'transactions/' + request.transactionId);
  if (fs.existsSync(transactionDir)) throw new Error('Transaction already exists');
  fs.mkdirSync(transactionDir, {recursive: true});
  const plans = [];
  function add(file, text, mode) {
    const before = read(file), after = Buffer.isBuffer(text) ? text : Buffer.from(text);
    if (same(before, after)) return;
    const index = plans.length;
    if (before !== null) fs.writeFileSync(path.join(transactionDir, index + '.before'), before);
    fs.writeFileSync(path.join(transactionDir, index + '.after'), after);
    plans.push({file, beforeHash: before === null ? null : hash(before), afterHash: hash(after), existed: before !== null,
                mode: mode || (before !== null && !WINDOWS ? fs.statSync(file).mode & 0o777 : 0o644)});
  }
  add(path.join(root, 'current.json'), json({...manifest, executable: VERSION + '/' + manifest.executable, installed_at: new Date().toISOString(),
      release_tag: 'v' + VERSION, platform: WINDOWS ? 'Windows' : 'Linux'}));
  add(path.join(root, 'preload.cjs'), fs.readFileSync(path.join(request.assetsDir, 'preload.cjs')));
  add(path.join(root, 'install-helper.cjs'), fs.readFileSync(path.join(request.assetsDir, 'install-helper.cjs')));
  add(path.join(root, 'node-options.txt'), option + '\n');
  add(path.join(root, 'last-install.json'), json({transactionId: request.transactionId, version: VERSION}));
  if (request.connectZed) {
    const settings = request.settingsPath || (WINDOWS ? path.join(process.env.APPDATA, 'Zed', 'settings.json') : path.join(os.homedir(), '.config', 'zed', 'settings.json'));
    // WSL's Zed agent is usually configured by Windows; standalone Linux Zed is optional.
    if (WINDOWS || fs.existsSync(settings)) add(settings, zedSettings(read(settings)));
  }
  if (request.installCli) {
    const bin = path.join(root, 'bin');
    add(path.join(bin, 'launch.cjs'), cliShim());
    if (WINDOWS) {
      if (/[%\r\n]/.test(process.execPath)) throw new Error('Node path cannot be used by a cmd launcher');
      add(path.join(bin, 'codex.cmd'), '@echo off\r\n"' + process.execPath + '" "%~dp0launch.cjs" %*\r\n');
    } else {
      const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'";
      add(path.join(bin, 'codex'), '#!/bin/sh\nexec ' + shellQuote(process.execPath) + ' ' + shellQuote(path.join(bin, 'launch.cjs')) + ' "$@"\n', 0o755);
      for (const filename of ['.profile', '.bashrc', '.zshrc']) {
        const file = path.join(os.homedir(), filename);
        if (filename === '.zshrc' && !fs.existsSync(file)) continue;
        const content = (read(file) || Buffer.alloc(0)).toString('utf8');
        if (!content.includes('# codex-context-accounting-fix PATH')) add(file, content + '\n# codex-context-accounting-fix PATH\nexport PATH="$HOME/.codex/context-accounting-fix/bin:$PATH"\n');
      }
    }
  }
  const transaction = {id: request.transactionId, state: 'prepared', plans, request, release: VERSION, created_at: new Date().toISOString()};
  atomic(path.join(transactionDir, 'transaction.json'), json(transaction));
  return {state: 'prepared', transactionId: transaction.id, version: VERSION, binary, changedFiles: plans.map(p => p.file)};
}

function loadTransaction(id) {
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(id)) throw new Error('Invalid transaction id');
  const directory = inside(root, 'transactions/' + id);
  return {directory, transaction: JSON.parse(fs.readFileSync(path.join(directory, 'transaction.json'), 'utf8'))};
}

function restore(directory, transaction, force = false, dryRun = false) {
  const changed = [];
  for (let i = transaction.plans.length - 1; i >= 0; i--) {
    const plan = transaction.plans[i];
    const current = read(plan.file);
    const currentHash = current === null ? null : hash(current);
    if (currentHash === plan.beforeHash) continue;
    if (currentHash !== plan.afterHash) {
      if (!force) throw new Error('File changed after installation; rollback stopped to preserve your edits: ' + plan.file);
      continue;
    }
    changed.push({i, plan});
  }
  if (dryRun) return {state: 'rollback-ready', transactionId: transaction.id, restoredFiles: changed.length};
  // Check all files before restoring any, so a manual edit never causes a partial rollback.
  for (const {i, plan} of changed) {
    if (plan.existed) { atomic(plan.file, fs.readFileSync(path.join(directory, i + '.before'))); if (!WINDOWS) fs.chmodSync(plan.file, plan.mode); }
    else fs.unlinkSync(plan.file);
  }
  transaction.state = 'rolled-back';
  atomic(path.join(directory, 'transaction.json'), json(transaction));
  return {state: transaction.state, transactionId: transaction.id, restoredFiles: changed.length};
}

async function protocolProbe(binary, adapter, cwd) {
  return new Promise((resolve, reject) => {
    const env = {...process.env};
    delete env.CODEX_PATH;
    delete env.CODEX_CONFIG;
    if (adapter) { env.NODE_OPTIONS = option; env.CODEX_CONTEXT_FIX_TRACE = '1'; }
    else delete env.NODE_OPTIONS;
    const child = spawn(adapter ? process.execPath : binary, adapter ? [adapter] : ['app-server'], {cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
    let stderr = '', pending = '', selected = !adapter, settled = false;
    function finish(error, status = 'passed') {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const done = () => { if (error) reject(error); else resolve(status); };
      // The next probe opens the same SQLite profile. Wait for the previous
      // process to exit and release its handles before starting the adapter.
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        child.once('close', done);
        child.stdin.end();
        child.kill();
      } else done();
    }
    const timer = setTimeout(() => finish(new Error('Startup probe timed out: ' + stderr)), 30000);
    child.on('error', finish);
    child.stdin.on('error', finish);
    child.on('close', code => { if (!settled) finish(new Error('Startup process exited (' + code + '): ' + stderr)); });
    child.stderr.on('data', data => {
      stderr = (stderr + data).slice(-6000);
      for (const line of stderr.split('\n')) {
        try { if (JSON.parse(line).executable === binary) selected = true; } catch {}
      }
    });
    function send(id, method, params) { child.stdin.write(JSON.stringify({jsonrpc: '2.0', ...(id === null ? {} : {id}), method, params}) + '\n'); }
    child.stdout.on('data', data => {
      if (settled) return;
      pending += data;
      const lines = pending.split('\n'); pending = lines.pop();
      for (const line of lines) {
        let event; try { event = JSON.parse(line); } catch { continue; }
        if (event.id !== 1 && event.id !== 2) continue;
        if (event.error) {
          if (adapter && event.id === 2 && selected && event.error.code === -32000 && /Authentication required/i.test(event.error.message || '')) {
            finish(null, 'authentication-required');
          } else finish(new Error(JSON.stringify(event.error) + '\n' + stderr));
          return;
        }
        if (event.id === 1) {
          if (adapter) send(2, 'session/new', {cwd, mcpServers: []});
          else { send(null, 'initialized', {}); send(2, 'thread/start', {cwd, persistExtendedHistory: false}); }
        } else if (selected) finish();
        else finish(new Error('ACP did not select the patched binary: ' + stderr));
      }
    });
    send(1, 'initialize', adapter ? {protocolVersion: 1, clientCapabilities: {}, clientInfo: {name: 'zed', version: 'context-accounting-validation'}} :
      {clientInfo: {name: 'context_accounting_validation', version: VERSION}, capabilities: {experimentalApi: true}});
  });
}

async function probe(save = true) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'current.json'), 'utf8'));
  const binary = inside(root, manifest.executable);
  if (hash(fs.readFileSync(binary)) !== manifest.binary_sha256) throw new Error('Installed binary checksum mismatch');
  const cwd = path.join(root, 'validation'); fs.mkdirSync(cwd, {recursive: true});
  await protocolProbe(binary, null, cwd);
  const zed = WINDOWS ? path.join(process.env.LOCALAPPDATA, 'Zed') : path.join(os.homedir(), '.local/share/zed');
  const adapter = path.join(zed, 'external_agents/registry/npx/codex-acp/node_modules/@agentclientprotocol/codex-acp/dist/index.js');
  const acp = fs.existsSync(adapter) ? await protocolProbe(binary, adapter, cwd) : 'not-installed';
  const result = {version: VERSION, selected_binary: binary, app_server: 'passed',
    acp, inference_requests: 0};
  if (save) atomic(path.join(root, 'startup-validation.json'), json(result));
  return result;
}

async function commit(id) {
  const {directory, transaction} = loadTransaction(id);
  if (transaction.state === 'committed') return {state: 'committed', transactionId: id, alreadyInstalled: true};
  if (transaction.state !== 'prepared') throw new Error('Transaction is not prepared');
  for (const plan of transaction.plans) {
    const current = read(plan.file);
    if ((current === null ? null : hash(current)) !== plan.beforeHash) throw new Error('File changed during preparation: ' + plan.file);
  }
  try {
    transaction.state = 'committing'; atomic(path.join(directory, 'transaction.json'), json(transaction));
    for (let i = 0; i < transaction.plans.length; i++) {
      const plan = transaction.plans[i];
      atomic(plan.file, fs.readFileSync(path.join(directory, i + '.after')));
      if (!WINDOWS) fs.chmodSync(plan.file, plan.mode);
    }
    const validation = await probe(false);
    const proofFile = path.join(root, 'startup-validation.json');
    const beforeProof = read(proofFile), afterProof = Buffer.from(json(validation));
    const proofIndex = transaction.plans.length;
    if (beforeProof !== null) fs.writeFileSync(path.join(directory, proofIndex + '.before'), beforeProof);
    fs.writeFileSync(path.join(directory, proofIndex + '.after'), afterProof);
    transaction.plans.push({file: proofFile, beforeHash: beforeProof === null ? null : hash(beforeProof), afterHash: hash(afterProof),
      existed: beforeProof !== null, mode: 0o644});
    atomic(path.join(directory, 'transaction.json'), json(transaction));
    atomic(proofFile, afterProof);
    transaction.state = 'committed'; transaction.validation = validation;
    atomic(path.join(directory, 'transaction.json'), json(transaction));
    return {state: 'committed', transactionId: id, validation};
  } catch (error) {
    restore(directory, transaction, true);
    throw error;
  }
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('Node.js 20 or newer is required');
  const request = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  let result;
  if (request.operation === 'prepare') result = prepare(request);
  else if (request.operation === 'commit') result = await commit(request.transactionId);
  else if (request.operation === 'rollback' || request.operation === 'rollback-check') {
    const id = request.transactionId || JSON.parse(fs.readFileSync(path.join(root, 'last-install.json'), 'utf8')).transactionId;
    const {directory, transaction} = loadTransaction(id);
    result = restore(directory, transaction, false, request.operation === 'rollback-check');
  } else if (request.operation === 'probe') result = await probe();
  else throw new Error('Unknown installer operation');
  console.log(JSON.stringify(result));
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = {jsonc, zedSettings, verifyPackage, option};

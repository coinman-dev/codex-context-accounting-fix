// Remove installation scratch data while preserving active files and rollback.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const load = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const versionPattern = /^\d+\.\d+\.\d+-reasoning[-.][a-zA-Z0-9.-]+$/;

function child(root, name) {
  const target = path.resolve(root, name), rel = path.relative(root, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Cleanup path outside installation: ' + name);
  return target;
}
function treeSize(file) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink()) throw new Error('Cleanup refuses symlinks/junctions: ' + file);
  if (!stat.isDirectory()) return stat.size;
  return fs.readdirSync(file).reduce((sum, name) => sum + treeSize(path.join(file, name)), 0);
}
function removeTree(root, target) {
  child(root, path.relative(root, target));
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) throw new Error('Cleanup refuses symlinks/junctions: ' + target);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(target)) removeTree(root, path.join(target, name));
    fs.rmdirSync(target);
  } else fs.unlinkSync(target);
}

function cleanup(root, request = {}) {
  root = path.resolve(root);
  // Validate the root itself and the live binary before removing any data.
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('Installation root is a symlink/junction');
  const manifest = load(child(root, 'current.json'));
  if (!versionPattern.test(manifest.version)) throw new Error('Unrecognized installed version');
  const binary = child(root, manifest.executable);
  if (hash(binary) !== manifest.binary_sha256) throw new Error('Installed binary checksum mismatch; cleanup refused');
  const keep = new Set([manifest.version]);
  const visited = new Set();
  let pending = false;
  const transactions = child(root, 'transactions');
  function follow(id) {
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(id)) throw new Error('Invalid rollback transaction');
    if (visited.has(id)) return;
    visited.add(id);
    const dir = child(transactions, id), transaction = load(path.join(dir, 'transaction.json'));
    if (transaction.state === 'prepared' || transaction.state === 'committing') pending = true;
    if (transaction.release && versionPattern.test(transaction.release)) keep.add(transaction.release);
    for (let i = 0; i < transaction.plans.length; i++) {
      const plan = transaction.plans[i];
      if (!plan.existed) continue;
      const filename = path.basename(plan.file);
      if (filename !== 'current.json' && filename !== 'last-install.json') continue;
      const before = load(path.join(dir, i + '.before'));
      if (filename === 'current.json') {
        if (!versionPattern.test(before.version)) throw new Error('Unrecognized rollback version');
        keep.add(before.version);
      } else if (before.transactionId) follow(before.transactionId);
    }
  }
  const last = child(root, 'last-install.json');
  if (fs.existsSync(last)) follow(load(last).transactionId);
  // Another installer may have prepared a version before committing its pointer.
  if (fs.existsSync(transactions)) {
    for (const name of fs.readdirSync(transactions)) {
      const file = path.join(child(transactions, name), 'transaction.json');
      if (!fs.existsSync(file)) continue;
      const transaction = load(file);
      if (transaction.state === 'prepared' || transaction.state === 'committing') { pending = true; follow(name); }
    }
  }
  const stateFile = child(root, 'last-powershell-install.json');
  if (fs.existsSync(stateFile) && load(stateFile).state !== 'committed') pending = true;
  if (pending) throw new Error('An installation is still prepared or committing; cleanup refused');
  const running = [...(request.runningExecutables || [])];
  if (process.platform === 'linux') {
    for (const pid of fs.readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
      try { running.push(fs.readlinkSync('/proc/' + pid + '/exe').replace(/ \(deleted\)$/, '')); } catch {}
    }
  }
  for (const executable of running) {
    const rel = path.relative(root, path.resolve(executable));
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) keep.add(rel.split(path.sep)[0]);
  }
  const candidates = [], skipped = [];
  function add(file) {
    if (!fs.existsSync(file)) return;
    try { candidates.push({path: file, bytes: treeSize(file)}); }
    catch (error) { skipped.push({path: file, reason: error.message}); }
  }
  const downloads = child(root, 'downloads');
  if (!request.keepDownloads) add(downloads);
  else if (fs.existsSync(downloads)) {
    for (const entry of fs.readdirSync(downloads, {withFileTypes: true})) {
      const file = child(downloads, entry.name);
      if (entry.name === 'staging') add(file);
      else if (entry.isDirectory() && /^v\d+\.\d+\.\d+-/.test(entry.name)) {
        for (const name of fs.readdirSync(file)) if (name === 'package' || name.startsWith('package-windows-')) add(child(file, name));
      }
    }
  }
  for (const name of fs.readdirSync(root)) {
    if (!versionPattern.test(name) || keep.has(name)) continue;
    const folder = child(root, name);
    // Only installer-managed releases are eligible; unrelated directories stay.
    if (fs.existsSync(path.join(folder, 'codex-package.json')) && fs.existsSync(path.join(folder, 'source.patch'))) add(folder);
  }
  const removed = [];
  for (const candidate of candidates) {
    if (!request.dryRun) {
      try { removeTree(root, candidate.path); }
      catch (error) { skipped.push({path: candidate.path, reason: error.message}); continue; }
    }
    removed.push(candidate);
  }
  return {dryRun: !!request.dryRun, retainedVersions: [...keep].sort(), removed, skipped,
    bytes: removed.reduce((sum, item) => sum + item.bytes, 0)};
}
if (require.main === module) {
  try {
    const request = process.argv[2] ? load(process.argv[2]) : {};
    console.log(JSON.stringify(cleanup(path.join(os.homedir(), '.codex', 'context-accounting-fix'), request)));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = {cleanup};

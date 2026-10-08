'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {cleanup} = require('./cleanup.cjs');
const base = path.resolve(__dirname, '../build');
function fixture() {
  const folder = path.join(base, 'cleanup-test-' + crypto.randomUUID()), root = path.join(folder, 'fix');
  fs.mkdirSync(root, {recursive: true});
  const version = '0.160.0-reasoning.1';
  const release = name => {
    const dir = path.join(root, name); fs.mkdirSync(path.join(dir, 'bin'), {recursive: true});
    fs.writeFileSync(path.join(dir, 'bin/codex'), 'binary');
    fs.writeFileSync(path.join(dir, 'codex-package.json'), '{}'); fs.writeFileSync(path.join(dir, 'source.patch'), 'patch');
    return dir;
  };
  release(version);
  const manifest = {version, executable: version + '/bin/codex', binary_sha256: crypto.createHash('sha256').update('binary').digest('hex')};
  fs.writeFileSync(path.join(root, 'current.json'), JSON.stringify(manifest));
  const downloads = path.join(root, 'downloads'); fs.mkdirSync(path.join(downloads, 'v0.160.0-reasoning.1/package'), {recursive: true});
  fs.writeFileSync(path.join(downloads, 'v0.160.0-reasoning.1/a.zip'), 'archive');
  fs.writeFileSync(path.join(downloads, 'v0.160.0-reasoning.1/package/copy'), 'copy');
  return {folder, root, version, release, downloads};
}
test('Cleanup removes scratch and unused managed releases, preserving active release, rollback and user files', () => {
  const f = fixture();
  const previous = '0.159.2-reasoning-0ae0125731'; f.release(previous);
  const unused = '0.158.0-reasoning-old'; f.release(unused);
  const running = '0.157.0-reasoning-running'; f.release(running);
  const id = '12345678-abcd'; const dir = path.join(f.root, 'transactions', id); fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, 'transaction.json'), JSON.stringify({id,state:'committed',release:f.version,plans:[{file:path.join(f.root,'current.json'),existed:true}]}));
  fs.writeFileSync(path.join(dir, '0.before'), JSON.stringify({version:previous}));
  fs.writeFileSync(path.join(f.root, 'last-install.json'), JSON.stringify({transactionId:id}));
  fs.mkdirSync(path.join(f.root, 'personal')); fs.writeFileSync(path.join(f.root, 'personal', 'keep'), 'keep');
  const options = {runningExecutables:[path.join(f.root,running,'bin/codex')]};
  const preview = cleanup(f.root, {...options,dryRun:true});
  assert.ok(preview.bytes > 0 && fs.existsSync(f.downloads));
  const result = cleanup(f.root, options);
  assert.equal(result.bytes, preview.bytes);
  assert.ok(!fs.existsSync(f.downloads) && !fs.existsSync(path.join(f.root,unused)));
  for (const name of [f.version,previous,running,'personal','transactions']) assert.ok(fs.existsSync(path.join(f.root,name)),name);
  assert.equal(cleanup(f.root, options).bytes, 0);
});
test('KeepDownloads keeps archives but removes expanded copies', () => {
  const f = fixture(); cleanup(f.root, {keepDownloads:true});
  assert.ok(fs.existsSync(path.join(f.downloads,'v0.160.0-reasoning.1/a.zip')));
  assert.ok(!fs.existsSync(path.join(f.downloads,'v0.160.0-reasoning.1/package')));
});
test('A changed binary or a pending installation refuses cleanup without deleting scratch', () => {
  const f = fixture(); fs.appendFileSync(path.join(f.root,f.version,'bin/codex'),'changed');
  assert.throws(()=>cleanup(f.root),/checksum mismatch/); assert.ok(fs.existsSync(f.downloads));
  fs.writeFileSync(path.join(f.root,f.version,'bin/codex'),'binary');
  const id='12345678-pending', dir=path.join(f.root,'transactions',id); fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'transaction.json'),JSON.stringify({id,state:'prepared',release:f.version,plans:[]}));
  assert.throws(()=>cleanup(f.root),/still prepared/); assert.ok(fs.existsSync(f.downloads));
});
test('Cleanup never follows a junction/symlink into another directory', () => {
  const f=fixture(), outside=path.join(f.folder,'outside'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside,'keep'),'keep');
  fs.symlinkSync(outside,path.join(f.downloads,'linked'),process.platform==='win32'?'junction':'dir');
  const result=cleanup(f.root);
  assert.equal(result.skipped.length,1); assert.ok(fs.existsSync(f.downloads));
  assert.equal(fs.readFileSync(path.join(outside,'keep'),'utf8'),'keep');
});

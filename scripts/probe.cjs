// Exercise the stock ACP adapter through the same NODE_OPTIONS hook used by Zed.
// Create an empty session but send no model prompt or tool invocation.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const {spawn} = require('node:child_process');
const userDir = os.homedir();
const root = path.join(userDir, '.codex', 'context-accounting-fix');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'current.json'), 'utf8'));
const expectedBinary = path.resolve(root, manifest.executable);
const windows = process.platform === 'win32';
const zedDir = windows ? path.join(process.env.LOCALAPPDATA, 'Zed') : path.join(userDir, '.local/share/zed');
const adapter = path.join(zedDir, 'external_agents/registry/npx/codex-acp/node_modules/@agentclientprotocol/codex-acp/dist/index.js');
const cwd = process.cwd();
const option = fs.readFileSync(path.join(root, 'node-options.txt'), 'utf8').trim();
const env = {...process.env, NODE_OPTIONS: option, CODEX_CONTEXT_FIX_TRACE: '1'};
delete env.CODEX_PATH;
delete env.CODEX_CONFIG;
const child = spawn(process.execPath, [adapter], {env, cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
let stderr = '';
let selectedCorrectBinary = false;
let success = false;
readline.createInterface({input: child.stderr}).on('line', line => {
  stderr = (stderr + line + '\n').slice(-4000);
  try {
    const item = JSON.parse(line);
    if (item.codexContextAccountingFix === manifest.version && item.executable === expectedBinary) selectedCorrectBinary = true;
  } catch {}
});
const timeout = setTimeout(() => { process.exitCode = 1; console.error('Startup timeout: ' + stderr); child.stdin.end(); }, 25000);
function send(id, method, params) { child.stdin.write(JSON.stringify({jsonrpc: '2.0', id, method, params}) + '\n'); }
readline.createInterface({input: child.stdout}).on('line', line => {
  let event;
  try { event = JSON.parse(line); } catch { return; }
  if (event.id === 1) {
    if (event.error) { process.exitCode = 1; console.error(JSON.stringify(event.error)); child.stdin.end(); }
    else send(2, 'session/new', {cwd, mcpServers: []});
  }
  if (event.id === 2) {
    clearTimeout(timeout);
    if (event.error || !selectedCorrectBinary) {
      process.exitCode = 1;
      console.error(JSON.stringify(event.error || {error: 'The patched binary was not selected'}));
    } else {
      success = true;
      const result = {platform: windows ? 'Windows' : 'Ubuntu', version: manifest.version, selected_binary: expectedBinary, initialize: 'passed', session_new: 'passed', inference_requests: 0};
      fs.writeFileSync(path.join(root, 'startup-validation.json'), JSON.stringify(result, null, 2) + '\n');
      console.log(JSON.stringify(result));
    }
    child.stdin.end();
  }
});
child.on('error', error => { clearTimeout(timeout); process.exitCode = 1; console.error(error.message); });
child.on('close', () => { clearTimeout(timeout); if (!success) { process.exitCode = 1; console.error(stderr); } });
send(1, 'initialize', {protocolVersion: 1, clientCapabilities: {}, clientInfo: {name: 'zed', version: 'context-accounting-validation'}});

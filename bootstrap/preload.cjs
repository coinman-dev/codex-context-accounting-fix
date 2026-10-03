// Loaded by NODE_OPTIONS only for the existing codex-acp registry agent.
// Keep the option through npx, then remove it before the agent starts tool processes.
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const entry = String(process.argv[1] || '').replaceAll('\\', '/');
if (entry.includes('/@agentclientprotocol/codex-acp/')) {
  const inheritedOptions = process.env.NODE_OPTIONS || '';
  const remainingOptions = inheritedOptions
    .replace(/(?:^|\s)--import=data:text\/javascript,[^\s]*#codex-context-accounting-fix(?=\s|$)/g, ' ')
    .trim();
  if (remainingOptions) process.env.NODE_OPTIONS = remainingOptions;
  else delete process.env.NODE_OPTIONS;
}
if (entry.includes('/@agentclientprotocol/codex-acp/') && !process.env.CODEX_PATH) {
  const root = path.join(os.homedir(), '.codex', 'context-accounting-fix');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'current.json'), 'utf8'));
  const executable = path.resolve(root, manifest.executable);
  const relative = path.relative(root, executable);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(executable)) {
    throw new Error('Codex context accounting fix: the configured executable is missing or outside its installation folder.');
  }
  process.env.CODEX_PATH = executable;
  for (const name of ['CODEX_MANAGED_PACKAGE_ROOT', 'CODEX_MANAGED_BY_NPM', 'CODEX_MANAGED_BY_BUN', 'CODEX_MANAGED_BY_PNPM', 'CODEX_MANAGED_BY_VITE_PLUS']) {
    delete process.env[name];
  }
  if (process.env.CODEX_CONTEXT_FIX_TRACE === '1') {
    console.error(JSON.stringify({codexContextAccountingFix: manifest.version, executable}));
    delete process.env.CODEX_CONTEXT_FIX_TRACE;
  }
}

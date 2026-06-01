#!/usr/bin/env node

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

function arg(name, fallback = null) {
  const prefix = `${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function withoutRuntimeArgs(argv) {
  const result = [];
  for (let index = 0; index < argv.length; index++) {
    const item = argv[index];
    if (item === '--runtime') {
      index++;
      continue;
    }
    if (item.startsWith('--runtime=')) continue;
    result.push(item);
  }
  return result;
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`Usage: node scripts/install.js --runtime <claude|codex> [runtime options]

Unified Citadel installer dispatcher.

Examples:
  node scripts/install.js --runtime claude --install --scope local
  node scripts/install.js --runtime codex --add-marketplace

Run the runtime-specific helper for all options:
  node scripts/claude-install.js --help
  node scripts/codex-install.js --help
`);
  process.exit(0);
}

const runtime = String(arg('--runtime', '')).toLowerCase();
const scriptByRuntime = {
  claude: 'claude-install.js',
  'claude-code': 'claude-install.js',
  codex: 'codex-install.js',
};

const scriptName = scriptByRuntime[runtime];
if (!scriptName) {
  console.error('Missing or invalid --runtime. Expected claude or codex.');
  process.exit(1);
}

const scriptPath = path.join(__dirname, scriptName);
const result = spawnSync(process.execPath, [scriptPath, ...withoutRuntimeArgs(process.argv.slice(2))], {
  cwd: process.cwd(),
  stdio: 'inherit',
  shell: false,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);

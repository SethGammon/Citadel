#!/usr/bin/env node

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { normalizeCodexHookInput } = require('../runtimes/codex/adapters/hook-input');
const { toLegacyHookPayload } = require('../core/hooks/hook-context');

function main() {
  const hookName = process.argv[2];
  if (!hookName) process.exit(0);

  const hookPath = path.join(__dirname, `${hookName}.js`);
  if (!fs.existsSync(hookPath)) process.exit(0);

  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    let payload = {};
    try {
      payload = input ? JSON.parse(input) : {};
    } catch {
      process.exit(0);
    }

    const envelope = normalizeCodexHookInput(payload);
    const legacyPayload = toLegacyHookPayload(envelope);
    const result = spawnSync(process.execPath, [hookPath], {
      cwd: path.resolve(__dirname, '..'),
      input: JSON.stringify(legacyPayload),
      encoding: 'utf8',
    });

    const stdout = result.stdout || '';
    const stderr = result.stderr || '';

    // Codex's Stop hook spec requires JSON on stdout (or empty stdout) when
    // exit is 0 — plain text is rejected. Inner hooks (quality-gate, session-end)
    // emit human-readable text by default. Route non-JSON Stop output to stderr
    // so Codex still logs the message without rejecting the hook contract.
    if (envelope.native_event_name === 'Stop' && stdout.trim().length > 0) {
      let isJson = false;
      try { JSON.parse(stdout); isJson = true; } catch { /* not JSON */ }
      if (isJson) {
        process.stdout.write(stdout);
      } else {
        process.stderr.write(stdout);
      }
    } else if (stdout) {
      process.stdout.write(stdout);
    }

    if (stderr) process.stderr.write(stderr);
    process.exit(typeof result.status === 'number' ? result.status : 0);
  });
}

main();

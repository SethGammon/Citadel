#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const codexRuntime = require(path.join(__dirname, '..', 'runtimes', 'codex'));

assert.equal(codexRuntime.runtime.id, 'codex', 'runtime id should be codex');
assert.equal(codexRuntime.guidance.target.filePath, 'AGENTS.md', 'Codex runtime guidance should target AGENTS.md');
assert.equal(typeof codexRuntime.installCodexHooks, 'function', 'Codex runtime should expose hook installer');
assert.equal(typeof codexRuntime.projectCodexSkills, 'function', 'Codex runtime should expose skill projection');
assert.equal(typeof codexRuntime.projectCodexAgents, 'function', 'Codex runtime should expose agent projection');

const adapterPath = path.join(__dirname, '..', 'hooks_src', 'codex-adapter.js');
const payload = {
  hook_event_name: 'PreToolUse',
  tool_name: 'Read',
  tool_input: { file_path: '.env' },
};
const result = spawnSync(process.execPath, [adapterPath, 'protect-files'], {
  cwd: path.join(__dirname, '..'),
  input: JSON.stringify(payload),
  encoding: 'utf8',
});

assert.equal(result.status, 2, 'Codex adapter should propagate hook exit status');
assert(result.stdout.includes('.env'), 'Codex adapter should surface underlying hook output');

const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-codex-runtime-'));
try {
  const skills = codexRuntime.projectCodexSkills({ projectRoot: tmpProject, skillName: 'review', dryRun: true });
  const agents = codexRuntime.projectCodexAgents({ projectRoot: tmpProject, agentName: 'archon', dryRun: true });
  assert.equal(skills.length, 1, 'Codex runtime should dry-run one projected skill');
  assert.equal(agents.length, 1, 'Codex runtime should dry-run one projected agent');
} finally {
  fs.rmSync(tmpProject, { recursive: true, force: true });
}

// Codex Stop hook contract: plain text stdout from inner hooks must be
// redirected to stderr (Codex rejects non-JSON stdout for Stop). JSON passes
// through unchanged. Non-Stop events keep their plain-text stdout.
const hooksDir = path.join(__dirname, '..', 'hooks_src');
const plainHook = path.join(hooksDir, 'test-fixture-plain-stop.js');
const jsonHook = path.join(hooksDir, 'test-fixture-json-stop.js');
fs.writeFileSync(plainHook, "process.stdout.write('plain text from hook');\n");
fs.writeFileSync(jsonHook, "process.stdout.write(JSON.stringify({decision:'block',reason:'keep going'}));\n");

try {
  const stopPlain = spawnSync(process.execPath, [adapterPath, 'test-fixture-plain-stop'], {
    cwd: path.join(__dirname, '..'),
    input: JSON.stringify({ hook_event_name: 'Stop' }),
    encoding: 'utf8',
  });
  assert.equal(stopPlain.stdout, '', 'Stop hook plain text should not leak to stdout');
  assert(stopPlain.stderr.includes('plain text from hook'), 'Stop hook plain text should be redirected to stderr');

  const stopJson = spawnSync(process.execPath, [adapterPath, 'test-fixture-json-stop'], {
    cwd: path.join(__dirname, '..'),
    input: JSON.stringify({ hook_event_name: 'Stop' }),
    encoding: 'utf8',
  });
  assert(stopJson.stdout.includes('"decision":"block"'), 'Stop hook JSON output should pass through stdout');

  const nonStop = spawnSync(process.execPath, [adapterPath, 'test-fixture-plain-stop'], {
    cwd: path.join(__dirname, '..'),
    input: JSON.stringify({ hook_event_name: 'PostToolUse' }),
    encoding: 'utf8',
  });
  assert(nonStop.stdout.includes('plain text from hook'), 'Non-Stop events should keep plain-text stdout behaviour');
} finally {
  fs.rmSync(plainHook, { force: true });
  fs.rmSync(jsonHook, { force: true });
}

console.log('codex runtime tests passed');

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
const { projectCodexOutput } = require(adapterPath);
const projectRoot = path.join(__dirname, '..');
const payload = {
  hook_event_name: 'PreToolUse',
  cwd: projectRoot,
  tool_name: 'Read',
  tool_input: { file_path: '.env' },
};
const result = spawnSync(process.execPath, [adapterPath, 'protect-files'], {
  cwd: projectRoot,
  input: JSON.stringify(payload),
  encoding: 'utf8',
});

assert.equal(result.status, 2, 'Codex adapter should propagate hook exit status');
assert(result.stderr.includes('.env'), 'Codex adapter should surface the hook block reason on stderr');

// Exercise the generated Windows command in real shells: PowerShell does not
// expand %PLUGIN_ROOT% and collapses native exit 2. JSON denials must survive.
if (process.platform === 'win32') {
  const { translateCodexPluginHooks } = require('../runtimes/codex/generators/install-hooks');
  const template = JSON.parse(fs.readFileSync(path.join(projectRoot, 'hooks/hooks-template.json'), 'utf8'));
  const hooks = translateCodexPluginHooks(template).hooks.PreToolUse;
  const cases = [
    ['protect-files', JSON.stringify(payload), true],
    ['protect-files', JSON.stringify({ ...payload, tool_input: { file_path: 'README.md' } }), false],
    ['protect-files', '{bad json', true],
    ['external-action-gate', '{bad json', true],
    ['external-action-gate', JSON.stringify({ ...payload, tool_name: 'Bash', tool_input: { command: 'echo hook-probe' } }), false],
  ];
  for (const shell of ['cmd', 'pwsh']) {
    for (const [name, input, denied] of cases) {
      const command = hooks.flatMap(group => group.hooks).find(h => h.command.endsWith(` ${name}`)).commandWindows;
      const shellResult = spawnSync(shell === 'cmd' ? process.env.COMSPEC : 'pwsh.exe',
        shell === 'cmd' ? ['/C', `"${command}"`] : ['-NoProfile', '-Command', command], {
          cwd: projectRoot, env: { ...process.env, PLUGIN_ROOT: projectRoot },
          input, encoding: 'utf8', timeout: 10000, windowsHide: true,
          windowsVerbatimArguments: shell === 'cmd',
        });
      assert.equal(shellResult.status, 0, `${shell}/${name}: ${shellResult.error || shellResult.stderr}`);
      if (denied) {
        const output = JSON.parse(shellResult.stdout).hookSpecificOutput;
        assert.equal(output.hookEventName, 'PreToolUse');
        assert.equal(output.permissionDecision, 'deny');
        assert(output.permissionDecisionReason.trim());
      } else {
        assert(!shellResult.stdout.includes('"permissionDecision":"deny"'));
      }
    }
  }
}

const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-codex-runtime-'));
try {
  const skills = codexRuntime.projectCodexSkills({ projectRoot: tmpProject, skillName: 'review', dryRun: true });
  const agents = codexRuntime.projectCodexAgents({ projectRoot: tmpProject, agentName: 'archon', dryRun: true });
  assert.equal(skills.length, 1, 'Codex runtime should dry-run one projected skill');
  assert.equal(agents.length, 1, 'Codex runtime should dry-run one projected agent');
} finally {
  fs.rmSync(tmpProject, { recursive: true, force: true });
}

// Codex hook output contracts: plain text from context-bearing hooks must be
// wrapped as hookSpecificOutput JSON. PostCompact supports only the universal
// output fields, so its text becomes systemMessage. Stop plain text must be
// redirected to stderr, while valid Stop JSON passes through unchanged.
const preToolLegacyBlock = JSON.stringify({ decision: 'block', reason: 'stop this tool' });
assert.equal(projectCodexOutput({
  stdout: preToolLegacyBlock,
  stderr: '',
  nativeEventName: 'PreToolUse',
}).stdout, preToolLegacyBlock, 'PreToolUse legacy block should retain its decision');

const preToolLegacyBlockWithMessage = JSON.stringify({
  decision: 'block',
  reason: 'stop this tool',
  systemMessage: 'Citadel blocked this tool',
});
assert.equal(projectCodexOutput({
  stdout: preToolLegacyBlockWithMessage,
  stderr: '',
  nativeEventName: 'PreToolUse',
}).stdout, preToolLegacyBlockWithMessage, 'PreToolUse legacy block should retain its system message');

const preToolWarning = projectCodexOutput({
  stdout: 'warning from pre-tool hook',
  stderr: '',
  nativeEventName: 'PreToolUse',
});
assert.deepEqual(JSON.parse(preToolWarning.stdout), {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    additionalContext: 'warning from pre-tool hook',
  },
}, 'PreToolUse plain text should become additional context');

const preToolUiWarning = projectCodexOutput({
  stdout: JSON.stringify({ message: 'warning from Citadel UI' }),
  stderr: '',
  nativeEventName: 'PreToolUse',
});
assert.deepEqual(JSON.parse(preToolUiWarning.stdout), {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    additionalContext: 'warning from Citadel UI',
  },
}, 'PreToolUse Citadel UI JSON should project only its message');

const validPreToolContext = JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    additionalContext: 'already valid context',
  },
});
assert.equal(projectCodexOutput({
  stdout: validPreToolContext,
  stderr: '',
  nativeEventName: 'PreToolUse',
}).stdout, validPreToolContext, 'valid PreToolUse context should pass through unchanged');

const validPreToolDenial = JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: 'operation blocked',
  },
});
assert.equal(projectCodexOutput({
  stdout: validPreToolDenial,
  stderr: '',
  nativeEventName: 'PreToolUse',
}).stdout, validPreToolDenial, 'valid PreToolUse denial should pass through unchanged');

assert.equal(projectCodexOutput({
  stdout: '',
  stderr: '',
  nativeEventName: 'PreToolUse',
}).stdout, '', 'empty PreToolUse allow should keep stdout empty');

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

  const postCompact = projectCodexOutput({
    stdout: 'plain text from hook',
    stderr: '',
    nativeEventName: 'PostCompact',
  });
  assert.deepEqual(JSON.parse(postCompact.stdout), {
    systemMessage: 'plain text from hook',
  }, 'PostCompact text should use the supported Codex universal output shape');

  const validPostCompact = JSON.stringify({
    continue: true,
    systemMessage: 'already valid',
  });
  assert.equal(projectCodexOutput({
    stdout: validPostCompact,
    stderr: '',
    nativeEventName: 'PostCompact',
  }).stdout, validPostCompact, 'valid PostCompact universal output should pass through unchanged');
} finally {
  fs.rmSync(plainHook, { force: true });
  fs.rmSync(jsonHook, { force: true });
}

console.log('codex runtime tests passed');

#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { installClaudeHooks } = require('../runtimes/claude-code/generators/install-hooks');
const { installCodexHooks, translateCodexHooks, translateCodexPluginHooks } = require('../runtimes/codex/generators/install-hooks');

function withTempDir(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-hook-install-'));
  try {
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const citadelRoot = path.resolve(__dirname, '..');
const hooksTemplatePath = path.join(citadelRoot, 'hooks', 'hooks-template.json');
const hooksTemplate = JSON.parse(fs.readFileSync(hooksTemplatePath, 'utf8'));

function countHookHandlers(hooks) {
  return Object.values(hooks || {}).reduce((total, entries) => total + entries.reduce(
    (entryTotal, entry) => entryTotal + (entry.hooks || []).length,
    0
  ), 0);
}


withTempDir((projectRoot) => {
  fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.claude', 'settings.json'), JSON.stringify({
    permissions: { allow: ['Read'] },
    hooks: {
      PreToolUse: [
        {
          matcher: 'Read',
          hooks: [{ type: 'command', command: 'node "/custom/user-hook.js"' }],
        },
      ],
    },
  }, null, 2));

  const result = installClaudeHooks({ citadelRoot, hooksTemplatePath, projectRoot, hookProfile: 'latest' });
  const settings = JSON.parse(fs.readFileSync(result.settingsPath, 'utf8'));

  assert(settings.hooks.PreToolUse.length >= 2, 'claude install should merge generated and user hooks');
  assert.equal(settings.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB, '1', 'claude install should inject subprocess scrub env');
  assert.equal(settings.permissions.allow[0], 'Read', 'claude install should preserve non-hook settings');
  assert.equal(result.compatibility.hookProfile, 'latest', 'latest profile should be reported');
  const firstInstallCount = countHookHandlers(settings.hooks);
  installClaudeHooks({ citadelRoot, hooksTemplatePath, projectRoot, hookProfile: 'latest' });
  const reinstalled = JSON.parse(fs.readFileSync(result.settingsPath, 'utf8'));
  assert.equal(countHookHandlers(reinstalled.hooks), firstInstallCount,
    'claude hook reinstall should be idempotent and must not duplicate generated hooks');
  assert.deepEqual(reinstalled.hooks, settings.hooks,
    'claude hook reinstall should preserve the exact merged hook registration set');

});

withTempDir((projectRoot) => {
  const result = installClaudeHooks({
    citadelRoot,
    hooksTemplatePath,
    projectRoot,
    hookProfile: 'auto',
    claudeVersion: '2.1.75',
  });
  const settings = JSON.parse(fs.readFileSync(result.settingsPath, 'utf8'));

  assert(settings.hooks.SessionStart, 'legacy-compatible install should keep SessionStart');
  assert(settings.hooks.SessionEnd, 'legacy-compatible install should keep SessionEnd');
  assert(!settings.hooks.PostCompact, 'legacy-compatible install should omit PostCompact before 2.1.76');
  assert(!settings.hooks.StopFailure, 'legacy-compatible install should omit StopFailure before 2.1.78');
  assert(!settings.hooks.TaskCreated, 'legacy-compatible install should omit TaskCreated before 2.1.84');
  assert(!settings.hooks.WorktreeCreate, 'legacy-compatible install should omit WorktreeCreate before 2.1.84');
  assert(result.compatibility.skippedEvents.includes('PostCompact'), 'legacy-compatible install should report skipped events');
});

const translated = translateCodexHooks(hooksTemplate, '/tmp/codex-adapter.js');
assert(translated.installed.length > 0, 'codex translation should install mapped hooks');
assert(translated.skipped.length > 0, 'codex translation should record unmapped hooks');
assert.deepEqual(Object.keys(translated.hooks).sort(), [
  'PermissionRequest',
  'PostCompact',
  'PostToolUse',
  'PreCompact',
  'PreToolUse',
  'SessionEnd',
  'SessionStart',
  'Stop',
  'SubagentStart',
  'SubagentStop',
  'UserPromptSubmit',
], 'Codex translation should project the exact native 11-event set');
const applyPatchProtectEntries = translated.hooks.PreToolUse.filter((entry) =>
  entry.matcher === 'apply_patch'
  && entry.hooks.some((hook) => hook.command.includes('protect-files'))
);
assert.equal(applyPatchProtectEntries.length, 1,
  'codex translation should register one protect-files projection for apply_patch');
assert(!translated.hooks.PreToolUse.some((entry) =>
  (entry.matcher === 'Edit' || entry.matcher === 'Write')
  && entry.hooks.some((hook) => hook.command.includes('protect-files'))
), 'codex translation should canonicalize Edit/Write matcher aliases to apply_patch');
const bashGateEntries = translated.hooks.PreToolUse.filter((entry) =>
  entry.matcher === 'Bash'
  && entry.hooks.some((hook) => hook.command.includes('external-action-gate'))
);
assert.equal(bashGateEntries.length, 1,
  'codex translation should register one canonical Bash external-action gate');
assert(!translated.hooks.PreToolUse.some((entry) => entry.matcher === 'Edit|Write'), 'codex translation should not leave pipe-delimited matchers');
assert(translated.hooks.PermissionRequest, 'codex translation should install PermissionRequest hooks');
assert(translated.hooks.PreCompact, 'codex translation should install PreCompact hooks');
assert(translated.hooks.PostCompact, 'codex translation should install PostCompact hooks');
assert(translated.hooks.UserPromptSubmit?.some((entry) =>
  entry.hooks.some((hook) => hook.command.includes('user-prompt-submit'))
), 'codex translation should install the native UserPromptSubmit hook');
assert(translated.hooks.SubagentStart, 'codex translation should install SubagentStart hooks');
assert(translated.hooks.SubagentStop, 'codex translation should install SubagentStop hooks');
assert(translated.hooks.SessionEnd?.some((entry) =>
  entry.hooks.some((hook) => hook.command.includes('session-end'))
), 'codex translation should install session-end on native SessionEnd');
assert(translated.hooks.SessionEnd.every((entry) =>
  entry.hooks.every((hook) => hook.timeout <= 3)
), 'Codex SessionEnd hooks must stay within the native three-second limit');
assert(!translated.hooks.Stop.some((entry) =>
  entry.hooks.some((hook) => hook.command.includes('session-end'))
), 'codex translation must not project SessionEnd handlers onto Stop');

const pluginHooks = translateCodexPluginHooks(hooksTemplate);
const pluginPermissionHook = pluginHooks.hooks.PermissionRequest[0].hooks[0];
assert(pluginPermissionHook.command.includes('${PLUGIN_ROOT}'), 'plugin hooks should use PLUGIN_ROOT in POSIX command');
assert(pluginPermissionHook.commandWindows.includes('%PLUGIN_ROOT%'), 'plugin hooks should use PLUGIN_ROOT in Windows command');
const checkedInPluginHooks = JSON.parse(fs.readFileSync(
  path.join(citadelRoot, 'runtimes', 'codex', 'hooks.json'),
  'utf8'
));
assert.deepEqual(checkedInPluginHooks, { hooks: pluginHooks.hooks },
  'checked-in Codex hooks must exactly match the current generator projection');

withTempDir((projectRoot) => {
  const outputPath = path.join(projectRoot, '.codex', 'hooks.json');
  const result = installCodexHooks({
    hooksTemplate,
    adapterScriptPath: '/tmp/codex-adapter.js',
    existingHooks: {
      PreToolUse: [
        {
          hooks: [{ type: 'command', command: 'node "/custom/user-hook.js"' }],
        },
      ],
    },
    outputPath,
  });

  const hooks = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  assert(result.hooks.PreToolUse.length >= 2, 'codex install should merge generated and user hooks');
  assert(hooks.hooks.PreToolUse.length >= 2, 'codex install should persist merged hooks');
});

withTempDir((projectRoot) => {
  const staleSessionEnd = {
    hooks: [
      {
        type: 'command',
        command: 'node "/old/codex-adapter.js" session-end',
      },
      {
        type: 'command',
        command: 'node "/custom/co-located-stop.js"',
      },
    ],
  };
  const userStopHook = {
    hooks: [{
      type: 'command',
      command: 'node "/custom/user-stop.js"',
    }],
  };
  const result = installCodexHooks({
    hooksTemplate,
    adapterScriptPath: '/tmp/codex-adapter.js',
    existingHooks: { Stop: [staleSessionEnd, userStopHook] },
  });

  assert(!result.hooks.Stop.some((entry) =>
    entry.hooks.some((hook) => hook.command.includes('session-end'))
  ), 'Codex reinstall should remove the stale generated session-end handler from Stop');
  assert(result.hooks.Stop.some((entry) =>
    entry.hooks.some((hook) => hook.command.includes('/custom/user-stop.js'))
  ), 'Codex reinstall should preserve unrelated user Stop hooks');
  assert(result.hooks.Stop.some((entry) =>
    entry.hooks.some((hook) => hook.command.includes('/custom/co-located-stop.js'))
  ), 'Codex reinstall should preserve a user hook co-located with a stale generated handler');
  assert(result.hooks.SessionEnd.some((entry) =>
    entry.hooks.some((hook) => hook.command.includes('session-end'))
  ), 'Codex reinstall should place the generated session-end handler on SessionEnd');
});

console.log('hook installer tests passed');

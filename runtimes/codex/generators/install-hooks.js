'use strict';

const {
  mergeHookMaps,
  quoteNodeCommand,
  readJson,
  writeJson,
} = require('../../../core/hooks/install');
const { filterHookTemplate } = require('../../../core/hooks/bundles');

const CODEX_EVENTS = new Set([
  'SessionStart',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PreCompact',
  'PostCompact',
  'UserPromptSubmit',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'SessionEnd',
]);

const EVENT_MAP = {
  SessionStart: 'SessionStart',
  PreToolUse: 'PreToolUse',
  PermissionRequest: 'PermissionRequest',
  PostToolUse: 'PostToolUse',
  PostToolUseFailure: null,
  PreCompact: 'PreCompact',
  PostCompact: 'PostCompact',
  UserPromptSubmit: 'UserPromptSubmit',
  Stop: 'Stop',
  StopFailure: null,
  SessionEnd: 'SessionEnd',
  SubagentStart: 'SubagentStart',
  SubagentStop: 'SubagentStop',
  TaskCreated: null,
  TaskCompleted: null,
  WorktreeCreate: null,
  WorktreeRemove: null,
};

const CODEX_MATCHER_ALIASES = Object.freeze({
  Edit: ['apply_patch'],
  Write: ['apply_patch'],
});

function extractHookName(command) {
  const match = command.match(/hooks_src\/([^.]+)\.js/);
  return match ? match[1] : null;
}

function translateCodexHooks(hooksTemplate, adapterScriptPath, options = {}) {
  const bundleFilter = filterHookTemplate(hooksTemplate, options.effectiveBundles);
  hooksTemplate = bundleFilter.template;
  const codexHooks = {};
  const warnings = [];
  const installed = [];
  const skipped = [];
  const entrySignatures = new Set();
  const adapterPath = adapterScriptPath.replace(/\\/g, '/');
  const adapterCmd = quoteNodeCommand(`node ${adapterPath}`);
  const commandForHook = options.commandForHook || ((hookName) => `${adapterCmd} ${hookName}`);
  const commandWindowsForHook = options.commandWindowsForHook || null;

  for (const [citadelEvent, entries] of Object.entries(hooksTemplate.hooks || {})) {
    const codexEvent = EVENT_MAP[citadelEvent];

    if (!codexEvent) {
      for (const entry of entries) {
        for (const hook of entry.hooks || []) {
          const name = extractHookName(hook.command);
          if (name) skipped.push({ hook: name, event: citadelEvent, reason: 'no Codex equivalent' });
        }
      }
      warnings.push(`${citadelEvent}: no Codex equivalent (${entries.length} hook(s) skipped)`);
      continue;
    }

    if (!codexHooks[codexEvent]) codexHooks[codexEvent] = [];

    for (const entry of entries) {
      if (!entry.hooks) continue;

      const hooks = [];
      for (const hook of entry.hooks) {
        const hookName = extractHookName(hook.command);
        if (!hookName) continue;
        const translatedHook = {
          type: 'command',
          command: commandForHook(hookName),
          statusMessage: `Citadel: ${hookName}`,
          timeout: codexEvent === 'SessionEnd'
            ? Math.min(hook.timeout || 30, 3)
            : hook.timeout || 30,
        };
        if (commandWindowsForHook) translatedHook.commandWindows = commandWindowsForHook(hookName);
        hooks.push(translatedHook);
        installed.push({ hook: hookName, event: codexEvent });
      }

      if (hooks.length === 0) continue;

      // Expand pipe-delimited matchers into separate entries (e.g. "Edit|Write" → two entries)
      const sourceMatchers = entry.matcher ? entry.matcher.split('|').map((m) => m.trim()).filter(Boolean) : [null];
      const matchers = sourceMatchers.flatMap((matcher) => CODEX_MATCHER_ALIASES[matcher] || [matcher]);
      for (const matcher of matchers) {
        const signature = JSON.stringify([
          codexEvent,
          matcher,
          hooks.map((hook) => [hook.command, hook.commandWindows || null]),
        ]);
        if (entrySignatures.has(signature)) continue;
        entrySignatures.add(signature);
        const codexEntry = { hooks };
        if (matcher) codexEntry.matcher = matcher;
        codexHooks[codexEvent].push(codexEntry);
      }
    }
  }

  return { hooks: codexHooks, installed, skipped: [...skipped, ...bundleFilter.skipped], warnings, bundleFilter };
}

function translateCodexPluginHooks(hooksTemplate) {
  return translateCodexHooks(hooksTemplate, '${PLUGIN_ROOT}/hooks_src/codex-adapter.js', {
    commandForHook: (hookName) => `node "\${PLUGIN_ROOT}/hooks_src/codex-adapter.js" ${hookName}`,
    commandWindowsForHook: (hookName) => `node "%PLUGIN_ROOT%\\hooks_src\\codex-adapter.js" ${hookName}`,
  });
}

function preserveUserHookHandlers(existingHooks, marker) {
  const preserved = {};
  for (const [event, entries] of Object.entries(existingHooks || {})) {
    const eventEntries = [];
    for (const entry of entries || []) {
      if (!Array.isArray(entry.hooks)) {
        eventEntries.push(entry);
        continue;
      }
      const hooks = entry.hooks.filter((hook) =>
        typeof hook.command !== 'string' || !hook.command.includes(marker)
      );
      if (hooks.length > 0) eventEntries.push({ ...entry, hooks });
    }
    if (eventEntries.length > 0) preserved[event] = eventEntries;
  }
  return preserved;
}

function installCodexHooks(options = {}) {
  const preserveMarker = 'codex-adapter';
  const existingHooks = preserveUserHookHandlers(options.existingHooks || {}, preserveMarker);
  const translated = translateCodexHooks(options.hooksTemplate, options.adapterScriptPath, {
    effectiveBundles: options.effectiveBundles,
  });
  const mergedHooks = mergeHookMaps({
    existingHooks,
    generatedHooks: translated.hooks,
    preserveMarker,
  });

  const filteredHooks = Object.fromEntries(
    Object.entries(mergedHooks).filter(([event]) => CODEX_EVENTS.has(event))
  );

  if (options.outputPath) {
    writeJson(options.outputPath, { hooks: filteredHooks });
  }

  return {
    ...translated,
    hooks: filteredHooks,
  };
}

module.exports = {
  CODEX_MATCHER_ALIASES,
  CODEX_EVENTS,
  EVENT_MAP,
  extractHookName,
  installCodexHooks,
  preserveUserHookHandlers,
  translateCodexPluginHooks,
  translateCodexHooks,
};

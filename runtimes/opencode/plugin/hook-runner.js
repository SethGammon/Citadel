#!/usr/bin/env node

'use strict';

// Runs Citadel's hooks_src/*.js processes on behalf of an opencode plugin.
//
// opencode has no command hooks. Its plugin hooks are in-process async
// functions called as (input, output) that mutate `output` and `throw` to
// block. Citadel's hooks are Node processes that read JSON on stdin and signal
// a block with exit code 2 plus a reason on stderr. This module is the
// translation layer, so all 30+ hooks are reused unchanged.
//
// It is deliberately CommonJS and free of opencode imports: the ESM shim in
// index.mjs is what opencode loads, and keeping the logic here means the Citadel
// test suite can exercise it under plain Node without Bun or opencode present.

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { normalizeOpencodeHookInput } = require('../adapters/hook-input');
const { toLegacyHookPayload } = require('../../../core/hooks/hook-context');
const { filterHookTemplate } = require('../../../core/hooks/bundles');

const PLUGIN_ROOT = path.resolve(__dirname, '..', '..', '..');
const HOOKS_DIR = path.join(PLUGIN_ROOT, 'hooks_src');
const TEMPLATE_PATH = path.join(PLUGIN_ROOT, 'hooks', 'hooks-template.json');

// Hooks whose whole purpose is refusing an action. If one of these cannot give a
// clean verdict — it crashes, is missing, or times out — the action is blocked.
// Everything else is an observer and must never turn a working tool call into a
// failure.
const SECURITY_HOOKS = new Set(['protect-files', 'external-action-gate']);

// opencode hook or bus-event name -> the event key used in hooks-template.json.
// Only events Citadel has hooks for appear here; see OPENCODE_EVENT_MAP in
// core/hooks/normalize-event.js for the full mapping rationale.
const TEMPLATE_EVENT_BY_OPENCODE_EVENT = Object.freeze({
  'tool.execute.before': 'PreToolUse',
  'tool.execute.after': 'PostToolUse',
  'chat.message': 'UserPromptSubmit',
  'plugin.init': 'SessionStart',
  dispose: 'SessionEnd',
  config: 'ConfigChange',
  'experimental.session.compacting': 'PreCompact',
  'session.compacted': 'PostCompact',
  'session.idle': 'Stop',
  'file.edited': 'FileChanged',
  'file.watcher.updated': 'FileChanged',
  'permission.asked': 'PermissionRequest',
});

// Only the pre-tool gate may abort an opencode tool call. Throwing from
// tool.execute.after would mark a tool that already succeeded as failed, so
// post-tool findings are surfaced as text instead. Bus events (session.idle,
// file.edited, permission.asked) are dispatched fire-and-forget by opencode and
// cannot block at all.
const BLOCKING_OPENCODE_EVENTS = new Set(['tool.execute.before']);

const DEFAULT_TIMEOUT_SECONDS = 5;

function hookNameFromCommand(command) {
  const match = String(command || '').replace(/\\/g, '/').match(/hooks_src\/([^.\/]+)\.js/);
  return match ? match[1] : null;
}

let cachedTemplate = null;

function loadTemplate(templatePath = TEMPLATE_PATH) {
  if (templatePath === TEMPLATE_PATH && cachedTemplate) return cachedTemplate;
  const parsed = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
  if (templatePath === TEMPLATE_PATH) cachedTemplate = parsed;
  return parsed;
}

// Under Bun, process.execPath is the bun binary. Citadel's hooks are written and
// tested against Node, so resolve a real Node rather than assuming the host
// runtime is one.
let cachedNodeBinary = null;

function resolveNodeBinary(options = {}) {
  if (options.nodeBinary) return options.nodeBinary;
  if (cachedNodeBinary) return cachedNodeBinary;

  const override = process.env.CITADEL_NODE;
  if (override && fs.existsSync(override)) {
    cachedNodeBinary = override;
    return cachedNodeBinary;
  }

  const execPath = process.execPath || '';
  const execName = path.basename(execPath).toLowerCase();
  if (execName === 'node' || execName === 'node.exe') {
    cachedNodeBinary = execPath;
    return cachedNodeBinary;
  }

  const isWindows = process.platform === 'win32';
  const probe = spawnSync(isWindows ? 'where' : 'which', ['node'], {
    encoding: 'utf8',
    timeout: 3000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const found = String(probe.stdout || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (found && fs.existsSync(found)) {
    cachedNodeBinary = found;
    return cachedNodeBinary;
  }

  // Last resort: the host runtime. Recorded by callers as a degradation rather
  // than silently pretending this is Node.
  cachedNodeBinary = execPath || 'node';
  return cachedNodeBinary;
}

function matcherMatches(matcher, toolNames) {
  if (!matcher) return true;
  const candidates = (Array.isArray(toolNames) ? toolNames : [toolNames]).filter(Boolean);
  if (candidates.length === 0) return false;
  const alternatives = String(matcher).split('|').map((part) => part.trim()).filter(Boolean);
  return candidates.some((name) => alternatives.includes(name));
}

// `apply_patch` is a single tool call carrying many file targets, so it has to
// satisfy the template's Edit/Write matchers to be gated at all. The Codex
// installer solves the same problem with matcher aliases; here the alias is
// applied at match time, and each selected entry's matcher is re-checked against
// the individual projected target below.
const TOOL_MATCH_ALIASES = Object.freeze({
  apply_patch: ['Edit', 'Write'],
});

function matchNamesFor(toolName) {
  return [toolName, ...(TOOL_MATCH_ALIASES[toolName] || [])].filter(Boolean);
}

// Resolve which hooks run for an event, honoring the template's matchers and the
// project's enabled bundles.
function selectHooks(templateEvent, toolName, options = {}) {
  const template = options.template || loadTemplate(options.templatePath);
  const filtered = filterHookTemplate(template, options.effectiveBundles).template;
  const entries = (filtered.hooks || {})[templateEvent] || [];
  const matchNames = matchNamesFor(toolName);

  const selected = [];
  const skipped = [];
  for (const entry of entries) {
    for (const hook of entry.hooks || []) {
      const name = hookNameFromCommand(hook.command);
      if (!name) continue;
      if (!matcherMatches(entry.matcher, matchNames)) {
        skipped.push({ hook: name, reason: `matcher ${entry.matcher} does not apply to ${toolName || 'this event'}` });
        continue;
      }
      selected.push({
        name,
        matcher: entry.matcher || null,
        timeoutMs: Math.max(1, Number(hook.timeout) || DEFAULT_TIMEOUT_SECONDS) * 1000,
      });
    }
  }
  return { selected, skipped };
}

// opencode's apply_patch carries every target in one patch body. Citadel's
// file-scoped hooks expect one path per invocation, so project the patch into an
// Edit/Write payload per target — the same split the Codex adapter performs.
function parseApplyPatchOperations(command) {
  if (typeof command !== 'string' || !command.trim()) {
    throw new TypeError('apply_patch args.command must be a non-empty string');
  }
  if (!/^\*\*\* Begin Patch\s*$/m.test(command) || !/^\*\*\* End Patch\s*$/m.test(command)) {
    throw new TypeError('apply_patch command is missing patch boundaries');
  }

  const operations = [];
  const seen = new Set();
  for (const line of command.split(/\r?\n/)) {
    const fileMatch = /^\*\*\* (Add|Update|Delete) File:\s*(.+?)\s*$/.exec(line);
    const moveMatch = /^\*\*\* Move to:\s*(.+?)\s*$/.exec(line);
    const match = fileMatch || moveMatch;
    if (!match) continue;
    let target = (fileMatch ? fileMatch[2] : moveMatch[1]).trim();
    if ((target.startsWith('"') && target.endsWith('"'))
      || (target.startsWith("'") && target.endsWith("'"))) {
      target = target.slice(1, -1);
    }
    if (!target) throw new TypeError('apply_patch contains an empty target path');
    const toolName = fileMatch?.[1] === 'Add' || moveMatch ? 'Write' : 'Edit';
    const signature = `${toolName}\0${target}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    operations.push({ filePath: target, toolName });
  }

  if (operations.length === 0) throw new TypeError('apply_patch command contains no target paths');
  return operations;
}

function legacyPayloadsFor(envelope, projectRoot) {
  const base = { ...(envelope.raw || {}), ...toLegacyHookPayload(envelope) };
  if (envelope.tool_name !== 'apply_patch') return [{ toolName: envelope.tool_name, payload: base }];

  return parseApplyPatchOperations(envelope.tool_input?.command).map(({ filePath, toolName }) => ({
    toolName,
    payload: {
      ...base,
      tool_name: toolName,
      tool_input: {
        ...base.tool_input,
        file_path: path.isAbsolute(filePath) ? path.normalize(filePath) : path.resolve(projectRoot, filePath),
      },
    },
  }));
}

function spawnHook({ nodeBinary, hookPath, cwd, payload, timeoutMs, spawnImpl }) {
  const launch = spawnImpl || spawn;
  return new Promise((resolve) => {
    let child;
    try {
      child = launch(nodeBinary, [hookPath], {
        cwd,
        env: {
          ...process.env,
          CITADEL_RUNTIME: 'opencode',
          CLAUDE_PROJECT_DIR: cwd,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve({ status: null, stdout: '', stderr: '', timedOut: false, error });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, timedOut, error: null, ...result });
    }

    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => finish({ status: null, error }));
    child.on('close', (code) => finish({ status: code }));

    // A hook may exit before reading stdin; an EPIPE here is not a failure.
    child.stdin?.on('error', () => {});
    try {
      child.stdin?.end(JSON.stringify(payload));
    } catch { /* stdin already closed */ }
  });
}

function firstLine(text) {
  return String(text || '').trim().split('\n').find((line) => line.trim()) || '';
}

// Citadel hooks may answer on stdout with a JSON envelope rather than plain text:
// `{hookSpecificOutput: {additionalContext}}` is how quality-gate reports findings
// without blocking, `{decision: 'block', reason}` is its blocking form, and
// `{hook, action, message}` is the CITADEL_UI shape. Surfacing the raw envelope
// put a JSON blob in front of the model, so unwrap it to the human text.
function messageFromStdout(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return '';
  if (!text.startsWith('{')) return firstLine(text);

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return firstLine(text);
  }
  if (!parsed || typeof parsed !== 'object') return firstLine(text);

  const candidates = [
    parsed.hookSpecificOutput?.additionalContext,
    parsed.reason,
    parsed.message,
  ];
  const found = candidates.find((item) => typeof item === 'string' && item.trim());
  // An envelope we do not recognize is dropped rather than shown raw: a JSON blob
  // is noise to the model, and every shape Citadel hooks emit is handled above.
  return found ? found.trim() : '';
}

/**
 * Run every Citadel hook registered for one opencode event.
 *
 * Returns `{ blocked, reason, messages, results, skipped }`. `blocked` is only
 * ever true for events in BLOCKING_OPENCODE_EVENTS; the ESM shim turns it into
 * the `throw` opencode needs.
 */
async function runHooksForEvent(opencodeEvent, payload, options = {}) {
  const templateEvent = TEMPLATE_EVENT_BY_OPENCODE_EVENT[opencodeEvent];
  const envelope = normalizeOpencodeHookInput({ ...payload, hook_event_name: opencodeEvent });
  const projectRoot = options.projectRoot
    || (typeof envelope.cwd === 'string' && envelope.cwd.trim() ? path.resolve(envelope.cwd) : null)
    || path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());

  const outcome = {
    event: opencodeEvent,
    templateEvent: templateEvent || null,
    blocked: false,
    reason: null,
    messages: [],
    results: [],
    skipped: [],
  };

  if (!templateEvent) {
    outcome.skipped.push({ hook: null, reason: `no Citadel hooks registered for ${opencodeEvent}` });
    return outcome;
  }

  const canBlock = BLOCKING_OPENCODE_EVENTS.has(opencodeEvent);
  const { selected, skipped } = selectHooks(templateEvent, envelope.tool_name, options);
  outcome.skipped = skipped;
  if (selected.length === 0) return outcome;

  const nodeBinary = resolveNodeBinary(options);

  let invocations;
  try {
    invocations = legacyPayloadsFor(envelope, projectRoot);
  } catch (error) {
    // A malformed apply_patch cannot be gated, so refuse it on a blocking event
    // rather than letting it through ungated.
    if (canBlock) {
      outcome.blocked = true;
      outcome.reason = `[citadel] could not parse apply_patch targets: ${error.message}`;
    } else {
      outcome.skipped.push({ hook: null, reason: `payload projection failed: ${error.message}` });
    }
    return outcome;
  }

  for (const hook of selected) {
    const hookPath = path.join(options.hooksDir || HOOKS_DIR, `${hook.name}.js`);
    const security = SECURITY_HOOKS.has(hook.name);

    if (!fs.existsSync(hookPath)) {
      if (security && canBlock) {
        outcome.blocked = true;
        outcome.reason = `[citadel] ${hook.name} is missing; blocking to fail closed`;
        return outcome;
      }
      outcome.skipped.push({ hook: hook.name, reason: 'implementation is missing' });
      continue;
    }

    for (const invocation of invocations) {
      // apply_patch fans out into Edit and Write projections. A hook selected via
      // the alias may still not apply to an individual target — a Write-only
      // matcher must not fire on an Edit projection — so re-check per target.
      if (invocations.length > 1 && !matcherMatches(hook.matcher, [invocation.toolName])) {
        outcome.skipped.push({
          hook: hook.name,
          reason: `matcher ${hook.matcher} does not apply to projected ${invocation.toolName}`,
        });
        continue;
      }

      const result = await spawnHook({
        nodeBinary,
        hookPath,
        cwd: projectRoot,
        payload: invocation.payload,
        timeoutMs: hook.timeoutMs,
        spawnImpl: options.spawnImpl,
      });

      outcome.results.push({
        hook: hook.name,
        tool: invocation.toolName,
        status: result.status,
        timedOut: result.timedOut,
      });

      const reason = firstLine(result.stderr) || messageFromStdout(result.stdout);

      if (result.timedOut) {
        const message = `[citadel] ${hook.name} timed out after ${hook.timeoutMs}ms`;
        if (security && canBlock) {
          outcome.blocked = true;
          outcome.reason = `${message}; blocking to fail closed`;
          return outcome;
        }
        outcome.messages.push(message);
        continue;
      }

      if (result.error) {
        const message = `[citadel] ${hook.name} could not run: ${result.error.message}`;
        if (security && canBlock) {
          outcome.blocked = true;
          outcome.reason = `${message}; blocking to fail closed`;
          return outcome;
        }
        outcome.messages.push(message);
        continue;
      }

      if (result.status === 0) {
        const note = messageFromStdout(result.stdout);
        if (note) outcome.messages.push(note);
        continue;
      }

      // Exit 2 is Citadel's block signal. Any other non-zero exit from a
      // security hook is an abnormal failure and also blocks, matching the
      // Codex adapter's fail-closed rule.
      const blocks = canBlock && (result.status === 2 || security);
      if (blocks) {
        outcome.blocked = true;
        outcome.reason = reason || `[citadel] ${hook.name} blocked this action (exit ${result.status})`;
        return outcome;
      }
      if (reason) outcome.messages.push(reason);
    }
  }

  return outcome;
}

module.exports = Object.freeze({
  BLOCKING_OPENCODE_EVENTS,
  DEFAULT_TIMEOUT_SECONDS,
  HOOKS_DIR,
  PLUGIN_ROOT,
  SECURITY_HOOKS,
  TEMPLATE_EVENT_BY_OPENCODE_EVENT,
  hookNameFromCommand,
  legacyPayloadsFor,
  messageFromStdout,
  matcherMatches,
  parseApplyPatchOperations,
  resolveNodeBinary,
  runHooksForEvent,
  selectHooks,
});

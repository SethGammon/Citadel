#!/usr/bin/env node

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { normalizeCodexHookInput } = require('../runtimes/codex/adapters/hook-input');
const { toLegacyHookPayload } = require('../core/hooks/hook-context');

const SECURITY_HOOKS = new Set(['protect-files', 'external-action-gate']);

function isSecurityHook(hookName) {
  return SECURITY_HOOKS.has(hookName);
}

function failureResult(hookName, reason, error = null) {
  const blocks = isSecurityHook(hookName);
  const detail = error?.message ? `: ${error.message}` : '';
  return {
    status: blocks ? 2 : 0,
    stdout: '',
    stderr: `[codex-adapter] ${hookName || 'unknown hook'} ${reason}${detail}\n`,
    nativeEventName: null,
  };
}

function parseApplyPatchOperations(command) {
  if (typeof command !== 'string' || !command.trim()) {
    throw new TypeError('apply_patch tool_input.command must be a non-empty string');
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
    if (!seen.has(signature)) {
      seen.add(signature);
      operations.push({ filePath: target, toolName });
    }
  }

  if (operations.length === 0) {
    throw new TypeError('apply_patch command contains no target paths');
  }
  return operations;
}

function extractApplyPatchTargets(command) {
  const targets = [];
  const seen = new Set();
  for (const operation of parseApplyPatchOperations(command)) {
    if (seen.has(operation.filePath)) continue;
    seen.add(operation.filePath);
    targets.push(operation.filePath);
  }
  return targets;
}

function validateSecurityEnvelope(hookName, payload, envelope) {
  if (payload.hook_event_name !== 'PreToolUse') {
    throw new TypeError('security hooks require hook_event_name PreToolUse');
  }
  if (typeof payload.cwd !== 'string' || !payload.cwd.trim()) {
    throw new TypeError('security hooks require a non-empty cwd');
  }
  if (typeof payload.tool_name !== 'string' || !payload.tool_name.trim()) {
    throw new TypeError('security hooks require a non-empty tool_name');
  }
  if (!payload.tool_input || typeof payload.tool_input !== 'object' || Array.isArray(payload.tool_input)) {
    throw new TypeError('security hooks require tool_input object');
  }

  if (hookName === 'external-action-gate') {
    if (envelope.tool_name !== 'Bash' || typeof envelope.tool_input.command !== 'string'
      || !envelope.tool_input.command.trim()) {
      throw new TypeError('external-action-gate requires Bash tool_input.command');
    }
    return;
  }

  if (hookName === 'protect-files') {
    if (envelope.tool_name === 'apply_patch') {
      if (typeof envelope.tool_input.command !== 'string' || !envelope.tool_input.command.trim()) {
        throw new TypeError('protect-files apply_patch requires tool_input.command');
      }
      return;
    }
    if (!['Edit', 'Write', 'Read'].includes(envelope.tool_name)) {
      throw new TypeError('protect-files requires apply_patch, Edit, Write, or Read');
    }
    const filePath = envelope.tool_input.file_path || envelope.tool_input.path;
    if (typeof filePath !== 'string' || !filePath.trim()) {
      throw new TypeError('protect-files requires a target path');
    }
  }
}

function projectLegacyPayloads(envelope, hookName) {
  const legacy = {
    ...(envelope.raw || {}),
    ...toLegacyHookPayload(envelope),
  };
  if (envelope.tool_name !== 'apply_patch') {
    return [legacy];
  }

  const projectRoot = typeof envelope.cwd === 'string' && envelope.cwd.trim()
    ? path.resolve(envelope.cwd)
    : path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());

  return parseApplyPatchOperations(envelope.tool_input?.command).map(({ filePath, toolName }) => {
    const projectedPath = path.isAbsolute(filePath)
      ? path.normalize(filePath)
      : path.resolve(projectRoot, filePath);
    return {
      ...legacy,
      tool_name: toolName,
      tool_input: {
        ...legacy.tool_input,
        file_path: projectedPath,
      },
    };
  });
}

function dispatchHook(hookName, input, options = {}) {
  if (!hookName) return failureResult(hookName, 'name is missing');

  const hooksDir = options.hooksDir || __dirname;
  const hookPath = path.join(hooksDir, `${hookName}.js`);
  if (!fs.existsSync(hookPath)) return failureResult(hookName, 'implementation is missing');

  let payload;
  try {
    payload = input ? JSON.parse(input) : {};
  } catch (error) {
    return failureResult(hookName, 'input parse failed', error);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return failureResult(hookName, 'input must be a JSON object');
  }

  let envelope;
  let legacyPayloads;
  try {
    envelope = normalizeCodexHookInput(payload);
    if (isSecurityHook(hookName)) validateSecurityEnvelope(hookName, payload, envelope);
    legacyPayloads = projectLegacyPayloads(envelope, hookName);
  } catch (error) {
    return failureResult(hookName, 'input projection failed', error);
  }

  const projectRoot = typeof envelope.cwd === 'string' && envelope.cwd.trim()
    ? path.resolve(envelope.cwd)
    : path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  if (isSecurityHook(hookName) && !fs.existsSync(projectRoot)) {
    return failureResult(hookName, 'project root does not exist');
  }
  const run = options.spawnSync || spawnSync;
  let stdout = '';
  let stderr = '';
  for (const legacyPayload of legacyPayloads) {
    let result;
    try {
      result = run(process.execPath, [hookPath], {
        cwd: fs.existsSync(projectRoot) ? projectRoot : path.resolve(__dirname, '..'),
        env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot },
        input: JSON.stringify(legacyPayload),
        encoding: 'utf8',
      });
    } catch (error) {
      const failure = failureResult(hookName, 'spawn failed', error);
      return {
        ...failure,
        stdout,
        stderr: stderr + failure.stderr,
        nativeEventName: envelope.native_event_name,
      };
    }

    if (result.error || typeof result.status !== 'number') {
      const failure = failureResult(hookName, 'spawn failed', result.error);
      return {
        ...failure,
        stdout: stdout + (result.stdout || ''),
        stderr: stderr + (result.stderr || '') + failure.stderr,
        nativeEventName: envelope.native_event_name,
      };
    }

    stdout += result.stdout || '';
    stderr += result.stderr || '';
    if (result.status !== 0) {
      const abnormalSecurityExit = isSecurityHook(hookName) && result.status !== 2;
      return {
        status: abnormalSecurityExit ? 2 : result.status,
        stdout,
        stderr: abnormalSecurityExit
          ? `${stderr}[codex-adapter] ${hookName} exited abnormally with status ${result.status}; blocking.\n`
          : stderr,
        nativeEventName: envelope.native_event_name,
      };
    }
  }

  return {
    status: 0,
    stdout,
    stderr,
    nativeEventName: envelope.native_event_name,
  };
}

function isValidCodexStopOutput(output) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return false;
  const allowedKeys = new Set([
    'continue',
    'decision',
    'reason',
    'stopReason',
    'suppressOutput',
    'systemMessage',
  ]);
  if (Object.keys(output).some((key) => !allowedKeys.has(key))) return false;
  if (output.continue !== undefined && typeof output.continue !== 'boolean') return false;
  if (output.suppressOutput !== undefined && typeof output.suppressOutput !== 'boolean') return false;
  if (output.stopReason !== undefined && typeof output.stopReason !== 'string') return false;
  if (output.systemMessage !== undefined && typeof output.systemMessage !== 'string') return false;
  if (output.decision !== undefined) {
    return output.decision === 'block'
      && typeof output.reason === 'string'
      && output.reason.trim().length > 0;
  }
  return output.reason === undefined;
}

function isValidCodexContextOutput(output, eventName) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return false;
  const allowedKeys = new Set([
    'continue',
    'stopReason',
    'suppressOutput',
    'systemMessage',
    'hookSpecificOutput',
  ]);
  if (Object.keys(output).some((key) => !allowedKeys.has(key))) return false;
  const specific = output.hookSpecificOutput;
  if (!specific || typeof specific !== 'object' || Array.isArray(specific)) return false;
  if (specific.hookEventName !== eventName) return false;
  return typeof specific.additionalContext === 'string';
}

function projectCodexContextOutput(stdout, eventName) {
  if (stdout.trim().length === 0) return '';

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    parsed = null;
  }

  if (isValidCodexContextOutput(parsed, eventName)) return stdout;

  const context = parsed
    && typeof parsed === 'object'
    && !Array.isArray(parsed)
    && typeof parsed.message === 'string'
    ? parsed.message
    : stdout.trim();

  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext: context,
    },
  });
}

function projectCodexOutput(result) {
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  if (['SessionStart', 'PostToolUse'].includes(result.nativeEventName)) {
    return { stdout: projectCodexContextOutput(stdout, result.nativeEventName), stderr };
  }
  if (result.nativeEventName !== 'Stop' || stdout.trim().length === 0) {
    return { stdout, stderr };
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    // Codex requires Stop stdout to be empty or a JSON decision. Preserve
    // human-readable observer text on stderr instead of emitting invalid data.
    return { stdout: '', stderr: stdout + stderr };
  }

  const stopContext = parsed?.hookSpecificOutput?.hookEventName === 'Stop'
    ? parsed.hookSpecificOutput.additionalContext
    : null;
  if (typeof stopContext === 'string' && stopContext.trim()) {
    return {
      stdout: JSON.stringify({ systemMessage: stopContext }),
      stderr,
    };
  }

  // `{ decision: "block", reason }` is valid Codex Stop output and must retain
  // its blocking semantics. Unknown or malformed JSON is moved to stderr so a
  // Claude-only envelope cannot silently masquerade as a valid Codex decision.
  if (isValidCodexStopOutput(parsed)) return { stdout, stderr };
  return { stdout: '', stderr: stdout + stderr };
}

function writeResult(result) {
  const projected = projectCodexOutput(result);
  if (projected.stdout) process.stdout.write(projected.stdout);
  if (projected.stderr) process.stderr.write(projected.stderr);
}

function main() {
  const hookName = process.argv[2];
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    const result = dispatchHook(hookName, input);
    writeResult(result);
    process.exit(result.status);
  });
}

if (require.main === module) main();

module.exports = Object.freeze({
  SECURITY_HOOKS,
  dispatchHook,
  extractApplyPatchTargets,
  isValidCodexStopOutput,
  isSecurityHook,
  isValidCodexContextOutput,
  parseApplyPatchOperations,
  projectLegacyPayloads,
  projectCodexOutput,
  projectCodexContextOutput,
  validateSecurityEnvelope,
});

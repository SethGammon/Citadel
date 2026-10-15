#!/usr/bin/env node

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { platformInvocation } = require('../core/forks/launcher');
const { runtimeSettings } = require('../core/operation-controller/contracts');
const { claudeObservation, codexObservation } = require('./optimizer-runtime-adapter');

function unknown(source) { return { status: 'unknown', amount_usd: null, basis: 'observed', source }; }

function costsFor(runtime, observation) {
  const market = runtime === 'claude' && Number.isFinite(observation?.vendor_cost_usd)
    ? { status: 'known', amount_usd: observation.vendor_cost_usd, basis: 'list-price', source: 'claude total_cost_usd telemetry' }
    : unknown('runtime did not provide attributable list-price telemetry');
  return {
    actual_cash: unknown('invoice and subscription attribution are outside the runtime adapter'),
    marginal: unknown('per-operation marginal cash was not observed'),
    market_equivalent: market,
  };
}

function promptFor(input) {
  return [
    'Complete the following operation in the current repository.',
    'Stay inside the repository. Do not commit, push, publish, deploy, or contact external systems.',
    'Use only the tools permitted by the runtime and operation. Leave the working tree ready for the independent verifier.',
    'Do not claim success merely because you finished; Citadel will run the declared verifier.',
    '',
    `Objective: ${input.operation.objective}`,
  ].join('\n');
}

function claudeAllowedTools(tools) {
  const allowed = [];
  if (tools.includes('filesystem')) allowed.push('Read', 'Edit', 'Write', 'Glob', 'Grep');
  if (tools.includes('shell')) allowed.push(
    'Bash(node *)', 'Bash(npm *)', 'Bash(npx *)',
    'Bash(git diff *)', 'Bash(git status *)', 'Bash(git rev-parse *)',
  );
  return allowed.join(',');
}

function invocationFor(runtime, model, env = process.env, tools = [], settings = {}, platform = process.platform) {
  const requested = runtimeSettings(settings);
  if (runtime === 'claude') {
    if (Object.keys(requested).length) throw new TypeError('claude operation adapter does not support reasoning-effort or service-tier settings');
    const args = [
      '--print', '--output-format', 'json', '--permission-mode', 'acceptEdits',
      '--allowedTools', claudeAllowedTools(tools),
    ];
    if (model) args.push('--model', model);
    return { command: 'claude', args };
  }
  if (runtime === 'codex') {
    const args = ['exec', '--json', '--sandbox', 'workspace-write', '--ignore-user-config'];
    // Windows needs a native sandbox implementation when user config is ignored.
    // Select the restricted-user backend; Codex still enforces workspace-write,
    // setup requirements, approvals, and managed policy. This does not elevate
    // the CLI process or grant full filesystem access.
    if (platform === 'win32') args.push('-c', 'windows.sandbox="elevated"');
    if (model) args.push('--model', model);
    // Identifier validation and a quoted TOML string keep each override literal.
    // Runtime/model support is checked by Codex; no user config file is changed.
    if (requested.reasoning_effort) args.push('-c', `model_reasoning_effort=${JSON.stringify(requested.reasoning_effort)}`);
    if (requested.service_tier) args.push('-c', `service_tier=${JSON.stringify(requested.service_tier)}`);
    args.push('-');
    if (env.CITADEL_CODEX_JS) {
      return { command: process.execPath, args: [env.CITADEL_CODEX_JS, ...args] };
    }
    return { command: 'codex', args };
  }
  throw new TypeError(`unsupported runtime adapter: ${runtime}`);
}

const THREAD_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// This bounded traversal intentionally stays separate from the optimizer's
// digest-frozen adapter, so historical optimizer evidence keeps its meaning.
function findSettingsSession(threadId, env) {
  const userRoot = env.CODEX_HOME
    || ((env.USERPROFILE || env.HOME) ? path.join(env.USERPROFILE || env.HOME, '.codex') : null);
  if (!userRoot || !THREAD_PATTERN.test(threadId)) return null;
  try {
    const sessions = path.resolve(userRoot, 'sessions');
    if (fs.lstatSync(sessions).isSymbolicLink() || !fs.statSync(sessions).isDirectory()) return null;
    const root = fs.realpathSync(sessions);
    const stack = [root];
    let scanned = 0;
    let match = null;
    while (stack.length) {
      const directory = stack.pop();
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (++scanned > 20000) return null;
        if (entry.isSymbolicLink()) continue;
        const candidate = path.join(directory, entry.name);
        const real = fs.realpathSync(candidate);
        const relative = path.relative(root, real);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
        if (entry.isDirectory()) stack.push(real);
        else if (entry.isFile() && entry.name.toLowerCase().endsWith(`-${threadId}.jsonl`.toLowerCase())) {
          if (match !== null || fs.lstatSync(candidate).isSymbolicLink()) return null;
          match = real;
        }
      }
    }
    return match;
  } catch (_error) { return null; }
}

// New setting evidence fails closed on incomplete or conflicting metadata.
// Existing model/usage parsing remains in the unchanged optimizer adapter.
function sessionReasoningSettings(threadId, repositoryPath, env) {
  const file = findSettingsSession(threadId, env);
  if (!file) return null;
  let descriptor;
  try {
    const expected = fs.realpathSync(repositoryPath);
    descriptor = fs.openSync(file, 'r');
    const size = fs.fstatSync(descriptor).size;
    if (size > 2 * 1024 * 1024) return null;
    const buffer = Buffer.alloc(size);
    if (fs.readSync(descriptor, buffer, 0, size, 0) !== size) return null;
    let identified = false;
    let observed = null;
    let model = null;
    for (const line of buffer.toString('utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (!event || typeof event !== 'object') return null;
      if (!['session_meta', 'turn_context'].includes(event.type)) continue;
      const context = event.payload;
      if (!context || typeof context.cwd !== 'string' || fs.realpathSync(context.cwd) !== expected) return null;
      if (event.type === 'session_meta') {
        if (typeof context.id !== 'string' || context.id.toLowerCase() !== threadId.toLowerCase()) return null;
        identified = true;
      } else {
        if (typeof context.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/.test(context.model)
          || (model !== null && model !== context.model)) return null;
        model = context.model;
        const effort = runtimeSettings({ reasoning_effort: context.effort ?? null }).reasoning_effort;
        if (!effort || (observed !== null && effort !== observed)) return null;
        const collaborationEffort = context.collaboration_mode?.settings?.reasoning_effort;
        if (collaborationEffort != null && collaborationEffort !== effort) return null;
        const collaborationModel = context.collaboration_mode?.settings?.model;
        if (collaborationModel != null && collaborationModel !== model) return null;
        observed = effort;
      }
    }
    return identified && observed !== null ? { model, reasoning_effort: observed } : null;
  } catch (_error) { return null; }
  finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}

function codexSettingsObservation(stdout, repositoryPath, env = process.env, observedModel = null) {
  const unknown = { reasoning_effort: null, reasoning_effort_source: null, service_tier: null, service_tier_source: null };
  const threads = new Set();
  const models = new Set();
  try {
    for (const line of String(stdout || '').split(/\r?\n/)) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event?.type === 'thread.started' && THREAD_PATTERN.test(event.thread_id || '')) threads.add(event.thread_id.toLowerCase());
      const body = event?.msg && typeof event.msg === 'object' ? event.msg : event;
      if (typeof body?.model === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/.test(body.model)) models.add(body.model);
    }
  } catch (_error) { return unknown; }
  if (threads.size !== 1) return unknown;
  const settings = sessionReasoningSettings([...threads][0], repositoryPath, env);
  // Effort is evidence about this session's model. Never attach it to a different
  // model selected by stdout parsing, or discard conflicting stdout model claims.
  if (!settings || models.size > 1 || (models.size === 1 && !models.has(settings.model))
    || (observedModel !== null && observedModel !== settings.model)) return unknown;
  // turn_context records configured effort. It provides no supported evidence
  // of the backend's served service tier, even if a configured tier is present.
  return { ...unknown, reasoning_effort: settings.reasoning_effort, reasoning_effort_source: 'codex-session-turn-context' };
}

function observedToolCalls(runtime, stdout) {
  if (runtime !== 'codex') return [];
  const tools = new Set();
  for (const line of String(stdout || '').split(/\r?\n/)) {
    let event;
    try { event = JSON.parse(line); } catch (_error) { continue; }
    const item = event.item || event.msg?.item || null;
    const type = item?.type || event.type;
    if (type === 'command_execution') tools.add('shell');
    if (type === 'file_change') tools.add('filesystem');
    if (type === 'mcp_tool_call') tools.add('mcp');
  }
  return [...tools].sort();
}

function execute(input, runtime, options = {}) {
  if (!input || input.protocol !== 'citadel-operation-adapter-v1') throw new TypeError('invalid operation adapter input');
  const invocation = (options.resolve || platformInvocation)(
    invocationFor(runtime, input.plan.model, options.env || process.env, input.plan.tools, input.plan, options.platform || process.platform),
    { env: options.env || process.env },
  );
  const result = (options.spawn || spawnSync)(invocation.command, invocation.args, {
    cwd: input.workspace_root,
    input: promptFor(input),
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: input.plan.expected_duration_ms ? Math.max(input.plan.expected_duration_ms * 2, 60000) : 1800000,
    maxBuffer: 16 * 1024 * 1024,
    env: options.env || process.env,
  });
  const observation = runtime === 'claude'
    ? claudeObservation(result.stdout || '', input.workspace_root, options.env || process.env)
    : codexObservation(result.stdout || '', input.workspace_root, options.env || process.env);
  const failure = result.error ? (result.error.code === 'ETIMEDOUT' ? 'TIMEOUT' : 'RUNTIME_LAUNCH_FAILED')
    : result.status === 0 ? null : 'RUNTIME_EXIT_NONZERO';
  return {
    schema: 1,
    status: failure === null ? 'completed' : 'failed',
    failure_code: failure,
    output: String(result.stdout || ''),
    observations: {
      model: observation?.model || null,
      ...(runtime === 'codex' ? codexSettingsObservation(result.stdout, input.workspace_root, options.env || process.env, observation?.model || null)
        : { reasoning_effort: null, reasoning_effort_source: null, service_tier: null, service_tier_source: null }),
      topology: input.plan.topology,
      tools: input.plan.tools,
      tool_calls: observedToolCalls(runtime, result.stdout),
      usage: observation?.usage || {},
      costs: costsFor(runtime, observation),
    },
  };
}

function main(argv = process.argv.slice(2)) {
  const runtime = argv[0];
  let text = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { text += chunk; });
  process.stdin.on('end', () => {
    try { process.stdout.write(`${JSON.stringify(execute(JSON.parse(text), runtime))}\n`); }
    catch (error) {
      process.stdout.write(`${JSON.stringify({
        schema: 1,
        status: 'failed',
        failure_code: 'ADAPTER_INTERNAL_ERROR',
        output: '',
        observations: {
          model: null, topology: null, tools: [], tool_calls: [], usage: {},
          costs: costsFor(runtime, null),
        },
      })}\n`);
      process.stderr.write(`operation runtime adapter: ${error.message}\n`);
      process.exitCode = 1;
    }
  });
}

if (require.main === module) main();

module.exports = Object.freeze({ claudeAllowedTools, codexSettingsObservation, costsFor, execute, invocationFor, main, observedToolCalls, promptFor });

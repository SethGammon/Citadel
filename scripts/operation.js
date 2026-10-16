#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { runCheckpointed, continueOperation, guardExports } = require('./operation-continuation');
const {
  historyRecordFromAttempt,
  digest,
  runtimeSettings,
  routeOperation,
  runOperation,
  validateCatalog,
  validateHistory,
  validateRequest,
  verifyReport,
} = require('../core/operation-controller');

const USAGE = `Usage:
  citadel operation init --objective TEXT --runtime codex|claude --model MODEL --verifier-executable CMD [--verifier-arg ARG] --out-dir DIR
  citadel operation catalog --runtime codex|claude --model MODEL [--fallback-model MODEL] [--reasoning-effort VALUE] [--service-tier VALUE] [--tools CSV] [--out FILE]
  citadel operation plan --request FILE --catalog FILE [--history FILE] [--json]
  citadel operation explain --request FILE --catalog FILE [--history FILE]
  citadel operation run --request FILE --catalog FILE --workspace DIR [--checkpoint DIR] [--history FILE] [--out FILE] [--history-out FILE] [--json]
  citadel operation continue --checkpoint DIR --request FILE --catalog FILE --workspace DIR [--history FILE] [--out FILE] [--history-out FILE] [--json]
  citadel operation verify --input FILE [--json]
  citadel operation doctor --request FILE --catalog FILE [--history FILE] [--json]

Planning is read-only. Run executes declared adapters and the independent
verifier without a shell. Start ordinary work with /do; use this command only
when an operation needs explicit quality, privacy, tool, time, or cost bounds.
Init and catalog accept Codex --reasoning-effort and --service-tier settings.
Both direct and fallback plans inherit them; runtime support is model-specific.
Use --service-tier default to request standard speed; served tier may be unknown.
With --checkpoint, run saves verified evidence before delivering its report.
Optional --reconcile FILE freezes deterministic local-file postconditions before
run; pass the same manifest to continue to verify an interrupted effect without
relaunching its adapter. See the guide for the restricted reconciliation contract.
Continue finishes that delivery without launching a worker. Changed inputs or
workspace files and unfinished/uncertain runs are blocked. Use a new checkpoint
directory outside the Git workspace; keep reports outside the workspace too.
Source/full-plugin guide: docs/OPERATION_CONTINUATION.md
`;

function has(args, flag) { return args.includes(flag); }

function value(args, flag, fallback = null) {
  const inline = args.find((item) => item.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
}

function values(args, flag) {
  const output = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1] !== undefined) output.push(args[index + 1]);
    else if (args[index].startsWith(`${flag}=`)) output.push(args[index].slice(flag.length + 1));
  }
  return output;
}

function csv(input) {
  if (!input) return [];
  return [...new Set(String(input).split(',').map((item) => item.trim()).filter(Boolean))];
}

function slug(input) {
  return String(input).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72) || 'operation';
}

function unknownCost(source) { return { status: 'unknown', amount_usd: null, basis: 'estimate', source }; }

function settingsIdentity(base, settings) {
  if (!Object.keys(settings).length) return base;
  return `${base.slice(0, 85)}-settings-${digest({ base, settings }).slice(7, 39)}`;
}

function requestedSettings(args, runtime) {
  const settings = {};
  for (const field of ['reasoning_effort', 'service_tier']) {
    const flag = `--${field.replaceAll('_', '-')}`;
    if (!args.some((item) => item === flag || item.startsWith(`${flag}=`))) continue;
    const raw = value(args, flag);
    if (raw === null || raw.startsWith('--')) throw Object.assign(new Error(`${flag} requires a value`), { code: 'USAGE' });
    settings[field] = raw;
  }
  runtimeSettings(settings, 'runtime settings');
  if (runtime !== 'codex' && Object.keys(settings).length) {
    throw Object.assign(new Error(`${runtime} operation adapter does not support reasoning-effort or service-tier settings`), { code: 'USAGE' });
  }
  return settings;
}

function runtimeCatalog(args) {
  const runtime = required(args, '--runtime');
  if (!['codex', 'claude'].includes(runtime)) throw Object.assign(new Error('--runtime must be codex or claude'), { code: 'USAGE' });
  const model = required(args, '--model');
  const fallbackModel = value(args, '--fallback-model');
  const settings = requestedSettings(args, runtime);
  const tools = csv(value(args, '--tools', 'filesystem,shell'));
  const adapterId = `${runtime}-cli`;
  const models = fallbackModel ? [model, fallbackModel] : [model];
  const plans = models.map((modelId, index) => ({
    plan_id: settingsIdentity(`${runtime}-${index === 0 ? 'direct' : 'fallback'}-${slug(modelId)}`, settings),
    label: `${runtime} ${modelId}${index === 0 ? ' direct attempt' : ' fallback'}`,
    adapter_id: adapterId,
    topology: 'direct',
    model: modelId,
    ...settings,
    tools,
    privacy: 'allow-remote',
    feature_keys: [],
    prior: { success_probability: index === 0 ? 0.65 : 0.8, strength: 2, source: 'uncalibrated-runtime-template' },
    expected_duration_ms: Number(value(args, '--expected-duration-ms', 600000)),
    costs: {
      actual_cash: unknownCost('runtime template has no invoice attribution'),
      marginal: unknownCost('runtime template has no per-operation marginal observation'),
      market_equivalent: unknownCost('add a sourced estimate or learn from observed telemetry'),
    },
    retry_on: ['MALFORMED_OUTPUT', 'OUTPUT_TRUNCATED'],
    max_retries: 1,
    fallback_plan_ids: index === 0 && fallbackModel ? [settingsIdentity(`${runtime}-fallback-${slug(fallbackModel)}`, settings)] : [],
  }));
  return {
    schema: 1,
    catalog_id: settingsIdentity(`${runtime}-${slug(model)}-runtime-catalog`, settings),
    adapters: {
      [adapterId]: {
        protocol: 'citadel-operation-adapter-v1',
        executable: process.execPath,
        args: [path.join(__dirname, 'operation-runtime-adapter.js'), runtime],
        timeout_ms: Number(value(args, '--adapter-timeout-ms', 1800000)),
        environment_allowlist: runtime === 'codex' ? ['CODEX_HOME', 'CITADEL_CODEX_JS'] : [],
      },
    },
    plans,
  };
}

function initializedRequest(args, catalog) {
  const objective = required(args, '--objective');
  const allowedTools = catalog.plans[0].tools;
  const requiredTools = csv(value(args, '--required-tools'));
  const numberOrNull = (flag) => {
    const raw = value(args, flag);
    return raw === null ? null : Number(raw);
  };
  return {
    schema: 2,
    operation_id: slug(value(args, '--operation-id', objective)),
    objective,
    feature_key: slug(value(args, '--feature', 'repository-change')),
    quality_target: Number(value(args, '--quality-target', 0.8)),
    constraints: {
      privacy: value(args, '--privacy', 'allow-remote'),
      allowed_tools: allowedTools,
      required_tools: requiredTools,
      max_duration_ms: Number(value(args, '--max-duration-ms', 3600000)),
      budgets: {
        actual_cash: numberOrNull('--actual-cash-budget'),
        marginal: numberOrNull('--marginal-budget'),
        market_equivalent: numberOrNull('--market-equivalent-budget'),
      },
      unknown_cost_policy: value(args, '--unknown-cost-policy', 'deny'),
    },
    verifier: {
      kind: 'command',
      executable: required(args, '--verifier-executable'),
      args: values(args, '--verifier-arg'),
      cwd: value(args, '--verifier-cwd', '.'),
      timeout_ms: Number(value(args, '--verifier-timeout-ms', 600000)),
      required_changed_paths: values(args, '--required-changed-path'),
    },
  };
}

function required(args, flag) {
  const found = value(args, flag);
  if (!found) throw Object.assign(new Error(`${flag} is required`), { code: 'USAGE' });
  return found;
}

function readJson(file, cwd) {
  const resolved = path.resolve(cwd, file);
  try { return JSON.parse(fs.readFileSync(resolved, 'utf8')); } catch (error) {
    throw Object.assign(new Error(`Could not read JSON ${resolved}: ${error.message}`), { code: 'INPUT_INVALID' });
  }
}

function readHistory(file, cwd) {
  if (!file) return [];
  const resolved = path.resolve(cwd, file);
  const text = fs.readFileSync(resolved, 'utf8').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : parsed.records;
  } catch (_error) {
    return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
      try { return JSON.parse(line); } catch (error) { throw new Error(`Invalid JSONL history at line ${index + 1}: ${error.message}`); }
    });
  }
}

function inputs(args, cwd) {
  const request = readJson(required(args, '--request'), cwd);
  const catalog = readJson(required(args, '--catalog'), cwd);
  const history = readHistory(value(args, '--history'), cwd);
  validateRequest(request);
  validateCatalog(catalog);
  validateHistory(history);
  return { request, catalog, history };
}

function humanPlan(decision) {
  const selected = decision.selected;
  const costs = Object.entries(selected.expected_costs).map(([lens, cost]) => `${lens}=${cost.status === 'known' ? `$${cost.amount_usd}` : 'unknown'}`).join(', ');
  return [
    `Operation: ${decision.operation_id}`,
    `Decision: ${decision.selection_status}`,
    `Path: ${selected.plan_ids.join(' -> ')}`,
    `Conservative verified-success estimate: ${(selected.verified_success_probability * 100).toFixed(1)}% (target ${(decision.quality_target * 100).toFixed(1)}%)`,
    `Expected whole-path duration: ${selected.expected_duration_ms} ms`,
    `Declared maximum duration: ${selected.maximum_duration_ms} ms`,
    `Expected whole-path cost: ${costs}`,
    `Decision digest: ${decision.decision_digest}`,
  ].join('\n') + '\n';
}

function write(valueToWrite, json, io, human = null) {
  if (json || human === null) io.stdout.write(`${JSON.stringify(valueToWrite, null, 2)}\n`);
  else io.stdout.write(human);
}

function main(argv = process.argv.slice(2), options = {}) {
  const cwd = options.cwd || process.cwd();
  const io = options.io || { stdout: process.stdout, stderr: process.stderr };
  const command = argv[0];
  const args = argv.slice(1);
  const json = has(args, '--json');
  if (!command || has(args, '--help') || has(args, '-h')) {
    io.stdout.write(USAGE);
    return 0;
  }
  try {
    if (command === 'catalog') {
      const catalog = runtimeCatalog(args);
      validateCatalog(catalog);
      const out = value(args, '--out');
      if (out) fs.writeFileSync(path.resolve(cwd, out), `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
      write(catalog, true, io);
      return 0;
    }
    if (command === 'init') {
      const outDir = path.resolve(cwd, required(args, '--out-dir'));
      const catalog = runtimeCatalog(args);
      const request = initializedRequest(args, catalog);
      validateCatalog(catalog);
      validateRequest(request);
      fs.mkdirSync(outDir, { recursive: true });
      const requestFile = path.join(outDir, 'request.json');
      const catalogFile = path.join(outDir, 'catalog.json');
      fs.writeFileSync(requestFile, `${JSON.stringify(request, null, 2)}\n`, 'utf8');
      fs.writeFileSync(catalogFile, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
      const result = {
        status: 'initialized', request: requestFile, catalog: catalogFile,
        next: `citadel operation plan --request "${requestFile}" --catalog "${catalogFile}"`,
      };
      write(result, json, io, `Operation inputs initialized.\nRequest: ${requestFile}\nCatalog: ${catalogFile}\nNext: ${result.next}\n`);
      return 0;
    }
    if (command === 'plan' || command === 'explain') {
      const decision = routeOperation(inputs(args, cwd));
      write(decision, json, io, humanPlan(decision));
      return 0;
    }
    if (command === 'doctor') {
      const loaded = inputs(args, cwd);
      const decision = routeOperation(loaded);
      const report = {
        schema: 1,
        status: 'ready',
        checks: [
          { name: 'request-contract', status: 'passed' },
          { name: 'catalog-contract', status: 'passed' },
          { name: 'history-contract', status: 'passed', records: loaded.history.length },
          { name: 'eligible-path', status: 'passed', plan_ids: decision.selected.plan_ids },
        ],
      };
      write(report, json, io, `Operation Control is ready. Selected path: ${decision.selected.plan_ids.join(' -> ')}\n`);
      return 0;
    }
    if (command === 'run' || command === 'continue') {
      const loaded = inputs(args, cwd);
      const workspaceRoot = path.resolve(cwd, required(args, '--workspace'));
      const checkpoint = command === 'continue' ? required(args, '--checkpoint') : value(args, '--checkpoint');
      const execution = { ...loaded, workspaceRoot, ...(checkpoint ? { checkpoint: path.resolve(cwd, checkpoint) } : {}) };
      const reconcileFile = value(args, '--reconcile');
      if (reconcileFile) {
        if (!checkpoint) throw Object.assign(new Error('--reconcile requires --checkpoint'), { code: 'USAGE' });
        execution.reconciliation = readJson(reconcileFile, cwd);
      }
      if (checkpoint) guardExports(execution, [value(args, '--out'), value(args, '--history-out')].filter(Boolean).map((file) => path.resolve(cwd, file)));
      const report = command === 'continue' ? continueOperation(execution) : checkpoint ? runCheckpointed(execution) : runOperation(execution);
      const out = value(args, '--out');
      if (out) fs.writeFileSync(path.resolve(cwd, out), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      const historyOut = value(args, '--history-out');
      if (historyOut) {
        const records = report.attempts.map((attempt) => historyRecordFromAttempt(loaded.request, attempt));
        fs.writeFileSync(path.resolve(cwd, historyOut), `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
      }
      const continuationMessage = report.kind === 'citadel_operation_recovery_report'
        ? 'Recovered file postconditions verified. Adapter not relaunched; original execution observations remain unknown.\n'
        : 'Verified checkpoint restored. No adapter or verifier launched.\n';
      write(report, json, io, `${command === 'continue' ? continuationMessage : ''}Operation ${report.operation_id}: ${report.status}\nAttempts: ${report.attempts.length}\nReport digest: ${report.report_digest}\n`);
      return report.status === 'passed' ? 0 : report.status === 'unknown' ? 2 : 1;
    }
    if (command === 'verify') {
      const report = readJson(required(args, '--input'), cwd);
      const result = verifyReport(report);
      write(result, json, io, `Operation report: ${result.status} (${result.reason_code})\nSigner trust: ${result.signer_trust || 'not established'}\n`);
      return result.status === 'verified' ? 0 : 1;
    }
    throw Object.assign(new Error(`unknown operation command: ${command}`), { code: 'USAGE' });
  } catch (error) {
    const payload = { ok: false, command, code: error.code || 'OPERATION_FAILED', message: error.message };
    if (error.candidates) payload.candidates = error.candidates;
    if (json) io.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    else io.stderr.write(`citadel operation: ${error.message} [${payload.code}]\n`);
    return error.code === 'USAGE' ? 64 : 1;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = Object.freeze({ USAGE, humanPlan, initializedRequest, main, readHistory, readJson, runtimeCatalog });

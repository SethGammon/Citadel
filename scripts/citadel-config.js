#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { sha256Digest } = require('../core/operations/canonical');
const config = require('../core/config');
const {
  CODEX_AGENT_EXTENSION,
  normalizeCodexAgentConfig,
} = require('../core/agents/model-config');

function parseArgs(argv) {
  const result = {
    command: argv[0] || 'show',
    values: [],
    projectRoot: process.cwd(),
    runtime: process.env.CITADEL_RUNTIME || 'unknown',
    runtimeSpecified: false,
    json: false,
    apply: false,
    profile: null,
    enable: [],
    disable: [],
    allowDegradedRuntime: null,
    input: null,
    defaultModel: null,
    defaultEffort: null,
    modelAliases: [],
    agentModels: [],
    agentEfforts: [],
  };
  function nextValue(flag, index) {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new TypeError(`${flag} requires a value`);
    return value;
  }
  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--project-root') result.projectRoot = path.resolve(nextValue(arg, index++));
    else if (arg === '--runtime') {
      result.runtimeSpecified = true;
      result.runtime = nextValue(arg, index++);
    }
    else if (arg === '--profile') result.profile = nextValue(arg, index++);
    else if (arg === '--input') result.input = path.resolve(nextValue(arg, index++));
    else if (arg === '--default-model') result.defaultModel = nextValue(arg, index++);
    else if (arg === '--default-effort') result.defaultEffort = nextValue(arg, index++);
    else if (arg === '--model-alias') result.modelAliases.push(nextValue(arg, index++));
    else if (arg === '--agent-model') result.agentModels.push(nextValue(arg, index++));
    else if (arg === '--agent-effort') result.agentEfforts.push(nextValue(arg, index++));
    else if (arg === '--enable') result.enable.push(nextValue(arg, index++));
    else if (arg === '--disable') result.disable.push(nextValue(arg, index++));
    else if (arg === '--allow-degraded-runtime') result.allowDegradedRuntime = true;
    else if (arg === '--deny-degraded-runtime') result.allowDegradedRuntime = false;
    else if (arg === '--json') result.json = true;
    else if (arg === '--apply') result.apply = true;
    else if (arg === '--help' || arg === '-h') result.command = 'help';
    else if (arg.startsWith('--')) throw new TypeError(`Unknown option: ${arg}`);
    else result.values.push(arg);
  }
  return result;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/citadel-config.js show [--runtime ID] [--json]',
    '  node scripts/citadel-config.js check <skill|route|hook> ID [--runtime ID] [--json]',
    '  node scripts/citadel-config.js reconcile [--runtime ID] --apply [--json]',
    '  node scripts/citadel-config.js initialize --input STACK.json [--apply] [--json]',
    '  node scripts/citadel-config.js plan [--profile ID[@VERSION]] [--enable BUNDLE] [--disable BUNDLE]',
    '  node scripts/citadel-config.js migrate [--apply]',
    '  node scripts/citadel-config.js set-profile ID[@VERSION] [--apply]',
    '  node scripts/citadel-config.js configure-codex-agents [--default-model MODEL] [--default-effort LEVEL]',
    '       [--model-alias FAMILY=MODEL] [--agent-model AGENT=MODEL] [--agent-effort AGENT=LEVEL] [--apply]',
    '  node scripts/citadel-config.js enable BUNDLE [--apply]',
    '  node scripts/citadel-config.js disable BUNDLE [--apply]',
    '',
    'Planning is the default. No command writes harness.json unless --apply is explicit.',
  ].join('\n');
}

function assignment(value, flag) {
  const separator = value.indexOf('=');
  if (separator < 1 || separator === value.length - 1) {
    throw new TypeError(`${flag} requires NAME=VALUE`);
  }
  return [value.slice(0, separator), value.slice(separator + 1)];
}

function withCodexAgentConfig(raw, args) {
  const candidate = config.migrationCandidate(raw);
  const existing = config.plain(candidate.extensions?.[CODEX_AGENT_EXTENSION])
    ? candidate.extensions[CODEX_AGENT_EXTENSION]
    : {};
  const next = {
    ...existing,
    modelAliases: { ...(existing.modelAliases || {}) },
    agents: Object.fromEntries(Object.entries(existing.agents || {}).map(([name, value]) => (
      [name, { ...value }]
    ))),
  };
  let changes = 0;
  if (args.defaultModel !== null) {
    next.defaultModel = args.defaultModel;
    changes++;
  }
  if (args.defaultEffort !== null) {
    next.defaultReasoningEffort = args.defaultEffort;
    changes++;
  }
  for (const rawAlias of args.modelAliases) {
    const [name, model] = assignment(rawAlias, '--model-alias');
    next.modelAliases[name] = model;
    changes++;
  }
  for (const rawAgent of args.agentModels) {
    const [name, model] = assignment(rawAgent, '--agent-model');
    next.agents[name] = { ...(next.agents[name] || {}), model };
    changes++;
  }
  for (const rawAgent of args.agentEfforts) {
    const [name, reasoningEffort] = assignment(rawAgent, '--agent-effort');
    next.agents[name] = { ...(next.agents[name] || {}), reasoningEffort };
    changes++;
  }
  if (!changes) {
    throw new TypeError('configure-codex-agents requires at least one model or effort option');
  }
  normalizeCodexAgentConfig(next);
  return {
    ...candidate,
    extensions: {
      ...candidate.extensions,
      [CODEX_AGENT_EXTENSION]: next,
    },
  };
}

function runtimeContract(runtimeId) {
  if (runtimeId === 'codex') return require('../runtimes/codex/runtime');
  if (runtimeId === 'opencode') return require('../runtimes/opencode/runtime');
  if (runtimeId === 'claude' || runtimeId === 'claude-code') {
    return require('../runtimes/claude-code/runtime');
  }
  if (runtimeId === 'openai') return require('../runtimes/openai/runtime');
  return { id: 'unknown', capabilities: {}, degradations: ['runtime-not-declared'] };
}

function transformPlan(raw, args) {
  let candidate = config.migrationCandidate(raw, {
    allowDegradedRuntime: args.allowDegradedRuntime ?? undefined,
  });
  if (args.profile) candidate = config.withProfile(candidate, args.profile);
  for (const bundle of args.enable) candidate = config.withBundleEnabled(candidate, bundle);
  for (const bundle of args.disable) candidate = config.withBundleDisabled(candidate, bundle);
  return candidate;
}

function buildPlan(raw, args) {
  if (args.command === 'initialize') {
    if (args.values.length) throw new TypeError('initialize does not accept positional values');
    if (!args.input) throw new TypeError('initialize requires --input');
    const patch = JSON.parse(fs.readFileSync(args.input, 'utf8'));
    const allowed = [
      'language', 'framework', 'packageManager', 'typecheck', 'test',
      'qualityRules', 'protectedFiles', 'features', 'registeredSkills',
      'registeredSkillCount', 'agentTimeouts', 'dependencyPatterns',
      'organization', 'telemetry', 'cost', 'verification', 'preCompact',
      'worktreeReadiness', 'docs', 'allowEnvWrites',
    ];
    if (!config.plain(patch)) throw new TypeError('initialize input must be a JSON object');
    const unknown = Object.keys(patch).filter((field) => !allowed.includes(field));
    if (unknown.length) {
      throw new TypeError(`initialize input has unsupported fields: ${unknown.join(', ')}`);
    }
    return config.createChangePlan(raw, 'initialize', (value) => ({
      ...config.migrationCandidate(value),
      ...patch,
    }));
  }
  if (args.command === 'migrate') {
    if (args.values.length) throw new TypeError('migrate does not accept positional values');
    return config.createMigrationPlan(raw, {
      allowDegradedRuntime: args.allowDegradedRuntime ?? undefined,
    });
  }
  if (args.command === 'set-profile') {
    const reference = args.values[0];
    if (!reference) throw new TypeError('set-profile requires ID[@VERSION]');
    if (args.values.length > 1) throw new TypeError('set-profile accepts exactly one profile');
    return config.createChangePlan(raw, `set-profile:${reference}`, (value) =>
      config.withProfile(value, reference));
  }
  if (args.command === 'configure-codex-agents') {
    if (args.values.length) throw new TypeError('configure-codex-agents does not accept positional values');
    return config.createChangePlan(raw, 'configure-codex-agents', (value) => (
      withCodexAgentConfig(value, args)
    ));
  }
  if (args.command === 'enable') {
    const bundle = args.values[0];
    if (!bundle) throw new TypeError('enable requires a bundle ID');
    if (args.values.length > 1) throw new TypeError('enable accepts exactly one bundle ID');
    return config.createChangePlan(raw, `enable:${bundle}`, (value) => {
      const candidate = config.withBundleEnabled(value, bundle);
      if (args.allowDegradedRuntime === null) return candidate;
      return {
        ...candidate,
        activation: {
          ...candidate.activation,
          allowDegradedRuntime: args.allowDegradedRuntime,
        },
      };
    });
  }
  if (args.command === 'disable') {
    const bundle = args.values[0];
    if (!bundle) throw new TypeError('disable requires a bundle ID');
    if (args.values.length > 1) throw new TypeError('disable accepts exactly one bundle ID');
    return config.createChangePlan(raw, `disable:${bundle}`, (value) =>
      config.withBundleDisabled(value, bundle));
  }
  if (args.command === 'plan') {
    if (args.values.length) throw new TypeError('plan does not accept positional values');
    return config.createChangePlan(raw, 'plan', (value) => transformPlan(value, args));
  }
  throw new TypeError(`Unknown command: ${args.command}`);
}

function atomicReplace(filePath, bytes) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  fs.writeFileSync(temporary, bytes);
  try {
    fs.renameSync(temporary, filePath);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch { /* best effort */ }
    throw error;
  }
}

function atomicWriteJson(filePath, value) {
  const existed = fs.existsSync(filePath);
  const previousBytes = existed ? fs.readFileSync(filePath) : null;
  const backupPath = existed ? `${filePath}.bak` : null;
  if (backupPath) atomicReplace(backupPath, previousBytes);
  atomicReplace(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return { backupPath, existed, previousBytes };
}

function rollbackWrite(filePath, write) {
  if (write.existed) {
    atomicReplace(filePath, write.previousBytes);
    return;
  }
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

function applyPlan(loaded, plan, options = {}) {
  if (plan.blocked || !plan.candidateConfig) {
    throw new Error(`Plan is blocked: ${plan.errors.join('; ')}`);
  }
  const candidateResolution = config.resolveConfig(plan.candidateConfig, {
    runtime: options.runtime,
    sourceDigest: plan.candidateDigest,
  });
  if (candidateResolution.status === 'blocked') {
    throw new Error(`Plan is blocked by runtime or policy: ${candidateResolution.errors.join('; ')}`);
  }
  const current = config.readConfigFile(loaded.projectRoot, {
    configPath: path.relative(loaded.projectRoot, loaded.configPath),
  });
  if (current.parseError) throw new Error(`Current config is invalid JSON: ${current.parseError}`);
  const currentDigest = sha256Digest(current.raw === undefined ? null : current.raw);
  if (currentDigest !== plan.sourceDigest) {
    throw new Error('Config changed after planning; rerun the command before applying');
  }
  const effectivePath = config.effectiveConfigPath(loaded.projectRoot);
  const priorEffective = fs.existsSync(effectivePath)
    ? fs.readFileSync(effectivePath)
    : null;
  const write = atomicWriteJson(loaded.configPath, plan.candidateConfig);
  let observedDigest;
  let effective;
  try {
    const observed = config.readConfigFile(loaded.projectRoot, {
      configPath: path.relative(loaded.projectRoot, loaded.configPath),
    });
    if (observed.parseError) {
      throw new Error(`Applied config is invalid JSON: ${observed.parseError}`);
    }
    config.assertConfigV2(observed.raw);
    observedDigest = sha256Digest(observed.raw);
    if (observedDigest !== plan.candidateDigest) {
      throw new Error('Applied config digest does not match the approved plan');
    }
    effective = config.reconcileEffectiveConfig(loaded.projectRoot, {
      runtime: options.runtime,
      reconciledAt: options.reconciledAt,
    });
  } catch (error) {
    try {
      rollbackWrite(loaded.configPath, write);
      if (priorEffective) atomicReplace(effectivePath, priorEffective);
      else if (fs.existsSync(effectivePath)) fs.unlinkSync(effectivePath);
    } catch (rollbackError) {
      throw new Error(`${error.message}; rollback failed: ${rollbackError.message}`);
    }
    throw new Error(`${error.message}; previous config restored`);
  }
  return Object.freeze({
    contractVersion: 1,
    applied: true,
    action: plan.action,
    planDigest: plan.planDigest,
    beforeDigest: plan.sourceDigest,
    afterDigest: observedDigest,
    configPath: loaded.configPath,
    backupPath: write.backupPath,
    effectiveConfigPath: effective.receiptPath,
    effectiveReceiptDigest: effective.receipt.receiptDigest,
  });
}

function renderPlan(plan, configPath) {
  const lines = [
    `Citadel config ${plan.action}`,
    `Config: ${configPath}`,
    `Source: ${plan.sourceKind} ${plan.sourceDigest}`,
    `Candidate: ${plan.candidateDigest || 'none'}`,
    `Status: ${plan.blocked ? 'BLOCKED' : 'READY TO APPLY'}`,
  ];
  for (const change of plan.changes) lines.push(`  - ${change.field}`);
  for (const error of plan.errors) lines.push(`  ! ${error}`);
  lines.push(`Rollback backup on apply: ${configPath}.bak`);
  lines.push('No changes written. Re-run with --apply to apply this exact operation.');
  return lines.join('\n');
}

function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
    if (args.command === 'help') {
      process.stdout.write(`${usage()}\n`);
      return 0;
    }
    const loaded = config.readConfigFile(args.projectRoot);
    const selectedRuntime = args.runtimeSpecified
      ? runtimeContract(args.runtime)
      : config.detectRuntimeContract(args.projectRoot);
    if (args.command === 'check') {
      if (args.apply) throw new TypeError('check does not accept --apply');
      const [kind, id] = args.values;
      if (!kind || !id || args.values.length !== 2) {
        throw new TypeError('check requires <skill|route|hook> ID');
      }
      const effective = config.loadActivationContext(args.projectRoot, {
        runtime: selectedRuntime,
      });
      const decision = config.activationDecision(effective, { kind, id });
      process.stdout.write(args.json
        ? `${JSON.stringify({ effective: {
          status: effective.status,
          reasonCode: effective.reasonCode,
          persisted: effective.persisted !== false,
        }, decision }, null, 2)}\n`
        : `${kind}:${id} ${decision.status} (${decision.reasonCode})\n`);
      return ['enabled', 'degraded'].includes(decision.status) ? 0 : 2;
    }
    if (args.command === 'reconcile') {
      if (!args.apply) {
        throw new TypeError('reconcile writes only derived state and requires --apply');
      }
      const effective = config.reconcileEffectiveConfig(args.projectRoot, {
        runtime: selectedRuntime,
      });
      process.stdout.write(args.json
        ? `${JSON.stringify(effective, null, 2)}\n`
        : `Reconciled ${effective.receiptPath}\nReceipt: ${effective.receipt.receiptDigest}\n`);
      return effective.receipt.status === 'blocked' ? 1 : 0;
    }
    if (args.command === 'show') {
      if (args.apply) throw new TypeError('show does not accept --apply');
      const receipt = config.resolveConfig(loaded.raw, {
        parseError: loaded.parseError,
        sourceDigest: loaded.sourceDigest,
        runtime: selectedRuntime,
      });
      process.stdout.write(args.json
        ? `${JSON.stringify(receipt, null, 2)}\n`
        : `Citadel config: ${receipt.status}\nProfile: ${receipt.profile.id}@${receipt.profile.version}\nBundles: ${receipt.bundles.effective.join(', ')}\nReceipt: ${receipt.receiptDigest}\n`);
      return receipt.status === 'blocked' ? 1 : 0;
    }
    if (loaded.parseError) throw new Error(`Config is invalid JSON: ${loaded.parseError}`);
    const plan = buildPlan(loaded.raw, args);
    if (!args.apply) {
      process.stdout.write(args.json
        ? `${JSON.stringify(plan, null, 2)}\n`
        : `${renderPlan(plan, loaded.configPath)}\n`);
      return plan.blocked ? 1 : 0;
    }
    const receipt = applyPlan(loaded, plan, { runtime: selectedRuntime });
    const result = args.command === 'configure-codex-agents'
      ? {
        ...receipt,
        nextCommand: `node "${path.join(__dirname, 'generate-agent-projections.js')}" --project-root "${loaded.projectRoot}"`,
      }
      : receipt;
    process.stdout.write(args.json
      ? `${JSON.stringify(result, null, 2)}\n`
      : `Applied ${receipt.action}\nConfig: ${receipt.configPath}\nDigest: ${receipt.afterDigest}\n${result.nextCommand ? `Next: ${result.nextCommand}\n` : ''}`);
    return 0;
  } catch (error) {
    process.stderr.write(
      `Citadel config error: ${error.message}`
        + (error.repairCommand ? `\nRepair: ${error.repairCommand}` : '')
        + '\n',
    );
    return 1;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = Object.freeze({
  applyPlan,
  atomicReplace,
  atomicWriteJson,
  buildPlan,
  main,
  parseArgs,
  rollbackWrite,
  runtimeContract,
  transformPlan,
  usage,
  withCodexAgentConfig,
});

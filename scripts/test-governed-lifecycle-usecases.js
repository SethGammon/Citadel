#!/usr/bin/env node

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const governance = require('../core/governance');
const productProof = require('../core/product-proof');
const { baselineMigration } = require('../core/adoption/migrations');
const { readReceipt } = require('../core/adoption');
const {
  parseWorkQueue,
  taskGovernanceAuthority,
} = require('../core/fleet/session');
const {
  fixture: controlFixture,
  intentCommand,
  request: controlRequest,
} = require('./control-plane-conformance');

const ROOT = path.resolve(__dirname, '..');
const CITADEL = path.join(ROOT, 'bin', 'citadel.js');
const FLEET_STEWARD = path.join(ROOT, 'scripts', 'fleet-steward.js');
const CONTROL_STDIO = path.join(ROOT, 'scripts', 'control-plane-stdio.js');
const DEFAULT_OUTPUT = path.join(
  ROOT,
  '.planning',
  'verification',
  'governed-lifecycle.json',
);
let activeScenario = null;

function resolveNpmCli() {
  const executableDirectory = path.dirname(process.execPath);
  const candidates = [
    process.env.npm_execpath,
    path.join(executableDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(executableDirectory, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function parseArgs(argv) {
  const options = { out: DEFAULT_OUTPUT, keepScratch: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--keep-scratch') options.keepScratch = true;
    else if (token === '--out') {
      const value = argv[++index];
      if (!value) throw new Error('--out requires a path');
      options.out = path.resolve(value);
    } else if (token === '--help' || token === '-h') options.help = true;
    else throw new Error(`Unknown option: ${token}`);
  }
  return options;
}

function usage() {
  return [
    'Usage: node scripts/test-governed-lifecycle-usecases.js [--out FILE] [--keep-scratch]',
    '',
    'Runs isolated local-user journeys and writes a privacy-bounded proof record.',
    'It does not claim registry publication, independent repository ownership,',
    'human utility, or D7/D30 retention evidence.',
  ].join('\n');
}

function digest(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function runProcess(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    encoding: 'utf8',
    input: options.input || null,
    shell: false,
    windowsHide: true,
    timeout: options.timeout || 60_000,
    env: { ...process.env, ...(options.env || {}) },
  });
}

function runStep(scenario, options) {
  const result = runProcess(options.command, options.args, options);
  const expected = options.expected || [0];
  const step = {
    step_id: options.id,
    command: options.display,
    exit_code: result.status,
    expected_exit_codes: expected,
    stdout_digest: digest(result.stdout || ''),
    stderr_digest: digest(result.stderr || ''),
    status: expected.includes(result.status) && !result.error ? 'passed' : 'failed',
  };
  scenario.steps.push(step);
  assert.equal(result.error, undefined, `${options.id} failed to start`);
  assert(
    expected.includes(result.status),
    `${options.id} exited ${result.status}; expected ${expected.join('/')}: ${result.stderr}`,
  );
  return {
    result,
    json: options.json === false || !String(result.stdout || '').trim()
      ? null
      : JSON.parse(result.stdout),
  };
}

function runCitadel(scenario, id, args, options = {}) {
  return runStep(scenario, {
    id,
    command: process.execPath,
    args: [CITADEL, ...args],
    display: `citadel ${options.display || args.join(' ')}`,
    cwd: options.cwd,
    input: options.input,
    env: options.env,
    timeout: options.timeout,
    expected: options.expected,
    json: options.json,
  });
}

function git(root, args) {
  const result = runProcess('git', args, { cwd: root, timeout: 30_000 });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function initializeGit(root, files = {}) {
  fs.mkdirSync(root, { recursive: true });
  for (const [relative, content] of Object.entries({
    'README.md': '# User project\n',
    ...files,
  })) {
    const target = path.join(root, ...relative.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'verification@example.invalid']);
  git(root, ['config', 'user.name', 'Citadel Verification']);
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'fixture']);
  return root;
}

function sourceRepository(root, version) {
  const hookTemplate = {
    hooks: {
      PreToolUse: [{
        matcher: 'Edit',
        hooks: [{
          type: 'command',
          command: "node '${CLAUDE_PLUGIN_ROOT}/hooks_src/protect-files.js'",
          timeout: 30,
        }],
      }],
    },
  };
  return initializeGit(root, {
    'package.json': `${JSON.stringify({ name: 'citadel', version }, null, 2)}\n`,
    '.citadel/project.template.md': `# Citadel ${version}\n`,
    'hooks/hooks-template.json': `${JSON.stringify(hookTemplate, null, 2)}\n`,
    'skills/review/SKILL.md': `---\nname: review\n---\n# Review ${version}\n`,
  });
}

function planApplyArgs(prefix, planFile, plan, controlRoot) {
  const args = [...prefix, 'apply', planFile];
  if (plan.confirmation?.token) args.push('--confirm', plan.confirmation.token);
  if (controlRoot) args.push('--control-root', controlRoot);
  args.push('--json');
  return args;
}

function scenarioRecord(id, title, supported, unsupported) {
  activeScenario = {
    scenario_id: id,
    title,
    evidence_class: 'local-isolated-user-journey',
    status: 'running',
    claims_supported: supported,
    claims_not_supported: unsupported,
    steps: [],
    facts: {},
  };
  return activeScenario;
}

function governanceScenario(suite) {
  const scenario = scenarioRecord(
    'governance-and-fleet',
    'A validator timeout holds one branch while independent work continues and merge waits for a receipt',
    [
      'timeout remains unknown and unauthorized',
      'independent passed work may advance',
      'retry history is append-only',
      'Fleet status alone cannot authorize merge',
      'a durable governance receipt can authorize an order-valid merge',
    ],
    ['human judgment quality', 'remote CI availability'],
  );
  const projectRoot = path.join(suite, 'governance-project');
  fs.mkdirSync(projectRoot, { recursive: true });
  const producerDigest = governance.sha256Digest({ contract: 'real-user-validator-v1' });
  const policy = governance.createGatePolicy({
    contract_version: 1,
    policy_id: 'real-user-merge-gate',
    subject_kind: 'fleet-task',
    required_observations: [{
      observation_id: 'validator',
      producer_kind: 'mechanical-validator',
      producer_contract_digest: producerDigest,
    }],
    retry_policy: {
      max_attempts: 2,
      initial_delay_ms: 0,
      backoff_multiplier: 1,
      max_delay_ms: 0,
    },
    deadline_policy: {
      attempt_timeout_ms: 1000,
      overall_deadline_ms: 300000,
    },
    checkpoint_requirement: 'none',
    human_gate: { required: false, observation_id: null },
    allowed_dispositions: ['retry', 'hold', 'advance', 'merge'],
  });

  function subject(id) {
    return { kind: 'fleet-task', id };
  }
  function subjectDigest(id) {
    return governance.sha256Digest(subject(id));
  }
  function passed(id, observationId, at) {
    return governance.createEvidenceObservation({
      contract_version: 1,
      observation_id: observationId,
      subject: subject(id),
      subject_digest: subjectDigest(id),
      subject_generation: 1,
      attempt_id: `attempt-${observationId}`,
      producer: { kind: 'mechanical-validator', id: 'validator' },
      producer_contract_digest: producerDigest,
      truth_status: 'passed',
      coverage: { required: 1, observed: 1, passed: 1, complete: true },
      reason_code: 'VERIFIED',
      artifact_digests: [governance.sha256Digest({ id, observationId })],
      observed_at: at,
      expires_at: null,
    });
  }
  function envelope(id, observations = [], failures = []) {
    return {
      input_version: 1,
      policy,
      observations,
      failures,
      subject: subject(id),
      subject_digest: subjectDigest(id),
      subject_generation: 1,
      started_at: '2026-07-30T20:00:00.000Z',
      requested_disposition: 'merge',
    };
  }
  function writeInput(name, value) {
    const target = path.join(projectRoot, name);
    writeJson(target, value);
    return target;
  }
  function authorize(id, expected) {
    return runCitadel(scenario, `authorize-${id}`, [
      'governance', 'authorize',
      '--project-root', projectRoot,
      '--subject-kind', 'fleet-task',
      '--subject-id', id,
      '--subject-digest', subjectDigest(id),
      '--subject-generation', '1',
      '--disposition', 'merge',
    ], {
      display: `governance authorize --project-root <project> --subject-id ${id} --disposition merge`,
      expected,
    });
  }

  const timeoutA = writeInput('branch-a-timeout.json', envelope('branch-a', [], [{
    failure_kind: 'timeout',
    observation_id: 'branch-a-validation-1',
    attempt_id: 'attempt-branch-a-validation-1',
    producer: { kind: 'mechanical-validator', id: 'validator' },
    producer_contract_digest: producerDigest,
    observed_at: '2026-07-30T20:00:30.000Z',
    expires_at: null,
  }]));
  const held = runCitadel(scenario, 'evaluate-timeout-a', [
    'governance', 'evaluate',
    '--project-root', projectRoot,
    '--input', timeoutA,
    '--at', '2026-07-30T20:01:00.000Z',
  ], {
    display: 'governance evaluate --project-root <project> --input <timeout-a.json>',
    expected: [1],
  }).json;
  assert.equal(held.status, 'unknown');
  assert.equal(held.decision.reason_code, 'VALIDATOR_TIMEOUT');
  assert.equal(authorize('branch-a', [1]).json.authorized, false);

  const passB = writeInput(
    'branch-b-pass.json',
    envelope('branch-b', [passed('branch-b', 'branch-b-validation-1', '2026-07-30T20:01:30.000Z')]),
  );
  const advanced = runCitadel(scenario, 'evaluate-pass-b', [
    'governance', 'evaluate',
    '--project-root', projectRoot,
    '--input', passB,
    '--at', '2026-07-30T20:02:00.000Z',
  ], {
    display: 'governance evaluate --project-root <project> --input <pass-b.json>',
  }).json;
  assert.equal(advanced.status, 'passed');
  assert.equal(authorize('branch-b', [0]).json.authorized, true);

  const retryA = writeInput(
    'branch-a-retry.json',
    envelope('branch-a', [passed('branch-a', 'branch-a-validation-2', '2026-07-30T20:02:30.000Z')]),
  );
  const recovered = runCitadel(scenario, 'evaluate-retry-a', [
    'governance', 'evaluate',
    '--project-root', projectRoot,
    '--input', retryA,
    '--at', '2026-07-30T20:03:00.000Z',
  ], {
    display: 'governance evaluate --project-root <project> --input <retry-a.json>',
  }).json;
  assert.equal(recovered.status, 'passed');
  assert.equal(recovered.decision.observation_digests.length, 2);
  assert.equal(authorize('branch-a', [0]).json.authorized, true);

  const fleetSession = [
    '# Fleet Session: Real User',
    '',
    'Status: active',
    '',
    '## Work Queue',
    '| # | Campaign | Scope | Deps | Status | Wave | Agent | Branch | Evidence |',
    '|---|----------|-------|------|--------|------|-------|--------|----------|',
    '| 4 | Docs | docs | none | validated | 1 | docs | codex/fleet-docs | validator pass |',
    '',
    '## Continuation State',
    'Next wave: 1',
  ].join('\n');
  const sessionFile = path.join(projectRoot, '.planning', 'fleet', 'real-user.md');
  fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
  fs.writeFileSync(sessionFile, fleetSession);
  const beforeMerge = runStep(scenario, {
    id: 'fleet-status-only',
    command: process.execPath,
    args: [
      FLEET_STEWARD, '--project-root', projectRoot,
      '--session', sessionFile, '--json',
    ],
    display: 'node scripts/fleet-steward.js --project-root <project> --session <session> --json',
  }).json;
  assert.deepEqual(beforeMerge.analysis.mergeCandidates, []);
  assert.equal(beforeMerge.analysis.governanceBlocked.length, 1);

  const task = parseWorkQueue(fleetSession)[0];
  const authority = taskGovernanceAuthority(task, { sessionId: 'real-user' });
  const fleetProducerDigest = governance.sha256Digest({ contract: 'fleet-real-user-validator-v1' });
  const fleetPolicy = governance.createGatePolicy({
    contract_version: 1,
    policy_id: 'fleet-real-user-merge',
    subject_kind: authority.kind,
    required_observations: [{
      observation_id: 'validator',
      producer_kind: 'mechanical-validator',
      producer_contract_digest: fleetProducerDigest,
    }],
    retry_policy: {
      max_attempts: 1,
      initial_delay_ms: 0,
      backoff_multiplier: 1,
      max_delay_ms: 0,
    },
    deadline_policy: { attempt_timeout_ms: 1000, overall_deadline_ms: 60000 },
    checkpoint_requirement: 'none',
    human_gate: { required: false, observation_id: null },
    allowed_dispositions: ['hold', 'merge'],
  });
  const fleetSubject = { kind: authority.kind, id: authority.id };
  const fleetObservation = governance.createEvidenceObservation({
    contract_version: 1,
    observation_id: 'validator',
    subject: fleetSubject,
    subject_digest: authority.digest,
    subject_generation: authority.generation,
    attempt_id: 'fleet-real-user-attempt',
    producer: { kind: 'mechanical-validator', id: 'validator' },
    producer_contract_digest: fleetProducerDigest,
    truth_status: 'passed',
    coverage: { required: 1, observed: 1, passed: 1, complete: true },
    reason_code: 'VERIFIED',
    artifact_digests: [governance.sha256Digest({ task: task.id, proof: 'passed' })],
    observed_at: '2026-07-30T20:04:00.000Z',
    expires_at: null,
  });
  const fleetInput = writeInput('fleet-task-pass.json', {
    input_version: 1,
    policy: fleetPolicy,
    observations: [fleetObservation],
    failures: [],
    subject: fleetSubject,
    subject_digest: authority.digest,
    subject_generation: authority.generation,
    started_at: '2026-07-30T20:03:30.000Z',
    requested_disposition: 'merge',
  });
  runCitadel(scenario, 'fleet-receipt', [
    'governance', 'evaluate',
    '--project-root', projectRoot,
    '--input', fleetInput,
    '--at', '2026-07-30T20:04:01.000Z',
  ], {
    display: 'governance evaluate --project-root <project> --input <fleet-pass.json>',
  });
  const afterMerge = runStep(scenario, {
    id: 'fleet-receipt-authorized',
    command: process.execPath,
    args: [
      FLEET_STEWARD, '--project-root', projectRoot,
      '--session', sessionFile, '--json',
    ],
    display: 'node scripts/fleet-steward.js --project-root <project> --session <session> --json',
  }).json;
  assert.deepEqual(afterMerge.analysis.mergeCandidates.map((item) => item.id), ['4']);
  assert.equal(afterMerge.analysis.governanceBlocked.length, 0);

  const storeCheck = runCitadel(scenario, 'governance-store-check', [
    'governance', 'check', '--project-root', projectRoot,
  ], {
    display: 'governance check --project-root <project>',
  }).json;
  assert.equal(storeCheck.check_code, 'STORE_VERIFIED');
  scenario.facts = {
    timeout_status: held.status,
    independent_status: advanced.status,
    retry_observations: recovered.decision.observation_digests.length,
    status_only_merge_candidates: 0,
    receipt_authorized_merge_candidates: 1,
    store_check: storeCheck.check_code,
  };
  return scenario;
}

function configScenario(suite) {
  const scenario = scenarioRecord(
    'progressive-activation',
    'A new user starts bounded, reviews an Operations activation, opts into degradation, and is protected from an unavailable runtime',
    [
      'fresh config is exact v2 Standard with Core and Persistence',
      'Operations routes are disabled before activation',
      'plan is no-write and apply is explicit',
      'degraded activation requires opt-in',
      'missing runtime capability remains unavailable',
    ],
    ['runtime parity beyond declared adapters'],
  );
  const projectRoot = path.join(suite, 'config-project');
  fs.mkdirSync(projectRoot, { recursive: true });
  const stack = path.join(suite, 'stack.json');
  writeJson(stack, {
    language: 'javascript',
    framework: null,
    packageManager: 'npm',
  });

  runCitadel(scenario, 'config-initialize-plan', [
    'config', 'initialize',
    '--project-root', projectRoot,
    '--runtime', 'codex',
    '--input', stack,
    '--json',
  ], {
    display: 'config initialize --project-root <project> --runtime codex --input <stack.json> --json',
  });
  assert.equal(fs.existsSync(path.join(projectRoot, '.claude', 'harness.json')), false);

  runCitadel(scenario, 'config-initialize-apply', [
    'config', 'initialize',
    '--project-root', projectRoot,
    '--runtime', 'codex',
    '--input', stack,
    '--apply', '--json',
  ], {
    display: 'config initialize --project-root <project> --runtime codex --input <stack.json> --apply --json',
  });
  const initial = runCitadel(scenario, 'config-show-initial', [
    'config', 'show',
    '--project-root', projectRoot,
    '--runtime', 'codex',
    '--json',
  ], {
    display: 'config show --project-root <project> --runtime codex --json',
  }).json;
  assert.equal(initial.configKind, 'v2');
  assert.equal(initial.profile.id, 'standard');
  assert.deepEqual(initial.bundles.effective, ['core', 'persistence']);

  const disabled = runCitadel(scenario, 'operations-disabled', [
    'config', 'check', 'route', 'marshal',
    '--project-root', projectRoot,
    '--runtime', 'codex',
    '--json',
  ], {
    display: 'config check route marshal --project-root <project> --runtime codex --json',
    expected: [2],
  }).json;
  assert.equal(disabled.decision.status, 'disabled');
  assert.equal(disabled.decision.reasonCode, 'ACTIVATION_PROMPT_REQUIRED');
  assert.match(
    disabled.decision.plan.applyCommand,
    /--runtime codex --allow-degraded-runtime --apply --json$/,
  );

  const beforePlan = fs.readFileSync(path.join(projectRoot, '.claude', 'harness.json'));
  runCitadel(scenario, 'operations-enable-plan', [
    'config', 'enable', 'operations',
    '--project-root', projectRoot,
    '--runtime', 'codex',
    '--json',
  ], {
    display: 'config enable operations --project-root <project> --runtime codex --json',
  });
  assert.deepEqual(
    fs.readFileSync(path.join(projectRoot, '.claude', 'harness.json')),
    beforePlan,
  );

  runCitadel(scenario, 'operations-degraded-blocked', [
    'config', 'enable', 'operations',
    '--project-root', projectRoot,
    '--runtime', 'codex',
    '--apply', '--json',
  ], {
    display: 'config enable operations --project-root <project> --runtime codex --apply --json',
    expected: [1],
  });
  assert.deepEqual(
    fs.readFileSync(path.join(projectRoot, '.claude', 'harness.json')),
    beforePlan,
  );

  runCitadel(scenario, 'operations-degraded-opt-in', [
    'config', 'enable', 'operations',
    '--project-root', projectRoot,
    '--runtime', 'codex',
    '--allow-degraded-runtime',
    '--apply', '--json',
  ], {
    display: 'config enable operations --project-root <project> --runtime codex --allow-degraded-runtime --apply --json',
  });
  const degraded = runCitadel(scenario, 'operations-degraded-check', [
    'config', 'check', 'route', 'marshal',
    '--project-root', projectRoot,
    '--runtime', 'codex',
    '--json',
  ], {
    display: 'config check route marshal --project-root <project> --runtime codex --json',
  }).json;
  assert.equal(degraded.decision.status, 'degraded');

  const beforeUnavailable = fs.readFileSync(path.join(projectRoot, '.claude', 'harness.json'));
  runCitadel(scenario, 'parallel-unavailable-openai', [
    'config', 'enable', 'parallel',
    '--project-root', projectRoot,
    '--runtime', 'openai',
    '--allow-degraded-runtime',
    '--apply', '--json',
  ], {
    display: 'config enable parallel --project-root <project> --runtime openai --allow-degraded-runtime --apply --json',
    expected: [1],
  });
  assert.deepEqual(
    fs.readFileSync(path.join(projectRoot, '.claude', 'harness.json')),
    beforeUnavailable,
  );
  scenario.facts = {
    schema_version: 2,
    profile: 'standard@1.0.0',
    default_bundles: ['core', 'persistence'],
    pre_activation_route_status: disabled.decision.status,
    post_activation_route_status: degraded.decision.status,
    unavailable_apply_mutated_config: false,
  };
  return scenario;
}

function adoptionScenario(suite) {
  const scenario = scenarioRecord(
    'governed-adoption',
    'A project owner reviews, adopts, updates, rolls back, leaves safely, and restores portable work',
    [
      'plan is no-write and apply consumes the saved plan',
      'doctor verifies active ownership',
      'update and rollback switch immutable generations',
      'modified owned material is retained as a conflict',
      'local shared-hook removal is exact while unobservable unregister stays unknown',
      'portable user state survives leave and restore',
    ],
    ['remote plugin marketplace unregister', 'legacy install exact removal without import'],
  );
  const sourceV1 = sourceRepository(path.join(suite, 'citadel-v1'), '1.0.0');
  const sourceV2 = sourceRepository(path.join(suite, 'citadel-v2'), '2.0.0');
  const controlRoot = path.join(suite, 'private-adoption-ledger');
  const target = initializeGit(path.join(suite, 'adoption-target'), {
    '.codex/hooks.json': `${JSON.stringify({ hooks: { Stop: [] }, user: true }, null, 2)}\n`,
  });
  const originalHookBytes = fs.readFileSync(path.join(target, '.codex', 'hooks.json'));
  const planFile = path.join(suite, 'adopt.plan.json');
  const updateFile = path.join(suite, 'update.plan.json');
  const rollbackFile = path.join(suite, 'rollback.plan.json');
  const leaveFile = path.join(suite, 'leave.plan.json');
  const migrationFile = path.join(suite, 'migration.json');
  writeJson(migrationFile, baselineMigration());

  const beforePlanHead = git(target, ['rev-parse', 'HEAD']);
  const adoptionPlan = runCitadel(scenario, 'adopt-plan', [
    'adopt', 'plan', sourceV1,
    '--target', target,
    '--project-runtime', 'codex',
    '--codex-mode', 'fallback',
    '--out', planFile,
    '--json',
  ], {
    display: 'adopt plan <citadel-v1> --target <project> --project-runtime codex --codex-mode fallback --out <plan> --json',
  }).json;
  assert.equal(git(target, ['rev-parse', 'HEAD']), beforePlanHead);
  assert.equal(fs.existsSync(path.join(target, '.citadel', 'adoption', 'active-receipt.json')), false);

  const adopted = runCitadel(
    scenario,
    'adopt-apply',
    planApplyArgs(['adopt'], planFile, adoptionPlan, controlRoot),
    {
      display: 'adopt apply <plan> --confirm <token> --control-root <private-ledger> --json',
      cwd: target,
    },
  ).json;
  assert(adopted.receipt);
  const healthyV1 = runCitadel(scenario, 'adopt-doctor-v1', [
    'adopt', 'doctor',
    '--target', target,
    '--control-root', controlRoot,
    '--json',
  ], {
    display: 'adopt doctor --target <project> --control-root <private-ledger> --json',
  }).json;
  assert.equal(healthyV1.status, 'unknown');
  assert.equal(healthyV1.code, 'RUNTIME_EVIDENCE_UNKNOWN');
  assert.equal(readReceipt(target, { controlRoot }).generation.version, '1.0.0');

  const updatePlan = runCitadel(scenario, 'adopt-update-plan', [
    'adopt', 'update', 'plan', sourceV2,
    '--target', target,
    '--migration', migrationFile,
    '--project-runtime', 'codex',
    '--codex-mode', 'fallback',
    '--control-root', controlRoot,
    '--out', updateFile,
    '--json',
  ], {
    display: 'adopt update plan <citadel-v2> --target <project> --migration <migration> --out <plan> --json',
  }).json;
  runCitadel(
    scenario,
    'adopt-update-apply',
    planApplyArgs(['adopt', 'update'], updateFile, updatePlan, controlRoot),
    {
      display: 'adopt update apply <plan> --confirm <token> --control-root <private-ledger> --json',
      cwd: target,
    },
  );
  const healthyV2 = runCitadel(scenario, 'adopt-doctor-v2', [
    'adopt', 'doctor',
    '--target', target,
    '--control-root', controlRoot,
    '--json',
  ], {
    display: 'adopt doctor --target <project> --control-root <private-ledger> --json',
  }).json;
  assert.equal(healthyV2.status, 'unknown');
  assert.equal(healthyV2.code, 'RUNTIME_EVIDENCE_UNKNOWN');
  assert.equal(readReceipt(target, { controlRoot }).generation.version, '2.0.0');

  const rollbackPlan = runCitadel(scenario, 'adopt-rollback-plan', [
    'adopt', 'rollback', 'plan',
    '--target', target,
    '--control-root', controlRoot,
    '--out', rollbackFile,
    '--json',
  ], {
    display: 'adopt rollback plan --target <project> --control-root <private-ledger> --out <plan> --json',
  }).json;
  runCitadel(
    scenario,
    'adopt-rollback-apply',
    planApplyArgs(['adopt', 'rollback'], rollbackFile, rollbackPlan, controlRoot),
    {
      display: 'adopt rollback apply <plan> --confirm <token> --control-root <private-ledger> --json',
      cwd: target,
    },
  );
  const healthyRollback = runCitadel(scenario, 'adopt-doctor-rollback', [
    'adopt', 'doctor',
    '--target', target,
    '--control-root', controlRoot,
    '--json',
  ], {
    display: 'adopt doctor --target <project> --control-root <private-ledger> --json',
  }).json;
  assert.equal(healthyRollback.status, 'unknown');
  assert.equal(readReceipt(target, { controlRoot }).generation.version, '1.0.0');

  const modifiedSkill = path.join(target, '.agents', 'skills', 'review', 'SKILL.md');
  fs.appendFileSync(modifiedSkill, '\nUser customization\n');
  const leavePlan = runCitadel(scenario, 'adopt-leave-plan', [
    'adopt', 'leave', 'plan',
    '--target', target,
    '--control-root', controlRoot,
    '--out', leaveFile,
    '--json',
  ], {
    display: 'adopt leave plan --target <project> --control-root <private-ledger> --out <plan> --json',
  }).json;
  const exited = runCitadel(
    scenario,
    'adopt-leave-apply',
    planApplyArgs(['adopt', 'leave'], leaveFile, leavePlan, controlRoot),
    {
      display: 'adopt leave apply <plan> --confirm <token> --control-root <private-ledger> --json',
      cwd: target,
    },
  ).json;
  assert(fs.existsSync(modifiedSkill));
  assert.match(fs.readFileSync(modifiedSkill, 'utf8'), /User customization/);
  assert.deepEqual(fs.readFileSync(path.join(target, '.codex', 'hooks.json')), originalHookBytes);
  assert(exited.runtime_removal_evidence.some((item) =>
    item.surface === 'shared-hooks' && item.status === 'passed'));
  assert(exited.runtime_removal_evidence.some((item) =>
    item.surface === 'config.toml' && item.status === 'unknown'));

  const restoreTarget = initializeGit(path.join(suite, 'restore-target'));
  const restorePlanFile = path.join(suite, 'restore-adopt.plan.json');
  const restoreLeaveFile = path.join(suite, 'restore-leave.plan.json');
  const restoreFile = path.join(suite, 'restore.plan.json');
  const restoreAdoptPlan = runCitadel(scenario, 'restore-adopt-plan', [
    'adopt', 'plan', sourceV1,
    '--target', restoreTarget,
    '--out', restorePlanFile,
    '--json',
  ], {
    display: 'adopt plan <citadel-v1> --target <restore-project> --out <plan> --json',
  }).json;
  runCitadel(
    scenario,
    'restore-adopt-apply',
    planApplyArgs(['adopt'], restorePlanFile, restoreAdoptPlan, controlRoot),
    {
      display: 'adopt apply <plan> --confirm <token> --control-root <private-ledger> --json',
      cwd: restoreTarget,
    },
  );
  const portable = path.join(restoreTarget, '.planning', 'campaigns', 'survives.md');
  fs.mkdirSync(path.dirname(portable), { recursive: true });
  fs.writeFileSync(portable, '# User campaign survives\n');
  const restoreLeavePlan = runCitadel(scenario, 'restore-leave-plan', [
    'adopt', 'leave', 'plan',
    '--target', restoreTarget,
    '--control-root', controlRoot,
    '--out', restoreLeaveFile,
    '--json',
  ], {
    display: 'adopt leave plan --target <restore-project> --out <plan> --json',
  }).json;
  const restoreExit = runCitadel(
    scenario,
    'restore-leave-apply',
    planApplyArgs(['adopt', 'leave'], restoreLeaveFile, restoreLeavePlan, controlRoot),
    {
      display: 'adopt leave apply <plan> --confirm <token> --json',
      cwd: restoreTarget,
    },
  ).json;
  const archive = path.join(restoreTarget, ...restoreExit.archive.split('/'));
  const restorePlan = runCitadel(scenario, 'restore-plan', [
    'adopt', 'restore', 'plan', archive,
    '--target', restoreTarget,
    '--control-root', controlRoot,
    '--out', restoreFile,
    '--json',
  ], {
    display: 'adopt restore plan <archive> --target <restore-project> --out <plan> --json',
  }).json;
  runCitadel(
    scenario,
    'restore-apply',
    planApplyArgs(['adopt', 'restore'], restoreFile, restorePlan, controlRoot),
    {
      display: 'adopt restore apply <plan> --confirm <token> --json',
      cwd: restoreTarget,
    },
  );
  assert.equal(fs.readFileSync(portable, 'utf8'), '# User campaign survives\n');
  const restoredHealth = runCitadel(scenario, 'restore-doctor', [
    'adopt', 'doctor',
    '--target', restoreTarget,
    '--control-root', controlRoot,
    '--json',
  ], {
    display: 'adopt doctor --target <restore-project> --json',
  }).json;
  assert.equal(restoredHealth.status, 'healthy');

  scenario.facts = {
    adopted_generation: '1.0.0',
    updated_generation: '2.0.0',
    rolled_back_generation: '1.0.0',
    doctor_status_with_external_boundary: 'unknown',
    modified_owned_material_retained: true,
    local_hook_removal_evidence: 'passed',
    external_unregister_evidence: 'unknown',
    portable_state_restored: true,
  };
  return scenario;
}

function ndjson(values) {
  return `${values.map((value) => JSON.stringify(value)).join('\n')}\n`;
}

function responseLines(output) {
  return String(output || '').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function controlPlaneScenario(suite) {
  const scenario = scenarioRecord(
    'control-plane-and-public-package',
    'An adapter developer packs the public contracts and a local operator restarts and replays the Governance Port',
    [
      'the public contracts tarball installs without the Citadel source tree',
      'strict NDJSON handshake, signed submission, and accepted intent work',
      'state survives process restart and events replay in order',
      'untrusted authority remains blocked',
      'proof tampering is rejected by conformance',
    ],
    ['registry publication', 'independently owned repository conformance', 'stable 1.0 compatibility'],
  );
  const npmCli = resolveNpmCli();
  assert(npmCli, 'npm CLI is required for the package user journey');
  const packDir = path.join(suite, 'contract-pack');
  const npmCache = path.join(suite, 'npm-cache');
  fs.mkdirSync(packDir, { recursive: true });
  const packed = runStep(scenario, {
    id: 'contracts-pack',
    command: process.execPath,
    args: [
      npmCli,
      'pack', './packages/contracts',
      '--json',
      '--pack-destination', packDir,
      '--cache', npmCache,
    ],
    display: 'npm pack ./packages/contracts --json --pack-destination <scratch>',
    cwd: ROOT,
    timeout: 120_000,
  }).json;
  const tarball = path.join(packDir, packed[0].filename);
  assert(fs.existsSync(tarball));

  const external = path.join(suite, 'external-adapter');
  fs.mkdirSync(external, { recursive: true });
  writeJson(path.join(external, 'package.json'), {
    name: 'external-citadel-adapter-proof',
    version: '1.0.0',
    private: true,
  });
  runStep(scenario, {
    id: 'contracts-install',
    command: process.execPath,
    args: [
      npmCli,
      'install', tarball,
      '--ignore-scripts', '--no-audit', '--no-fund', '--offline',
      '--cache', npmCache,
    ],
    display: 'npm install <citadel-contracts.tgz> --ignore-scripts --offline',
    cwd: external,
    timeout: 120_000,
    json: false,
  });
  runStep(scenario, {
    id: 'contracts-external-load',
    command: process.execPath,
    args: ['-e', [
      "const assert=require('assert');",
      "const c=require('@citadel/contracts');",
      "const p=require('@citadel/contracts/control-plane');",
      "assert.equal(c.operations.PROTOCOL_VERSION,'0.1');",
      "assert.equal(p.CONTROL_PLANE_CONTRACT_VERSION,'0.1');",
      "assert(p.validateRequestEnvelope({}).length>0);",
    ].join('')],
    display: 'node <external-adapter-smoke.js>',
    cwd: external,
    json: false,
  });

  const authority = crypto.generateKeyPairSync('ed25519');
  const untrustedAuthority = crypto.generateKeyPairSync('ed25519');
  const proof = crypto.generateKeyPairSync('ed25519');
  const authorityPublicPem = authority.publicKey.export({ type: 'spki', format: 'pem' });
  const proofPrivatePem = proof.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const trustPath = path.join(suite, 'authority-keys.json');
  const proofPath = path.join(suite, 'proof-private.pem');
  const statePath = path.join(suite, 'governance-port-state.json');
  writeJson(trustPath, {
    control_plane_trust_version: 1,
    kind: 'authority_public_key_map',
    keys: [{
      key_id: 'external-key',
      algorithm: 'ed25519',
      public_key_pem: authorityPublicPem,
    }],
  });
  fs.writeFileSync(proofPath, proofPrivatePem, { mode: 0o600 });
  const stdioArgs = [
    '--state', statePath,
    '--authority-keys', trustPath,
    '--proof-private-key', proofPath,
    '--proof-key-id', 'citadel-proof',
    '--proof-issuer-id', 'citadel-local',
    '--installation-id', 'real-user-stdio',
  ];
  const current = Date.now();
  const mainFixture = controlFixture(
    'real-user-operation',
    authority.privateKey,
    'external-key',
    {
      issuedAt: new Date(current - 86_400_000).toISOString(),
      expiresAt: new Date(current + 365 * 86_400_000).toISOString(),
    },
  );
  const handshake = controlRequest('handshake', {
    supported_control_plane_contract_versions: ['0.1'],
    supported_operations_protocol_versions: ['0.1'],
  }, { requestId: 'request-real-user-handshake' });
  const submit = controlRequest('operations.submit', mainFixture.submission, {
    requestId: 'request-real-user-submit',
    idempotencyKey: 'idem-real-user-submit',
  });
  const start = controlRequest(
    'intents.submit',
    intentCommand(mainFixture, 'start', 'intent-real-user-start', authority.privateKey),
    {
      requestId: 'request-real-user-start',
      idempotencyKey: 'idem-real-user-start',
      expectedRevision: 0,
    },
  );
  const first = runStep(scenario, {
    id: 'stdio-submit-and-start',
    command: process.execPath,
    args: [CONTROL_STDIO, ...stdioArgs],
    display: 'citadel control-plane stdio <pinned-config> < handshake-submit-start.ndjson',
    cwd: ROOT,
    input: ndjson([handshake, submit, start]),
    json: false,
  }).result;
  const firstResponses = responseLines(first.stdout);
  assert.equal(firstResponses.length, 3);
  assert.equal(firstResponses[0].reason_code, 'HANDSHAKE_NEGOTIATED');
  assert.equal(firstResponses[2].reason_code, 'INTENT_CONSUMED');
  assert.equal(firstResponses[2].result.run_status, 'running');

  const replayRequest = controlRequest('events.replay', {
    after_cursor: null,
    limit: 50,
  }, { requestId: 'request-real-user-replay' });
  const replayResult = runStep(scenario, {
    id: 'stdio-restart-and-replay',
    command: process.execPath,
    args: [CONTROL_STDIO, ...stdioArgs],
    display: 'citadel control-plane stdio <same-pinned-config> < replay.ndjson',
    cwd: ROOT,
    input: ndjson([replayRequest]),
    json: false,
  }).result;
  const replay = responseLines(replayResult.stdout)[0];
  assert.equal(replay.reason_code, 'EVENTS_REPLAYED');
  assert.equal(replay.result.events.length, 3);
  assert.equal(replay.result.next_cursor, 'cursor-3');

  const untrustedFixture = controlFixture(
    'real-user-untrusted',
    untrustedAuthority.privateKey,
    'untrusted-key',
    {
      issuedAt: new Date(current - 86_400_000).toISOString(),
      expiresAt: new Date(current + 365 * 86_400_000).toISOString(),
    },
  );
  const untrustedRequest = controlRequest('operations.submit', untrustedFixture.submission, {
    requestId: 'request-real-user-untrusted',
    idempotencyKey: 'idem-real-user-untrusted',
  });
  const untrustedResult = runStep(scenario, {
    id: 'stdio-untrusted-authority',
    command: process.execPath,
    args: [CONTROL_STDIO, ...stdioArgs],
    display: 'citadel control-plane stdio <pinned-config> < untrusted-submission.ndjson',
    cwd: ROOT,
    input: ndjson([untrustedRequest]),
    json: false,
  }).result;
  const untrusted = responseLines(untrustedResult.stdout)[0];
  assert.equal(untrusted.outcome, 'blocked');
  assert.equal(untrusted.reason_code, 'AUTHORITY_SIGNER_NOT_TRUSTED');

  const conformance = runCitadel(scenario, 'control-plane-conformance', [
    'control-plane', 'conformance',
  ], {
    display: 'control-plane conformance',
  }).json;
  assert.equal(conformance.status, 'passed');
  assert(conformance.checks.some((check) =>
    check.name === 'authority-untrusted-key-id' && check.status === 'passed'));
  assert(conformance.checks.some((check) =>
    check.name === 'proof-tamper' && check.status === 'passed'));

  const observed = `${first.stdout}${first.stderr}${replayResult.stdout}${untrustedResult.stdout}`;
  assert.equal(observed.includes('BEGIN PRIVATE KEY'), false);
  assert.equal(observed.includes('BEGIN PUBLIC KEY'), false);
  scenario.facts = {
    package_version: packed[0].version,
    package_entry_count: packed[0].entryCount,
    package_integrity: packed[0].integrity,
    replayed_events: replay.result.events.length,
    replay_cursor: replay.result.next_cursor,
    untrusted_authority_reason: untrusted.reason_code,
    conformance_checks: conformance.check_count,
    proof_tamper_check: 'passed',
  };
  return scenario;
}

function proofSpec() {
  return {
    evidence_kind: 'instrument-proof',
    created_day: '2026-07-30',
    participant_count: 2,
    metric_set_id: 'real-user-proof-v2',
    scenario_pairs: [{
      pair_id: 'pair-routing',
      scenario_a: 'route-regression-a',
      scenario_b: 'route-regression-b',
      category: 'short-control',
    }],
    strata: [{
      runtime_family: 'codex',
      model_id: 'gpt-5.6',
      os_family: 'windows',
    }],
    gates: {
      telemetry_join_min: 0.95,
      accepted_completion_margin: -0.05,
      recovery_gain_min: 0.2,
      intervention_reduction_min: 0.25,
      time_overhead_max: 0.15,
      verification_accuracy_min: 0.95,
      false_pass_max: 0,
      d7_retention_min: 0.15,
      minimum_public_cell: 5,
    },
    randomization_seed: 'governed-lifecycle-real-user-proof',
    signing_public_key: null,
  };
}

function productProofScenario(suite) {
  const scenario = scenarioRecord(
    'real-user-proof-instrument',
    'A facilitator plans a balanced local trial, records a false pass, previews suppression, and purges only trial state',
    [
      'assignment generation is balanced and plan-first',
      'false pass remains visible in the private report',
      'instrument never converts sparse local data into a utility claim',
      'public cells smaller than five are suppressed',
      'purge removes only v2 trial state and preserves unrelated user files',
    ],
    ['human comparative utility', 'D7 retention', 'D30 retention', '36-user confirmatory cohort'],
  );
  const projectRoot = path.join(suite, 'proof-project');
  fs.mkdirSync(projectRoot, { recursive: true });
  const specFile = path.join(suite, 'proof-spec.json');
  const recordFile = path.join(suite, 'false-pass-record.json');
  writeJson(specFile, proofSpec());

  const plan = runCitadel(scenario, 'trial-plan', [
    'trial', 'plan',
    '--spec', specFile,
    '--root', projectRoot,
  ], {
    display: 'trial plan --spec <frozen-spec> --root <project>',
  }).json;
  assert.equal(plan.wrote_files, false);
  assert.equal(plan.claim_status, 'instrument_only');
  assert.equal(plan.balance.valid, true);
  assert.equal(fs.existsSync(path.join(projectRoot, '.planning')), false);

  const started = runCitadel(scenario, 'trial-start', [
    'trial', 'start',
    '--spec', specFile,
    '--root', projectRoot,
  ], {
    display: 'trial start --spec <frozen-spec> --root <project>',
  }).json;
  assert.equal(started.claim_status, 'instrument_only');
  const store = productProof.loadStore(projectRoot);
  const assignment = store.assignments.find((item) => item.mode === 'harnessed');
  writeJson(recordFile, {
    schema: 2,
    kind: 'trial_score_v2',
    protocol_id: assignment.protocol_id,
    assignment_id: assignment.assignment_id,
    completed: false,
    claimed_verdict: 'passed',
    oracle_verdict: 'failed',
    owner_accepted: false,
    resume_correct: null,
    corrective_interventions: 1,
    required_approvals: 0,
    clarifications: 0,
    rework_cycles: 1,
    regressions: 1,
  });
  runCitadel(scenario, 'trial-record-false-pass', [
    'trial', 'record',
    '--input', recordFile,
    '--root', projectRoot,
  ], {
    display: 'trial record --input <false-pass-record> --root <project>',
  });
  const report = runCitadel(scenario, 'trial-report', [
    'trial', 'report', '--root', projectRoot,
  ], {
    display: 'trial report --root <project>',
  }).json;
  assert.equal(report.claim_status, 'instrument_only');
  assert.equal(report.utility_claim, false);
  assert.equal(report.modes.harnessed.false_passes, 1);
  assert.equal(report.gates.false_pass.state, 'failed');
  assert.equal(report.intention_to_treat.missing_attempts, 3);

  const preview = runCitadel(scenario, 'trial-share-preview', [
    'trial', 'share-preview', '--root', projectRoot,
  ], {
    display: 'trial share-preview --root <project>',
  }).json;
  assert.equal(preview.transmitted, false);
  assert.equal(preview.instrument_status, 'suppressed');
  assert.equal(preview.cells.bare.suppressed, true);
  assert.equal(preview.cells.harnessed.suppressed, true);
  assert.equal(preview.comparisons.suppressed, true);
  assert.equal(JSON.stringify(preview).includes('participant-'), false);

  const userFile = path.join(projectRoot, '.planning', 'keep-me', 'user.txt');
  fs.mkdirSync(path.dirname(userFile), { recursive: true });
  fs.writeFileSync(userFile, 'preserve');
  const purged = runCitadel(scenario, 'trial-purge', [
    'trial', 'purge', '--root', projectRoot,
  ], {
    display: 'trial purge --root <project>',
  }).json;
  assert.equal(purged.outcome, 'purged');
  assert.equal(fs.existsSync(productProof.pathsFor(projectRoot).dir), false);
  assert.equal(fs.readFileSync(userFile, 'utf8'), 'preserve');
  scenario.facts = {
    assignments: plan.assignments.length,
    balanced: plan.balance.valid,
    private_false_passes: report.modes.harnessed.false_passes,
    utility_claim: report.utility_claim,
    public_preview: preview.instrument_status,
    transmitted: preview.transmitted,
    unrelated_user_state_preserved: true,
    retention_evidence: 'not_run',
  };
  return scenario;
}

function sourceSnapshot() {
  const listing = runProcess('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
    cwd: ROOT,
    timeout: 60_000,
  });
  assert.equal(listing.status, 0, listing.stderr);
  const files = listing.stdout.split('\0').filter(Boolean).sort();
  const hash = crypto.createHash('sha256');
  let fileCount = 0;
  for (const relative of files) {
    const normalized = relative.replace(/\\/g, '/');
    if (normalized.startsWith('.planning/tmp/')
      || normalized.startsWith('.planning/verification/')) continue;
    const absolute = path.join(ROOT, ...normalized.split('/'));
    hash.update(`${normalized}\0`);
    if (!fs.existsSync(absolute)) {
      hash.update('deleted\0');
      continue;
    }
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile()) {
      hash.update(`${stat.isSymbolicLink() ? 'symlink' : 'non-file'}\0`);
      continue;
    }
    hash.update(fs.readFileSync(absolute));
    hash.update('\0');
    fileCount += 1;
  }
  return {
    git_head: git(ROOT, ['rev-parse', 'HEAD']),
    workspace_digest: `sha256:${hash.digest('hex')}`,
    files_hashed: fileCount,
    excluded_generated_state: [
      '.planning/tmp/',
      '.planning/verification/',
    ],
  };
}

function writeProof(outputPath, scenarios) {
  const passed = scenarios.filter((scenario) => scenario.status === 'passed').length;
  const failed = scenarios.length - passed;
  const body = {
    schema: 1,
    kind: 'governed_lifecycle_verification',
    generated_at: new Date().toISOString(),
    implementation_ref: sourceSnapshot(),
    evidence_scope: 'local-isolated-user-journeys',
    privacy: {
      stores_prompts: false,
      stores_repository_paths: false,
      stores_file_contents: false,
      stores_personal_identifiers: false,
      step_output: 'sha256-digests-only',
    },
    summary: {
      scenarios: scenarios.length,
      passed,
      failed,
      status: failed === 0 ? 'passed' : 'failed',
    },
    scenarios,
    external_boundaries: {
      registry_publication: 'not_run',
      independently_owned_repository_conformance: 'not_run',
      human_instrumentation_pilot: 'not_run',
      human_confirmatory_cohort: 'not_run',
      d7_retention_window: 'not_run',
      d30_retention_window: 'not_run',
      comparative_utility_claim: false,
      adapter_stability_claim: 'alpha-0.1-only',
    },
  };
  const proof = { ...body, proof_digest: digest(JSON.stringify(body)) };
  const serialized = `${JSON.stringify(proof, null, 2)}\n`;
  assert.doesNotMatch(serialized, /[A-Za-z]:\\\\Users\\\\/);
  assert.doesNotMatch(serialized, /BEGIN (?:RSA |EC |OPENSSH )?(?:PRIVATE|PUBLIC) KEY/);
  assert.doesNotMatch(serialized, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, serialized);
  fs.renameSync(temporary, outputPath);
  return proof;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const suite = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-governed-usecases-'));
  const scenarios = [];
  const definitions = [
    governanceScenario,
    configScenario,
    adoptionScenario,
    controlPlaneScenario,
    productProofScenario,
  ];
  try {
    for (const definition of definitions) {
      let scenario;
      activeScenario = null;
      try {
        scenario = definition(suite);
        scenario.status = 'passed';
      } catch (error) {
        scenario = activeScenario || scenarioRecord(
          definition.name.replace(/Scenario$/, '').toLowerCase(),
          definition.name,
          [],
          [],
        );
        scenario.status = 'failed';
        scenario.failure_code = error.code || 'ASSERTION_FAILED';
        process.stderr.write(`FAIL ${scenario.scenario_id}: ${error.message}\n`);
      }
      scenarios.push(scenario);
    }
    const proof = writeProof(options.out, scenarios);
    for (const scenario of scenarios) {
      process.stdout.write(
        `${scenario.status === 'passed' ? 'PASS' : 'FAIL'} ${scenario.scenario_id}`
          + ` (${scenario.steps.length} steps)\n`,
      );
    }
    process.stdout.write(
      `Proof: ${path.relative(ROOT, options.out).replace(/\\/g, '/')}\n`
        + `Digest: ${proof.proof_digest}\n`
        + `Result: ${proof.summary.passed}/${proof.summary.scenarios} scenarios passed\n`,
    );
    return proof.summary.failed === 0 ? 0 : 1;
  } finally {
    if (!options.keepScratch) fs.rmSync(suite, { recursive: true, force: true });
  }
}

if (require.main === module) process.exitCode = main();

module.exports = Object.freeze({
  main,
  parseArgs,
  usage,
  writeProof,
});

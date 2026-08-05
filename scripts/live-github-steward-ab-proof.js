#!/usr/bin/env node
'use strict';

const assert = require('assert');
const cp = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONTRACT_PATH = path.join(ROOT, 'benchmarks', 'citadel-proof-experiments', 'deploy-steward', 'live-github-contract.json');
const AGENTS_SOURCE = path.join(ROOT, 'examples', 'berman-agents-md-only', 'AGENTS.md');
const OUTPUT_ROOT = path.join(ROOT, '.planning', 'live-proof');
const ARM_ORDERS = {
  'control-first': ['control', 'treatment'],
  'treatment-first': ['treatment', 'control'],
};

function parseArgs(argv) {
  const args = { pollMs: 5000, maxCycles: 180, ciSleepSeconds: 8, armOrder: 'control-first' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--run-id') { args.runId = next; i += 1; }
    else if (arg === '--owner') { args.owner = next; i += 1; }
    else if (arg === '--execute') args.execute = true;
    else if (arg === '--cleanup') args.cleanup = true;
    else if (arg === '--confirm-delete') { args.confirmDelete = next; i += 1; }
    else if (arg === '--poll-ms') { args.pollMs = Number(next); i += 1; }
    else if (arg === '--max-cycles') { args.maxCycles = Number(next); i += 1; }
    else if (arg === '--ci-sleep-seconds') { args.ciSleepSeconds = Number(next); i += 1; }
    else if (arg === '--arm-order') { args.armOrder = next; i += 1; }
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/live-github-steward-ab-proof.js --run-id <stable-id>',
    '  node scripts/live-github-steward-ab-proof.js --run-id <stable-id> --execute',
    '  node scripts/live-github-steward-ab-proof.js --run-id <stable-id> --cleanup --confirm-delete <stable-id>',
    '',
    'The default is a mutation-free plan. --execute creates exactly two public',
    'repositories and 15 PRs per arm. Re-running the same run ID resumes state.',
    'Use --arm-order control-first|treatment-first to counterbalance repeat runs.',
  ].join('\n');
}

function validateArgs(args) {
  if (args.help) return;
  if (!args.runId || !/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(args.runId)) {
    throw new Error('--run-id must be a stable lowercase slug of 1-40 characters');
  }
  if (args.execute && args.cleanup) throw new Error('--execute and --cleanup are mutually exclusive');
  if (args.cleanup && args.confirmDelete !== args.runId) {
    throw new Error('--cleanup requires --confirm-delete with the exact run ID');
  }
  if (!Object.hasOwn(ARM_ORDERS, args.armOrder)) {
    throw new Error('--arm-order must be control-first or treatment-first');
  }
  for (const key of ['pollMs', 'maxCycles', 'ciSleepSeconds']) {
    if (!Number.isFinite(args[key]) || args[key] < 0) throw new Error(`${key} must be a non-negative number`);
  }
}

function loadContract() {
  const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));
  assert.equal(contract.prs_per_arm, 15, 'live contract must remain frozen at 15 PRs per arm');
  assert.deepEqual(contract.arms, ['control', 'treatment']);
  return contract;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hashContractSource(value) {
  return sha256(String(value).replace(/\r\n/g, '\n'));
}

function createPlan(args, contract = loadContract()) {
  const prefix = `citadel-steward-${args.runId}`;
  return {
    schema: 2,
    experimentId: contract.experiment_id,
    contractSha256: hashContractSource(fs.readFileSync(CONTRACT_PATH, 'utf8')),
    runId: args.runId,
    owner: args.owner || null,
    armOrderName: args.armOrder || 'control-first',
    armOrder: [...ARM_ORDERS[args.armOrder || 'control-first']],
    timingScope: {
      overall: 'full execute invocation including repository and PR setup',
      arm: 'arm algorithm execution after matched repositories and PRs are prepared',
    },
    mutationMode: args.execute ? 'execute' : args.cleanup ? 'cleanup' : 'plan-only',
    repositories: {
      control: `${prefix}-control`,
      treatment: `${prefix}-treatment`,
    },
    prsPerArm: 15,
    totalPrs: 30,
    requiredCheck: contract.required_check,
    protection: contract.branch_protection,
    deploymentEnvironment: contract.deployment_environment,
    statePath: path.join(OUTPUT_ROOT, args.runId, 'state.json'),
    resultPath: path.join(OUTPUT_ROOT, args.runId, 'result.json'),
  };
}

function run(command, commandArgs, options = {}) {
  const result = cp.spawnSync(command, commandArgs, {
    cwd: options.cwd || process.cwd(), encoding: 'utf8', input: options.input,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error(`${command} ${commandArgs.join(' ')} failed (${result.status})\n${result.stderr || result.stdout || ''}`.trim());
    error.stdout = result.stdout; error.stderr = result.stderr; error.status = result.status;
    throw error;
  }
  return result.stdout || '';
}

function runAsync(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = cp.spawn(command, commandArgs, { cwd: options.cwd || process.cwd(), windowsHide: true });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => {
      if (status === 0) resolve(stdout);
      else {
        const error = new Error(`${command} ${commandArgs.join(' ')} failed (${status})\n${stderr || stdout}`.trim());
        error.stdout = stdout; error.stderr = stderr; error.status = status; reject(error);
      }
    });
  });
}

function gh(args, options = {}) { return run('gh', args, options).trim(); }
function git(args, cwd) { return run('git', args, { cwd }).trim(); }
function ghJson(args, options = {}) { return JSON.parse(gh(args, options)); }

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function writeFile(file, text) { ensureDir(path.dirname(file)); fs.writeFileSync(file, text, 'utf8'); }
function readJson(file, fallback = null) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJsonAtomic(file, value) {
  ensureDir(path.dirname(file));
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, file);
}

function checkpoint(state, statePath, patch = {}) {
  Object.assign(state, patch, { updatedAt: new Date().toISOString() });
  writeJsonAtomic(statePath, state);
}

function toIso(now = new Date()) {
  return (now instanceof Date ? now : new Date(now)).toISOString();
}

function elapsedMs(startedAt, completedAt) {
  const elapsed = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  assert(Number.isFinite(elapsed) && elapsed >= 0, 'timing timestamps must produce a non-negative elapsed duration');
  return elapsed;
}

function beginTiming(target, now = new Date()) {
  target.startedAt ||= toIso(now);
  return target;
}

function completeTiming(target, now = new Date()) {
  assert(target.startedAt, 'timing must be started before it is completed');
  target.completedAt = toIso(now);
  target.elapsedMs = elapsedMs(target.startedAt, target.completedAt);
  return target;
}

function recordTelemetry(armState, event, now = new Date()) {
  armState.telemetry ||= [];
  const record = { ...event, at: event.at || toIso(now) };
  armState.telemetry.push(record);
  return record;
}

function timedSyncTelemetry(armState, event, fn, clock = () => Date.now()) {
  const startedMs = clock();
  try {
    const value = fn();
    recordTelemetry(armState, { ...event, outcome: 'success', elapsedMs: Math.max(0, clock() - startedMs) });
    return value;
  } catch (error) {
    recordTelemetry(armState, { ...event, outcome: 'failure', elapsedMs: Math.max(0, clock() - startedMs), error: error.message });
    throw error;
  }
}

async function waitWithTelemetry(armState, delayMs, context = {}, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), clock = () => Date.now()) {
  const startedMs = clock();
  await sleep(delayMs);
  return recordTelemetry(armState, {
    event: 'action-wait',
    scheduledMs: delayMs,
    elapsedMs: Math.max(0, clock() - startedMs),
    ...context,
  });
}

function beginAttempt(state) {
  if (state.lastError) {
    state.errorHistory ||= [];
    state.errorHistory.push(state.lastError);
    delete state.lastError;
  }
  state.status = 'running';
  return state;
}

function bindArmOrder(state, plan, contract = loadContract()) {
  if (!state.armOrder) {
    const hasProgress = Object.keys(state.arms || {}).length > 0;
    if (hasProgress) assert.deepEqual(plan.armOrder, contract.arms, 'legacy state with progress can only resume control-first');
    state.armOrder = [...plan.armOrder];
    state.armOrderName = plan.armOrderName;
  }
  assert.deepEqual(state.armOrder, plan.armOrder, 'state arm order mismatch');
  return state;
}

function protectionPayload(contract = loadContract()) {
  return {
    required_status_checks: { strict: true, contexts: [contract.required_check] },
    enforce_admins: true,
    required_pull_request_reviews: null,
    restrictions: null,
    required_linear_history: true,
    allow_force_pushes: false,
    allow_deletions: false,
    required_conversation_resolution: true,
  };
}

function assertProtection(readback, contract = loadContract()) {
  assert.equal(readback.required_status_checks?.strict, true, 'strict status checks not enabled');
  const contexts = readback.required_status_checks?.contexts || [];
  assert(contexts.includes(contract.required_check), `required ${contract.required_check} check missing`);
  assert.equal(readback.enforce_admins?.enabled, true, 'admin enforcement not enabled');
  assert.equal(readback.required_linear_history?.enabled, true, 'linear history not required');
  assert.equal(readback.required_conversation_resolution?.enabled, true, 'conversation resolution not required');
  return true;
}

function assertActionsPermissions(readback) {
  assert.equal(readback.enabled, true, 'GitHub Actions not enabled');
  assert.equal(readback.allowed_actions, 'all', 'GitHub Actions are not enabled for the frozen workflow contract');
  return true;
}

function workflowYaml(args, contract = loadContract()) {
  return [
    'name: ci', '', 'on:', '  pull_request:', '    branches: [main]', '',
    'permissions:', '  contents: read', '', 'jobs:', `  ${contract.required_check}:`,
    `    name: ${contract.required_check}`, '    runs-on: ubuntu-latest', '    steps:',
    '      - uses: actions/checkout@v4', '      - uses: actions/setup-node@v4',
    '        with:', '          node-version: 22', `      - run: sleep ${args.ciSleepSeconds}`,
    '      - run: npm test', '',
  ].join('\n');
}

function extractStewardScript() {
  const text = fs.readFileSync(AGENTS_SOURCE, 'utf8');
  const match = text.match(/<!-- BEGIN_STEWARD_SCRIPT -->\s*```js\r?\n([\s\S]*?)\r?\n```\s*<!-- END_STEWARD_SCRIPT -->/);
  assert(match, 'standalone AGENTS.md steward block missing');
  return match[1];
}

function deploymentRecorder(repoSlug, environment) {
  return `#!/usr/bin/env node
'use strict';
const cp = require('child_process');
function gh(args, input) {
  const r = cp.spawnSync('gh', args, { encoding: 'utf8', input });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || 'gh failed');
  return r.stdout.trim();
}
const repo = ${JSON.stringify(repoSlug)};
const environment = ${JSON.stringify(environment)};
const sha = gh(['api', 'repos/' + repo + '/commits/main', '--jq', '.sha']);
const existing = JSON.parse(gh(['api', '-X', 'GET', 'repos/' + repo + '/deployments?sha=' + sha + '&environment=' + environment + '&per_page=100']));
let deployment = existing[0];
if (!deployment) {
  deployment = JSON.parse(gh(['api', '-X', 'POST', 'repos/' + repo + '/deployments', '--input', '-'], JSON.stringify({ ref: sha, environment, auto_merge: false, required_contexts: [], description: 'Citadel simulated deploy evidence' })));
}
const statuses = JSON.parse(gh(['api', '-X', 'GET', 'repos/' + repo + '/deployments/' + deployment.id + '/statuses?per_page=100']));
if (!statuses.some((status) => status.state === 'success')) {
  gh(['api', '-X', 'POST', 'repos/' + repo + '/deployments/' + deployment.id + '/statuses', '--input', '-'], JSON.stringify({ state: 'success', environment, description: 'Citadel simulated deploy evidence' }));
}
process.stdout.write(JSON.stringify({ deploymentId: deployment.id, sha, reused: existing.length > 0 }) + '\\n');
`;
}

function setupFiles(workDir, arm, repoSlug, args, contract) {
  const marker = { schema: 1, runId: args.runId, arm, repo: repoSlug };
  writeJsonAtomic(path.join(workDir, '.citadel-live-proof.json'), marker);
  writeFile(path.join(workDir, 'AGENTS.md'), fs.readFileSync(AGENTS_SOURCE, 'utf8'));
  writeFile(path.join(workDir, 'package.json'), `${JSON.stringify({ private: true, scripts: { test: 'node scripts/check.js' } }, null, 2)}\n`);
  writeFile(path.join(workDir, 'scripts', 'check.js'), "'use strict';\nconst fs=require('fs');const p='features';if(fs.existsSync(p))for(const f of fs.readdirSync(p)){if(!/^agent \\d+\\n$/.test(fs.readFileSync(p+'/'+f,'utf8')))throw Error('bad '+f)}\nconsole.log('proof check passed');\n");
  writeFile(path.join(workDir, '.github', 'workflows', 'ci.yml'), workflowYaml(args, contract));
  writeFile(path.join(workDir, '.agent-steward', 'deploy-steward.cjs'), extractStewardScript());
  writeFile(path.join(workDir, '.agent-steward', 'live-deploy.cjs'), deploymentRecorder(repoSlug, contract.deployment_environment));
  writeFile(path.join(workDir, 'README.md'), `# Citadel live proof ${args.runId} ${arm}\n\nDisposable experiment repository.\n`);
}

function safeWorkDir(plan, arm) {
  return path.join(os.tmpdir(), `citadel-live-${plan.runId}-${arm}`);
}

function assertWorkDirMarker(workDir, plan, arm) {
  const marker = readJson(path.join(workDir, '.citadel-live-proof.json'));
  assert(marker && marker.runId === plan.runId && marker.arm === arm, `refusing unmarked work directory: ${workDir}`);
}

function repoExists(slug) {
  try { gh(['api', `repos/${slug}`, '--jq', '.full_name']); return true; }
  catch (error) {
    const detail = `${error.stderr || ''}\n${error.stdout || ''}\n${error.message || ''}`;
    if (/HTTP 404|not found/i.test(detail)) return false;
    throw error;
  }
}

function ensureArm(state, statePath, plan, arm, args, contract) {
  const repoName = plan.repositories[arm];
  const repoSlug = `${state.owner}/${repoName}`;
  const workDir = safeWorkDir(plan, arm);
  state.arms[arm] ||= { repoName, repoSlug, workDir, phase: 'planned', prs: [], telemetry: [] };
  const armState = state.arms[arm];
  if (!fs.existsSync(workDir)) ensureDir(workDir);
  if (fs.existsSync(path.join(workDir, '.citadel-live-proof.json'))) assertWorkDirMarker(workDir, plan, arm);
  else if (fs.readdirSync(workDir).length) throw new Error(`refusing non-empty unmarked work directory: ${workDir}`);

  if (!fs.existsSync(path.join(workDir, '.git'))) {
    setupFiles(workDir, arm, repoSlug, args, contract);
    git(['init', '-b', 'main'], workDir);
    git(['config', 'user.name', 'Citadel Steward Proof'], workDir);
    git(['config', 'user.email', 'citadel-steward-proof@example.com'], workDir);
    git(['add', 'AGENTS.md', 'README.md', 'package.json', 'scripts/check.js', '.github/workflows/ci.yml'], workDir);
    git(['commit', '-m', 'initialize Citadel live proof'], workDir);
    armState.initialSha = git(['rev-parse', 'HEAD'], workDir);
    checkpoint(state, statePath);
  }
  if (!armState.initialSha) {
    armState.initialSha = git(['rev-list', '--max-parents=0', 'HEAD'], workDir).split(/\r?\n/)[0];
    checkpoint(state, statePath);
  }
  const description = `Citadel live proof ${plan.runId} ${arm}`;
  if (!repoExists(repoSlug)) {
    gh(['repo', 'create', repoSlug, '--public', '--description', description, '--source', workDir, '--remote', 'origin', '--push'], { cwd: workDir });
  } else {
    const remoteDescription = ghJson(['repo', 'view', repoSlug, '--json', 'description']).description;
    assert.equal(remoteDescription, description, `existing ${repoSlug} does not carry this run marker`);
    try { git(['remote', 'get-url', 'origin'], workDir); } catch { git(['remote', 'add', 'origin', `https://github.com/${repoSlug}.git`], workDir); }
  }
  armState.phase = 'repository-created'; checkpoint(state, statePath);

  gh(['api', '-X', 'PUT', `repos/${repoSlug}/actions/permissions`, '--input', '-'], { input: JSON.stringify({ enabled: true, allowed_actions: 'all' }) });
  const actionsPermissions = ghJson(['api', `repos/${repoSlug}/actions/permissions`]);
  assertActionsPermissions(actionsPermissions);
  gh(['api', '-X', 'PUT', `repos/${repoSlug}/branches/main/protection`, '--input', '-'], { input: JSON.stringify(protectionPayload(contract)) });
  const protection = ghJson(['api', `repos/${repoSlug}/branches/main/protection`]);
  assertProtection(protection, contract);
  armState.actionsPermissions = actionsPermissions; armState.protection = protection; armState.phase = 'protected'; checkpoint(state, statePath);
  return armState;
}

function existingPr(repoSlug, owner, branch) {
  const prs = ghJson(['pr', 'list', '--repo', repoSlug, '--state', 'all', '--head', `${owner}:${branch}`, '--json', 'number,url,headRefOid,state']);
  return prs[0] || null;
}

function recordedPr(armState, number, lookup = prDetail) {
  const record = armState.prs.find((item) => item.index === number);
  if (!record) return null;
  const observed = lookup(armState.repoSlug, record.number);
  assert.equal(observed.number, record.number, `recorded PR identity changed for index ${number}`);
  assert(['OPEN', 'MERGED', 'CLOSED'].includes(observed.state), `recorded PR ${record.number} has unknown state`);
  return record;
}

function ensurePr(state, statePath, armState, number, owner) {
  const branch = `agent-${String(number).padStart(2, '0')}`;
  const retained = recordedPr(armState, number);
  if (retained) return retained;
  let pr = existingPr(armState.repoSlug, owner, branch);
  if (!pr) {
    const remoteBranch = (() => { try { return gh(['api', `repos/${armState.repoSlug}/git/ref/heads/${branch}`, '--jq', '.object.sha']); } catch { return null; } })();
    if (!remoteBranch) {
      git(['checkout', '-B', branch, armState.initialSha], armState.workDir);
      writeFile(path.join(armState.workDir, 'features', `${branch}.txt`), `agent ${number}\n`);
      git(['add', 'features'], armState.workDir);
      git(['commit', '-m', `agent ${number} change`], armState.workDir);
      git(['push', '-u', 'origin', branch], armState.workDir);
    }
    const url = gh(['pr', 'create', '--repo', armState.repoSlug, '--head', branch, '--base', 'main', '--title', `Agent ${number} proof PR`, '--body', `Matched live experiment PR ${number}.`], { cwd: armState.workDir });
    pr = { ...ghJson(['pr', 'view', url, '--json', 'number,url,headRefOid,state']), url };
  }
  const record = { index: number, branch, number: pr.number, url: pr.url, initialHead: pr.headRefOid };
  const at = armState.prs.findIndex((item) => item.index === number);
  if (at === -1) armState.prs.push(record); else armState.prs[at] = { ...armState.prs[at], ...record };
  checkpoint(state, statePath);
  return record;
}

function prDetail(repoSlug, number) {
  return ghJson(['pr', 'view', String(number), '--repo', repoSlug, '--json', 'number,url,state,mergeable,mergeStateStatus,headRefOid,statusCheckRollup,mergedAt,mergeCommit']);
}

function checksPassed(detail, requiredCheck) {
  return (detail.statusCheckRollup || []).some((check) => {
    const name = check.name || check.context;
    return name === requiredCheck && ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(String(check.conclusion || check.state).toUpperCase());
  });
}

function classifyGhError(error) {
  const text = `${error.stderr || ''}\n${error.stdout || ''}\n${error.message || ''}`.toLowerCase();
  if (/behind|head branch was modified|not mergeable|base branch.*modified|sha does not match/.test(text)) return 'stale';
  if (/status check|required.*check|pending/.test(text)) return 'checks';
  if (/conflict|dirty/.test(text)) return 'conflict';
  return 'unknown';
}

function createDeployment(repoSlug, sha, environment) {
  const existing = ghJson(['api', '-X', 'GET', `repos/${repoSlug}/deployments?sha=${sha}&environment=${environment}&per_page=100`]);
  let deployment = existing[0];
  if (!deployment) {
    deployment = ghJson(['api', '-X', 'POST', `repos/${repoSlug}/deployments`, '--input', '-'], {
      input: JSON.stringify({ ref: sha, environment, auto_merge: false, required_contexts: [], description: 'Citadel simulated deploy evidence' }),
    });
  }
  const statuses = ghJson(['api', '-X', 'GET', `repos/${repoSlug}/deployments/${deployment.id}/statuses?per_page=100`]);
  if (!statuses.some((status) => status.state === 'success')) {
    gh(['api', '-X', 'POST', `repos/${repoSlug}/deployments/${deployment.id}/statuses`, '--input', '-'], {
      input: JSON.stringify({ state: 'success', environment, description: 'Citadel simulated deploy evidence' }),
    });
  }
  return { deploymentId: deployment.id, sha, reused: existing.length > 0 };
}

async function runControl(state, statePath, armState, args, contract) {
  const eligible = new Set(armState.prs.slice(0, 3).map((pr) => pr.number));
  const startCycle = armState.cycle || 1;
  if (startCycle >= 3) armState.prs.forEach((pr) => eligible.add(pr.number));
  for (let cycle = startCycle; cycle <= args.maxCycles; cycle += 1) {
    if (cycle === 3) armState.prs.forEach((pr) => eligible.add(pr.number));
    const open = armState.prs.filter((pr) => eligible.has(pr.number)).map((pr) => prDetail(armState.repoSlug, pr.number)).filter((pr) => pr.state === 'OPEN');
    if (!open.length && eligible.size === contract.prs_per_arm) break;
    const candidates = [];
    for (const detail of open) {
      const mergeState = String(detail.mergeStateStatus || '').toUpperCase();
      if (mergeState === 'BEHIND') {
        timedSyncTelemetry(armState, { event: 'api-timing', operation: 'update-branch', cycle, pr: detail.number }, () => (
          gh(['api', '-X', 'PUT', `repos/${armState.repoSlug}/pulls/${detail.number}/update-branch`, '-f', `expected_head_sha=${detail.headRefOid}`])
        ));
        recordTelemetry(armState, { cycle, pr: detail.number, event: 'stale', head: detail.headRefOid });
        recordTelemetry(armState, { cycle, pr: detail.number, event: 'intervention', action: 'update-branch' });
      } else if (mergeState !== 'UNKNOWN' && checksPassed(detail, contract.required_check)) candidates.push(detail);
    }
    const attempts = await Promise.allSettled(candidates.map(async (detail) => {
      const startedMs = Date.now();
      try {
        await runAsync('gh', [
          'pr', 'merge', String(detail.number), '--repo', armState.repoSlug, '--squash', '--delete-branch', '--match-head-commit', detail.headRefOid,
        ]);
        recordTelemetry(armState, { event: 'api-timing', operation: 'merge-pr', cycle, pr: detail.number, outcome: 'success', elapsedMs: Math.max(0, Date.now() - startedMs) });
        return { detail };
      } catch (error) {
        recordTelemetry(armState, { event: 'api-timing', operation: 'merge-pr', cycle, pr: detail.number, outcome: 'failure', elapsedMs: Math.max(0, Date.now() - startedMs), error: error.message });
        throw error;
      }
    }));
    for (let index = 0; index < attempts.length; index += 1) {
      const attempt = attempts[index]; const detail = candidates[index];
      if (attempt.status === 'fulfilled') {
        const merged = prDetail(armState.repoSlug, detail.number);
        const mergeSha = merged.mergeCommit?.oid;
        assert(mergeSha, `merged PR ${detail.number} missing merge SHA`);
        const deployment = timedSyncTelemetry(armState, { event: 'api-timing', operation: 'create-deployment', cycle, pr: detail.number }, () => (
          createDeployment(armState.repoSlug, mergeSha, contract.deployment_environment)
        ));
        recordTelemetry(armState, { cycle, pr: detail.number, event: 'merged-and-deployed', mergeSha, ...deployment });
      } else {
        const classification = classifyGhError(attempt.reason);
        recordTelemetry(armState, { cycle, pr: detail.number, event: 'race', classification, error: attempt.reason.message });
        recordTelemetry(armState, { cycle, pr: detail.number, event: 'intervention', action: 'retry-after-race' });
      }
    }
    armState.cycle = cycle + 1; checkpoint(state, statePath);
    await waitWithTelemetry(armState, args.pollMs, { cycle, stage: 'control-poll' });
  }
  const merged = armState.prs.filter((pr) => prDetail(armState.repoSlug, pr.number).state === 'MERGED').length;
  if (merged !== contract.prs_per_arm) {
    armState.phase = 'cycles-exhausted'; checkpoint(state, statePath);
    throw new Error(`control exhausted ${args.maxCycles} cycles with ${merged}/${contract.prs_per_arm} merges`);
  }
  armState.phase = 'arm-complete'; checkpoint(state, statePath);
}

function writeReady(armState, record) {
  writeJsonAtomic(path.join(armState.workDir, '.agent-steward', 'ready', `pr-${record.number}.json`), {
    id: `pr-${record.number}`, pr: record.url, branch: record.branch, head: record.initialHead,
    ready: true, verification: 'GitHub Actions verify', createdAt: new Date().toISOString(),
  });
}

function runStewardCycle(armState, cycle) {
  const stdout = run(process.execPath, [
    path.join(armState.workDir, '.agent-steward', 'deploy-steward.cjs'), '--root', armState.workDir,
    '--scan', '--run', '--deploy', 'node .agent-steward/live-deploy.cjs', '--cycle', String(cycle),
  ], { cwd: armState.workDir });
  return JSON.parse(stdout);
}

async function runTreatment(state, statePath, armState, args, contract) {
  armState.prs.slice(0, 3).forEach((pr) => writeReady(armState, pr));
  for (let cycle = armState.cycle || 1; cycle <= args.maxCycles; cycle += 1) {
    if (cycle === 3) armState.prs.slice(3).forEach((pr) => writeReady(armState, pr));
    const result = timedSyncTelemetry(armState, { event: 'stage-timing', operation: 'steward-cycle', cycle }, () => runStewardCycle(armState, cycle));
    recordTelemetry(armState, { cycle, event: result.outcome.action, item: result.outcome.item || null, reason: result.outcome.reason || null });
    armState.cycle = cycle + 1; checkpoint(state, statePath);
    const landed = result.queue.filter((item) => item.status === 'landed').length;
    if (result.queue.length === contract.prs_per_arm && landed === contract.prs_per_arm) break;
    await waitWithTelemetry(armState, args.pollMs, { cycle, stage: 'treatment-poll' });
  }
  const queue = readJson(path.join(armState.workDir, '.agent-steward', 'queue.json'), []);
  const landed = queue.filter((item) => item.status === 'landed').length;
  if (queue.length !== contract.prs_per_arm || landed !== contract.prs_per_arm) {
    armState.phase = 'cycles-exhausted'; checkpoint(state, statePath);
    throw new Error(`treatment exhausted ${args.maxCycles} cycles with ${landed}/${contract.prs_per_arm} landed`);
  }
  armState.phase = 'arm-complete'; checkpoint(state, statePath);
}

function collectArm(armState, contract) {
  const prs = ghJson(['pr', 'list', '--repo', armState.repoSlug, '--state', 'all', '--limit', '100', '--json', 'number,state,mergedAt,mergeCommit,headRefOid,statusCheckRollup,url']);
  const deployments = ghJson(['api', '-X', 'GET', `repos/${armState.repoSlug}/deployments?environment=${contract.deployment_environment}&per_page=100`]);
  const deploymentEvidence = deployments.map((deployment) => ({
    id: deployment.id, sha: deployment.sha, environment: deployment.environment,
    statuses: ghJson(['api', '-X', 'GET', `repos/${armState.repoSlug}/deployments/${deployment.id}/statuses?per_page=100`]).map((status) => ({ id: status.id, state: status.state, created_at: status.created_at })),
  }));
  const workflowRuns = ghJson(['run', 'list', '--repo', armState.repoSlug, '--workflow', 'ci.yml', '--limit', '100', '--json', 'databaseId,headSha,event,status,conclusion,url']);
  const actionsPermissions = ghJson(['api', `repos/${armState.repoSlug}/actions/permissions`]);
  assertActionsPermissions(actionsPermissions);
  const protection = ghJson(['api', `repos/${armState.repoSlug}/branches/main/protection`]);
  assertProtection(protection, contract);
  return summarizeArm({ prs, deployments: deploymentEvidence, workflowRuns, telemetry: armState.telemetry, actionsPermissions, protection }, contract);
}

function summarizeArm(evidence, contract = loadContract()) {
  const merged = evidence.prs.filter((pr) => pr.state === 'MERGED' && pr.mergeCommit?.oid);
  const successful = evidence.deployments.filter((deployment) => deployment.statuses.some((status) => status.state === 'success'));
  const perSha = Object.fromEntries(merged.map((pr) => [pr.mergeCommit.oid, successful.filter((deployment) => deployment.sha === pr.mergeCommit.oid).length]));
  return {
    prs: evidence.prs.length,
    merged: merged.length,
    successfulDeployments: successful.length,
    deploymentsPerMergeSha: perSha,
    exactlyOnceDeployments: merged.length === contract.prs_per_arm && Object.values(perSha).every((count) => count === 1),
    workflowRuns: evidence.workflowRuns,
    workflowEvidenceComplete: evidence.prs.every((pr) => checksPassed({ statusCheckRollup: pr.statusCheckRollup }, contract.required_check)),
    staleAttempts: evidence.telemetry.filter((event) => event.event === 'stale').length,
    raceAttempts: evidence.telemetry.filter((event) => event.event === 'race').length,
    interventions: evidence.telemetry.filter((event) => event.event === 'intervention').length,
    repairs: evidence.telemetry.filter((event) => event.event === 'repair-needed').length,
    actionsPermissions: evidence.actionsPermissions,
    protection: evidence.protection,
    prsEvidence: evidence.prs,
    deploymentsEvidence: evidence.deployments,
    telemetry: evidence.telemetry,
  };
}

function validateResult(result, contract = loadContract()) {
  const failures = [];
  for (const arm of contract.arms) {
    const summary = result.arms[arm];
    if (!summary) { failures.push(`${arm}: missing evidence`); continue; }
    if (summary.prs !== contract.prs_per_arm) failures.push(`${arm}: expected 15 PRs, saw ${summary.prs}`);
    if (summary.merged !== contract.prs_per_arm) failures.push(`${arm}: expected 15 merges, saw ${summary.merged}`);
    if (!summary.exactlyOnceDeployments) failures.push(`${arm}: deployments were not exactly once per merge SHA`);
    if (summary.successfulDeployments !== summary.merged) failures.push(`${arm}: successful deployment count did not equal merged PR count`);
    if (!summary.workflowEvidenceComplete) failures.push(`${arm}: required check evidence incomplete`);
    try { assertActionsPermissions(summary.actionsPermissions); } catch (error) { failures.push(`${arm}: ${error.message}`); }
    try { assertProtection(summary.protection, contract); } catch (error) { failures.push(`${arm}: ${error.message}`); }
  }
  if ((result.arms.treatment?.repairs || 0) !== 0) failures.push('treatment: repair events observed');
  const comparativeHypothesis = {
    treatmentRaceAttemptsLessThanControl: Number.isFinite(result.arms.control?.raceAttempts)
      && Number.isFinite(result.arms.treatment?.raceAttempts)
      && result.arms.treatment.raceAttempts < result.arms.control.raceAttempts,
    treatmentInterventionsNotGreaterThanControl: Number.isFinite(result.arms.control?.interventions)
      && Number.isFinite(result.arms.treatment?.interventions)
      && result.arms.treatment.interventions <= result.arms.control.interventions,
  };
  if (!comparativeHypothesis.treatmentRaceAttemptsLessThanControl) {
    failures.push('comparative hypothesis failed: treatment race attempts were not lower than control');
  }
  if (!comparativeHypothesis.treatmentInterventionsNotGreaterThanControl) {
    failures.push('comparative hypothesis failed: treatment interventions exceeded control');
  }
  return { passed: failures.length === 0, failures, comparativeHypothesis };
}

async function execute(args, plan, contract) {
  const runDir = path.dirname(plan.statePath);
  ensureDir(runDir);
  let state = readJson(plan.statePath);
  const authenticatedOwner = args.owner || gh(['api', 'user', '--jq', '.login']);
  if (state) {
    assert.equal(state.runId, plan.runId, 'state run ID mismatch');
    assert.equal(state.contractSha256, plan.contractSha256, 'frozen contract changed since this run began');
    assert.equal(state.owner, authenticatedOwner, 'state owner mismatch');
    bindArmOrder(state, plan, contract);
  } else {
    state = {
      schema: 2,
      runId: plan.runId,
      owner: authenticatedOwner,
      contractSha256: plan.contractSha256,
      armOrderName: plan.armOrderName,
      armOrder: [...plan.armOrder],
      timingScope: plan.timingScope,
      status: 'running',
      createdAt: new Date().toISOString(),
      arms: {},
    };
  }
  beginAttempt(state);
  beginTiming(state);
  checkpoint(state, plan.statePath);
  try {
    for (const arm of plan.armOrder) ensureArm(state, plan.statePath, plan, arm, { ...args, owner: authenticatedOwner }, contract);
    for (const arm of plan.armOrder) {
      const armState = state.arms[arm];
      for (let number = 1; number <= contract.prs_per_arm; number += 1) ensurePr(state, plan.statePath, armState, number, authenticatedOwner);
      if (armState.phase !== 'arm-complete') armState.phase = 'prs-created';
      checkpoint(state, plan.statePath);
    }
    for (const arm of plan.armOrder) {
      const armState = state.arms[arm];
      if (armState.phase === 'arm-complete') {
        if (armState.startedAt && !armState.completedAt) completeTiming(armState);
        continue;
      }
      beginTiming(armState);
      checkpoint(state, plan.statePath);
      if (arm === 'control') await runControl(state, plan.statePath, armState, args, contract);
      else await runTreatment(state, plan.statePath, armState, args, contract);
      completeTiming(armState);
      checkpoint(state, plan.statePath);
    }
    completeTiming(state);
    const result = {
      schema: 2,
      runId: plan.runId,
      contractSha256: plan.contractSha256,
      armOrderName: plan.armOrderName,
      armOrder: [...plan.armOrder],
      timingScope: plan.timingScope,
      generatedAt: new Date().toISOString(),
      timing: {
        startedAt: state.startedAt,
        completedAt: state.completedAt,
        elapsedMs: state.elapsedMs,
        arms: Object.fromEntries(contract.arms.map((arm) => [arm, {
          startedAt: state.arms[arm].startedAt || null,
          completedAt: state.arms[arm].completedAt || null,
          elapsedMs: Number.isFinite(state.arms[arm].elapsedMs) ? state.arms[arm].elapsedMs : null,
        }])),
      },
      arms: {},
    };
    for (const arm of contract.arms) result.arms[arm] = collectArm(state.arms[arm], contract);
    result.validation = validateResult(result, contract);
    writeJsonAtomic(plan.resultPath, result);
    checkpoint(state, plan.statePath, { status: result.validation.passed ? 'complete' : 'failed-validation', resultPath: plan.resultPath });
    if (!result.validation.passed) throw new Error(`live experiment failed validation:\n${result.validation.failures.join('\n')}`);
    return result;
  } catch (error) {
    checkpoint(state, plan.statePath, { status: 'failed', lastError: { at: new Date().toISOString(), message: error.message } });
    throw error;
  }
}

function cleanup(args, plan) {
  const state = readJson(plan.statePath);
  assert(state, `no state exists for ${plan.runId}`);
  assert.equal(state.runId, args.confirmDelete, 'cleanup confirmation mismatch');
  for (const arm of ['control', 'treatment']) {
    const armState = state.arms?.[arm];
    if (!armState) continue;
    assert.equal(armState.repoName, plan.repositories[arm], 'refusing cleanup of unexpected repository');
    const description = ghJson(['repo', 'view', armState.repoSlug, '--json', 'description']).description;
    assert.equal(description, `Citadel live proof ${plan.runId} ${arm}`, 'refusing cleanup of unmarked repository');
    gh(['repo', 'delete', armState.repoSlug, '--yes']);
    if (fs.existsSync(armState.workDir)) { assertWorkDirMarker(armState.workDir, plan, arm); fs.rmSync(armState.workDir, { recursive: true }); }
  }
  checkpoint(state, plan.statePath, { status: 'cleaned', cleanedAt: new Date().toISOString() });
  return { cleaned: true, runId: plan.runId };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  validateArgs(args);
  if (args.help) { console.log(usage()); return; }
  const contract = loadContract();
  const plan = createPlan(args, contract);
  if (!args.execute && !args.cleanup) { console.log(JSON.stringify(plan, null, 2)); return; }
  const result = args.cleanup ? cleanup(args, plan) : await execute(args, plan, contract);
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });

module.exports = {
  parseArgs, validateArgs, loadContract, createPlan, protectionPayload, assertProtection, assertActionsPermissions,
  workflowYaml, deploymentRecorder, safeWorkDir, assertWorkDirMarker, classifyGhError,
  extractStewardScript, hashContractSource, recordedPr, beginAttempt, bindArmOrder, beginTiming, completeTiming, elapsedMs,
  recordTelemetry, timedSyncTelemetry, waitWithTelemetry, checksPassed, summarizeArm, validateResult,
};

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { GoldenPathError, LIMITATIONS, failureFor } = require('./contract');
const { digestDirectory, loadFixture } = require('./fixture');
const { evidenceFor, parseJson, runNode } = require('./process');

const SCRIPT = (root, name) => path.join(root, 'scripts', name);

function baseResult(runtime) {
  return {
    schema: 1,
    mode: 'fixture-automation',
    runtime: runtime || null,
    fixture_id: null,
    platform: process.platform,
    status: 'failed',
    failure: null,
    steps: [],
    metrics: { install_to_route_ms: null, install_to_verified_handoff_ms: null, total_ms: null },
    artifacts: {},
    resume: { status: 'not-run', command: null },
    rollback: { status: 'not-created', before_digest: null, after_digest: null, workspace_removed: true },
    limitations: [...LIMITATIONS],
  };
}

function shouldStagePluginPath(source, entry) {
  if (entry === source) return true;
  const parts = path.relative(source, entry).split(path.sep);
  const lower = parts.map((part) => part.toLowerCase());
  const basename = lower.at(-1);
  if (lower.some((part) => ['.git', '.planning', 'node_modules'].includes(part))) return false;
  if (basename === '.env' || basename.startsWith('.env.')) return false;
  const privateBasenames = new Set(['.npmrc', '.netrc', '.git-credentials', '.pypirc', '.vault-token',
    'credentials', 'credentials.json', 'service-account.json', 'id_rsa', 'id_ed25519']);
  if (privateBasenames.has(basename) || /\.(?:pem|key|p12|pfx|kdbx)$/.test(basename)) return false;
  const relative = lower.join('/');
  const privateState = new Set(['.claude/settings.local.json', '.claude/harness.json',
    '.claude/compact-state.json', '.codex/auth.json', '.aws/credentials', '.azure/accesstokens.json',
    '.config/gcloud/application_default_credentials.json', '.docker/config.json', '.kube/config']);
  if (privateState.has(relative)) return false;
  if (/^\.claude\/(?:consent-(?:session|onetime)-[^/]+\.json|remote[-_]?attachments)(?:\/|$)/.test(relative)) return false;
  return true;
}

function isSafeStageEntry(source, entry, lstat = fs.lstatSync) {
  if (entry !== source) {
    try {
      if (lstat(entry).isSymbolicLink()) return false;
    } catch {
      return false;
    }
  }
  return shouldStagePluginPath(source, entry);
}

function stagePlugin(source, destination) {
  fs.cpSync(source, destination, {
    recursive: true,
    filter: (entry) => isSafeStageEntry(source, entry),
  });
}

function installerArgs(runtime, target, plugin) {
  const shared = ['--project-root', target, '--plugin-root', plugin, '--json'];
  return runtime === 'claude'
    ? [...shared, '--install-hooks', '--skip-validate']
    : [...shared, '--skip-windows-check'];
}

function recordStep(result, id, operation) {
  const started = Date.now();
  try {
    const value = operation();
    result.steps.push({
      id,
      status: 'passed',
      duration_ms: Date.now() - started,
      evidence: value.evidence || [],
    });
    return value.value;
  } catch (error) {
    result.steps.push({
      id,
      status: 'failed',
      duration_ms: Date.now() - started,
      evidence: [error.message, ...(error.evidence || [])].slice(0, 5),
    });
    throw error;
  }
}

function requireProcess(script, args, options, code, label) {
  const raw = runNode(script, args, options);
  const value = parseJson(raw, code, label);
  return { raw, value };
}

function runSetup(pluginRoot, target) {
  const env = { CLAUDE_PROJECT_DIR: target };
  const init = runNode(path.join(pluginRoot, 'hooks_src', 'init-project.js'), [], { cwd: target, env });
  if (init.status !== 0) throw new GoldenPathError('setup_failed', 'init-project failed', evidenceFor(init));
  const guidance = runNode(SCRIPT(pluginRoot, 'bootstrap-project-guidance.js'), ['--project-root', target], {
    cwd: target,
    env,
  });
  if (guidance.status !== 0) {
    throw new GoldenPathError('setup_failed', 'bootstrap-project-guidance failed', evidenceFor(guidance));
  }
  return [...evidenceFor(init), ...evidenceFor(guidance)].slice(0, 5);
}

function assertRoute(preview, fixture) {
  const mismatches = [];
  if (preview.selected !== fixture.expectedRoute) mismatches.push(`route=${preview.selected}`);
  if (preview.command !== fixture.verificationCommand) mismatches.push(`command=${preview.command}`);
  if (!preview.verification) mismatches.push('verification=(missing)');
  if (mismatches.length) {
    throw new GoldenPathError('route_mismatch', 'deterministic route preview did not match fixture', mismatches);
  }
}

function cleanup(result, state, keepTemp, operations = {}) {
  const started = Date.now();
  const digest = operations.digestDirectory || digestDirectory;
  const remove = operations.removeTemp || ((tempRoot) => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const exists = operations.exists || fs.existsSync;
  let after = null;
  let cleanupError = null;
  try {
    after = state.fixture && state.beforeDigest ? digest(state.fixture.fixtureRoot) : null;
    if (state.beforeDigest && after !== state.beforeDigest) cleanupError = new Error('original fixture digest changed');
  } catch (error) {
    cleanupError = error;
  }
  if (state.tempRoot && !keepTemp) {
    try {
      remove(state.tempRoot);
    } catch (error) {
      cleanupError ||= error;
    }
  }
  const removed = !state.tempRoot || !exists(state.tempRoot);
  if (!removed && !keepTemp) cleanupError ||= new Error('temporary workspace could not be removed');

  if (!cleanupError) {
    result.rollback = {
      status: keepTemp && state.tempRoot ? 'retained' : 'exact',
      before_digest: state.beforeDigest,
      after_digest: after,
      workspace_removed: removed,
    };
    result.steps.push({
      id: 'rollback',
      status: 'passed',
      duration_ms: Date.now() - started,
      evidence: [`status=${result.rollback.status}`, `workspace_removed=${removed}`],
    });
  } else {
    result.rollback = {
      status: 'failed',
      before_digest: state.beforeDigest,
      after_digest: after,
      workspace_removed: removed,
    };
    result.steps.push({ id: 'rollback', status: 'failed', duration_ms: Date.now() - started, evidence: [cleanupError.message, `workspace_removed=${removed}`] });
    result.failure = failureFor('rollback_failed');
    result.status = 'failed';
  }
}

function runGoldenPath(options) {
  const started = Date.now();
  const result = baseResult(options.runtime);
  const state = { fixture: null, beforeDigest: null, tempRoot: null, target: null };
  let installStarted = null;
  try {
    if (!['claude', 'codex'].includes(options.runtime)) {
      throw new GoldenPathError('fixture_invalid', 'runtime must be claude or codex');
    }
    state.fixture = loadFixture(options.fixture);
    result.fixture_id = state.fixture.id;
    state.beforeDigest = digestDirectory(state.fixture.fixtureRoot);
    result.rollback.before_digest = state.beforeDigest;
    state.tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-golden-path-'));
    state.target = path.join(state.tempRoot, 'workspace');
    const stagedPlugin = path.join(state.tempRoot, 'plugin');

    recordStep(result, 'pristine', () => {
      fs.cpSync(state.fixture.projectDir, state.target, { recursive: true });
      stagePlugin(options.pluginRoot, stagedPlugin);
      return { evidence: [`fixture_digest=${state.beforeDigest}`, 'workspace=temporary-copy', 'plugin=temporary-copy'] };
    });

    installStarted = Date.now();
    recordStep(result, 'install', () => {
      const script = SCRIPT(options.pluginRoot, `${options.runtime}-install.js`);
      const { raw, value } = requireProcess(
        script,
        installerArgs(options.runtime, state.target, stagedPlugin),
        { cwd: state.target, timeout: 120000 },
        'install_failed',
        `${options.runtime} installer`,
      );
      if (value.pass !== true) throw new GoldenPathError('install_failed', 'installer reported pass=false', evidenceFor(raw));
      return { evidence: [`installer_pass=${value.pass}`, `registration_requested=false`, `plugin_refresh=${options.runtime === 'codex' ? 'performed' : 'n/a'}`] };
    });

    recordStep(result, 'setup', () => ({ evidence: runSetup(options.pluginRoot, state.target) }));
    recordStep(result, 'campaign', () => {
      const destination = path.join(state.target, '.planning', 'campaigns', path.basename(state.fixture.campaignFile));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(state.fixture.campaignFile, destination);
      return { evidence: [`campaign=${path.relative(state.target, destination).replace(/\\/g, '/')}`, 'status=active'] };
    });

    recordStep(result, 'route', () => {
      const { value } = requireProcess(
        SCRIPT(options.pluginRoot, 'route-preview.js'),
        ['--json', '--project-root', state.target, '--', state.fixture.task],
        { cwd: state.target },
        'route_mismatch',
        'route preview',
      );
      assertRoute(value, state.fixture);
      result.metrics.install_to_route_ms = Date.now() - installStarted;
      return { evidence: [`route=${value.selected}`, `command=${value.command}`, `verification=${value.verification}`] };
    });

    recordStep(result, 'operator', () => {
      const { value } = requireProcess(
        SCRIPT(options.pluginRoot, 'operator-console.js'),
        ['--json', '--project-root', state.target],
        { cwd: state.target },
        'setup_failed',
        'operator console',
      );
      const report = path.join(state.target, value.reportPath || '');
      if (!value.reportPath || !fs.existsSync(report)) {
        throw new GoldenPathError('setup_failed', 'operator console did not create its durable report');
      }
      result.artifacts.operator_report = value.reportPath;
      return { evidence: [`report=${value.reportPath}`, `status=${value.status}`] };
    });

    recordStep(result, 'verified-handoff', () => {
      const { value } = requireProcess(
        SCRIPT(options.pluginRoot, 'usefulness-trial.js'),
        ['--project-root', state.target, '--task', state.fixture.task, '--write', '--run-verification', '--json'],
        { cwd: state.target, timeout: 120000 },
        'verification_failed',
        'usefulness trial',
      );
      if (value.decision !== 'ready-for-dogfood' || value.score?.label !== '5/5') {
        throw new GoldenPathError('verification_failed', `usefulness trial was ${value.decision} at ${value.score?.label}`);
      }
      const reportPath = path.join(state.target, value.reportPath || '');
      const report = value.reportPath && fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf8') : '';
      if (!report.includes('---HANDOFF---')) throw new GoldenPathError('handoff_missing', 'trial report has no HANDOFF block');
      result.artifacts.usefulness_report = value.reportPath;
      result.artifacts.usefulness_decision = value.decision;
      result.artifacts.usefulness_score = value.score.label;
      result.artifacts.handoff_present = true;
      result.metrics.install_to_verified_handoff_ms = Date.now() - installStarted;
      return { evidence: [`decision=${value.decision}`, `score=${value.score.label}`, `report=${value.reportPath}`, 'handoff=true'] };
    });

    recordStep(result, 'resume', () => {
      const { value } = requireProcess(
        SCRIPT(options.pluginRoot, 'continue-action.js'),
        ['--project-root', state.target, '--json'],
        { cwd: state.target },
        'resume_failed',
        'fresh continuation',
      );
      if (value.action?.command !== state.fixture.expectedResumeCommand) {
        throw new GoldenPathError('resume_failed', `continuation command was ${value.action?.command || '(none)'}`);
      }
      result.resume = { status: 'passed', command: value.action.command };
      return { evidence: [`command=${value.action.command}`, 'process=fresh'] };
    });
    result.status = 'passed';
  } catch (error) {
    const code = error instanceof GoldenPathError ? error.code : 'unexpected_error';
    result.failure = failureFor(code);
  } finally {
    cleanup(result, state, Boolean(options.keepTemp));
    result.metrics.total_ms = Date.now() - started;
    if (result.failure) result.status = 'failed';
    result.artifacts.workspace = options.keepTemp && state.target ? state.target : null;
  }
  return result;
}

module.exports = { cleanup, installerArgs, isSafeStageEntry, runGoldenPath, shouldStagePluginPath, stagePlugin };

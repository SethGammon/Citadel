'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');

const DEFAULT_PROFILE = Object.freeze({
  setupCommand: null,
  dependencyMode: 'auto',
  env: {
    policy: 'copy-if-present',
    files: ['.env.local', '.env'],
  },
  ports: {
    host: '127.0.0.1',
    required: [],
    preferred: [],
  },
  healthChecks: [],
  cleanupPolicy: 'keep-on-failure',
  blockFleetOnFailure: true,
  allowHealthCommands: false,
});

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readHarnessConfig(projectRoot) {
  return readJson(path.join(projectRoot, '.claude', 'harness.json')) ||
    readJson(path.join(projectRoot, '.Codex', 'harness.json')) ||
    {};
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function normalizeProfile(config = {}) {
  const raw = config.worktreeReadiness || config.worktree?.readiness ||
    (config.dependencyMode || config.env || config.ports || config.healthChecks ? config : {});
  const env = raw.env || {};
  const ports = raw.ports || {};
  return {
    ...DEFAULT_PROFILE,
    ...raw,
    env: {
      ...DEFAULT_PROFILE.env,
      ...env,
      files: asArray(env.files || DEFAULT_PROFILE.env.files).filter(Boolean),
    },
    ports: {
      ...DEFAULT_PROFILE.ports,
      ...ports,
      required: asArray(ports.required).map(Number).filter(Number.isInteger),
      preferred: asArray(ports.preferred).map(Number).filter(Number.isInteger),
    },
    healthChecks: asArray(raw.healthChecks),
  };
}

function loadReadinessProfile(projectRoot) {
  return normalizeProfile(readHarnessConfig(projectRoot));
}

function safeName(value) {
  return String(value || 'worktree')
    .replace(/^[a-zA-Z]:/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-120) || 'worktree';
}

function detectDependencyNeeds(worktreePath) {
  const exists = (entry) => fs.existsSync(path.join(worktreePath, entry));
  const needs = [];

  if (exists('package.json')) {
    let packageManager = 'npm';
    if (exists('pnpm-lock.yaml')) packageManager = 'pnpm';
    else if (exists('yarn.lock')) packageManager = 'yarn';
    else if (exists('bun.lockb')) packageManager = 'bun';
    needs.push({
      type: 'node',
      packageManager,
      ready: exists('node_modules'),
      expectedPath: 'node_modules',
    });
  }

  if (exists('requirements.txt') || exists('pyproject.toml')) {
    needs.push({
      type: 'python',
      packageManager: 'pip',
      ready: exists('.venv'),
      expectedPath: '.venv',
    });
  }

  if (exists('go.mod')) {
    needs.push({
      type: 'go',
      packageManager: 'go',
      ready: true,
      expectedPath: 'go module cache',
    });
  }

  if (exists('Cargo.toml')) {
    needs.push({
      type: 'rust',
      packageManager: 'cargo',
      ready: true,
      expectedPath: 'cargo cache',
    });
  }

  return needs;
}

function checkDependencies(worktreePath, profile) {
  if (profile.dependencyMode === 'skip') {
    return [{
      name: 'dependencies',
      status: 'pass',
      detail: 'Dependency readiness skipped by profile.',
    }];
  }

  const needs = detectDependencyNeeds(worktreePath);
  if (needs.length === 0) {
    return [{
      name: 'dependencies',
      status: 'pass',
      detail: 'No dependency manifest detected.',
    }];
  }

  return needs.map((need) => {
    if (need.ready) {
      return {
        name: `dependencies:${need.type}`,
        status: 'pass',
        detail: `${need.expectedPath} is present.`,
        meta: need,
      };
    }

    const status = profile.dependencyMode === 'optional' ? 'warn' : 'fail';
    return {
      name: `dependencies:${need.type}`,
      status,
      detail: `${need.expectedPath} is missing after worktree setup.`,
      meta: need,
    };
  });
}

function checkEnvFiles(projectRoot, worktreePath, profile) {
  const envProfile = profile.env || DEFAULT_PROFILE.env;
  if (envProfile.policy === 'skip') {
    return [{
      name: 'env',
      status: 'pass',
      detail: 'Environment file checks skipped by profile.',
    }];
  }

  const checks = [];
  for (const file of envProfile.files || []) {
    const sourceExists = fs.existsSync(path.join(projectRoot, file));
    const targetExists = fs.existsSync(path.join(worktreePath, file));

    if (envProfile.policy === 'required') {
      checks.push({
        name: `env:${file}`,
        status: targetExists ? 'pass' : 'fail',
        detail: targetExists ? `${file} is present.` : `${file} is required but missing in the worktree.`,
        meta: { sourceExists, targetExists },
      });
      continue;
    }

    if (envProfile.policy === 'copy-if-present') {
      if (!sourceExists) {
        checks.push({
          name: `env:${file}`,
          status: 'pass',
          detail: `${file} is not present in the main project; nothing to copy.`,
          meta: { sourceExists, targetExists },
        });
      } else {
        checks.push({
          name: `env:${file}`,
          status: targetExists ? 'pass' : 'fail',
          detail: targetExists ? `${file} was copied to the worktree.` : `${file} exists in main project but is missing in the worktree.`,
          meta: { sourceExists, targetExists },
        });
      }
      continue;
    }

    checks.push({
      name: `env:${file}`,
      status: sourceExists && !targetExists ? 'warn' : 'pass',
      detail: sourceExists && !targetExists
        ? `${file} exists in main project but is optional and missing in the worktree.`
        : `${file} optional check passed.`,
      meta: { sourceExists, targetExists },
    });
  }

  return checks.length ? checks : [{
    name: 'env',
    status: 'pass',
    detail: 'No environment files configured.',
  }];
}

function portAvailable(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

async function checkPorts(profile) {
  const ports = profile.ports || DEFAULT_PROFILE.ports;
  const host = ports.host || '127.0.0.1';
  const checks = [];

  for (const port of ports.required || []) {
    const available = await portAvailable(port, host);
    checks.push({
      name: `port:${port}`,
      status: available ? 'pass' : 'fail',
      detail: available ? `Required port ${port} is available.` : `Required port ${port} is already in use.`,
      meta: { port, host, required: true },
    });
  }

  for (const port of ports.preferred || []) {
    const available = await portAvailable(port, host);
    checks.push({
      name: `port:${port}`,
      status: available ? 'pass' : 'warn',
      detail: available ? `Preferred port ${port} is available.` : `Preferred port ${port} is already in use.`,
      meta: { port, host, required: false },
    });
  }

  return checks.length ? checks : [{
    name: 'ports',
    status: 'pass',
    detail: 'No port readiness checks configured.',
  }];
}

function checkHealthCommands(profile) {
  const commands = profile.healthChecks || [];
  if (commands.length === 0) {
    return [{
      name: 'health',
      status: 'pass',
      detail: 'No health checks configured.',
    }];
  }

  if (!profile.allowHealthCommands) {
    return commands.map((command, index) => ({
      name: `health:${index + 1}`,
      status: 'warn',
      detail: `Configured health check was not executed by read-only readiness mode: ${String(command).slice(0, 160)}`,
    }));
  }

  return commands.map((command, index) => ({
    name: `health:${index + 1}`,
    status: 'warn',
    detail: `Executable health checks are not implemented yet: ${String(command).slice(0, 160)}`,
  }));
}

function deriveStatus(checks) {
  if (checks.some((check) => check.status === 'fail')) return 'blocked';
  if (checks.some((check) => check.status === 'warn')) return 'warning';
  return 'ready';
}

function readinessFile(projectRoot, worktreePath, branch) {
  const dir = path.join(projectRoot, '.planning', 'verification', 'worktree-readiness');
  const base = branch ? safeName(branch) : safeName(path.basename(worktreePath));
  return path.join(dir, `${base}.json`);
}

function writeReadinessReport(projectRoot, report) {
  const target = readinessFile(projectRoot, report.worktreePath, report.branch);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return target;
}

async function checkWorktreeReadiness(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const worktreePath = path.resolve(options.worktreePath || projectRoot);
  const profile = normalizeProfile(options.profile || readHarnessConfig(projectRoot));
  const branch = options.branch || null;
  const now = options.now ? new Date(options.now) : new Date();

  const checks = [
    ...checkDependencies(worktreePath, profile),
    ...checkEnvFiles(projectRoot, worktreePath, profile),
    ...await checkPorts(profile),
    ...checkHealthCommands(profile),
  ];

  const report = {
    schema: 1,
    timestamp: now.toISOString(),
    projectRoot,
    worktreePath,
    worktreeName: path.basename(worktreePath),
    branch,
    status: deriveStatus(checks),
    blockFleet: profile.blockFleetOnFailure !== false && checks.some((check) => check.status === 'fail'),
    profile: {
      setupCommand: profile.setupCommand || null,
      dependencyMode: profile.dependencyMode,
      env: profile.env,
      ports: profile.ports,
      healthChecks: profile.healthChecks,
      cleanupPolicy: profile.cleanupPolicy,
      blockFleetOnFailure: profile.blockFleetOnFailure !== false,
    },
    checks,
  };

  if (options.write) {
    report.file = writeReadinessReport(projectRoot, report);
  }

  return report;
}

function listReadinessReports(projectRoot) {
  const dir = path.join(projectRoot, '.planning', 'verification', 'worktree-readiness');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => path.join(dir, entry))
    .map((filePath) => {
      const data = readJson(filePath);
      if (!data) return null;
      return { ...data, file: filePath };
    })
    .filter(Boolean)
    .sort((left, right) => new Date(right.timestamp || 0).getTime() - new Date(left.timestamp || 0).getTime());
}

function matchReadiness(task, reports) {
  if (!task || !reports || reports.length === 0) return null;
  const branch = String(task.branch || '').replace(/^-$/, '').trim();
  const agent = String(task.agent || '').replace(/^-$/, '').trim();
  const id = String(task.id || '').trim();
  return reports.find((report) => {
    return (branch && report.branch === branch) ||
      (branch && String(report.worktreePath || '').includes(branch)) ||
      (agent && String(report.worktreeName || '').includes(agent)) ||
      (id && String(report.worktreeName || '').includes(`-${id}`));
  }) || null;
}

module.exports = {
  DEFAULT_PROFILE,
  checkWorktreeReadiness,
  deriveStatus,
  listReadinessReports,
  loadReadinessProfile,
  matchReadiness,
  normalizeProfile,
  readinessFile,
  safeName,
  writeReadinessReport,
};

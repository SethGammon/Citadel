'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function readPackageScripts(projectRoot) {
  try {
    const packagePath = path.join(projectRoot, 'package.json');
    const raw = fs.readFileSync(packagePath, 'utf8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw);
    return parsed.scripts || {};
  } catch {
    return {};
  }
}

function runGit(projectRoot, args) {
  const result = spawnSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.status !== 0) return '';
  return result.stdout || '';
}

function splitLines(output) {
  return String(output || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function listUntrackedPath(projectRoot, statusPath) {
  const fullPath = path.join(projectRoot, statusPath);
  try {
    const stat = fs.statSync(fullPath);
    if (!stat.isDirectory()) return [statusPath];
    const found = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir)) {
        const entryPath = path.join(dir, entry);
        const entryStat = fs.statSync(entryPath);
        if (entryStat.isDirectory()) walk(entryPath);
        else found.push(normalizePath(path.relative(projectRoot, entryPath)));
      }
    };
    walk(fullPath);
    return found;
  } catch {
    return [statusPath];
  }
}

function changedFilesFromGit(projectRoot) {
  const dirty = [
    ...splitLines(runGit(projectRoot, ['diff', '--name-only'])),
    ...splitLines(runGit(projectRoot, ['diff', '--name-only', '--cached'])),
    ...splitLines(runGit(projectRoot, ['status', '--short']))
      .filter((line) => line.startsWith('?? '))
      .flatMap((line) => listUntrackedPath(projectRoot, line.slice(3).trim())),
  ];
  if (dirty.length > 0) return unique(dirty.map(normalizePath));

  const headRange = splitLines(runGit(projectRoot, ['diff', '--name-only', 'HEAD~1', 'HEAD']));
  if (headRange.length > 0) return unique(headRange.map(normalizePath));

  return splitLines(runGit(projectRoot, ['ls-files'])).map(normalizePath);
}

function defaultCommand(scripts) {
  if (scripts.test) return 'npm run test';
  return 'node scripts/test-all.js';
}

function hasAny(files, predicate) {
  return files.some((file) => predicate(normalizePath(file)));
}

function profileForFiles(changedFiles, scripts = {}) {
  const files = changedFiles.map(normalizePath);
  const broad = defaultCommand(scripts);
  const commands = [broad];
  const notes = [];
  const touchesOperatorLoop = hasAny(files, (file) => file === 'scripts/dashboard.js' || file === 'scripts/next-action.js' || file === 'scripts/continue-action.js' || file === 'scripts/operator-console.js');
  let id = 'baseline';
  let label = 'Baseline regression';
  let reason = 'No narrower high-signal verification profile matched the changed paths.';

  if (hasAny(files, (file) => file.startsWith('hooks_src/') || file.startsWith('hooks/'))) {
    id = 'hook-runtime';
    label = 'Hook runtime verification';
    reason = 'Hook changes affect command safety, generated state, and lifecycle behavior.';
    commands.unshift(
      'node hooks_src/smoke-test.js',
      'node scripts/verify-hooks.js',
      'node scripts/integration-test.js'
    );
    notes.push('Run hook smoke, synthetic hook verification, and integration sequences before relying on broad tests.');
  } else if (hasAny(files, (file) => file === 'scripts/deploy-steward.js' || file === 'scripts/test-deploy-steward.js' || file.startsWith('core/deploy-steward/') || file.startsWith('skills/deploy-steward/'))) {
    id = 'deploy-steward';
    label = 'Deploy steward verification';
    reason = 'Deploy steward changes affect mainline serialization, CI gates, merge behavior, deploy handoff, and repair task generation.';
    commands.unshift(
      'node scripts/test-deploy-steward.js',
      'node scripts/test-pr-ready.js',
      'node scripts/test-stack-plan.js'
    );
    if (hasAny(files, (file) => file.startsWith('skills/deploy-steward/'))) {
      commands.unshift('node scripts/skill-lint.js deploy-steward');
    }
    notes.push('Steward changes must prove queue/lease behavior plus the PR readiness and stack-plan inputs that feed it.');
  } else if (hasAny(files, (file) => file.startsWith('skills/') || file === 'scripts/skill-lint.js')) {
    id = 'skill-surface';
    label = 'Skill surface verification';
    reason = 'Skill changes affect routing, operator instructions, and user-facing agent behavior.';
    commands.unshift('node scripts/skill-lint.js');
    notes.push('Skill lint proves structure; broad tests catch routing and packaging regressions.');
  } else if (hasAny(files, (file) => file === 'docs/index.html' || file === 'scripts/test-demo.js')) {
    id = 'demo-experience';
    label = 'Demo experience verification';
    reason = 'Demo page changes affect the first-run public experience.';
    commands.unshift('node scripts/test-demo.js');
    notes.push('Demo routing checks are required because broad tests alone do not inspect the page copy and links deeply.');
  } else if (touchesOperatorLoop) {
    id = 'operator-loop';
    label = 'Operator loop verification';
    reason = 'Operator changes affect the next-action, dashboard, and continuation path.';
    commands.unshift(
      'node scripts/test-dashboard.js',
      'node scripts/test-next-action.js',
      'node scripts/test-continue-action.js',
      'node scripts/test-operator-console.js',
      'node scripts/test-operator-journey.js'
    );
    notes.push('Verify both focused operator behavior and the full intake-to-package journey.');
  } else if (hasAny(files, (file) => file === 'scripts/pr-ready.js' || file === 'scripts/verification-plan.js' || file === 'core/verification/profiles.js')) {
    id = 'review-readiness';
    label = 'Review readiness verification';
    reason = 'Readiness finalizer changes affect PR approval handoffs and verification evidence.';
    commands.unshift(
      'node scripts/test-verification-plan.js',
      'node scripts/test-pr-ready.js'
    );
    notes.push('Finalizer changes must prove both profile selection and PR readiness report generation.');
  } else if (hasAny(files, (file) => file.startsWith('core/campaigns/') || file === 'scripts/campaign.js' || file === 'scripts/package-delivery.js' || file === 'scripts/deliver.js')) {
    id = 'campaign-delivery';
    label = 'Campaign delivery verification';
    reason = 'Campaign lifecycle changes affect delivery state, evidence, review packages, and outcomes.';
    commands.unshift(
      'node scripts/test-campaign-core.js',
      'node scripts/test-deliver.js',
      'node scripts/test-package-delivery.js',
      'node scripts/test-operator-journey.js'
    );
    notes.push('Campaign lifecycle checks need focused delivery evidence tests before broad regression tests.');
  } else if (hasAny(files, (file) => file.endsWith('.md') || file.startsWith('docs/'))) {
    id = 'documentation';
    label = 'Documentation verification';
    reason = 'Documentation changes should still preserve demo routes, skill docs, and broad harness contracts.';
    commands.unshift('node scripts/test-demo.js', 'node scripts/skill-lint.js');
    notes.push('Docs can affect the public demo and skill instructions; keep those checks visible.');
  }

  if (id !== 'operator-loop' && touchesOperatorLoop) {
    commands.unshift(
      'node scripts/test-dashboard.js',
      'node scripts/test-next-action.js',
      'node scripts/test-continue-action.js',
      'node scripts/test-operator-console.js',
      'node scripts/test-operator-journey.js'
    );
    notes.push('Operator files also changed; keep the decision-console and end-to-end operator journey checks visible.');
  }

  return {
    id,
    label,
    reason,
    changedFiles: files,
    primaryCommand: broad,
    commands: unique(commands),
    notes,
  };
}

function selectVerificationProfile(projectRoot, options = {}) {
  const root = path.resolve(projectRoot || process.cwd());
  const scripts = readPackageScripts(root);
  const changedFiles = options.changedFiles
    ? options.changedFiles.map(normalizePath)
    : changedFilesFromGit(root);
  return profileForFiles(changedFiles, scripts);
}

module.exports = {
  changedFilesFromGit,
  profileForFiles,
  readPackageScripts,
  selectVerificationProfile,
};

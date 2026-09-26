#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  applyPlan, createAdoptionPlan, createImportPlan, createLeavePlan,
  createRestorePlan, createRollbackPlan, createUpdatePlan, doctor,
  proposeClaudeProjection, proposeCodexProjection, readReceipt,
} = require('../core/adoption');
const { ACTIVE_RECEIPT } = require('../core/adoption/footprint');
const { targetKey } = require('../core/adoption/ledger');
const { baselineMigration } = require('../core/adoption/migrations');

let passed = 0;

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd, encoding: 'utf8', shell: false, windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status}): ${result.stderr || result.error}`);
  }
  return result.stdout;
}

function git(root, args) {
  return run('git', args, root).trim();
}

function initializeGit(root, files) {
  fs.mkdirSync(root, { recursive: true });
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'citadel-evolution@example.invalid']);
  git(root, ['config', 'user.name', 'Citadel Evolution']);
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, ...relative.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'baseline']);
  return root;
}

function source(root, version) {
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

function target(root, extras = {}) {
  return initializeGit(root, { 'README.md': '# User project\n', ...extras });
}

function treeDigest(root) {
  const hash = crypto.createHash('sha256');
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.git') continue;
      const absolute = path.join(directory, entry.name);
      hash.update(`${path.relative(root, absolute).replace(/\\/g, '/')}\0`);
      if (entry.isDirectory()) visit(absolute);
      else hash.update(fs.readFileSync(absolute));
    }
  };
  visit(root);
  return hash.digest('hex');
}

function confirm(plan, controlRoot, extra = {}) {
  assert.notStrictEqual(plan.status, 'blocked', JSON.stringify(plan.blockers));
  return applyPlan(plan, { confirm: plan.confirmation.token, controlRoot, ...extra });
}

function test(name, body) {
  body();
  passed += 1;
  process.stdout.write(`ok ${passed} - ${name}\n`);
}

const suite = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-evolution-'));
const sourceV1 = source(path.join(suite, 'source-v1'), '1.0.0');
const sourceV2 = source(path.join(suite, 'source-v2'), '2.0.0');
const controlRoot = path.join(suite, 'private-control');

try {
  test('private ledger identity canonicalizes filesystem aliases', () => {
    const canonicalParent = path.join(suite, 'canonical-parent');
    const aliasParent = path.join(suite, 'alias-parent');
    fs.mkdirSync(canonicalParent);
    fs.symlinkSync(canonicalParent, aliasParent, process.platform === 'win32' ? 'junction' : 'dir');
    const root = target(path.join(canonicalParent, 'ledger-identity'));
    assert.strictEqual(targetKey(root), targetKey(path.join(aliasParent, 'ledger-identity')));
  });

  test('update switches immutable generation, doctor passes, and rollback returns to predecessor', () => {
    const root = target(path.join(suite, 'update'));
    const adopted = applyPlan(createAdoptionPlan({ source: sourceV1, target: root }), { controlRoot });
    const beforeUpdatePlan = treeDigest(root);
    const update = createUpdatePlan({
      source: sourceV2, target: root, controlRoot, migration: baselineMigration(),
    });
    assert.strictEqual(treeDigest(root), beforeUpdatePlan);
    const updated = confirm(update, controlRoot);
    assert.strictEqual(updated.post_switch_doctor.status, 'healthy');
    assert.strictEqual(doctor(root, { controlRoot }).status, 'healthy');
    assert.strictEqual(readReceipt(root).generation.version, '2.0.0');
    const pointer = JSON.parse(fs.readFileSync(path.join(root, '.citadel', 'adoption', 'current.json'), 'utf8'));
    assert.strictEqual(pointer.generation_id, updated.receipt.generation.generation_id);
    assert(fs.existsSync(path.join(root, '.citadel', 'adoption', 'generations', adopted.receipt.generation.generation_id)));
    const beforeRollbackPlan = treeDigest(root);
    const rollback = createRollbackPlan({ target: root, controlRoot });
    assert.strictEqual(treeDigest(root), beforeRollbackPlan);
    const rolledBack = confirm(rollback, controlRoot);
    assert.strictEqual(rolledBack.post_switch_doctor.status, 'healthy');
    assert.strictEqual(readReceipt(root).generation.version, '1.0.0');
    assert.strictEqual(doctor(root, { controlRoot }).status, 'healthy');
  });

  test('incompatible and unknown migration state block update planning', () => {
    const root = target(path.join(suite, 'incompatible'));
    applyPlan(createAdoptionPlan({ source: sourceV1, target: root }), { controlRoot });
    const update = createUpdatePlan({
      source: sourceV2,
      target: root,
      controlRoot,
      migration: {
        reads: ['future-schema'], writes: ['future-schema'],
        reversible: true, minimum_code_version: '99.0.0',
      },
    });
    assert.strictEqual(update.status, 'blocked');
    assert(update.blockers.some((item) => item.code === 'STATE_SCHEMA_UNKNOWN'));
    const minimum = createUpdatePlan({
      source: sourceV2,
      target: root,
      controlRoot,
      migration: {
        reads: ['citadel-state-v1'], writes: ['citadel-state-v1'],
        reversible: true, minimum_code_version: '99.0.0',
      },
    });
    assert(minimum.blockers.some((item) => item.code === 'MINIMUM_CODE_VERSION_UNMET'));
    const downgradeRoot = target(path.join(suite, 'downgrade'));
    applyPlan(createAdoptionPlan({ source: sourceV2, target: downgradeRoot }), { controlRoot });
    const downgrade = createUpdatePlan({
      source: sourceV1, target: downgradeRoot, controlRoot, migration: baselineMigration(),
    });
    assert(downgrade.blockers.some((item) => item.code === 'DOWNGRADE_BLOCKED'));
  });

  test('failure after generation switch compensates and leaves prior receipt healthy', () => {
    const root = target(path.join(suite, 'update-fault'));
    const adopted = applyPlan(createAdoptionPlan({ source: sourceV1, target: root }), { controlRoot });
    const update = createUpdatePlan({
      source: sourceV2, target: root, controlRoot, migration: baselineMigration(),
    });
    let failure;
    try {
      confirm(update, controlRoot, { failAt: 'before-receipt' });
    } catch (error) {
      failure = error;
    }
    assert(failure);
    assert.strictEqual(failure.recovery.state, 'recovered');
    assert.strictEqual(readReceipt(root).receipt_digest, adopted.receipt.receipt_digest);
    assert.strictEqual(doctor(root, { controlRoot }).status, 'healthy');
  });

  test('portable archive restores owned material and user state', () => {
    const root = target(path.join(suite, 'restore'));
    applyPlan(createAdoptionPlan({ source: sourceV1, target: root }), { controlRoot });
    fs.mkdirSync(path.join(root, '.planning', 'campaigns'), { recursive: true });
    fs.writeFileSync(path.join(root, '.planning', 'campaigns', 'survives.md'), '# Survives\n');
    const leave = createLeavePlan({ target: root, controlRoot });
    const exited = confirm(leave, controlRoot);
    const archive = path.join(root, ...exited.archive.split('/'));
    const beforeRestorePlan = treeDigest(root);
    const restore = createRestorePlan({ target: root, archive, controlRoot });
    assert.strictEqual(treeDigest(root), beforeRestorePlan);
    const restored = confirm(restore, controlRoot);
    assert.strictEqual(restored.receipt.generation.version, '1.0.0');
    assert.strictEqual(fs.readFileSync(path.join(root, '.planning', 'campaigns', 'survives.md'), 'utf8'), '# Survives\n');
    assert.strictEqual(doctor(root, { controlRoot }).status, 'healthy');
  });

  test('legacy import classifies strong, shared, and ambiguous evidence without perfect rollback', () => {
    const root = target(path.join(suite, 'legacy'), {
      '.citadel/plugin-root.txt': `${sourceV1}\n`,
      '.citadel/version.txt': '1.0.0\n',
      '.citadel/project.md': '# Legacy user state\n',
      '.claude/settings.json': `${JSON.stringify({ hooks: {}, user: true }, null, 2)}\n`,
      '.codex/config.toml': 'model = "gpt-5"\n',
    });
    const beforeImportPlan = treeDigest(root);
    const plan = createImportPlan({ target: root, source: sourceV1, controlRoot });
    assert.strictEqual(treeDigest(root), beforeImportPlan);
    assert.strictEqual(plan.status, 'confirmation_required');
    assert.strictEqual(plan.rollback.reversible, false);
    const ownership = new Set(plan.footprint_preview.entries.map((entry) => entry.ownership));
    assert(ownership.has('owned') && ownership.has('shared') && ownership.has('ambiguous'));
    confirm(plan, controlRoot);
    assert.strictEqual(doctor(root, { controlRoot }).status, 'healthy');
  });

  test('private ledger supplies a missing project receipt to doctor and leave', () => {
    const root = target(path.join(suite, 'ledger'));
    const adopted = applyPlan(createAdoptionPlan({ source: sourceV1, target: root }), { controlRoot });
    assert.strictEqual(adopted.ledger.status, 'mirrored');
    fs.unlinkSync(path.join(root, ...ACTIVE_RECEIPT.split('/')));
    const report = doctor(root, { controlRoot });
    assert.strictEqual(report.status, 'healthy');
    assert.strictEqual(report.receipt_source, 'private_ledger');
    const leave = createLeavePlan({ target: root, controlRoot });
    const result = confirm(leave, controlRoot);
    assert.strictEqual(result.ledger.status, 'retired');
  });

  test('required private ledger failure rolls project effects back conservatively', () => {
    const root = target(path.join(suite, 'ledger-failure'));
    const invalidControl = path.join(suite, 'not-a-control-directory');
    fs.writeFileSync(invalidControl, 'occupied');
    let failure;
    try {
      applyPlan(createAdoptionPlan({ source: sourceV1, target: root }), { controlRoot: invalidControl });
    } catch (error) {
      failure = error;
    }
    assert(failure);
    assert.strictEqual(failure.code, 'LEDGER_MIRROR_FAILED');
    assert.strictEqual(failure.recovery.state, 'recovered');
    assert(!fs.existsSync(path.join(root, ...ACTIVE_RECEIPT.split('/'))));
    assert(!fs.existsSync(path.join(root, '.citadel', 'plugin-root.txt')));
  });

  test('leave preserves a modified generation-control footprint instead of deleting its directory', () => {
    const root = target(path.join(suite, 'modified-generation'));
    applyPlan(createAdoptionPlan({ source: sourceV1, target: root }), { controlRoot });
    const pointer = path.join(root, '.citadel', 'adoption', 'current.json');
    fs.appendFileSync(pointer, '\nuser-note\n');
    const leave = createLeavePlan({ target: root, controlRoot });
    assert(leave.warnings.some((item) => item.code === 'MODIFIED_FOOTPRINT_RETAINED'
      && item.paths.includes('.citadel/adoption/current.json')));
    confirm(leave, controlRoot);
    assert(fs.existsSync(pointer));
  });

  test('Claude projection is read-only, installs shared hooks, and leave restores exact pre-image', () => {
    const original = `${JSON.stringify({ hooks: {}, userSetting: true }, null, 2)}\n`;
    const root = target(path.join(suite, 'claude'), { '.claude/settings.json': original });
    const before = treeDigest(root);
    const projection = proposeClaudeProjection({ target: root, source: sourceV1 });
    assert.strictEqual(treeDigest(root), before);
    assert(projection.proposed_effects.some((effect) => effect.removal.evidence_status === 'unknown'));
    const plan = createAdoptionPlan({ source: sourceV1, target: root, runtimeProjections: [projection] });
    confirm(plan, controlRoot);
    assert.strictEqual(doctor(root, { controlRoot }).status, 'unknown');
    const leave = createLeavePlan({ target: root, controlRoot });
    assert(leave.warnings.some((item) => item.code === 'RUNTIME_REMOVAL_UNKNOWN'));
    const exited = confirm(leave, controlRoot);
    assert(exited.runtime_removal_evidence.some((item) => item.surface === 'shared-hooks-settings' && item.status === 'passed'));
    assert(exited.runtime_removal_evidence.some((item) => item.surface === 'plugin-registration' && item.status === 'unknown'));
    assert.strictEqual(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'), original);
  });

  test('explicit Codex fallback owns new skills and restores shared hooks without plugin registration', () => {
    const original = `${JSON.stringify({ hooks: { Stop: [] }, user: true }, null, 2)}\n`;
    const root = target(path.join(suite, 'codex'), { '.codex/hooks.json': original });
    const before = treeDigest(root);
    const projection = proposeCodexProjection({ target: root, source: sourceV1, mode: 'fallback' });
    assert.strictEqual(treeDigest(root), before);
    assert(!projection.proposed_effects.some((effect) => effect.surface === 'plugin-registration'));
    const plan = createAdoptionPlan({ source: sourceV1, target: root, runtimeProjections: [projection] });
    confirm(plan, controlRoot);
    assert(fs.existsSync(path.join(root, '.agents', 'skills', 'review', 'SKILL.md')));
    const leave = createLeavePlan({ target: root, controlRoot });
    const exited = confirm(leave, controlRoot);
    assert(exited.runtime_removal_evidence.some((item) => item.surface === 'shared-hooks' && item.status === 'passed'));
    assert(exited.runtime_removal_evidence.some((item) => item.surface === 'config.toml' && item.status === 'unknown'));
    assert.strictEqual(fs.readFileSync(path.join(root, '.codex', 'hooks.json'), 'utf8'), original);
    assert(!fs.existsSync(path.join(root, '.agents', 'skills', 'review', 'SKILL.md')));
  });

  test('Codex plugin projection preserves unowned local hooks and skill collisions', () => {
    const hooks = `${JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'node codex-adapter.js' }] }] } })}\n`;
    const skill = 'user-authored review guidance\n';
    const root = target(path.join(suite, 'codex-plugin'), {
      '.codex/hooks.json': hooks,
      '.agents/skills/review/SKILL.md': skill,
    });
    const before = treeDigest(root);
    const projection = proposeCodexProjection({ target: root, source: sourceV1 });
    assert.strictEqual(treeDigest(root), before);
    assert.strictEqual(projection.status, 'plugin_registration_required');
    assert(!projection.proposed_effects.some((effect) => ['create', 'replace'].includes(effect.action)));
    assert(projection.proposed_effects.some((effect) => effect.surface === 'legacy-local-hooks'));
    assert(projection.proposed_effects.some((effect) => effect.surface === 'legacy-local-skill'));
    assert(projection.proposed_effects.some((effect) => effect.surface === 'plugin-registration'));
    confirm(createAdoptionPlan({ source: sourceV1, target: root, runtimeProjections: [projection] }), controlRoot);
    assert.strictEqual(fs.readFileSync(path.join(root, '.codex', 'hooks.json'), 'utf8'), hooks);
    assert.strictEqual(fs.readFileSync(path.join(root, '.agents', 'skills', 'review', 'SKILL.md'), 'utf8'), skill);
  });

  test('plugin migration prunes only unchanged fallback-owned copies', () => {
    const original = `${JSON.stringify({ hooks: { Stop: [] }, user: true }, null, 2)}\n`;
    const root = target(path.join(suite, 'codex-migration'), { '.codex/hooks.json': original });
    const fallback = proposeCodexProjection({ target: root, source: sourceV1, mode: 'fallback' });
    confirm(createAdoptionPlan({ source: sourceV1, target: root, runtimeProjections: [fallback] }), controlRoot);
    const plugin = proposeCodexProjection({ target: root, source: sourceV2, mode: 'plugin',
      ownedPaths: ['.codex/hooks.json', '.agents/skills/review/SKILL.md'] });
    const update = createUpdatePlan({ source: sourceV2, target: root, controlRoot,
      migration: baselineMigration(), runtimeProjections: [plugin] });
    confirm(update, controlRoot);
    assert.strictEqual(fs.readFileSync(path.join(root, '.codex', 'hooks.json'), 'utf8'), original);
    assert(!fs.existsSync(path.join(root, '.agents', 'skills', 'review', 'SKILL.md')));
  });

  test('plugin migration retains a user-edited fallback skill', () => {
    const root = target(path.join(suite, 'codex-migration-edited'));
    const fallback = proposeCodexProjection({ target: root, source: sourceV1, mode: 'fallback' });
    confirm(createAdoptionPlan({ source: sourceV1, target: root, runtimeProjections: [fallback] }), controlRoot);
    const skillPath = path.join(root, '.agents', 'skills', 'review', 'SKILL.md');
    fs.appendFileSync(skillPath, '\nuser edit\n');
    const edited = fs.readFileSync(skillPath, 'utf8');
    const plugin = proposeCodexProjection({ target: root, source: sourceV2, mode: 'plugin',
      ownedPaths: ['.codex/hooks.json'] });
    const update = createUpdatePlan({ source: sourceV2, target: root, controlRoot,
      migration: baselineMigration(), runtimeProjections: [plugin] });
    assert(update.warnings.some((warning) => warning.code === 'STALE_PROJECTION_RETAINED'));
    confirm(update, controlRoot);
    assert.strictEqual(fs.readFileSync(skillPath, 'utf8'), edited);
  });

  test('update prunes an unchanged stale owned runtime projection from the prior receipt', () => {
    const root = target(path.join(suite, 'stale-projection'));
    const first = proposeCodexProjection({ target: root, source: sourceV1, mode: 'fallback' });
    confirm(createAdoptionPlan({ source: sourceV1, target: root, runtimeProjections: [first] }), controlRoot);
    assert(fs.existsSync(path.join(root, '.agents', 'skills', 'review', 'SKILL.md')));
    const next = proposeCodexProjection({ target: root, source: sourceV2, mode: 'fallback',
      ownedPaths: ['.agents/skills/review/SKILL.md'] });
    next.proposed_effects = next.proposed_effects.filter((effect) => effect.surface !== 'skill');
    const update = createUpdatePlan({
      source: sourceV2, target: root, controlRoot,
      migration: baselineMigration(), runtimeProjections: [next],
    });
    confirm(update, controlRoot);
    assert(!fs.existsSync(path.join(root, '.agents', 'skills', 'review', 'SKILL.md')));
  });

  test('saved CLI update and rollback plans execute as another user would run them', () => {
    const root = target(path.join(suite, 'cli-evolution'));
    applyPlan(createAdoptionPlan({ source: sourceV1, target: root }), { controlRoot });
    const cli = path.resolve(__dirname, 'adopt.js');
    const migration = path.join(suite, 'migration.json');
    const updateFile = path.join(suite, 'saved-update.json');
    fs.writeFileSync(migration, JSON.stringify(baselineMigration()));
    const updateRun = spawnSync(process.execPath, [
      cli, 'update', 'plan', sourceV2, '--target', root, '--migration', migration,
      '--control-root', controlRoot, '--out', updateFile, '--json',
    ], { cwd: suite, encoding: 'utf8', shell: false, windowsHide: true });
    assert.strictEqual(updateRun.status, 0, updateRun.stderr);
    const update = JSON.parse(updateRun.stdout);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(updateFile, 'utf8')), update);
    const applyUpdate = spawnSync(process.execPath, [
      cli, 'update', 'apply', updateFile, '--confirm', update.confirmation.token,
      '--control-root', controlRoot, '--json',
    ], { cwd: root, encoding: 'utf8', shell: false, windowsHide: true });
    assert.strictEqual(applyUpdate.status, 0, applyUpdate.stderr);
    const rollbackRun = spawnSync(process.execPath, [
      cli, 'rollback', 'plan', '--target', root, '--control-root', controlRoot, '--json',
    ], { cwd: suite, encoding: 'utf8', shell: false, windowsHide: true });
    assert.strictEqual(rollbackRun.status, 0, rollbackRun.stderr);
    const rollback = JSON.parse(rollbackRun.stdout);
    const rollbackFile = path.join(suite, 'saved-rollback.json');
    fs.writeFileSync(rollbackFile, JSON.stringify(rollback));
    const applyRollback = spawnSync(process.execPath, [
      cli, 'rollback', 'apply', rollbackFile, '--confirm', rollback.confirmation.token,
      '--control-root', controlRoot, '--json',
    ], { cwd: root, encoding: 'utf8', shell: false, windowsHide: true });
    assert.strictEqual(applyRollback.status, 0, applyRollback.stderr);
    assert.strictEqual(JSON.parse(applyRollback.stdout).receipt.generation.version, '1.0.0');
  });

  process.stdout.write(`1..${passed}\n`);
} finally {
  fs.rmSync(suite, { recursive: true, force: true });
}

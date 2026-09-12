#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const activation = require('../core/telemetry/activation');
const installer = require('./install');
const {
  assertPortableSharedOutputs,
  classifyOutputs,
  ensureMachineLocalExcludes,
  guidanceOwner,
  inspectInstallInventory,
  withGuidanceOwner,
} = require('../core/runtime/install-contract');
const { installClaudeHooks } = require('../runtimes/claude-code/generators/install-hooks');
const { installCodexHooks } = require('../runtimes/codex/generators/install-hooks');

const CITADEL_ROOT = path.resolve(__dirname, '..');

function tempProject(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runJson(args, cwd = CITADEL_ROOT) {
  const output = execFileSync(process.execPath, args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 30000,
  });
  return JSON.parse(output);
}

function testClaudeDryRun() {
  const tmp = tempProject('citadel-claude-install-');
  try {
    const report = runJson([
      path.join(CITADEL_ROOT, 'scripts', 'claude-install.js'),
      '--project-root',
      tmp,
      '--install',
      '--scope',
      'local',
      '--dry-run',
      '--json',
    ]);
    assert(report.pass, JSON.stringify(report, null, 2));
    assert.equal(report.scope, 'local');
    assert(report.steps.some((step) => step.name === 'Validate Claude Code plugin marketplace'));
    assert(report.steps.some((step) => step.name === 'Register Citadel marketplace with Claude Code'));
    assert(report.steps.some((step) => step.name === 'Install Citadel Harness plugin'));
    assert(!report.steps.some((step) => step.name === 'Install resolved Citadel hooks'),
      'native Claude install must not silently write shared project hook settings');
    assert(report.steps.every((step) => step.skipped));
    assert(report.nextSteps.claudeCode.some((step) => step.includes('/reload-plugins')));
    assert(report.nextSteps.claudeCode.some((step) => step.includes('/do review README.md')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function testUnifiedDispatcherDryRun() {
  const tmp = tempProject('citadel-unified-install-');
  try {
    const codex = runJson([
      path.join(CITADEL_ROOT, 'scripts', 'install.js'),
      '--runtime',
      'codex',
      '--project-root',
      tmp,
      '--plugin-only',
      '--dry-run',
      '--json',
    ]);
    assert.equal(codex.mode, 'plugin-only');
    assert(codex.pass, JSON.stringify(codex, null, 2));

    const claude = runJson([
      path.join(CITADEL_ROOT, 'scripts', 'install.js'),
      '--runtime',
      'claude',
      '--project-root',
      tmp,
      '--install',
      '--dry-run',
      '--json',
    ]);
    assert.equal(claude.scope, 'local');
    assert(claude.pass, JSON.stringify(claude, null, 2));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function testClaudeMarketplaceManifest() {
  const marketplacePath = path.join(CITADEL_ROOT, '.claude-plugin', 'marketplace.json');
  const pluginPath = path.join(CITADEL_ROOT, '.claude-plugin', 'plugin.json');
  const marketplace = JSON.parse(fs.readFileSync(marketplacePath, 'utf8'));
  const plugin = JSON.parse(fs.readFileSync(pluginPath, 'utf8'));
  assert.equal(marketplace.plugins[0].version, plugin.version, 'Claude marketplace version should match plugin.json');
  assert(!marketplace.plugins[0].description.includes('â'), 'Claude marketplace description should not contain mojibake');
}

function testCodexMarketplaceTargetsPluginRoot() {
  const marketplace = JSON.parse(fs.readFileSync(
    path.join(CITADEL_ROOT, '.agents', 'plugins', 'marketplace.json'), 'utf8',
  ));
  assert.equal(marketplace.plugins[0].source.path, './',
    'Codex marketplace source must be the directory containing .codex-plugin/plugin.json');
}

function testUnifiedDispatcherRecordsSuccessfulInstall() {
  const tmp = tempProject('citadel-unified-activation-');
  try {
    const times = [new Date('2026-07-13T12:00:00.000Z'), new Date('2026-07-13T12:00:00.250Z')];
    const result = installer.execute(['--runtime', 'codex', '--project-root', tmp], {
      cwd: CITADEL_ROOT,
      env: { CITADEL_ACQUISITION_SOURCE: 'github_trending' },
      clock: () => times.shift(),
      spawnSync: () => ({ status: 0 }),
    });
    assert.equal(result.status, 0);
    const events = activation.readEvents(tmp).events;
    assert.equal(events.length, 2);
    assert.deepEqual(events.map(({ stage, status }) => ({ stage, status })), [
      { stage: 'install_started', status: 'started' },
      { stage: 'install_completed', status: 'succeeded' },
    ]);
    assert.equal(events[1].duration_ms, 250);
    assert.equal(events[1].runtime, 'codex');
    assert.equal(events[1].acquisition_source, 'github_trending');
    assert.equal(events[1].citadel_version, require('../package.json').version);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function testUnifiedDispatcherRecordsFailureWithoutChangingExit() {
  const tmp = tempProject('citadel-unified-failure-');
  try {
    const failed = installer.execute(['--runtime=claude', '--project-root', tmp], {
      cwd: CITADEL_ROOT,
      clock: () => new Date('2026-07-13T12:00:00.000Z'),
      spawnSync: () => ({ status: 7 }),
    });
    assert.equal(failed.status, 7);
    let event = activation.readEvents(tmp).events.at(-1);
    assert.equal(event.status, 'failed');
    assert.equal(event.failure_code, 'unknown_error');
    assert.equal(event.runtime, 'claude-code');

    fs.rmSync(activation.pathsFor(tmp).dir, { recursive: true, force: true });
    const missing = installer.execute(['--runtime=codex', '--project-root', tmp], {
      cwd: CITADEL_ROOT,
      clock: () => new Date('2026-07-13T12:00:00.000Z'),
      spawnSync: () => ({ error: new Error('missing') }),
    });
    assert.equal(missing.status, 1);
    event = activation.readEvents(tmp).events.at(-1);
    assert.equal(event.failure_code, 'dependency_missing');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function testUnifiedDispatcherRespectsNonInstallModesAndOptOut() {
  for (const flag of ['--dry-run', '--plugin-only']) {
    const tmp = tempProject('citadel-unified-no-activation-');
    try {
      installer.execute(['--runtime=codex', '--project-root', tmp, flag], {
        cwd: CITADEL_ROOT, spawnSync: () => ({ status: 0 }),
      });
      assert.equal(fs.existsSync(activation.pathsFor(tmp).events), false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  const tmp = tempProject('citadel-unified-opt-out-');
  try {
    activation.setOptOut(tmp, true);
    const result = installer.execute(['--runtime=codex', '--project-root', tmp], {
      cwd: CITADEL_ROOT, spawnSync: () => ({ status: 0 }),
    });
    assert(result.records.every((record) => record.reason === 'opted_out'));
    assert.equal(fs.existsSync(activation.pathsFor(tmp).events), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function gitLikeProject(prefix) {
  const root = tempProject(prefix);
  fs.mkdirSync(path.join(root, '.git', 'info'), { recursive: true });
  return root;
}

function testPortableInstallContractAndTwoClones() {
  const first = gitLikeProject('citadel-portable-a-');
  const second = gitLikeProject('citadel-portable-b-');
  try {
    const firstExclude = ensureMachineLocalExcludes(first);
    assert(firstExclude.written, 'first clone should receive the local machine-output block');
    assert(ensureMachineLocalExcludes(first).skipped, 'local exclusion installation must be idempotent');
    assert(fs.readFileSync(path.join(first, '.git', 'info', 'exclude'), 'utf8').includes('.opencode/'));

    installClaudeHooks({ projectRoot: first, citadelRoot: CITADEL_ROOT });
    const firstSettings = fs.readFileSync(path.join(first, '.claude', 'settings.json'), 'utf8');
    installClaudeHooks({ projectRoot: second, citadelRoot: CITADEL_ROOT });
    assert.equal(fs.readFileSync(path.join(first, '.claude', 'settings.json'), 'utf8'), firstSettings,
      'installing a second clone must not rewrite the first clone');

    const hooksTemplate = JSON.parse(fs.readFileSync(path.join(CITADEL_ROOT, 'hooks', 'hooks-template.json'), 'utf8'));
    installCodexHooks({
      projectRoot: first,
      outputPath: path.join(first, '.codex', 'hooks.json'),
      hooksTemplate,
      adapterScriptPath: path.join(CITADEL_ROOT, 'hooks_src', 'codex-adapter.js'),
    });
    const inventory = inspectInstallInventory(first, { runtime: 'codex' });
    assert(inventory.registrations.some((item) => item.runtime === 'claude-code'));
    assert(inventory.registrations.some((item) => item.runtime === 'codex'));
    assert.equal(inventory.diagnostics.length, 0, 'Claude and Codex registrations should coexist');

    const duplicateRoot = gitLikeProject('citadel-duplicate-');
    try {
      fs.mkdirSync(path.join(duplicateRoot, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(duplicateRoot, '.claude', 'settings.json'), JSON.stringify({
        hooks: {
          PreToolUse: [{ hooks: [
            { type: 'command', command: 'node "C:\\\\one\\hooks_src\\a.js"' },
            { type: 'command', command: 'node "D:\\\\two\\hooks_src\\b.js"' },
          ] }],
        },
      }));
      const duplicate = inspectInstallInventory(duplicateRoot, { runtime: 'claude-code' });
      assert(duplicate.diagnostics.some((item) => item.code === 'DUPLICATE_CITADEL_REGISTRATION'));
      assert(duplicate.diagnostics[0].message.includes('Re-run the installer'));
    } finally {
      fs.rmSync(duplicateRoot, { recursive: true, force: true });
    }

    const guided = withGuidanceOwner('# Demo\n');
    assert.equal(guidanceOwner(guided), 'citadel:project-guidance');
    assert.throws(
      () => assertPortableSharedOutputs([{ path: 'opencode.json', ownership: 'shared', content: { root: 'C:\\\\workstation' } }]),
      (error) => error.code === 'CITADEL_SHARED_PATH_NOT_PORTABLE',
    );

    const firstClassification = classifyOutputs([{
      path: 'opencode.json',
      ownership: 'shared',
      content: { skills: { paths: ['C:\\\\old-citadel\\skills'] } },
    }])[0];
    const reclassified = classifyOutputs([firstClassification])[0];
    assert.equal(reclassified.portable, false, 'reclassifying output evidence must preserve portability failures');
    assert.deepEqual(reclassified.absoluteReferences, firstClassification.absoluteReferences);
  } finally {
    fs.rmSync(first, { recursive: true, force: true });
    fs.rmSync(second, { recursive: true, force: true });
  }
}

function testLinkedWorktreeExcludesUseCommonGitDirectory() {
  const repository = tempProject('citadel-common-git-');
  const linked = path.join(repository, 'linked');
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: repository, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'citadel-tests@example.test'], { cwd: repository, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Citadel Tests'], { cwd: repository, stdio: 'ignore' });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'test'], { cwd: repository, stdio: 'ignore' });
    execFileSync('git', ['worktree', 'add', '--detach', '--quiet', linked], { cwd: repository, stdio: 'ignore' });

    const plan = ensureMachineLocalExcludes(linked);
    const commonDir = path.resolve(repository, execFileSync(
      'git', ['rev-parse', '--git-common-dir'], { cwd: linked, encoding: 'utf8' },
    ).trim());
    assert.equal(path.resolve(plan.path), path.join(commonDir, 'info', 'exclude'));
    execFileSync('git', ['check-ignore', '--no-index', '-q', '.opencode/portable-test'], {
      cwd: linked,
      stdio: 'ignore',
    });
  } finally {
    if (fs.existsSync(linked)) {
      try { execFileSync('git', ['worktree', 'remove', '--force', linked], { cwd: repository, stdio: 'ignore' }); } catch { /* cleanup below */ }
    }
    fs.rmSync(repository, { recursive: true, force: true });
  }
}

testClaudeDryRun();
testUnifiedDispatcherDryRun();
testClaudeMarketplaceManifest();
testCodexMarketplaceTargetsPluginRoot();
testUnifiedDispatcherRecordsSuccessfulInstall();
testUnifiedDispatcherRecordsFailureWithoutChangingExit();
testUnifiedDispatcherRespectsNonInstallModesAndOptOut();
function testInitProjectSurfacesAmbiguousRuntimeAndStillProtectsRepo() {
  // Regression for #293: two runtime marker directories with no CITADEL_RUNTIME
  // used to make the session-start hook exit 0 in total silence, before it
  // ever reached ensureMachineLocalExcludes(). That left a mixed
  // Claude/Codex/OpenCode checkout with no .git/info/exclude protection at
  // all -- the one case the machine-local/shared contract exists to cover.
  const repository = tempProject('citadel-ambiguous-runtime-');
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: repository, stdio: 'ignore' });
    fs.mkdirSync(path.join(repository, '.claude'), { recursive: true });
    fs.mkdirSync(path.join(repository, '.codex'), { recursive: true });

    const { CITADEL_RUNTIME, ...envWithoutRuntime } = process.env;
    const result = spawnSync(
      process.execPath,
      [path.join(CITADEL_ROOT, 'hooks_src', 'init-project.js')],
      {
        cwd: repository,
        encoding: 'utf8',
        env: { ...envWithoutRuntime, CLAUDE_PROJECT_DIR: repository },
        timeout: 30000,
      },
    );

    assert.equal(result.status, 0, 'ambiguous runtime must never block session start');
    assert.match(
      result.stderr,
      /Multiple Citadel runtimes are present/,
      'the ambiguity must be surfaced, not swallowed silently',
    );
    assert.match(
      result.stderr,
      /repair: Set CITADEL_RUNTIME/,
      'a concrete repair command must accompany the diagnostic',
    );

    const excludePath = path.join(repository, '.git', 'info', 'exclude');
    assert(fs.existsSync(excludePath), 'machine-local exclude file must be written even under ambiguity');
    const excludeContents = fs.readFileSync(excludePath, 'utf8');
    assert.match(excludeContents, /CITADEL MACHINE-LOCAL/, 'exclude file must carry the Citadel block');
    assert(fs.existsSync(path.join(repository, '.planning')), 'planning scaffold must still be created in degraded mode');
  } finally {
    fs.rmSync(repository, { recursive: true, force: true });
  }
}

function testInitProjectDoesNotCreateClaudeMarkerUnderAmbiguity() {
  // Codex review on #294: a disputed runtime used to fall through to the
  // .codex/.claude default in step 5's agent-context copy, so .codex/ +
  // .opencode/ (no .claude/ at all) got a brand-new .claude/agent-context/
  // written into it -- creating a THIRD runtime marker and turning a
  // temporary ambiguity into a permanent one.
  const repository = tempProject('citadel-ambiguous-no-claude-marker-');
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: repository, stdio: 'ignore' });
    fs.mkdirSync(path.join(repository, '.codex'), { recursive: true });
    fs.mkdirSync(path.join(repository, '.opencode'), { recursive: true });

    const { CITADEL_RUNTIME, ...envWithoutRuntime } = process.env;
    const result = spawnSync(
      process.execPath,
      [path.join(CITADEL_ROOT, 'hooks_src', 'init-project.js')],
      {
        cwd: repository,
        encoding: 'utf8',
        env: { ...envWithoutRuntime, CLAUDE_PROJECT_DIR: repository },
        timeout: 30000,
      },
    );

    assert.equal(result.status, 0, 'ambiguous runtime must never block session start');
    assert.equal(
      fs.existsSync(path.join(repository, '.claude')),
      false,
      'a disputed runtime must never mint a new .claude/ marker',
    );
    assert.equal(
      fs.existsSync(path.join(repository, '.codex', 'agent-context')),
      false,
      'agent-context must wait for an explicit runtime, not guess codex either',
    );
    assert.equal(
      fs.existsSync(path.join(repository, '.opencode', 'agent-context')),
      false,
      'agent-context must wait for an explicit runtime, not guess opencode either',
    );
  } finally {
    fs.rmSync(repository, { recursive: true, force: true });
  }
}

testPortableInstallContractAndTwoClones();
testLinkedWorktreeExcludesUseCommonGitDirectory();
testInitProjectSurfacesAmbiguousRuntimeAndStillProtectsRepo();
testInitProjectDoesNotCreateClaudeMarkerUnderAmbiguity();

console.log('installer tests passed');

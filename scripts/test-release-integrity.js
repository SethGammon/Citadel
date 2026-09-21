#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync, spawnSync } = require('child_process');
const { buildRelease, sanitizeReleaseInstructions, sha256 } = require('./release-package');
const { parseTar, verifyRelease } = require('./release-verify');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const LARGE_BINARY_FIXTURE = Buffer.concat([
  Buffer.from([0x00, 0x0d, 0x0a, 0xff]),
  Buffer.alloc((2 * 1024 * 1024) + 17, 0xa5),
]);

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function makeSource(root, version = '1.1.0') {
  writeJson(path.join(root, 'package.json'), { name: 'citadel', version, engines: { node: '>=22' } });
  writeJson(path.join(root, '.claude-plugin', 'plugin.json'), { name: 'citadel', version });
  writeJson(path.join(root, '.claude-plugin', 'marketplace.json'), { plugins: [{ name: 'citadel', version }] });
  writeJson(path.join(root, '.codex-plugin', 'plugin.json'), { name: 'citadel', version });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'hello.js'), "console.log('citadel');\n");
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'assets', 'fixture.bin'), LARGE_BINARY_FIXTURE);
  writeJson(path.join(root, 'release-files.json'), {
    schema: 1,
    includeFiles: ['package.json', 'release-files.json'],
    includeDirectories: ['.claude-plugin/', '.codex-plugin/', 'assets/', 'scripts/', '.planning/_templates/'],
    excludeFiles: [],
    excludeDirectories: [],
    excludePrefixes: [],
    excludeSegments: [],
  });
}

function writeOwnershipManifest(root, version, options = {}) {
  const omitted = new Set(options.omit || []);
  const files = [];
  const visit = (directory, prefix = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (relative === '.citadel-release.json' || relative === '.citadel-backup.json' || relative.startsWith('.git/')) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute, relative);
      else if (entry.isFile() && !omitted.has(relative)) {
        const data = fs.readFileSync(absolute);
        files.push({ path: relative, bytes: data.length, sha256: sha256(data), mode: 0o644 });
      }
    }
  };
  visit(root);
  writeJson(path.join(root, '.citadel-release.json'), {
    schema: 1,
    version,
    ref: `v${version}`,
    commit: options.commit || '1'.repeat(40),
    createdAt: '2026-01-01T00:00:00.000Z',
    nodeRange: '>=22',
    runtimeMatrix: { operatingSystems: ['linux', 'macos', 'windows'], node: ['18', '20', '22'] },
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
    rollbackCommand: 'node scripts/update.js --rollback <backup-path> --target <installation> --apply',
  });
}

function expectFailure(fn, pattern) {
  assert.throws(fn, pattern);
}

function sectionBody(content, startPattern, endPattern, label) {
  const start = content.search(startPattern);
  assert(start >= 0, `${label} is missing its start marker`);
  const afterStart = content.slice(start).replace(startPattern, '');
  const end = afterStart.search(endPattern);
  assert(end >= 0, `${label} is missing its end marker`);
  const body = afterStart.slice(0, end).trim();
  assert(body, `${label} must not be empty`);
  return body;
}

function markdownHeadingAnchors(content) {
  const counts = new Map();
  const anchors = new Set();
  for (const match of content.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = match[1]
      .replace(/<[^>]+>/g, '')
      .replace(/[`*_~]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-');
    if (!base) continue;
    const seen = counts.get(base) || 0;
    anchors.add(seen === 0 ? base : `${base}-${seen}`);
    counts.set(base, seen + 1);
  }
  return anchors;
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-release-integrity-'));
try {
  assert.throws(
    () => sanitizeReleaseInstructions([
      { name: 'package.json', data: Buffer.from('{"version":"1.3.0"}') },
      {
        name: 'skills/kept/SKILL.md',
        data: Buffer.from('Preserve this required contract while using /omitted for an optional follow-up.\n'),
      },
    ], new Set(['kept', 'omitted'])),
    /Unhandled release instruction references:\s+skills\/kept\/SKILL\.md:1 \/omitted/,
    'release instruction projection must fail closed instead of deleting an unhandled mixed-purpose line',
  );

  const projectedDatedChangelog = sanitizeReleaseInstructions([
    { name: 'package.json', data: Buffer.from('{"version":"1.3.0"}') },
    {
      name: 'CHANGELOG.md',
      data: Buffer.from('## 1.3.0 - 2026-08-12\n\n### Added\n\n- Release feature.\n\n### Verification\n\n- Verified.\n\n## 1.2.0 - 2026-08-11\n\nHistorical source-only docs/SHOWCASE.md\n'),
    },
  ], new Set()).find((entry) => entry.name === 'CHANGELOG.md').data.toString('utf8');
  assert(!projectedDatedChangelog.includes('SHOWCASE.md'), 'historical source-only notes must not leak into the current slim release');
  assert(projectedDatedChangelog.includes('Verified.'), 'current verification notes must remain');
  assert(projectedDatedChangelog.startsWith('## 1.3.0\n'),
    'release projection accepts an exact ISO-dated current changelog heading');
  assert.throws(
    () => sanitizeReleaseInstructions([
      { name: 'package.json', data: Buffer.from('{"version":"1.3.0"}') },
      {
        name: 'CHANGELOG.md',
        data: Buffer.from('## 1.2.0 - 2026-08-12\n\n### Added\n\n- Wrong version.\n\n### Verification\n\n- Verified.\n'),
      },
    ], new Set()),
    /exactly one current version heading/,
    'release projection rejects a dated changelog heading for a different version',
  );

  for (const notes of [
    '### Fixed\n\n- Patch correction.\n',
    '### Added\n\n- New feature.\n\n### Fixed\n\n- Patch correction.\n',
  ]) {
    const projected = sanitizeReleaseInstructions([
      { name: 'package.json', data: Buffer.from('{"version":"1.3.7"}') },
      { name: 'CHANGELOG.md', data: Buffer.from('## 1.3.7 - 2026-09-10\n\n' + notes) },
    ], new Set()).find(entry => entry.name === 'CHANGELOG.md').data.toString('utf8');
    assert(projected.includes('Patch correction.'), 'patch notes must survive without Added or Verification headings');
    assert(projected.includes('Included consumer surface'));
  }

  const source = path.join(temp, 'source');
  makeSource(source);
  fs.mkdirSync(path.join(source, '.planning', '_templates'), { recursive: true });
  fs.mkdirSync(path.join(source, '.planning', 'campaigns'), { recursive: true });
  fs.writeFileSync(path.join(source, '.planning', '_templates', 'campaign.md'), 'distributable\n');
  fs.writeFileSync(path.join(source, '.planning', 'campaigns', 'private.md'), 'operational state\n');
  execFileSync('git', ['init'], { cwd: source, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'release-test@example.invalid'], { cwd: source, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Citadel Release Test'], { cwd: source, stdio: 'pipe' });
  execFileSync('git', ['add', '.'], { cwd: source, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'release fixture'], {
    cwd: source,
    stdio: 'pipe',
    env: { ...process.env, GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' },
  });
  execFileSync('git', ['tag', '-a', 'v1.1.0', '-m', 'Citadel v1.1.0'], {
    cwd: source,
    stdio: 'pipe',
    env: { ...process.env, GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' },
  });
  const first = buildRelease({ sourceDir: source, outputDir: path.join(temp, 'one') });
  const second = buildRelease({ sourceDir: source, outputDir: path.join(temp, 'two') });
  assert.equal(first.sha256, second.sha256, 'same source must produce identical archives');
  assert.equal(fs.readFileSync(first.manifestPath, 'utf8'), fs.readFileSync(second.manifestPath, 'utf8'));
  assert.equal(
    fs.readFileSync(first.archivePath)[9],
    0xff,
    'gzip source-OS marker must be canonical across supported builders',
  );
  assert.equal(
    first.manifest.files.find((file) => file.path === 'assets/fixture.bin')?.sha256,
    sha256(LARGE_BINARY_FIXTURE),
    'release text normalization must not alter binary payloads',
  );
  assert.deepEqual(
    first.manifest.runtimeMatrix,
    { operatingSystems: ['linux', 'macos', 'windows'], node: ['22', '24'], runtimes: ['claude', 'codex'] },
    'release manifest must report the supported CI/runtime matrix',
  );
  for (const relative of [
    'package.json', 'release-files.json', '.claude-plugin/plugin.json',
    '.claude-plugin/marketplace.json', '.codex-plugin/plugin.json', 'scripts/hello.js',
  ]) {
    const file = path.join(source, ...relative.split('/'));
    const text = fs.readFileSync(file, 'utf8');
    assert(!text.includes('\r\n'), `${relative} fixture must begin with LF bytes`);
    fs.writeFileSync(file, text.replace(/\n/g, '\r\n'));
  }
  const crlfEquivalent = buildRelease({ sourceDir: source, outputDir: path.join(temp, 'crlf-equivalent') });
  assert.equal(
    crlfEquivalent.sha256,
    first.sha256,
    'semantically identical LF and CRLF worktrees must produce identical archives',
  );
  assert(
    fs.readFileSync(crlfEquivalent.archivePath).equals(fs.readFileSync(first.archivePath)),
    'semantically identical LF and CRLF worktrees must produce byte-identical archives',
  );

  const verified = verifyRelease(first.archivePath, { version: '1.1.0', ref: first.manifest.ref });
  assert.equal(verified.version, '1.1.0');
  assert(verified.files >= 5);
  assert(first.manifest.files.some((file) => file.path === '.planning/_templates/campaign.md'));
  assert(!first.manifest.files.some((file) => file.path === '.planning/campaigns/private.md'));
  const tagged = buildRelease({ sourceDir: source, ref: 'v1.1.0', outputDir: path.join(temp, 'tagged') });
  assert.equal(verifyRelease(tagged.archivePath, { version: '1.1.0', ref: 'v1.1.0' }).ref, 'v1.1.0');
  const tagObject = execFileSync('git', ['rev-parse', 'v1.1.0'], { cwd: source, encoding: 'utf8' }).trim();
  const sourceCommit = execFileSync('git', ['rev-parse', 'v1.1.0^{commit}'], { cwd: source, encoding: 'utf8' }).trim();
  assert.notEqual(tagObject, sourceCommit, 'fixture must use an annotated tag');
  assert.equal(tagged.manifest.commit, sourceCommit, 'release manifest must identify the peeled source commit');
  execFileSync('git', ['branch', 'v1.1.0'], { cwd: source, stdio: 'pipe' });
  expectFailure(() => buildRelease({ sourceDir: source, ref: 'refs/heads/v1.1.0', outputDir: path.join(temp, 'bad-ref') }), /does not match manifest version/);
  execFileSync('git', ['tag', 'vnext'], { cwd: source, stdio: 'pipe' });
  expectFailure(() => buildRelease({ sourceDir: source, ref: 'vnext', outputDir: path.join(temp, 'bad-label') }), /does not match manifest version/);
  execFileSync('git', ['tag', 'v9.9.9'], { cwd: source, stdio: 'pipe' });
  expectFailure(() => buildRelease({ sourceDir: source, ref: 'v9.9.9', outputDir: path.join(temp, 'bad-tag') }), /does not match manifest version/);
  expectFailure(() => verifyRelease(first.archivePath, { version: '9.9.9' }), /Expected version/);
  expectFailure(() => verifyRelease(first.archivePath, { ref: 'v9.9.9' }), /Expected ref/);

  const originalChecksum = fs.readFileSync(first.checksumPath);
  fs.writeFileSync(first.checksumPath, `${'0'.repeat(64)}  ${path.basename(first.archivePath)}\n`);
  expectFailure(() => verifyRelease(first.archivePath), /sidecar mismatch/);
  fs.writeFileSync(first.checksumPath, originalChecksum);

  const originalArchive = fs.readFileSync(first.archivePath);
  const corrupted = Buffer.from(originalArchive);
  corrupted[Math.floor(corrupted.length / 2)] ^= 0xff;
  fs.writeFileSync(first.archivePath, corrupted);
  const corruptHash = sha256(corrupted);
  fs.writeFileSync(first.checksumPath, `${corruptHash}  ${path.basename(first.archivePath)}\n`);
  const external = JSON.parse(fs.readFileSync(first.manifestPath, 'utf8'));
  external.artifact.sha256 = corruptHash;
  external.artifact.bytes = corrupted.length;
  fs.writeFileSync(first.manifestPath, `${JSON.stringify(external, null, 2)}\n`);
  expectFailure(() => verifyRelease(first.archivePath), /Invalid gzip|tar header|checksum mismatch|Truncated/);

  const updateRelease = buildRelease({ sourceDir: source, outputDir: path.join(temp, 'update-release') });
  const target = path.join(temp, 'installed-citadel');
  makeSource(target, '1.0.0');
  fs.writeFileSync(path.join(target, 'old-only.txt'), 'old\n');
  writeOwnershipManifest(target, '1.0.0');
  fs.writeFileSync(path.join(target, '.env'), 'CITADEL_USER_SECRET=preserve\n');
  fs.writeFileSync(path.join(target, 'operator-notes.txt'), 'user-owned notes\n');
  const updateScript = path.resolve(__dirname, 'update.js');
  const plan = JSON.parse(execFileSync(process.execPath, [updateScript, '--archive', updateRelease.archivePath, '--target', target], { encoding: 'utf8' }));
  assert.equal(plan.applied, false);
  assert.equal(readVersion(target), '1.0.0');
  assert(fs.existsSync(path.join(target, 'old-only.txt')), 'plan-only update must not mutate target');

  const applied = JSON.parse(execFileSync(process.execPath, [updateScript, '--archive', updateRelease.archivePath, '--target', target, '--apply'], { encoding: 'utf8' }));
  assert.equal(applied.applied, true);
  assert.equal(readVersion(target), '1.1.0');
  assert(!fs.existsSync(path.join(target, 'old-only.txt')), 'apply should replace stale release files');
  assert.equal(fs.readFileSync(path.join(target, '.env'), 'utf8'), 'CITADEL_USER_SECRET=preserve\n');
  assert.equal(fs.readFileSync(path.join(target, 'operator-notes.txt'), 'utf8'), 'user-owned notes\n');
  assert(fs.existsSync(path.join(target, '.citadel-release.json')), 'update must retain embedded ownership metadata');
  assert(fs.existsSync(applied.backupPath));
  assert(fs.existsSync(path.join(applied.backupPath, '.citadel-backup.json')), 'backup must carry a bound integrity receipt');

  const conflictTarget = path.join(temp, 'conflict-citadel');
  makeSource(conflictTarget, '1.0.0');
  writeOwnershipManifest(conflictTarget, '1.0.0', { omit: ['scripts/hello.js'] });
  fs.writeFileSync(path.join(conflictTarget, 'scripts', 'hello.js'), 'user-owned conflict\n');
  expectFailure(() => execFileSync(process.execPath, [
    updateScript, '--archive', updateRelease.archivePath, '--target', conflictTarget, '--apply',
  ], { encoding: 'utf8', stdio: 'pipe' }), /unowned path conflict/i);
  assert.equal(fs.readFileSync(path.join(conflictTarget, 'scripts', 'hello.js'), 'utf8'), 'user-owned conflict\n');

  const wrongTarget = path.join(temp, 'wrong-citadel');
  makeSource(wrongTarget, '1.1.0');
  writeOwnershipManifest(wrongTarget, '1.1.0');
  expectFailure(() => execFileSync(process.execPath, [
    updateScript, '--rollback', applied.backupPath, '--target', wrongTarget,
  ], { encoding: 'utf8', stdio: 'pipe' }), /target binding/i);

  const backupPackage = path.join(applied.backupPath, 'package.json');
  const pristineBackupPackage = fs.readFileSync(backupPackage);
  fs.appendFileSync(backupPackage, '\n');
  expectFailure(() => execFileSync(process.execPath, [
    updateScript, '--rollback', applied.backupPath, '--target', target,
  ], { encoding: 'utf8', stdio: 'pipe' }), /backup content digest/i);
  fs.writeFileSync(backupPackage, pristineBackupPackage);

  const rollbackPlan = JSON.parse(execFileSync(process.execPath, [updateScript, '--rollback', applied.backupPath, '--target', target], { encoding: 'utf8' }));
  assert.equal(rollbackPlan.applied, false);
  assert.equal(readVersion(target), '1.1.0');
  fs.writeFileSync(path.join(target, 'after-update-note.txt'), 'created after update\n');
  execFileSync(process.execPath, [updateScript, '--rollback', applied.backupPath, '--target', target, '--apply'], { stdio: 'pipe' });
  assert.equal(readVersion(target), '1.0.0');
  assert(fs.existsSync(path.join(target, 'old-only.txt')), 'rollback should restore prior release files');
  assert.equal(fs.readFileSync(path.join(target, '.env'), 'utf8'), 'CITADEL_USER_SECRET=preserve\n');
  assert.equal(fs.readFileSync(path.join(target, 'operator-notes.txt'), 'utf8'), 'user-owned notes\n');
  assert.equal(fs.readFileSync(path.join(target, 'after-update-note.txt'), 'utf8'), 'created after update\n');

  const product = buildRelease({ sourceDir: ROOT, outputDir: path.join(temp, 'product') });
  const productPaths = new Set(product.manifest.files.map((file) => file.path));
  for (const required of [
    'release-files.json', 'package.json', 'bin/citadel.js',
    'scripts/install.js', 'scripts/adopt.js', 'scripts/update.js', 'scripts/unharness.js',
    'core/cli/package-cli.js', 'runtimes/codex/hooks.json', 'runtimes/claude-code/runtime.js',
    'core/skills/routing.js', 'core/skills/routing-table.json', 'scripts/route-preview.js',
    'mcp-servers/codebase-memory/index.js',
    'skills/do/SKILL.md', 'hooks_src/init-project.js', 'docs/CLI.md', 'docs/RELEASES.md',
    'docs/CONSTITUTION.md', 'docs/CAMPAIGNS.md', 'docs/SETUP_REFERENCE.md',
    'docs/FLEET.md', 'docs/JUDGE_TIERING.md',
  ]) assert(productPaths.has(required), `release allowlist omitted runtime path: ${required}`);
  for (const forbidden of productPaths) {
    assert(!forbidden.startsWith('benchmarks/'), `release leaked benchmark content: ${forbidden}`);
    assert(!forbidden.startsWith('.planning/research/'), `release leaked research content: ${forbidden}`);
    assert(!forbidden.startsWith('docs/grants/'), `release leaked grant content: ${forbidden}`);
    assert(!forbidden.startsWith('packages/'), `release leaked quarantined package: ${forbidden}`);
    assert(!forbidden.startsWith('packs/'), `release leaked experimental pack: ${forbidden}`);
    assert(!forbidden.startsWith('workflows/'), `release leaked internal workflow: ${forbidden}`);
    assert(!forbidden.startsWith('scripts/test-'), `release leaked test program: ${forbidden}`);
    assert(!forbidden.includes('/__benchmarks__/'), `release leaked skill benchmark: ${forbidden}`);
    assert(!forbidden.split('/').includes('fixtures'), `release leaked fixture content: ${forbidden}`);
  }
  for (const forbidden of [
    'assets/social-preview.png', 'docs/index.html', 'hooks_src/smoke-test.js',
    'agents/knowledge-extractor.md', 'mcp-servers/codebase-memory/README.md',
    'mcp-servers/citadel-state/README.md',
    'docs/DAEMON.md', 'docs/GOVERNED_LIFECYCLE.md', 'docs/OPERATION_CONTROL.md',
    'mcp-servers/codebase-memory/smoke-test.js', 'core/team/pilot.js',
    'core/telemetry/activation-cohort.js', 'core/telemetry/github-traffic.js',
    'scripts/check-sentient-grant-form.js', 'scripts/github-traffic-snapshot.js',
    'scripts/render-sentient-grant-packet.py', 'scripts/capture-application-media.js',
  ]) assert(!productPaths.has(forbidden), `release leaked lab or maintainer-only content: ${forbidden}`);
  for (const sourceOnlyProofPath of [
    'docs/CASE_STUDY_DEPLOY_STEWARD.md',
    'docs/EXPERIMENTS.md',
    'docs/EXTERNAL_OWNER_TRIAL.md',
    'benchmarks/citadel-proof-experiments/experiment-manifest.json',
    'scripts/experiment-contracts.js',
    'scripts/experiment-deploy-steward.js',
    'scripts/experiment-fleet-ablation.js',
    'scripts/experiment-judge-eval.js',
    'scripts/experiment-operation-recovery.js',
    'scripts/experiment-package-bloat.js',
    'scripts/experiment-safety-gates.js',
    'scripts/live-github-steward-ab-proof.js',
  ]) {
    assert(fs.existsSync(path.join(ROOT, ...sourceOnlyProofPath.split('/'))), `source checkout lost proof path ${sourceOnlyProofPath}`);
    assert(!productPaths.has(sourceOnlyProofPath), `release leaked source-only proof path ${sourceOnlyProofPath}`);
  }
  assert(![...productPaths].some((relative) => relative.startsWith('.planning/rubrics/')), 'release leaked maintainer-only rubrics');
  assert.equal(verifyRelease(product.archivePath, { version: SOURCE_VERSION, ref: product.manifest.ref }).files, productPaths.size);

  const extracted = path.join(temp, 'product-extracted');
  const archiveFiles = parseTar(zlib.gunzipSync(fs.readFileSync(product.archivePath)));
  for (const [name, data] of archiveFiles) {
    const destination = path.join(extracted, ...name.split('/'));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, data);
  }
  const productRoot = path.join(extracted, `citadel-${product.manifest.version}`);
  execFileSync(process.execPath, ['-e', "require('./runtimes/opencode/plugin/hook-runner.js')"], { cwd: productRoot, stdio: 'pipe' });
  execFileSync(process.execPath, ['-e', "import('./runtimes/opencode/plugin/index.mjs')"], { cwd: productRoot, stdio: 'pipe' });
  const healthOutput = execFileSync(process.execPath, [path.join(productRoot, 'scripts', 'health.js')], { cwd: productRoot, encoding: 'utf8' });
  assert(JSON.parse(healthOutput).timestamp, 'packaged health diagnostic must execute with packaged dependencies');
  const runbookAnchors = new Map();
  const assertRunbookReference = (relative, match) => {
    const runbook = match[1];
    assert(productPaths.has(runbook), `${relative} references omitted release runbook ${runbook}`);
    const anchor = match[2] ? match[2].slice(1) : null;
    if (!anchor) return;
    if (!runbookAnchors.has(runbook)) {
      const content = fs.readFileSync(path.join(productRoot, ...runbook.split('/')), 'utf8');
      runbookAnchors.set(runbook, markdownHeadingAnchors(content));
    }
    assert(runbookAnchors.get(runbook).has(anchor), `${relative} references missing release runbook anchor ${runbook}#${anchor}`);
  };
  for (const relative of [...productPaths].filter((item) => /\.(?:c?js|mjs|json|md|html?|svg|txt)$/i.test(item))) {
    const content = fs.readFileSync(path.join(productRoot, ...relative.split('/')), 'utf8');
    for (const match of content.matchAll(/\b(docs\/[A-Za-z0-9._/-]+\.md)(#[A-Za-z0-9_-]+)?/g)) {
      assertRunbookReference(relative, match);
    }
  }
  const productBin = path.join(productRoot, 'bin', 'citadel.js');
  const cliHelp = execFileSync(process.execPath, [productBin, '--help'], { cwd: productRoot, encoding: 'utf8' });
  const cliCommands = new Set([...cliHelp.matchAll(/^  ([a-z][a-z-]+)\s+/gm)].map((match) => match[1]));
  for (const relative of ['README.md', 'INSTALL.md', 'docs/CLI.md']) {
    const content = fs.readFileSync(path.join(productRoot, ...relative.split('/')), 'utf8');
    for (const match of content.matchAll(/\bcitadel\s+([a-z][a-z-]*)\b/g)) {
      assert(cliCommands.has(match[1]), `${relative} advertises unsupported packaged CLI command: citadel ${match[1]}`);
    }
  }
  for (const relative of [...productPaths].filter((item) => /^skills\/[^/]+\/SKILL\.md$/.test(item))) {
    const content = fs.readFileSync(path.join(productRoot, ...relative.split('/')), 'utf8');
    for (const match of content.matchAll(/\bnode\s+(?:\{[^}]+\}\/)?((?:scripts|hooks_src)\/[A-Za-z0-9._/-]+)/g)) {
      assert(productPaths.has(match[1]), `${relative} invokes omitted runtime target: ${match[1]}`);
    }
    for (const match of content.matchAll(/\bcitadel\s+([a-z][a-z-]*)\b/g)) {
      assert(cliCommands.has(match[1]), `${relative} advertises unsupported packaged CLI command: citadel ${match[1]}`);
    }
  }
  const releaseRouting = JSON.parse(fs.readFileSync(path.join(productRoot, 'core', 'skills', 'routing-table.json'), 'utf8'));
  for (const skill of releaseRouting.skills) {
    assert(productPaths.has(`skills/${skill.name}/SKILL.md`), `release routing suggests omitted skill /${skill.name}`);
  }
  const releaseDo = fs.readFileSync(path.join(productRoot, 'skills', 'do', 'SKILL.md'), 'utf8');
  for (const match of releaseDo.matchAll(/\| `\/([a-z0-9-]+)/g)) {
    assert(productPaths.has(`skills/${match[1]}/SKILL.md`), `release /do table suggests omitted skill /${match[1]}`);
  }
  for (const match of releaseDo.matchAll(/`\/([a-z][a-z0-9-]*)(?=[\s`{])/g)) {
    if (['name', 'skill'].includes(match[1])) continue;
    assert(productPaths.has(`skills/${match[1]}/SKILL.md`), `release /do routes to omitted skill /${match[1]}`);
  }

  const createAppSkill = fs.readFileSync(path.join(productRoot, 'skills', 'create-app', 'SKILL.md'), 'utf8');
  const createAppVerify = sectionBody(
    createAppSkill,
    /### Step 3: VERIFY \(All Tiers except 1\)\r?\n/,
    /### Step 4: DELIVER/,
    'release create-app Step 3 VERIFY contract',
  );
  assert.match(createAppVerify, /each PRD end condition/i, 'release create-app must preserve PRD end-condition verification');
  assert.match(createAppVerify, /PASS \/ PARTIAL \/ FAIL/, 'release create-app must preserve explicit verification outcomes');
  assert.match(createAppVerify, /visual/i, 'release create-app must preserve visual-check semantics');

  const experimentSkill = fs.readFileSync(path.join(productRoot, 'skills', 'experiment', 'SKILL.md'), 'utf8');
  const experimentTrust = sectionBody(
    experimentSkill,
    /\*\*Trust gates:\*\*\r?\n/,
    /## Quality Gates/,
    'release experiment Trust gates contract',
  );
  assert.match(experimentTrust, /novice/i, 'release experiment must preserve novice trust guidance');
  assert.match(experimentTrust, /manual review/i, 'release experiment must preserve its manual-review boundary');
  assert.match(experimentTrust, /Familiar \(5\+ sessions\)/, 'release experiment must preserve its familiar-user threshold');
  assert.match(experimentTrust, /iterates and commits autonomously/i, 'release experiment must preserve its autonomous-commit disclosure');

  for (const relative of [...productPaths].filter((item) => /^skills\/[^/]+\/SKILL\.md$/.test(item))) {
    const sourceContent = fs.readFileSync(path.join(ROOT, ...relative.split('/')), 'utf8');
    const content = fs.readFileSync(path.join(productRoot, ...relative.split('/')), 'utf8');
    for (const sourceMarker of sourceContent.matchAll(/^\*\*Trust gates:\*\*[ \t]*$/gm)) {
      assert(sourceMarker, `${relative} source trust marker could not be read`);
      const marker = /^\*\*Trust gates:\*\*[ \t]*$/m.exec(content);
      assert(marker, `${relative} omitted its Trust gates marker`);
      const tail = content.slice(marker.index + marker[0].length).replace(/^\r?\n/, '');
      const boundary = tail.search(/^#{1,6}\s/m);
      const body = (boundary >= 0 ? tail.slice(0, boundary) : tail).trim();
      assert(body, `${relative} has an empty Trust gates section`);
    }
  }

  const postmortemSkill = fs.readFileSync(path.join(productRoot, 'skills', 'postmortem', 'SKILL.md'), 'utf8');
  const postmortemHandoff = sectionBody(
    postmortemSkill,
    /### Step 4: HANDOFF\r?\n/,
    /## What \/postmortem Does NOT Do/,
    'release postmortem Step 4 HANDOFF contract',
  );
  assert.match(postmortemHandoff, /HANDOFF block/i, 'release postmortem must preserve its HANDOFF action');

  const archonSkill = fs.readFileSync(path.join(productRoot, 'skills', 'archon', 'SKILL.md'), 'utf8');
  const archonExecution = sectionBody(
    archonSkill,
    /### Step 3: EXECUTE PHASES\r?\n/,
    /### Step 4: SELF-CORRECTION/,
    'release Archon execution contract',
  );
  assert.match(archonExecution, /visual_verify/, 'release Archon must retain visual_verify execution');
  assert.match(archonExecution, /visual verifier|visual evidence/i, 'release Archon must retain executable visual-evidence semantics');
  assert.match(archonExecution, /blocked\/HUMAN_INPUT_REQUIRED/, 'release Archon must block when visual verification is unavailable');
  const archonSpotCheck = sectionBody(
    archonSkill,
    /#### Quality Spot-Check \(every phase\)\r?\n/,
    /#### Regression Guard/,
    'release Archon quality spot-check contract',
  );
  for (const pattern of [/view files/i, /visual verifier|visual evidence/i, /below bar/i]) {
    assert.match(archonSpotCheck, pattern, `release Archon spot-check lost required semantics: ${pattern}`);
  }

  const dashboardSkill = fs.readFileSync(path.join(productRoot, 'skills', 'dashboard', 'SKILL.md'), 'utf8');
  const dashboardHookPolicy = sectionBody(
    dashboardSkill,
    /\*\*Hook Problem Taxonomy:\*\*\r?\n/,
    /\*\*Health:\*\*/,
    'release dashboard hook-problem policy',
  );
  assert.match(dashboardHookPolicy, /repair action should appear only when actionable entries are\s+present/i);
  assert.match(dashboardHookPolicy, /Safety blocks remain visible/i);
  const dashboardFringe = sectionBody(
    dashboardSkill,
    /### Step 4: FRINGE CASE HANDLING\r?\n/,
    /## Contextual Gates/,
    'release dashboard fringe-case policy',
  );
  assert.match(dashboardFringe, /Only safety blocks recorded/i);
  assert.match(dashboardFringe, /Actionable hook problem recorded/i);
  assert.match(dashboardFringe, /node scripts\/dashboard\.js --json/);
  assert.match(dashboardFringe, /node hooks_src\/doc-sync\.js --project-root \./, 'release dashboard must retain its shipped doc-sync repair command');

  const setupSkill = fs.readFileSync(path.join(productRoot, 'skills', 'setup', 'SKILL.md'), 'utf8');
  const setupWalkthrough = sectionBody(
    setupSkill,
    /### Step 7: FULL TOUR WALKTHROUGH \(Full Tour only\)\r?\n/,
    /### Step 8: REFERENCE CARD/,
    'release setup walkthrough contract',
  );
  for (const pattern of [/5\. \*\*Observability\*\*/, /\/do next/, /\/dashboard/, /\/cost/]) {
    assert.match(setupWalkthrough, pattern, `release setup walkthrough lost required semantics: ${pattern}`);
  }
  const setupReferenceCard = sectionBody(
    setupSkill,
    /### Step 8: REFERENCE CARD \(all modes\)\r?\n/,
    /### Step 9: CLOSING LINE/,
    'release setup reference-card contract',
  );
  for (const pattern of [/NEXT STEPS/, /CLAUDE\.md/, /\/do --list/, /\/create-skill/]) {
    assert.match(setupReferenceCard, pattern, `release setup reference card lost required semantics: ${pattern}`);
  }

  const orientationContracts = new Map([
    ['skills/merge-review/SKILL.md', [/general code quality/i, /\/review/, /CI status/i]],
    ['skills/postmortem/SKILL.md', [/session context/i, /\/session-handoff/, /reusable patterns/i, /iterative quality/i]],
    ['skills/review/SKILL.md', [/generating tests/i, /\/test-gen/, /security audit/i, /skill file review/i]],
    ['skills/session-handoff/SKILL.md', [/reusable patterns/i, /\/postmortem/, /documentation/i]],
    ['skills/setup/SKILL.md', [/already configured/i, /adding a single skill/i, /copy SKILL\.md manually/i]],
    ['skills/test-gen/SKILL.md', [/tests already exist/i, /\/review/, /integration tests across services/i, /\/marshal/]],
    ['skills/wiki/SKILL.md', [/session learnings/i, /structured code documentation/i, /\/doc-gen/]],
  ]);
  for (const [relative, patterns] of orientationContracts) {
    const content = fs.readFileSync(path.join(productRoot, ...relative.split('/')), 'utf8');
    const orientation = /^\*\*Don't use when:\*\*.*$/m.exec(content);
    assert(orientation, `${relative} omitted its Don't use when orientation`);
    for (const pattern of patterns) assert.match(orientation[0], pattern, `${relative} orientation lost required semantics: ${pattern}`);
  }
  const housecleanSkill = fs.readFileSync(path.join(productRoot, 'skills', 'houseclean', 'SKILL.md'), 'utf8');
  assert.match(housecleanSkill, /monthly manual check/i, 'release houseclean must retain monthly-check guidance');
  const costSkill = fs.readFileSync(path.join(productRoot, 'skills', 'cost', 'SKILL.md'), 'utf8');
  assert.doesNotMatch(costSkill, /scripts\/pricing\.json/, 'release cost skill retains the stale pricing owner');
  assert.match(costSkill, /runtimes\/claude-code\/adapters\/pricing\.json/, 'release cost skill must name the shipped pricing owner');

  const setupReference = fs.readFileSync(path.join(productRoot, 'docs', 'SETUP_REFERENCE.md'), 'utf8');
  assert(!setupReference.includes('docs/index.html'), 'release setup reference must not claim the omitted site-only routing surface');
  assert.match(setupReference, /both packaged routing surfaces are in sync/i, 'release setup reference must describe the two shipped routing surfaces');
  const fleetReference = fs.readFileSync(path.join(productRoot, 'docs', 'FLEET.md'), 'utf8');
  assert.match(fleetReference, /\.planning\/telemetry\/agent-runs\.jsonl/, 'release Fleet reference must use the real telemetry path');
  assert.match(fleetReference, /Preserve staged findings for review; compilation requires a full source checkout\./, 'release Fleet reference must preserve the source-only compilation boundary');
  assert.match(fleetReference, /hooks_src\/worktree-setup\.js/, 'release Fleet reference must name the shipped readiness owner');
  for (const omittedProgram of ['scripts/worktree-readiness.js', '.citadel/scripts/parse-handoff.cjs', '.citadel/scripts/telemetry-report.cjs']) {
    assert(!fleetReference.includes(omittedProgram), `release Fleet reference retains omitted helper ${omittedProgram}`);
  }
  const campaignReference = fs.readFileSync(path.join(productRoot, 'docs', 'CAMPAIGNS.md'), 'utf8');
  assert.match(campaignReference, /\.planning\/campaigns\/completed\//, 'release campaign reference must use the real archive path');
  const releaseInstall = fs.readFileSync(path.join(productRoot, 'INSTALL.md'), 'utf8');
  assert.match(releaseInstall, /Delivery workflows require the full\s+source distribution\./, 'release install guide must bound Delivery to the full source distribution');
  assert.match(setupSkill, /slim release does not expose Delivery; those workflows require the full source distribution\./, 'release setup skill must not promise unavailable Delivery activation');
  for (const relative of [...productPaths].filter((item) => item.endsWith('.md'))) {
    const content = fs.readFileSync(path.join(productRoot, ...relative.split('/')), 'utf8');
    assert.doesNotMatch(content, /Delivery remains off|enable delivery\b/i, `${relative} promises unavailable Delivery activation`);
  }
  const sourceReadme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const releaseReadme = fs.readFileSync(path.join(productRoot, 'README.md'), 'utf8');
  assert.match(sourceReadme, /### Source-only proof program/, 'source README must retain the maintainer proof boundary');
  assert.match(sourceReadme, /docs\/EXPERIMENTS\.md/, 'source README must link the detailed proof record');
  assert.doesNotMatch(releaseReadme, /### Source-only proof program|npm run grant:verify|docs\/EXPERIMENTS\.md/, 'release README leaked source-only proof instructions');
  assert.match(releaseReadme, /v1 experiment does not support a savings claim/i, 'release README lost the bounded public evidence summary');
  const releaseBundleIds = require(path.join(productRoot, 'core', 'config', 'contract.js')).BUNDLE_IDS;
  const releaseBundleCatalog = require(path.join(productRoot, 'core', 'config', 'bundle-catalog.js')).BUNDLE_CATALOG;
  assert.deepEqual(releaseBundleIds, ['core', 'persistence', 'parallel', 'operations', 'delivery']);
  assert.deepEqual(Object.keys(releaseBundleCatalog), releaseBundleIds, 'release bundle catalog must exactly match its selectable bundle IDs');
  for (const bundle of Object.values(releaseBundleCatalog)) {
    const executableCount = bundle.owns.skills.length + bundle.owns.hooks.length;
    if (bundle.available === false) {
      assert.equal(bundle.stage, 'source-only', `unavailable release bundle ${bundle.id} must not claim stable availability`);
      assert.equal(bundle.unavailableReasonCode, 'BUNDLE_EXECUTABLES_NOT_SHIPPED');
      assert.equal(executableCount, 0, `unavailable release bundle ${bundle.id} unexpectedly owns shipped executables`);
      continue;
    }
    assert(executableCount > 0, `available release bundle ${bundle.id} must own a shipped executable`);
    for (const skill of bundle.owns.skills) {
      assert(productPaths.has(`skills/${skill}/SKILL.md`), `release bundle ${bundle.id} activates omitted skill /${skill}`);
    }
    for (const hook of bundle.owns.hooks) {
      assert(productPaths.has(`hooks_src/${hook}.js`), `release bundle ${bundle.id} activates omitted hook ${hook}`);
    }
  }
  assert.equal(releaseBundleCatalog.delivery.available, false, 'release delivery bundle must be explicitly unavailable');
  const releaseConfigScript = path.join(productRoot, 'scripts', 'citadel-config.js');
  const releaseConfigTarget = path.join(temp, 'release-config-target');
  fs.mkdirSync(releaseConfigTarget, { recursive: true });
  const unavailableDelivery = spawnSync(process.execPath, [
    releaseConfigScript, 'enable', 'delivery', '--project-root', releaseConfigTarget, '--json',
  ], { cwd: productRoot, encoding: 'utf8' });
  assert.equal(unavailableDelivery.status, 1, 'release config must reject an omitted delivery bundle');
  assert.equal(unavailableDelivery.stderr, '');
  const unavailableDeliveryPlan = JSON.parse(unavailableDelivery.stdout);
  assert.equal(unavailableDeliveryPlan.blocked, true);
  assert.equal(unavailableDeliveryPlan.candidateConfig, null);
  assert.match(unavailableDeliveryPlan.errors.join('\n'), /delivery.*unavailable in this release.*BUNDLE_EXECUTABLES_NOT_SHIPPED/i);
  for (const bundleId of releaseBundleIds.filter((id) => releaseBundleCatalog[id].available !== false)) {
    const result = spawnSync(process.execPath, [
      releaseConfigScript, 'enable', bundleId, '--project-root', releaseConfigTarget, '--json',
    ], { cwd: productRoot, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.blocked, false, `release config blocked retained bundle ${bundleId}`);
    assert(plan.candidateConfig.activation.bundles.includes(bundleId));
    assert(plan.candidateConfig.activation.bundles.every((id) => releaseBundleIds.includes(id)));
  }
  assert(!fs.existsSync(path.join(releaseConfigTarget, '.claude', 'harness.json')), 'release bundle previews must not mutate the target');

  const modelConfigTarget = path.join(temp, 'release-model-config-target');
  fs.mkdirSync(modelConfigTarget, { recursive: true });
  const configureModels = spawnSync(process.execPath, [
    releaseConfigScript,
    'configure-codex-agents',
    '--project-root', modelConfigTarget,
    '--runtime', 'codex',
    '--agent-model', 'arbiter=gpt-5.6-sol',
    '--agent-effort', 'arbiter=ultra',
    '--apply',
    '--json',
  ], { cwd: modelConfigTarget, encoding: 'utf8' });
  assert.equal(configureModels.status, 0, configureModels.stderr || configureModels.stdout);
  const modelConfigReceipt = JSON.parse(configureModels.stdout);
  const releaseAgentGenerator = path.join(productRoot, 'scripts', 'generate-agent-projections.js');
  assert.equal(
    modelConfigReceipt.nextCommand,
    `node "${fs.realpathSync(releaseAgentGenerator)}" --project-root "${modelConfigTarget}"`,
    'release config must return an executable, source-bound projection command',
  );
  const projectModels = spawnSync(process.execPath, [
    releaseAgentGenerator,
    '--project-root', modelConfigTarget,
    '--agent', 'arbiter',
  ], { cwd: modelConfigTarget, encoding: 'utf8' });
  assert.equal(projectModels.status, 0, projectModels.stderr || projectModels.stdout);
  const projectedArbiter = fs.readFileSync(
    path.join(modelConfigTarget, '.codex', 'agents', 'arbiter.toml'),
    'utf8',
  );
  assert.match(projectedArbiter, /model = "gpt-5\.6-sol"/);
  assert.match(projectedArbiter, /model_reasoning_effort = "ultra"/);

  const releaseConfig = require(path.join(productRoot, 'core', 'config', 'index.js'));
  const existingDeliveryTarget = path.join(temp, 'release-existing-delivery-target');
  const existingDeliveryConfig = releaseConfig.createDefaultConfig();
  existingDeliveryConfig.activation.bundles = ['core', 'persistence', 'operations', 'delivery'];
  writeJson(path.join(existingDeliveryTarget, '.claude', 'harness.json'), existingDeliveryConfig);
  const existingDelivery = spawnSync(process.execPath, [
    releaseConfigScript, 'show', '--project-root', existingDeliveryTarget, '--runtime', 'codex', '--json',
  ], { cwd: productRoot, encoding: 'utf8' });
  assert.equal(existingDelivery.status, 1, 'existing delivery config must fail closed until repaired');
  const existingDeliveryReceipt = JSON.parse(existingDelivery.stdout);
  assert(existingDeliveryReceipt.bundles.unavailable.some((entry) => (
    entry.id === 'delivery' && entry.reasonCode === 'BUNDLE_EXECUTABLES_NOT_SHIPPED'
  )), 'existing delivery config must explain the unavailable release executable boundary');
  const disableDelivery = JSON.parse(execFileSync(process.execPath, [
    releaseConfigScript, 'disable', 'delivery', '--project-root', existingDeliveryTarget, '--json',
  ], { cwd: productRoot, encoding: 'utf8' }));
  assert.equal(disableDelivery.blocked, false, 'existing delivery config must retain a recovery plan');
  assert(!disableDelivery.candidateConfig.activation.bundles.includes('delivery'));

  const fullRuntime = {
    id: 'release-test',
    capabilities: Object.fromEntries([
      'workspace', 'agents', 'worktrees', 'approvals', 'history', 'surfaces',
    ].map((capability) => [capability, 'full'])),
  };
  const legacyReceipt = releaseConfig.resolveConfig({ legacySetting: true }, { runtime: fullRuntime });
  assert.equal(legacyReceipt.status, 'ready', `legacy release config did not resolve: ${legacyReceipt.errors.join('; ')}`);
  assert.deepEqual(legacyReceipt.bundles.requested, ['core', 'persistence', 'parallel', 'operations']);

  const releaseMetadata = JSON.parse(fs.readFileSync(path.join(productRoot, 'citadel-metadata.json'), 'utf8'));
  const shippedSkillCount = [...productPaths].filter((relative) => /^skills\/[^/]+\/SKILL\.md$/.test(relative)).length;
  assert.equal(releaseMetadata.skills.count, shippedSkillCount, 'release metadata skill count must match the archive');
  let generatedSkillCountMarkers = 0;
  for (const relative of [...productPaths].filter((item) => /\.(?:html|json|md|svg|txt)$/i.test(item))) {
    const content = fs.readFileSync(path.join(productRoot, ...relative.split('/')), 'utf8');
    for (const match of content.matchAll(/<!-- GENERATED: skill-count -->(\d+)<!-- \/GENERATED -->/g)) {
      generatedSkillCountMarkers += 1;
      assert.equal(Number(match[1]), shippedSkillCount, `${relative} generated skill count must match the archive`);
    }
  }
  assert(generatedSkillCountMarkers >= 2, 'release must retain and project its public generated skill-count surfaces');
  for (const link of releaseMetadata.proof_links) {
    const target = String(link).split('#')[0];
    assert(productPaths.has(target), `release metadata links omitted archive path: ${link}`);
  }
  assert.deepEqual(releaseMetadata.interoperability, { remote_registry_verification: 'not-claimed' });
  const releaseCodexManifest = JSON.parse(fs.readFileSync(path.join(productRoot, '.codex-plugin', 'plugin.json'), 'utf8'));
  assert(!/\b49 skills\b|PR triage/i.test(JSON.stringify(releaseCodexManifest)), 'release Codex metadata overstates excluded surfaces');
  assert.deepEqual(releaseCodexManifest.interface?.screenshots, ['./assets/terminal-demo.svg'],
    'release Codex metadata must expose the shipped terminal demo screenshot');

  const publicMarkdown = [...productPaths].filter((relative) => (
    relative === 'README.md' || relative === 'INSTALL.md' || relative === 'CHANGELOG.md'
      || relative === 'PRIVACY.md' || relative === 'SECURITY.md' || /^docs\/[^/]+\.md$/.test(relative)
  ));
  for (const relative of publicMarkdown) {
    const absolute = path.join(productRoot, ...relative.split('/'));
    const content = fs.readFileSync(absolute, 'utf8');
    const rawTargets = [
      ...[...content.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1]),
      ...[...content.matchAll(/<(?:img|a)\b[^>]*(?:src|href)=["']([^"']+)["'][^>]*>/gi)].map((match) => match[1]),
    ];
    for (let raw of rawTargets) {
      raw = raw.trim();
      if (raw.startsWith('<')) raw = raw.slice(1, raw.indexOf('>'));
      else raw = raw.split(/\s+["']/)[0];
      if (!raw || /^(?:https?:|mailto:|#)/i.test(raw)) continue;
      const local = decodeURIComponent(raw.split('#')[0].split('?')[0]);
      if (!local) continue;
      const resolved = path.resolve(path.dirname(absolute), ...local.replace(/\\/g, '/').split('/'));
      assert(fs.existsSync(resolved), `${relative} links omitted archive-local path: ${raw}`);
    }
  }

  const ownedPathSource = String.raw`(?:^|[\s\x60"'(=])((?:\.agents|\.claude-plugin|\.codex-plugin|\.planning[\\/]_templates|agents|assets|bin|core|docs|hooks|hooks_src|mcp-servers|runtimes|scripts|skills|templates)[\\/][A-Za-z0-9_.\\/-]+\.(?:json|(?:c|m)?js|md))(?:#[A-Za-z0-9_-]+)?(?=$|[\s\x60"'),:;])`;
  const allowedGeneratedPathReferences = new Set(['hooks/README.md::hooks/hooks.json']);
  const observedGeneratedPathReferences = new Set();
  for (const relative of [...productPaths].filter((item) => item.endsWith('.md'))) {
    const content = fs.readFileSync(path.join(productRoot, ...relative.split('/')), 'utf8');
    for (const match of content.matchAll(new RegExp(ownedPathSource, 'g'))) {
      const referenced = match[1].replace(/\\/g, '/');
      const key = `${relative}::${referenced}`;
      if (allowedGeneratedPathReferences.has(key)) {
        observedGeneratedPathReferences.add(key);
        continue;
      }
      assert(productPaths.has(referenced), `${relative} references omitted release-owned path ${referenced}`);
    }
  }
  assert.deepEqual(observedGeneratedPathReferences, allowedGeneratedPathReferences, 'release path-reference allowlist drifted');

  const releasePackage = JSON.parse(fs.readFileSync(path.join(productRoot, 'package.json'), 'utf8'));
  const releaseChangelog = fs.readFileSync(path.join(productRoot, 'CHANGELOG.md'), 'utf8');
  assert(releaseChangelog.includes(`## ${releasePackage.version}`));
  assert(!releaseChangelog.includes(`## ${releasePackage.version} - Unreleased`));
  assert.equal(releasePackage.private, true);
  assert(!releasePackage.files && !releasePackage.maintainerFiles && !releasePackage.maintainerScripts);
  assert.deepEqual(Object.keys(releasePackage.scripts).sort(), [
    'citadel:install', 'claude:install', 'codex:install', 'release:verify', 'update',
  ]);
  assert.deepEqual(releasePackage.citadelRelease.lifecycleCommands, ['install', 'doctor', 'update', 'rollback', 'uninstall']);
  for (const [name, command] of Object.entries(releasePackage.scripts)) {
    const match = /^node\s+([^\s]+\.js)(?:\s|$)/.exec(command);
    assert(match, `release package script ${name} is not a single Node target`);
    assert(fs.existsSync(path.join(productRoot, ...match[1].split('/'))), `release package script ${name} targets omitted file ${match[1]}`);
  }
  for (const target of Object.values(releasePackage.bin)) {
    assert(fs.existsSync(path.join(productRoot, ...target.split('/'))), `release package bin targets omitted file ${target}`);
  }
  const releasePackageScripts = new Set(Object.keys(releasePackage.scripts));
  const sourceSkillNames = new Set(fs.readdirSync(path.join(ROOT, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name));
  const shippedSkillNames = new Set([...productPaths]
    .map((relative) => /^skills\/([^/]+)\/SKILL\.md$/.exec(relative)?.[1])
    .filter(Boolean));
  const targetProjectNpmCommands = new Map([
    ['.planning/_templates/campaign.md', new Set(['test'])],
    ['.planning/_templates/deploy/static.md', new Set(['start'])],
    ['docs/ARCHITECTURE.md', new Set(['test'])],
    ['docs/CAMPAIGNS.md', new Set(['test'])],
    ['skills/do/SKILL.md', new Set(['test', 'build', 'typecheck'])],
    ['skills/experiment/SKILL.md', new Set(['test', 'build'])],
    ['skills/map/SKILL.md', new Set(['test', 'typecheck'])],
    ['skills/refactor/SKILL.md', new Set(['typecheck'])],
    ['skills/setup/SKILL.md', new Set(['test'])],
  ]);
  const releaseInstructionMarkdown = [...productPaths].filter((item) => item.endsWith('.md'));
  for (const relative of releaseInstructionMarkdown) {
    const content = fs.readFileSync(path.join(productRoot, ...relative.split('/')), 'utf8');
    for (const line of content.split(/\r?\n/)) {
      for (const match of line.matchAll(/\/([a-z][a-z0-9-]*)\b/g)) {
        const before = match.index === 0 ? '' : line[match.index - 1];
        if (match.index !== 0 && !/[\s`"'(]/.test(before)) continue;
        if (!sourceSkillNames.has(match[1])) continue;
        assert(shippedSkillNames.has(match[1]), `${relative} references omitted release route /${match[1]}`);
      }
      for (const match of line.matchAll(/\bnode\s+(?:["']?(?:\$[A-Za-z_:]+|\{[^}]+\})[\\/])?((?:scripts|hooks_src)[\\/][A-Za-z0-9._/-]+)/g)) {
        const program = match[1].replace(/\\/g, '/');
        assert(productPaths.has(program), `${relative} invokes omitted release program ${program}`);
      }
      for (const match of line.matchAll(/\bnpm\s+(?:run\s+([A-Za-z0-9:_-]+)|test\b)/g)) {
        const script = match[1] || 'test';
        if (targetProjectNpmCommands.get(relative)?.has(script)) continue;
        assert(releasePackageScripts.has(script), `${relative} invokes omitted release package script ${script}`);
      }
      for (const match of line.matchAll(/\.citadel[\\/]scripts[\\/]([A-Za-z0-9._-]+\.(?:c?js))/g)) {
        const delegate = `scripts/${match[1]}`;
        assert(productPaths.has(delegate), `${relative} delegates to omitted packaged program ${delegate}`);
      }
      for (const match of line.matchAll(/\bcitadel\s+([a-z][a-z-]*)\b/g)) {
        assert(cliCommands.has(match[1]), `${relative} advertises unsupported packaged CLI command: citadel ${match[1]}`);
      }
    }
    if (sourceSkillNames.has('daemon') && !shippedSkillNames.has('daemon')) {
      assert(!/\bdaemon\b/i.test(content), `${relative} retains daemon instructions although /daemon is omitted`);
    }
  }

  const runtimeInstructionFiles = [
    'core/codex/native-integrations.js',
    'core/project/render-codex-guidance.js',
    'core/verification/profiles.js',
    'hooks_src/init-project.js',
    'hooks_src/intake-scanner.js',
    'hooks_src/issue-monitor.js',
    'mcp-servers/citadel-state/index.js',
    'scripts/dashboard.js',
    'scripts/next-action.js',
    'scripts/operator-console.js',
    'scripts/repository-memory.js',
    'scripts/stack-plan.js',
  ];
  const targetProjectRuntimeNpmCommands = new Map([
    ['core/verification/profiles.js', new Set(['test'])],
    ['scripts/stack-plan.js', new Set(['test'])],
  ]);
  for (const relative of runtimeInstructionFiles) {
    const content = fs.readFileSync(path.join(productRoot, ...relative.split('/')), 'utf8');
    for (const line of content.split(/\r?\n/)) {
      for (const match of line.matchAll(/\/([a-z][a-z0-9-]*)\b/g)) {
        const before = match.index === 0 ? '' : line[match.index - 1];
        if (match.index !== 0 && !/[\s`"'(]/.test(before)) continue;
        if (!sourceSkillNames.has(match[1])) continue;
        assert(shippedSkillNames.has(match[1]), `${relative} can emit omitted release route /${match[1]}`);
      }
      for (const match of line.matchAll(/\bnpm\s+(?:run\s+([A-Za-z0-9:_-]+)|test\b)/g)) {
        const script = match[1] || 'test';
        if (targetProjectRuntimeNpmCommands.get(relative)?.has(script)) continue;
        assert(releasePackageScripts.has(script), `${relative} can emit omitted release package script ${script}`);
      }
      for (const match of line.matchAll(/\bnode\s+((?:scripts|hooks_src)[\\/][A-Za-z0-9._/-]+)/g)) {
        const program = match[1].replace(/\\/g, '/');
        assert(productPaths.has(program), `${relative} can emit omitted release program ${program}`);
      }
      for (const match of line.matchAll(/\bcitadel\s+([a-z][a-z-]*)\b/g)) {
        assert(cliCommands.has(match[1]), `${relative} can emit unsupported packaged CLI command: citadel ${match[1]}`);
      }
      for (const match of line.matchAll(/\.citadel[\\/]scripts[\\/]([A-Za-z0-9._-]+\.(?:c?js))/g)) {
        const delegate = `scripts/${match[1]}`;
        assert(productPaths.has(delegate), `${relative} can emit a delegate for omitted packaged program ${delegate}`);
      }
    }
  }

  const releaseStackPlan = require(path.join(productRoot, 'scripts', 'stack-plan.js'));
  const stackRunbook = releaseStackPlan.buildPostApprovalRunbook('approval-needed', [{ pr: 'https://example.invalid/pr/1', status: 'ready' }]);
  assert.match(JSON.stringify(stackRunbook), /node scripts\/stack-plan\.js/);
  assert.doesNotMatch(JSON.stringify(stackRunbook), /npm run stack:plan/);
  const releaseOperator = require(path.join(productRoot, 'scripts', 'operator-console.js'));
  const stackBoundary = releaseOperator.boundaryForStack({ status: 'blocked' });
  assert.match(JSON.stringify(stackBoundary), /node scripts\/stack-plan\.js/);
  assert.doesNotMatch(JSON.stringify(stackBoundary), /npm run stack:plan/);
  const releaseProfiles = require(path.join(productRoot, 'core', 'verification', 'profiles.js'));
  assert.equal(releaseProfiles.profileForFiles(['src/example.js'], {}).primaryCommand, 'git diff --check');
  assert.equal(releaseProfiles.profileForFiles(['src/example.js'], { test: 'vitest' }).primaryCommand, 'npm run test');

  const mcpProbe = [
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'release-test', version: '1' } } }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    '',
  ].join('\n');
  const mcpOutput = execFileSync(process.execPath, [path.join(productRoot, 'mcp-servers', 'citadel-state', 'index.js')], {
    cwd: productRoot,
    encoding: 'utf8',
    input: mcpProbe,
  }).trim().split(/\r?\n/).map((line) => JSON.parse(line));
  const workflowTool = mcpOutput.find((response) => response.id === 2).result.tools
    .find((tool) => tool.name === 'citadel_workflow_prompt');
  assert.deepEqual(new Set(workflowTool.inputSchema.properties.workflow.enum), shippedSkillNames);
  const releaseMcp = JSON.parse(fs.readFileSync(path.join(productRoot, '.mcp.json'), 'utf8'));
  assert.deepEqual(releaseMcp.mcpServers, {},
    'release plugin-root .mcp.json must remain inert under Codex auto-discovery');
  const releaseClaudeManifest = JSON.parse(fs.readFileSync(
    path.join(productRoot, '.claude-plugin', 'plugin.json'), 'utf8',
  ));
  assert.equal(releaseClaudeManifest.mcpServers, './.claude-plugin/.mcp.json');
  const releaseClaudeMcp = JSON.parse(fs.readFileSync(
    path.resolve(productRoot, releaseClaudeManifest.mcpServers), 'utf8',
  ));
  assert.deepEqual(Object.keys(releaseClaudeMcp.mcpServers), ['citadel-state', 'codebase-memory']);
  for (const [name, server] of Object.entries(releaseClaudeMcp.mcpServers)) {
    assert.equal(server.command, 'node', `release MCP ${name} must use the packaged Node runtime target`);
    assert.equal(server.cwd, '.', `release MCP ${name} must preserve the consuming project as cwd`);
    const target = server.args?.[0]?.replace(/^\$\{CLAUDE_PLUGIN_ROOT\}\//, '');
    assert(target && fs.existsSync(path.join(productRoot, ...target.split('/'))), `release MCP ${name} targets omitted file ${target}`);
  }

  for (const relative of productPaths) {
    if (!/\.(?:c?js)$/.test(relative)) continue;
    const absolute = path.join(productRoot, ...relative.split('/'));
    const sourceText = fs.readFileSync(absolute, 'utf8');
    const executableText = sourceText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    const imports = [...executableText.matchAll(/^[ \t]*(?:[^\"'`\r\n]*=\s*|return\s+)?require\(\s*(['"])(\.[^'"]+)\1\s*\)/gm)].map((match) => match[2]);
    for (const request of imports) {
      const base = path.resolve(path.dirname(absolute), request);
      const candidates = [base, `${base}.js`, `${base}.cjs`, `${base}.json`, path.join(base, 'index.js')];
      assert(candidates.some((candidate) => fs.existsSync(candidate)), `${relative} requires omitted module ${request}`);
    }
    for (const match of executableText.matchAll(/path\.(?:join|resolve)\(\s*__dirname\s*,\s*['"]([^'"]+\.(?:c?js))['"]\s*\)/g)) {
      const sibling = path.posix.normalize(path.posix.join(path.posix.dirname(relative), match[1].replace(/\\/g, '/')));
      assert(productPaths.has(sibling), `${relative} resolves omitted executable sibling ${sibling}`);
    }
  }

  const codexManifest = JSON.parse(fs.readFileSync(path.join(productRoot, '.codex-plugin', 'plugin.json'), 'utf8'));
  assert.equal(codexManifest.mcpServers, undefined,
    'release Codex manifest must not auto-load Claude-only MCP declarations');
  const interfaceAssets = [
    codexManifest.interface?.composerIcon,
    codexManifest.interface?.logo,
    ...(codexManifest.interface?.screenshots || []),
  ].filter(Boolean);
  for (const asset of interfaceAssets) {
    const relative = asset.replace(/^\.\//, '');
    assert(fs.existsSync(path.join(productRoot, ...relative.split('/'))), `Codex plugin references omitted asset ${asset}`);
  }
  assert(!JSON.stringify(codexManifest).includes('social-preview'), 'Codex plugin must not reference excluded site media');

  const routeScript = path.join(productRoot, 'scripts', 'route-preview.js');
  const exactRoute = JSON.parse(execFileSync(process.execPath, [
    routeScript, '--json', '--', 'what should I do next',
  ], { cwd: productRoot, encoding: 'utf8' }));
  assert.equal(exactRoute.selected, '/do next');
  assert.equal(exactRoute.command, 'node scripts/operator-console.js --run');
  const semanticRoute = JSON.parse(execFileSync(process.execPath, [
    routeScript, '--json', '--', 'review auth module',
  ], { cwd: productRoot, encoding: 'utf8' }));
  assert.equal(semanticRoute.selected, null);
  assert.equal(semanticRoute.suggestedRoute, '/review');
  assert.equal(semanticRoute.boundary, 'semantic-classification-required');

  for (const command of ['install', 'update', 'rollback', 'uninstall']) {
    const help = execFileSync(process.execPath, [productBin, command, '--help'], { cwd: productRoot, encoding: 'utf8' });
    assert.match(help, /Usage:/, `release artifact ${command} help is not runnable`);
  }
  const dryRunTarget = path.join(temp, 'release-install-target');
  fs.mkdirSync(dryRunTarget, { recursive: true });
  const install = JSON.parse(execFileSync(process.execPath, [
    productBin, 'install', '--runtime', 'codex', '--project-root', dryRunTarget,
    '--plugin-only', '--dry-run', '--json',
  ], { cwd: productRoot, encoding: 'utf8' }));
  assert.equal(install.mode, 'plugin-only');
  assert(install.steps.every((step) => step.skipped), 'release artifact install dry-run must not execute steps');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log('release integrity tests passed');

function readVersion(directory) {
  return JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')).version;
}

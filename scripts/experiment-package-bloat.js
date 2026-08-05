#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE_DIR = path.join(ROOT, '.planning', 'research', 'citadel-proof-experiments');
const BASELINE_PATH = path.join(ROOT, 'benchmarks', 'citadel-proof-experiments', 'bloat-baseline.json');
const RESULT_PATH = path.join(EVIDENCE_DIR, 'package-bloat-results.json');
const MAX_ITERATIONS = 5;
const EXCLUSIONS = Object.freeze([
  Object.freeze({ pattern: '!docs/images/**', id: 'site-screenshots', kind: 'source-only-site-media' }),
  Object.freeze({ pattern: '!skills/*/__benchmarks__/**', id: 'skill-benchmarks', kind: 'source-only-dev-fixtures' }),
  Object.freeze({ pattern: '!packages/client/**', id: 'private-client-workspace', kind: 'source-only-private-workspace' }),
  Object.freeze({ pattern: '!packages/runtime-openai/**', id: 'private-openai-workspace', kind: 'source-only-private-workspace' }),
  Object.freeze({ pattern: '!packages/runtime-claude-code/**', id: 'private-claude-workspace', kind: 'source-only-private-workspace' }),
]);
const SCOPED_IGNORE_FILES = Object.freeze([
  Object.freeze({ path: 'docs/.npmignore', content: 'images/\n' }),
  Object.freeze({ path: 'skills/.npmignore', content: '*/__benchmarks__/\n' }),
  Object.freeze({ path: 'packages/.npmignore', content: 'client/\nruntime-openai/\nruntime-claude-code/\n' }),
]);
const REQUIRED_RUNTIME_PATHS = Object.freeze([
  'bin/citadel.js',
  'core/cli/package-cli.js',
  'docs/assets/application/citadel-live-verification-demo.mp4',
  'benchmarks/citadel-proof-experiments/experiment-manifest.json',
  'benchmarks/citadel-proof-experiments/bloat-baseline.json',
  'benchmarks/optimizer-proof/proof-bundle/manifest.json',
  'packages/contracts/index.js',
  'scripts/grant-verify.js',
  'scripts/experiment-operation-recovery.js',
  'scripts/test-operation-control.js',
  'scripts/test-all.js',
  'examples/operation-control/request.json',
]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(stable(value)));
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function activeExclusions(manifest) {
  return EXCLUSIONS.filter((entry) => manifest.files.includes(entry.pattern));
}

function matchesExclusion(relativePath, pattern) {
  const normalized = relativePath.replaceAll('\\', '/').replace(/^package\//, '');
  if (pattern === '!docs/images/**') return normalized.startsWith('docs/images/');
  if (pattern === '!skills/*/__benchmarks__/**') {
    return /^skills\/[^/]+\/__benchmarks__\/.+/.test(normalized);
  }
  if (pattern === '!packages/client/**') return normalized.startsWith('packages/client/');
  if (pattern === '!packages/runtime-openai/**') return normalized.startsWith('packages/runtime-openai/');
  if (pattern === '!packages/runtime-claude-code/**') return normalized.startsWith('packages/runtime-claude-code/');
  return false;
}

function validatePackageManifest(manifest, options = {}) {
  assert(Array.isArray(manifest.files), 'package.json files allowlist is required');
  for (const required of ['docs/', 'assets/', 'benchmarks/', 'packages/', 'scripts/', 'skills/']) {
    assert(manifest.files.includes(required), `runtime allowlist must retain ${required}`);
  }
  const active = activeExclusions(manifest);
  const negations = manifest.files.filter((entry) => entry.startsWith('!'));
  assert.deepStrictEqual(negations, active.map((entry) => entry.pattern), 'only approved ordered package negations are allowed');
  if (options.requireAll) {
    assert.deepStrictEqual(active.map((entry) => entry.pattern), EXCLUSIONS.map((entry) => entry.pattern), 'final runtime profile is missing an approved exclusion');
  }
  return active;
}

function validatePackagingProfile(root, manifest, options = {}) {
  const manifestExclusions = validatePackageManifest(manifest);
  const scopedExists = SCOPED_IGNORE_FILES.some((entry) => fs.existsSync(path.join(root, entry.path)));
  if (manifestExclusions.length > 0) {
    if (options.requireAll) {
      assert.deepStrictEqual(manifestExclusions.map((entry) => entry.pattern), EXCLUSIONS.map((entry) => entry.pattern), 'final runtime profile is missing an approved exclusion');
    }
    return {
      mechanism: 'package-files-negation',
      exclusions: manifestExclusions,
      ignore_files: [],
      signed_package_source_preserved: false,
    };
  }
  if (scopedExists) {
    assert(!fs.existsSync(path.join(root, '.npmignore')), 'root .npmignore is overridden by the files allowlist and must not be retained');
    for (const entry of SCOPED_IGNORE_FILES) {
      const file = path.join(root, entry.path);
      assert(fs.existsSync(file), `scoped npm ignore file missing: ${entry.path}`);
      assert.equal(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), entry.content, `scoped npm ignore changed: ${entry.path}`);
    }
    const request = readJson(path.join(root, 'benchmarks', 'public-holdout-capstone', 'selection-request.json'));
    const capstoneDigest = require('../core/operation-control/contracts').digest(
      fs.readFileSync(path.join(root, 'package.json'), 'utf8').replace(/\r\n/g, '\n'),
    );
    assert.equal(capstoneDigest, request.source_digests['package.json'], 'scoped npm ignore profile must preserve the signed package.json source digest');
    return {
      mechanism: 'scoped-npmignore',
      exclusions: [...EXCLUSIONS],
      ignore_files: SCOPED_IGNORE_FILES.map((entry) => entry.path),
      signed_package_source_preserved: true,
      signed_package_source_digest: capstoneDigest,
    };
  }
  assert(!options.requireAll, 'final runtime profile has no approved exclusions');
  return {
    mechanism: 'none',
    exclusions: [],
    ignore_files: [],
    signed_package_source_preserved: true,
  };
}

function collectFiles(root, predicate = () => true) {
  const files = [];
  function visit(directory) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) {
        const relative = path.relative(root, absolute).replaceAll('\\', '/');
        if (predicate(relative)) files.push(relative);
      }
    }
  }
  visit(root);
  return files.sort();
}

function inventoryForExclusions(root, exclusions) {
  const allFiles = collectFiles(root);
  const groups = exclusions.map((exclusion) => {
    const files = allFiles.filter((relative) => matchesExclusion(relative, exclusion.pattern));
    assert(files.length > 0, `${exclusion.pattern} did not match any source files`);
    const records = files.map((relative) => {
      const bytes = fs.readFileSync(path.join(root, relative));
      return { path: relative, bytes: bytes.length, sha256: digest(bytes) };
    });
    return {
      id: exclusion.id,
      kind: exclusion.kind,
      pattern: exclusion.pattern,
      file_count: records.length,
      bytes: records.reduce((sum, entry) => sum + entry.bytes, 0),
      manifest_sha256: digest(records),
      records,
    };
  });
  const unique = new Map();
  for (const group of groups) {
    for (const record of group.records) unique.set(record.path, record);
  }
  const records = [...unique.values()].sort((left, right) => left.path.localeCompare(right.path));
  return {
    file_count: records.length,
    bytes: records.reduce((sum, entry) => sum + entry.bytes, 0),
    manifest_sha256: digest(records),
    groups: groups.map(({ records: omitted, ...group }) => group),
  };
}

function npmInvocation(args, options) {
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (fs.existsSync(npmCli)) return [process.execPath, [npmCli, ...args]];
  return [process.platform === 'win32' ? 'npm.cmd' : 'npm', args];
}

function tail(value, lines = 4) {
  return String(value || '').trim().split(/\r?\n/).slice(-lines).join(' | ');
}

function runChecked(command, args, options = {}) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    env: options.env || process.env,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeout || 600000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const report = {
    status: result.status,
    duration_ms: Date.now() - started,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error ? result.error.message : null,
  };
  if (result.error || result.status !== 0) {
    const rendered = `${command} ${args.join(' ')}`;
    throw new Error(`${rendered} failed (${result.status}): ${report.error || tail(report.stderr) || tail(report.stdout)}`);
  }
  return report;
}

function disposableRoot() {
  const preferredBase = process.env.CITADEL_PACKAGE_TMP
    ? path.resolve(process.env.CITADEL_PACKAGE_TMP)
    : (process.platform === 'win32' ? path.join(ROOT, '.package-bloat-tmp') : os.tmpdir());
  const fallbackBase = os.tmpdir();
  for (const base of [preferredBase, fallbackBase]) {
    try {
      fs.mkdirSync(base, { recursive: true });
      return fs.mkdtempSync(path.join(base, 'citadel-package-bloat-'));
    } catch (error) {
      if (base === fallbackBase) {
        throw error;
      }
    }
  }
  throw new Error('package bloat scratch root unavailable');
}

function packProfile(root, scratchRoot, npmEnvironment) {
  const destination = path.join(scratchRoot, 'pack');
  fs.mkdirSync(destination, { recursive: true });
  const [command, args] = npmInvocation(['pack', '--json', '--pack-destination', destination]);
  const run = runChecked(command, args, { cwd: root, env: npmEnvironment });
  const parsed = JSON.parse(run.stdout);
  assert(Array.isArray(parsed) && parsed.length === 1, 'npm pack must produce exactly one artifact');
  const info = parsed[0];
  const archivePath = path.join(destination, info.filename);
  const archiveBytes = fs.readFileSync(archivePath);
  const files = [...info.files]
    .map((entry) => ({ path: entry.path.replaceAll('\\', '/'), size: entry.size, mode: entry.mode }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return {
    archivePath,
    run,
    runtime: {
      filename: info.filename,
      packed_bytes: info.size,
      unpacked_bytes: info.unpackedSize,
      file_count: info.entryCount,
      sha256: digest(archiveBytes),
      sha512_integrity: info.integrity,
      npm_shasum: info.shasum,
      file_manifest_sha256: digest(files),
      files,
    },
  };
}

function verifyPackedFilePolicy(runtime, exclusions) {
  const names = new Set(runtime.files.map((entry) => entry.path));
  for (const required of REQUIRED_RUNTIME_PATHS) {
    assert(names.has(required), `runtime package lost required file: ${required}`);
  }
  for (const exclusion of exclusions) {
    const leaked = runtime.files.find((entry) => matchesExclusion(entry.path, exclusion.pattern));
    assert(!leaked, `npm files negation did not exclude ${leaked ? leaked.path : exclusion.pattern}`);
  }
  const leakedIgnore = runtime.files.find((entry) => entry.path === '.npmignore' || entry.path.endsWith('/.npmignore'));
  assert(!leakedIgnore, `npm package leaked ignore control file: ${leakedIgnore ? leakedIgnore.path : '.npmignore'}`);
  return true;
}

function installAndSmoke(root, scratchRoot, archivePath, npmEnvironment) {
  const installedRoot = path.join(scratchRoot, 'installed');
  const [command, args] = npmInvocation([
    'install', '--ignore-scripts', '--no-audit', '--no-fund', '--offline',
    '--prefix', installedRoot, archivePath,
  ]);
  const install = runChecked(command, args, {
    cwd: scratchRoot,
    env: npmEnvironment,
    timeout: 180000,
  });
  const packageRoot = path.join(installedRoot, 'node_modules', 'citadel');
  const smoke = runChecked(process.execPath, [
    path.join(root, 'scripts', 'test-cli-package.js'),
    '--installed-package-root', packageRoot, scratchRoot,
  ], { cwd: root, env: npmEnvironment, timeout: 180000 });
  return {
    install_duration_ms: install.duration_ms,
    smoke_duration_ms: smoke.duration_ms,
    smoke_output_sha256: digest(Buffer.from(smoke.stdout)),
    smoke: JSON.parse(smoke.stdout.trim()),
  };
}

function replayEvidence(root, npmEnvironment) {
  const [command, args] = npmInvocation(['run', 'grant:verify']);
  const run = runChecked(command, args, { cwd: root, env: npmEnvironment, timeout: 600000 });
  return {
    command: 'npm run grant:verify',
    mode: 'source-offline',
    status: 'passed',
    duration_ms: run.duration_ms,
    stdout_sha256: digest(Buffer.from(run.stdout)),
    output_tail: tail(run.stdout, 2),
  };
}

function currentHead(root) {
  const run = runChecked('git', ['rev-parse', 'HEAD'], { cwd: root, timeout: 30000 });
  return run.stdout.trim();
}

function measureProfile(options = {}) {
  const root = options.root || ROOT;
  const manifestPath = path.join(root, 'package.json');
  const manifest = readJson(manifestPath);
  const packagingProfile = validatePackagingProfile(root, manifest, { requireAll: Boolean(options.requireAll) });
  const exclusions = packagingProfile.exclusions;
  const sourceProfile = inventoryForExclusions(root, exclusions);
  const scratchRoot = options.scratchRoot || disposableRoot();
  const removeScratch = !options.scratchRoot;
  const cacheRoot = path.join(scratchRoot, 'npm-cache');
  const npmEnvironment = {
    ...process.env,
    npm_config_cache: cacheRoot,
    npm_config_offline: 'true',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    NO_UPDATE_NOTIFIER: '1',
  };
  try {
    const packed = packProfile(root, scratchRoot, npmEnvironment);
    verifyPackedFilePolicy(packed.runtime, exclusions);
    const installed = installAndSmoke(root, scratchRoot, packed.archivePath, npmEnvironment);
    const evidence = options.skipEvidenceReplay
      ? {
        command: 'npm run grant:verify',
        mode: 'source-offline',
        status: 'deferred-to-final-profile',
        duration_ms: 0,
        stdout_sha256: null,
        output_tail: '',
      }
      : replayEvidence(root, npmEnvironment);
    const runtime = { ...packed.runtime };
    delete runtime.files;
    return {
      measured_at: new Date().toISOString(),
      source_head: currentHead(root),
      package_json_sha256: digest(fs.readFileSync(manifestPath)),
      exclusions: exclusions.map((entry) => entry.pattern),
      packaging_profile: packagingProfile,
      runtime,
      source_only: sourceProfile,
      accounting: {
        observed_published_artifacts: ['npm-runtime-tarball'],
        observed_total_published_bytes: runtime.packed_bytes,
        total_accounted_unpacked_bytes: runtime.unpacked_bytes + sourceProfile.bytes,
        cross_profile_packed_total: null,
        boundary: 'The npm tarball is the only artifact packed by this local experiment. Source-only files remain hash-accounted in GitHub/source, but no GitHub archive is produced; packed runtime bytes are not added to raw source bytes.',
      },
      guardrails: {
        npm_files_negations_effective: true,
        protected_runtime_files_present: true,
        installed_runtime_smoke: installed.smoke.status === 'passed',
        installed_runtime_surfaces: installed.smoke.surfaces,
        installed_control_plane_checks: installed.smoke.controlPlaneChecks,
        offline_evidence_replay: evidence.status === 'passed' ? true : 'deferred-to-final-profile',
        source_repository_preserved: sourceProfile.file_count > 0,
      },
      timings_ms: {
        npm_pack: packed.run.duration_ms,
        npm_install: installed.install_duration_ms,
        installed_smoke: installed.smoke_duration_ms,
        evidence_replay: evidence.duration_ms,
      },
      evidence_replay: evidence,
    };
  } finally {
    if (removeScratch) fs.rmSync(scratchRoot, { recursive: true, force: true });
  }
}

function guardrailsPass(measurement, options = {}) {
  return Object.entries(measurement.guardrails)
    .filter(([key]) => !['installed_runtime_surfaces', 'installed_control_plane_checks'].includes(key))
    .every(([key, value]) => value === true || (
      options.allowDeferredEvidence
      && key === 'offline_evidence_replay'
      && value === 'deferred-to-final-profile'
    ));
}

function appendMeasurement(journalPath, label, measurement) {
  const baseline = readJson(BASELINE_PATH);
  const journal = fs.existsSync(journalPath)
    ? readJson(journalPath)
    : { schema: 1, kind: 'citadel_package_bloat_iteration_journal', iterations: [] };
  assert(journal.iterations.length < MAX_ITERATIONS, `iteration budget of ${MAX_ITERATIONS} exhausted`);
  const priorKept = [...journal.iterations].reverse().find((entry) => entry.verdict === 'KEEP');
  const priorBytes = priorKept ? priorKept.measurement.runtime.packed_bytes : baseline.npm_pack.packed_bytes;
  const improved = measurement.runtime.packed_bytes < priorBytes;
  const passed = guardrailsPass(measurement, { allowDeferredEvidence: true });
  const iteration = {
    iteration: journal.iterations.length + 1,
    label,
    previous_packed_bytes: priorBytes,
    packed_bytes: measurement.runtime.packed_bytes,
    delta_bytes: measurement.runtime.packed_bytes - priorBytes,
    verdict: improved && passed ? 'KEEP' : 'DISCARD',
    reason: !passed ? 'guardrail-failed' : (improved ? 'metric-improved' : 'metric-not-improved'),
    measurement,
  };
  journal.iterations.push(iteration);
  writeJson(journalPath, journal);
  return iteration;
}

function compactIteration(iteration) {
  return {
    iteration: iteration.iteration,
    label: iteration.label,
    previous_packed_bytes: iteration.previous_packed_bytes,
    packed_bytes: iteration.packed_bytes,
    delta_bytes: iteration.delta_bytes,
    verdict: iteration.verdict,
    reason: iteration.reason,
    final_adjudication: iteration.final_adjudication || null,
    exclusions: iteration.measurement.exclusions,
    packaging_profile: iteration.measurement.packaging_profile || { mechanism: 'package-files-negation' },
    runtime: iteration.measurement.runtime,
    guardrails: iteration.measurement.guardrails,
  };
}

function normalizeHistory(value) {
  assert(value && Array.isArray(value.iterations), 'package bloat history must contain iterations');
  if (value.iterations.every((entry) => entry.measurement)) return value;
  assert.equal(value.kind, 'citadel_package_bloat_result', 'compact history must be a recorded package bloat result');
  return {
    schema: 1,
    kind: 'citadel_package_bloat_iteration_journal',
    iterations: value.iterations.map((entry) => ({
      ...entry,
      measurement: {
        exclusions: entry.exclusions,
        packaging_profile: entry.packaging_profile,
        runtime: entry.runtime,
        guardrails: entry.guardrails,
      },
    })),
  };
}

function adjudicateFinalHistory(journal, finalMeasurement, baseline = readJson(BASELINE_PATH)) {
  const resolved = structuredClone(journal);
  assert(resolved.iterations.length > 0 && resolved.iterations.length <= MAX_ITERATIONS, 'measured iteration history is invalid');
  for (const iteration of resolved.iterations) {
    const mechanism = iteration.measurement.packaging_profile?.mechanism || 'package-files-negation';
    if (mechanism === 'package-files-negation') {
      iteration.verdict = 'DISCARD';
      iteration.reason = 'offline-evidence-replay-failed-signed-package-source-drift';
      iteration.final_adjudication = {
        installed_runtime_smoke: true,
        offline_evidence_replay: false,
        observed_error: 'frozen capstone sources drifted',
      };
    }
  }
  const finalIndex = resolved.iterations.findLastIndex((entry) => entry.measurement.packaging_profile?.mechanism === 'scoped-npmignore');
  assert(finalIndex >= 0, 'final history is missing the scoped npm ignore candidate');
  const final = resolved.iterations[finalIndex];
  const passed = finalMeasurement.runtime.packed_bytes < baseline.npm_pack.packed_bytes
    && guardrailsPass(finalMeasurement)
    && finalMeasurement.packaging_profile.signed_package_source_preserved === true;
  final.previous_packed_bytes = baseline.npm_pack.packed_bytes;
  final.packed_bytes = finalMeasurement.runtime.packed_bytes;
  final.delta_bytes = finalMeasurement.runtime.packed_bytes - baseline.npm_pack.packed_bytes;
  final.verdict = passed ? 'KEEP' : 'DISCARD';
  final.reason = passed ? 'metric-improved-and-all-guardrails-passed' : 'final-profile-gate-failed';
  final.measurement = finalMeasurement;
  final.final_adjudication = {
    installed_runtime_smoke: finalMeasurement.guardrails.installed_runtime_smoke,
    offline_evidence_replay: finalMeasurement.guardrails.offline_evidence_replay,
    signed_package_source_preserved: finalMeasurement.packaging_profile.signed_package_source_preserved,
  };
  return resolved;
}

function buildResult(journal, options = {}) {
  const baseline = options.baseline || readJson(BASELINE_PATH);
  assert(journal.iterations.length > 0, 'at least one measured iteration is required');
  assert(journal.iterations.length <= MAX_ITERATIONS, `iteration history exceeds budget ${MAX_ITERATIONS}`);
  const kept = journal.iterations.filter((entry) => entry.verdict === 'KEEP');
  assert(kept.length > 0, 'experiment found no kept improvement');
  const final = kept[kept.length - 1].measurement;
  assert(final.runtime.packed_bytes < baseline.npm_pack.packed_bytes, 'final packed bytes did not beat frozen baseline');
  assert(guardrailsPass(final), 'final measurement failed a guardrail');
  const improvementBytes = baseline.npm_pack.packed_bytes - final.runtime.packed_bytes;
  const result = {
    schema: 1,
    kind: 'citadel_package_bloat_result',
    experiment_id: 'package-bloat',
    measured_at: final.measured_at,
    baseline: {
      source_commit: baseline.source_commit,
      runtime: {
        packed_bytes: baseline.npm_pack.packed_bytes,
        unpacked_bytes: baseline.npm_pack.unpacked_bytes,
        file_count: baseline.npm_pack.file_count,
      },
    },
    budget: { maximum_iterations: MAX_ITERATIONS, measured_iterations: journal.iterations.length },
    iterations: journal.iterations.map(compactIteration),
    final: {
      source_head: final.source_head,
      package_json_sha256: final.package_json_sha256,
      exclusions: final.exclusions,
      packaging_profile: final.packaging_profile,
      runtime: final.runtime,
      source_only: final.source_only,
      accounting: final.accounting,
      guardrails: final.guardrails,
      timings_ms: final.timings_ms,
      evidence_replay: final.evidence_replay,
    },
    improvement: {
      packed_bytes: improvementBytes,
      packed_percent: Number(((improvementBytes / baseline.npm_pack.packed_bytes) * 100).toFixed(4)),
      unpacked_bytes: baseline.npm_pack.unpacked_bytes - final.runtime.unpacked_bytes,
      files: baseline.npm_pack.file_count - final.runtime.file_count,
    },
    gates: {
      packed_bytes_below_frozen_baseline: true,
      installed_runtime_smoke: true,
      offline_evidence_replay: true,
      runtime_and_total_accounting_reported: true,
      source_repository_preserved: true,
    },
    outcome: 'passed',
    stop_reason: journal.iterations.length === MAX_ITERATIONS ? 'budget-exhausted' : 'candidate-set-exhausted',
    claim_boundary: 'Observed locally on Windows/Node with a single npm runtime tarball. Scoped npm ignore files preserve the signed package.json evidence binding. Excluded files remain in source and are hash-accounted; no second release artifact or cross-OS acquisition claim was measured.',
  };
  return { ...result, result_sha256: digest(result) };
}

function validateResult(result, options = {}) {
  assert.equal(result.schema, 1);
  assert.equal(result.kind, 'citadel_package_bloat_result');
  const unsigned = { ...result };
  delete unsigned.result_sha256;
  assert.equal(result.result_sha256, digest(unsigned), 'package bloat result hash mismatch');
  assert.equal(result.outcome, 'passed');
  assert(result.final.runtime.packed_bytes < result.baseline.runtime.packed_bytes);
  assert(result.iterations.length <= MAX_ITERATIONS);
  assert(Object.values(result.gates).every((value) => value === true));
  if (options.checkCurrent !== false) {
    const manifest = readJson(path.join(ROOT, 'package.json'));
    validatePackagingProfile(ROOT, manifest, { requireAll: true });
    assert.equal(result.final.package_json_sha256, digest(fs.readFileSync(path.join(ROOT, 'package.json'))), 'package.json changed after recorded measurement');
  }
  return result;
}

function parseOptions(argv) {
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--label') options.label = argv[++index];
    else if (arg === '--journal') options.journal = path.resolve(argv[++index]);
    else if (arg === '--history') options.history = path.resolve(argv[++index]);
    else if (arg === '--output') options.output = path.resolve(argv[++index]);
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function runCli(argv = process.argv.slice(2)) {
  const command = argv[0];
  const options = parseOptions(argv);
  if (command === 'measure') {
    assert(options.label, 'measure requires --label');
    assert(options.journal, 'measure requires --journal');
    const measurement = measureProfile({ skipEvidenceReplay: true });
    const iteration = appendMeasurement(options.journal, options.label, measurement);
    process.stdout.write(`${JSON.stringify(compactIteration(iteration), null, 2)}\n`);
    if (iteration.verdict !== 'KEEP') process.exitCode = 2;
    return iteration;
  }
  if (command === 'run') {
    assert(options.history, 'run requires --history');
    const journal = normalizeHistory(readJson(options.history));
    const finalMeasurement = measureProfile({ requireAll: true });
    const result = buildResult(adjudicateFinalHistory(journal, finalMeasurement));
    const output = options.output || RESULT_PATH;
    writeJson(output, result);
    process.stdout.write(`${JSON.stringify({ outcome: result.outcome, output, final: result.final.runtime, improvement: result.improvement }, null, 2)}\n`);
    return result;
  }
  if (command === 'metric') {
    const result = validateResult(readJson(RESULT_PATH));
    process.stdout.write(`${result.final.runtime.packed_bytes}\n`);
    return result.final.runtime.packed_bytes;
  }
  if (command === 'verify') {
    const recorded = validateResult(readJson(RESULT_PATH));
    const observed = measureProfile({ requireAll: true, skipEvidenceReplay: true });
    for (const key of ['packed_bytes', 'unpacked_bytes', 'file_count', 'sha256', 'sha512_integrity', 'npm_shasum', 'file_manifest_sha256']) {
      assert.equal(observed.runtime[key], recorded.final.runtime[key], `runtime ${key} differs from recorded result`);
    }
    assert.equal(observed.source_only.manifest_sha256, recorded.final.source_only.manifest_sha256, 'source-only manifest changed');
    assert(guardrailsPass(observed, { allowDeferredEvidence: true }), 'verification rerun failed a runtime guardrail');
    assert.equal(recorded.final.evidence_replay.status, 'passed', 'recorded final offline evidence replay did not pass');
    process.stdout.write(`${JSON.stringify({ outcome: 'verified', runtime: observed.runtime, guardrails: observed.guardrails, result_sha256: recorded.result_sha256 }, null, 2)}\n`);
    return observed;
  }
  throw new Error('Usage: node scripts/experiment-package-bloat.js <measure --label ID --journal FILE|run --history FILE [--output FILE]|metric|verify>');
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`Package bloat experiment failed: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({
  BASELINE_PATH,
  EXCLUSIONS,
  MAX_ITERATIONS,
  REQUIRED_RUNTIME_PATHS,
  RESULT_PATH,
  SCOPED_IGNORE_FILES,
  activeExclusions,
  adjudicateFinalHistory,
  appendMeasurement,
  buildResult,
  compactIteration,
  digest,
  guardrailsPass,
  inventoryForExclusions,
  matchesExclusion,
  measureProfile,
  normalizeHistory,
  stable,
  validatePackageManifest,
  validatePackagingProfile,
  validateResult,
  verifyPackedFilePolicy,
});

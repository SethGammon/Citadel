#!/usr/bin/env node
'use strict';

const path = require('path');
const crypto = require('crypto');
const {
  AdoptionError, applyPlan, createAdoptionPlan, createImportPlan,
  createLeavePlan, createRestorePlan, createRollbackPlan, createUpdatePlan,
  defaultControlRoot, doctor, loadPlan, proposeClaudeProjection,
  proposeCodexProjection,
} = require('../core/adoption');
const fs = require('fs');
const { readReceipt } = require('../core/adoption/planner');
const { snapshot } = require('../core/adoption/footprint');

function parse(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const name = token.slice(2);
    if (['json', 'allow-dirty-source', 'allow-downgrade'].includes(name)) flags[name] = true;
    else {
      if (!argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error(`Flag --${name} requires a value`);
      flags[name] = argv[++index];
    }
  }
  return { positional, flags };
}

function print(value, json, summary) {
  if (json || !summary) process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  else process.stdout.write(`${summary}\n`);
}

function lstatIfPresent(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

function resolveCanonicalPath(filePath, label) {
  const resolved = path.resolve(filePath);
  let existing = resolved;
  const missing = [];
  while (true) {
    const stat = lstatIfPresent(existing);
    if (stat) {
      let real;
      try {
        real = fs.realpathSync.native
          ? fs.realpathSync.native(existing)
          : fs.realpathSync(existing);
      } catch {
        throw new Error(`${label} contains an unresolved filesystem alias: ${existing}`);
      }
      if (missing.length && !fs.statSync(real).isDirectory()) {
        throw new Error(`${label} has a non-directory ancestor: ${existing}`);
      }
      return {
        canonicalPath: path.resolve(real, ...missing),
        existingPath: path.resolve(real),
        missing,
      };
    }
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error(`${label} cannot be resolved: ${resolved}`);
    missing.unshift(path.basename(existing));
    existing = parent;
  }
}

function canonicalPathIdentity(filePath, label) {
  return resolveCanonicalPath(filePath, label).canonicalPath;
}

function assertPlanPathIsNotLink(filePath) {
  const resolved = path.resolve(filePath);
  if (lstatIfPresent(resolved)?.isSymbolicLink()) {
    throw new Error(`Saved plan path must not be a symbolic link: ${resolved}`);
  }
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function assertDirectoryOwnsPath(directoryPath, expected) {
  const current = fs.lstatSync(directoryPath, { bigint: true });
  if (current.isSymbolicLink() || !current.isDirectory() || !sameFileIdentity(current, expected)) {
    throw new Error(`Saved plan directory changed during validation: ${directoryPath}`);
  }
  return current;
}

function resolvePublicationDirectory(requestedTarget) {
  const resolution = resolveCanonicalPath(path.dirname(requestedTarget), 'Saved plan directory');
  const anchorIdentity = fs.lstatSync(resolution.existingPath, { bigint: true });
  if (anchorIdentity.isSymbolicLink() || !anchorIdentity.isDirectory()) {
    throw new Error(`Saved plan directory is not a directory: ${resolution.existingPath}`);
  }
  return {
    anchorIdentity,
    anchorPath: resolution.existingPath,
    directory: resolution.canonicalPath,
    missing: resolution.missing,
    target: path.join(resolution.canonicalPath, path.basename(requestedTarget)),
  };
}

function createPublicationDirectories(publication, plan, createdDirectories) {
  let parentPath = publication.anchorPath;
  let parentIdentity = publication.anchorIdentity;
  assertDirectoryOwnsPath(parentPath, parentIdentity);
  for (const segment of publication.missing) {
    assertDirectoryOwnsPath(parentPath, parentIdentity);
    const directoryPath = path.join(parentPath, segment);
    try {
      fs.mkdirSync(directoryPath);
    } catch (error) {
      if (error.code === 'EEXIST') {
        throw new Error(`Saved plan directory changed before creation: ${directoryPath}`);
      }
      throw error;
    }
    const directoryIdentity = fs.lstatSync(directoryPath, { bigint: true });
    if (directoryIdentity.isSymbolicLink() || !directoryIdentity.isDirectory()) {
      throw new Error(`Saved plan directory changed during creation: ${directoryPath}`);
    }
    createdDirectories.push({ identity: directoryIdentity, path: directoryPath });
    assertDirectoryOwnsPath(parentPath, parentIdentity);
    assertExternalPlanPath(directoryPath, plan);
    assertDirectoryOwnsPath(directoryPath, directoryIdentity);
    parentPath = directoryPath;
    parentIdentity = directoryIdentity;
  }
  return parentIdentity;
}

function cleanupCreatedDirectories(createdDirectories) {
  for (const created of [...createdDirectories].reverse()) {
    try {
      const current = fs.lstatSync(created.path, { bigint: true });
      if (current.isSymbolicLink() || !current.isDirectory() || !sameFileIdentity(current, created.identity)) continue;
      fs.rmdirSync(created.path);
    } catch {
      // Cleanup is best effort and never removes a changed or non-empty directory.
    }
  }
}

function assertDescriptorOwnsPath(descriptor, filePath, expectedLinks = 1) {
  const descriptorStat = fs.fstatSync(descriptor, { bigint: true });
  if (!descriptorStat.isFile()) throw new Error('Saved plan file must be a regular file');
  if (descriptorStat.nlink !== BigInt(expectedLinks)) {
    const expected = expectedLinks === 1
      ? 'exactly one filesystem link'
      : `exactly ${expectedLinks} filesystem links during publication`;
    throw new Error(`Saved plan file must have ${expected}`);
  }
  const pathStat = fs.lstatSync(filePath, { bigint: true });
  if (pathStat.isSymbolicLink()) {
    throw new Error(`Saved plan path must not be a symbolic link: ${filePath}`);
  }
  if (!sameFileIdentity(descriptorStat, pathStat)) {
    throw new Error(`Saved plan path changed during validation: ${filePath}`);
  }
  return descriptorStat;
}

function unlinkIfSameFile(filePath, expected) {
  try {
    const current = fs.lstatSync(filePath, { bigint: true });
    if (!current.isSymbolicLink() && sameFileIdentity(current, expected)) fs.unlinkSync(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function openStagedPlan(directory) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = crypto.randomBytes(16).toString('hex');
    const stagedPath = path.join(directory, `.citadel-plan-${process.pid}-${suffix}.tmp`);
    try {
      return {
        descriptor: fs.openSync(stagedPath, 'wx', 0o600),
        stagedPath,
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw new Error(`Unable to create a fresh saved-plan staging file in ${directory}`);
}

function planPathInsideTarget(filePath, plan) {
  const targetRoot = plan?.target?.root;
  if (!targetRoot) return false;
  const canonicalTarget = canonicalPathIdentity(targetRoot, 'Adoption target');
  const canonicalPlanPath = canonicalPathIdentity(filePath, 'Saved plan path');
  const relative = path.relative(canonicalTarget, canonicalPlanPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertExternalPlanPath(filePath, plan) {
  assertPlanPathIsNotLink(filePath);
  if (planPathInsideTarget(filePath, plan)) {
    throw new Error(`Saved plan must be outside target ${plan.target.root}; use --out ../citadel-${plan.operation}.plan.json`);
  }
}

function loadExternalPlan(filePath) {
  const resolved = path.resolve(filePath);
  assertPlanPathIsNotLink(resolved);
  const noFollow = Number.isInteger(fs.constants.O_NOFOLLOW) ? fs.constants.O_NOFOLLOW : 0;
  const descriptor = fs.openSync(resolved, fs.constants.O_RDONLY | noFollow);
  try {
    assertDescriptorOwnsPath(descriptor, resolved);
    const plan = loadPlan(descriptor);
    assertDescriptorOwnsPath(descriptor, resolved);
    assertExternalPlanPath(resolved, plan);
    assertDescriptorOwnsPath(descriptor, resolved);
    return plan;
  } finally {
    fs.closeSync(descriptor);
  }
}

function publishPlanOutput(plan, outputPath, testSeam = {}) {
  const requestedTarget = path.resolve(outputPath);
  assertExternalPlanPath(requestedTarget, plan);
  const publication = resolvePublicationDirectory(requestedTarget);
  const target = publication.target;
  assertExternalPlanPath(target, plan);
  const createdDirectories = [];
  let descriptor;
  let stagedPath;
  let stagedIdentity;
  let directoryIdentity;
  let installed = false;
  let destinationConflict = false;
  let failure;
  try {
    if (testSeam.beforeMkdir) testSeam.beforeMkdir({ publicationTarget: target, requestedTarget });
    assertExternalPlanPath(requestedTarget, plan);
    assertExternalPlanPath(target, plan);
    directoryIdentity = createPublicationDirectories(publication, plan, createdDirectories);
    assertDirectoryOwnsPath(publication.directory, directoryIdentity);
    assertExternalPlanPath(target, plan);
    ({ descriptor, stagedPath } = openStagedPlan(publication.directory));
    assertDirectoryOwnsPath(publication.directory, directoryIdentity);
    stagedIdentity = fs.fstatSync(descriptor, { bigint: true });
    stagedIdentity = assertDescriptorOwnsPath(descriptor, stagedPath);
    fs.writeFileSync(descriptor, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
    assertDescriptorOwnsPath(descriptor, stagedPath);
    assertDirectoryOwnsPath(publication.directory, directoryIdentity);
    assertExternalPlanPath(target, plan);
    if (testSeam.beforeInstall) {
      testSeam.beforeInstall({ descriptor, requestedTarget, stagedPath, target });
    }
    assertDirectoryOwnsPath(publication.directory, directoryIdentity);
    assertExternalPlanPath(requestedTarget, plan);
    assertExternalPlanPath(target, plan);
    try {
      fs.linkSync(stagedPath, target);
    } catch (error) {
      if (error.code === 'EEXIST') destinationConflict = true;
      throw error;
    }
    installed = true;
    assertDescriptorOwnsPath(descriptor, target, 2);
    assertExternalPlanPath(requestedTarget, plan);
    assertDescriptorOwnsPath(descriptor, requestedTarget, 2);
    unlinkIfSameFile(stagedPath, stagedIdentity);
    if (testSeam.afterInstall) testSeam.afterInstall({ descriptor, target });
    assertDescriptorOwnsPath(descriptor, target);
    assertExternalPlanPath(target, plan);
    assertDescriptorOwnsPath(descriptor, target);
    assertExternalPlanPath(requestedTarget, plan);
    assertDescriptorOwnsPath(descriptor, requestedTarget);
    assertExternalPlanPath(requestedTarget, plan);
    assertDescriptorOwnsPath(descriptor, requestedTarget);
  } catch (error) {
    failure = error;
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch (error) { if (!failure) failure = error; }
    }
  }
  if (failure) {
    if (installed && stagedIdentity) unlinkIfSameFile(target, stagedIdentity);
    if (stagedIdentity && stagedPath) unlinkIfSameFile(stagedPath, stagedIdentity);
    cleanupCreatedDirectories(createdDirectories);
    if (destinationConflict) {
      throw new Error(`Saved plan path already exists; choose a fresh --out path: ${requestedTarget}`);
    }
    throw failure;
  }
}

function printPlan(plan, flags) {
  if (flags.out) publishPlanOutput(plan, flags.out);
  print(plan, true);
}

function usage() {
  return [
    'Usage:',
    '  node scripts/adopt.js plan [source] [--target <path>] [--project-runtime codex] [--codex-mode plugin|fallback] [--allow-dirty-source] [--out <plan.json>] [--json]',
    '  node scripts/adopt.js apply <plan.json> [--confirm <token>] [--json]',
    '  node scripts/adopt.js doctor [--target <path>] [--json]',
    '  node scripts/adopt.js update plan <source> --migration <file> [--target <path>] [--json]',
    '  node scripts/adopt.js update apply <plan.json> [--confirm <token>] [--json]',
    '  node scripts/adopt.js rollback plan [--target <path>] [--json]',
    '  node scripts/adopt.js rollback apply <plan.json> [--confirm <token>] [--json]',
    '  node scripts/adopt.js leave plan [--target <path>] [--out <plan.json>] [--json]',
    '  node scripts/adopt.js leave apply <plan.json> [--confirm <token>] [--json]',
    '  node scripts/adopt.js restore plan <archive.json> [--target <path>] [--json]',
    '  node scripts/adopt.js restore apply <plan.json> [--confirm <token>] [--json]',
    '  node scripts/adopt.js import plan [source] [--target <path>] [--json]',
    '  node scripts/adopt.js import apply <plan.json> [--confirm <token>] [--json]',
  ].join('\n');
}

function runtimeProjections(flags, target, source) {
  if (!flags['project-runtime'] || !source) return [];
  const requested = flags['project-runtime'].split(',').map((item) => item.trim());
  const projections = [];
  if (requested.includes('claude') || requested.includes('both')) {
    projections.push(proposeClaudeProjection({ target, source }));
  }
  if (requested.includes('codex') || requested.includes('both')) {
    const mode = flags['codex-mode'] || 'plugin';
    let ownedPaths = [];
    try {
      const prior = readReceipt(target, { controlRoot: path.resolve(flags['control-root'] || defaultControlRoot()) });
      ownedPaths = (prior?.footprint?.entries || [])
        .filter((entry) => entry.path === '.codex/hooks.json'
          || (entry.path.startsWith('.agents/skills/') && entry.path.endsWith('/SKILL.md')))
        .filter((entry) => {
          const current = snapshot(target, entry.path);
          return current.exists && current.digest === entry.installed_digest
            && current.bytes === entry.installed_bytes;
        })
        .map((entry) => entry.path);
    } catch { /* the plan's receipt validation reports the actual blocker */ }
    projections.push(proposeCodexProjection({ target, source, mode, ownedPaths }));
  }
  return projections;
}

function migrationFile(flags) {
  if (!flags.migration) return null;
  return JSON.parse(fs.readFileSync(path.resolve(flags.migration), 'utf8').replace(/^\uFEFF/, ''));
}

function applyOptions(flags) {
  return {
    confirm: flags.confirm,
    controlRoot: path.resolve(flags['control-root'] || defaultControlRoot()),
    failAt: flags['fail-at'],
  };
}

function main(argv) {
  const { positional, flags } = parse(argv);
  const [command, subcommand] = positional;
  const target = path.resolve(flags.target || process.cwd());
  const controlRoot = path.resolve(flags['control-root'] || defaultControlRoot());
  if (command === 'plan') {
    const source = path.resolve(subcommand || path.join(__dirname, '..'));
    const plan = createAdoptionPlan({
      source, target, runtime: flags.runtime,
      allowDirtySource: Boolean(flags['allow-dirty-source']),
      runtimeProjections: runtimeProjections(flags, target, source),
    });
    printPlan(plan, flags);
    return plan.status === 'blocked' ? 2 : 0;
  }
  if (command === 'apply') {
    if (!subcommand) throw new Error('apply requires a saved plan path');
    const result = applyPlan(loadExternalPlan(subcommand), applyOptions(flags));
    print(result, Boolean(flags.json), `Citadel adoption ${result.operation} completed (${result.operation_id})`);
    return 0;
  }
  if (command === 'doctor') {
    const result = doctor(target, { controlRoot });
    print(result, Boolean(flags.json), `Citadel adoption status: ${result.status}`);
    return result.status === 'blocked' ? 2 : 0;
  }
  if (command === 'leave' && subcommand === 'plan') {
    const plan = createLeavePlan({ target, controlRoot });
    printPlan(plan, flags);
    return plan.status === 'blocked' ? 2 : 0;
  }
  if (command === 'leave' && subcommand === 'apply') {
    const file = positional[2];
    if (!file) throw new Error('leave apply requires a saved plan path');
    const plan = loadExternalPlan(file);
    if (plan.operation !== 'leave') throw new Error('leave apply requires a leave plan');
    const result = applyPlan(plan, applyOptions(flags));
    print(result, Boolean(flags.json), `Citadel leave completed (${result.operation_id})`);
    return 0;
  }
  if (command === 'update' && subcommand === 'plan') {
    const sourceArg = positional[2];
    if (!sourceArg) throw new Error('update plan requires a source path');
    const source = path.resolve(sourceArg);
    const planOptions = {
      source, target, controlRoot, migration: migrationFile(flags),
      allowDirtySource: Boolean(flags['allow-dirty-source']),
      allowDowngrade: Boolean(flags['allow-downgrade']),
    };
    if (flags['project-runtime']) planOptions.runtimeProjections = runtimeProjections(flags, target, source);
    const plan = createUpdatePlan(planOptions);
    printPlan(plan, flags);
    return plan.status === 'blocked' ? 2 : 0;
  }
  if (command === 'rollback' && subcommand === 'plan') {
    const plan = createRollbackPlan({ target, controlRoot });
    printPlan(plan, flags);
    return plan.status === 'blocked' ? 2 : 0;
  }
  if (command === 'restore' && subcommand === 'plan') {
    if (!positional[2]) throw new Error('restore plan requires an archive path');
    const plan = createRestorePlan({ target, controlRoot, archive: path.resolve(positional[2]) });
    printPlan(plan, flags);
    return plan.status === 'blocked' ? 2 : 0;
  }
  if (command === 'import' && subcommand === 'plan') {
    const source = positional[2] ? path.resolve(positional[2]) : null;
    const plan = createImportPlan({
      target, source, controlRoot,
      allowDirtySource: Boolean(flags['allow-dirty-source']),
      runtimeProjections: runtimeProjections(flags, target, source),
    });
    printPlan(plan, flags);
    return plan.status === 'blocked' ? 2 : 0;
  }
  if (['update', 'rollback', 'restore', 'import'].includes(command) && subcommand === 'apply') {
    const file = positional[2];
    if (!file) throw new Error(`${command} apply requires a saved plan path`);
    const plan = loadExternalPlan(file);
    if (plan.operation !== command) throw new Error(`${command} apply requires a ${command} plan`);
    const result = applyPlan(plan, applyOptions(flags));
    print(result, Boolean(flags.json), `Citadel ${command} completed (${result.operation_id})`);
    return 0;
  }
  process.stderr.write(`${usage()}\n`);
  return 64;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    const payload = {
      ok: false,
      code: error instanceof AdoptionError ? error.code : 'INVALID_REQUEST',
      message: error.message,
      recovery: error.recovery || null,
    };
    if (process.argv.includes('--json')) process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
    else process.stderr.write(`Citadel adoption failed [${payload.code}]: ${payload.message}\n`);
    process.exitCode = error instanceof AdoptionError && error.code === 'CONFIRMATION_REQUIRED' ? 3 : 1;
  }
}

module.exports = { __test: { publishPlanOutput } };

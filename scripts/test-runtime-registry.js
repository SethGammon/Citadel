#!/usr/bin/env node

'use strict';

const assert = require('assert');
const path = require('path');
const { getRuntimeDefinition, listRuntimeIds } = require(path.join(__dirname, '..', 'core', 'runtime', 'registry'));
const {
  detectRuntime,
  RuntimeDetectionError,
  VALID_RUNTIMES,
} = require(path.join(__dirname, '..', 'core', 'runtime', 'detect-runtime'));
const fs = require('fs');
const inventory = require(path.join(__dirname, '..', 'core', 'runtime', 'runtime-list-inventory'));

function fail(message) {
  console.error(message);
  process.exit(1);
}

// Registering a runtime does not add it anywhere else. These two checks are what
// stop that from being discovered in production: the first holds every declared
// list to the coverage it claims, the second refuses to let a list go undeclared.
function checkDeclaredRuntimeLists(registryIds) {
  const expected = inventory.coveredRuntimes(registryIds);

  for (const entry of inventory.RUNTIME_LISTS) {
    const label = `${entry.module}#${entry.exportName}`;
    let loaded;
    try {
      loaded = require(inventory.modulePath(entry));
    } catch (error) {
      fail(`Runtime list inventory names ${label}, but the module failed to load: ${error.message}`);
    }
    const values = loaded[entry.exportName];
    if (!Array.isArray(values)) {
      fail(`Runtime list inventory names ${label}, but that export is not an array.`);
    }
    if (!entry.note) fail(`Runtime list ${label} must carry a note saying what the field means.`);

    // A list on a different axis owes an explanation, not coverage.
    if (entry.kind === 'other-axis') continue;
    if (entry.kind !== 'agent-runtime') fail(`Runtime list ${label} has an unknown kind: ${entry.kind}`);

    for (const runtimeId of expected) {
      const spelling = inventory.nameFor(runtimeId, entry.naming);
      const present = values.includes(spelling);
      const excuse = entry.exclusions[runtimeId];

      if (!present && !excuse) {
        fail(
          `Runtime "${runtimeId}" is in the registry but missing from ${label} (expected "${spelling}").\n`
          + '  Add it, or declare the omission with a reason in core/runtime/runtime-list-inventory.js.',
        );
      }
      if (present && excuse) {
        fail(
          `${label} lists "${spelling}" but the inventory still records an exclusion for it.\n`
          + '  Remove the stale exclusion so the reason cannot outlive the gap it described.',
        );
      }
      if (excuse && excuse.length < 40) {
        fail(`Exclusion of "${runtimeId}" from ${label} needs a real reason, not "${excuse}".`);
      }
    }

    // An exclusion for something the registry does not have is dead weight.
    for (const excluded of Object.keys(entry.exclusions)) {
      if (!expected.includes(excluded)) {
        fail(`${label} excludes "${excluded}", which is not a registry runtime.`);
      }
    }
  }
}

// Without this, the next hardcoded list simply escapes the check above -- which is
// exactly how the activation enum drifted in the first place.
function checkNoUndeclaredRuntimeLists() {
  const declared = new Set(
    inventory.RUNTIME_LISTS.map((entry) => `${entry.module}#${entry.exportName}`),
  );
  const pattern = /const\s+([A-Z_]*RUNTIMES)\s*=\s*(?:Object\.freeze\(\s*)?\[/g;
  const found = [];

  const walk = (dir) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) { walk(full); continue; }
      if (!item.name.endsWith('.js')) continue;
      const source = fs.readFileSync(full, 'utf8');
      pattern.lastIndex = 0;
      let match = pattern.exec(source);
      while (match) {
        const relative = path.relative(inventory.CORE_DIR, full).split(path.sep).join('/');
        found.push(`${relative}#${match[1]}`);
        match = pattern.exec(source);
      }
    }
  };
  walk(inventory.CORE_DIR);

  const undeclared = found.filter((id) => !declared.has(id));
  if (undeclared.length) {
    fail(
      `Runtime list(s) in core/ not declared in core/runtime/runtime-list-inventory.js:\n  ${undeclared.join('\n  ')}\n`
      + '  Declare each one so its registry coverage is stated rather than assumed.',
    );
  }

  const stale = [...declared].filter((id) => !found.includes(id));
  if (stale.length) {
    fail(
      `Runtime list inventory names entries that no longer exist:\n  ${stale.join('\n  ')}\n`
      + '  Drop them so the inventory keeps describing the code.',
    );
  }
}

function main() {
  const runtimeIds = listRuntimeIds();
  for (const expected of ['claude-code', 'codex', 'opencode', 'unknown']) {
    if (!runtimeIds.includes(expected)) {
      fail(`Runtime registry missing expected runtime id: ${expected}`);
    }
  }

  for (const expected of ['codex', 'opencode']) {
    if (!VALID_RUNTIMES.includes(expected)) {
      fail(`Detect-runtime valid runtime list missing ${expected}`);
    }
  }

  const claude = getRuntimeDefinition('claude-code');
  const codex = getRuntimeDefinition('codex');
  const opencode = getRuntimeDefinition('opencode');
  const unknown = getRuntimeDefinition('does-not-exist');

  if (claude.id !== 'claude-code') fail('Claude runtime definition mismatch');
  if (codex.id !== 'codex') fail('Codex runtime definition mismatch');
  if (opencode.id !== 'opencode') fail('opencode runtime definition mismatch');
  if (unknown.id !== 'unknown') fail('Unknown runtime fallback mismatch');
  if (claude.capabilities.hooks.support !== 'full') fail('Claude runtime hooks capability mismatch');
  if (codex.capabilities.hooks.support === 'full') fail('Codex runtime hooks support should not be full');

  // opencode cannot block on Stop and has no native permission gate. Claiming
  // full hook support, or dropping those degradations, would misreport the
  // runtime to every consumer of the capability contract.
  if (opencode.capabilities.hooks.support !== 'partial') {
    fail('opencode runtime hooks support must be partial');
  }
  if (opencode.capabilities.guidance.support !== 'full' || opencode.capabilities.skills.support !== 'full') {
    fail('opencode runtime must report full guidance and skills support');
  }
  for (const degradation of ['stop-cannot-block', 'permission-gate-not-native']) {
    if (!opencode.degradations.includes(degradation)) {
      fail(`opencode runtime must declare the ${degradation} degradation`);
    }
  }

  const origEnv = process.env.CITADEL_RUNTIME;
  process.env.CITADEL_RUNTIME = 'codex';
  const detected = detectRuntime('/nonexistent');
  if (detected.runtime !== 'codex' || detected.method !== 'env') {
    fail(`Runtime detection env override mismatch: ${detected.runtime}/${detected.method}`);
  }
  if (origEnv !== undefined) process.env.CITADEL_RUNTIME = origEnv;
  else delete process.env.CITADEL_RUNTIME;

  assert.throws(
    () => detectRuntime('/nonexistent', { env: { CITADEL_RUNTIME: 'invalid-value' } }),
    (error) => error instanceof RuntimeDetectionError
      && error.code === 'CITADEL_RUNTIME_INVALID'
      && error.repairCommand.includes('node .citadel/scripts/citadel-config.js reconcile --apply'),
  );

  // Exercise process probing and fallback without depending on host tooling.
  const vm = require('vm');
  const source = require('fs').readFileSync(path.join(__dirname, '..', 'core', 'runtime', 'detect-runtime.js'), 'utf8');
  // Runs detect-runtime against a sandboxed host so the assertions never depend
  // on the real process tree or filesystem. `markers` are the directory names
  // existsSync should report as present; `mtimes` drives the recency tiebreak.
  function probe({ platform, probeFails, parentCommand, markers, mtimes = {} }) {
    const calls = [];
    const exported = { exports: {} };
    vm.runInNewContext(source, {
      module: exported,
      process: { platform, ppid: 4321, env: {}, cwd: () => '/project with spaces' },
      require: (name) => {
        if (name === './registry') return { listRuntimeIds };
        if (name === 'path') return path;
        if (name === 'fs') {
          return {
            existsSync: (target) => markers.some((marker) => target.endsWith(marker)),
            statSync: (target) => {
              const marker = markers.find((item) => target.endsWith(item));
              if (!marker) throw new Error(`unexpected statSync target: ${target}`);
              return { mtimeMs: mtimes[marker] ?? 0 };
            },
          };
        }
        if (name === 'child_process') return {
          execFileSync: (file, args, options) => {
            calls.push([file, Array.from(args)]);
            assert.notEqual(options.shell, true);
            if (probeFails || file === 'wmic') throw new Error('probe unavailable');
            return parentCommand;
          },
        };
        throw new Error('Unexpected dependency: ' + name);
      },
    });
    return { result: exported.exports.detectRuntime(), calls };
  }

  function expectedCalls(platform) {
    return platform === 'win32' ? [
      ['wmic', ['process', 'where', 'ProcessId=4321', 'get', 'CommandLine', '/format:list']],
      ['tasklist', ['/FI', 'PID eq 4321', '/FO', 'CSV', '/NH']],
    ] : [['ps', ['-p', '4321', '-o', 'command=']]];
  }

  for (const platform of ['win32', 'linux']) {
    for (const probeFails of [false, true]) {
      for (const [runtimeId, marker] of [['codex', '.codex'], ['opencode', '.opencode']]) {
        const { result, calls } = probe({
          platform,
          probeFails,
          parentCommand: runtimeId,
          markers: [marker],
        });
        assert.equal(result.runtime, runtimeId);
        assert.equal(result.method, probeFails ? 'directory-marker' : 'process-tree');
        assert.deepEqual(calls, expectedCalls(platform));
      }
    }
  }

  // An opencode parent must never be read as Codex on a substring match.
  assert.equal(
    probe({ platform: 'linux', probeFails: false, parentCommand: 'bun /home/u/.opencode/bin/opencode', markers: [] })
      .result.runtime,
    'opencode',
  );

  // Multiple markers are an unsafe state. Detection must not use directory
  // timestamps or a fixed tie-breaker to guess which runtime is active.
  assert.throws(() => probe({
    platform: 'linux',
    probeFails: true,
    parentCommand: '',
    markers: ['.claude', '.opencode'],
  }), (error) => error.code === 'CITADEL_RUNTIME_AMBIGUOUS'
    && error.candidates.join(',') === 'claude-code,opencode'
    && error.repairCommand.includes('--runtime <runtime> --json'));

  // No parent signal and no markers stays honest rather than guessing.
  assert.equal(
    probe({ platform: 'linux', probeFails: true, parentCommand: '', markers: [] }).result.method,
    'default',
  );

  checkDeclaredRuntimeLists(runtimeIds);
  checkNoUndeclaredRuntimeLists();

  console.log('Runtime registry tests pass.');
}

main();

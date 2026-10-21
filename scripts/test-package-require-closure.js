#!/usr/bin/env node

'use strict';

// Closure check for the npm pack. Every script the package ships must be able to
// load the modules it requires, and every hook script that hooks/hooks-template.json
// registers must start without a missing-module failure. A source-tree test cannot
// see this: a module that exists in the repository but is absent from package.json
// "files" passes every source test and then fails only in an installed package.
//
// Static scope: literal require('<spec>') or require("<spec>") calls whose spec
// starts with ./ or ../, resolved against the packed file list with Node's rules
// (exact file, then .js, .cjs, .json, then dir/index.js). Dynamic requires (computed
// paths, require(variable)), template-literal requires and ESM import() are out of
// scope for the static part. The runtime part exercises the hook entrypoints, which
// is where computed requires would surface.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const HOOK_TIMEOUT_MS = 20000;
const RELATIVE_REQUIRE = /require\(\s*(['"])(\.\.?\/[^'"\n]*)\1\s*\)/g;
const MODULE_MISSING = /Cannot find module|MODULE_NOT_FOUND/;

// Regex hits that are not executed requires. Each entry must match exactly `count`
// unresolved hits in `file`; an entry that no longer matches, or matches more or
// fewer times than recorded, fails the test so the allowlist cannot go stale.
const NOT_A_REQUIRE_ALLOWLIST = Object.freeze([
  {
    file: 'hooks_src/external-action-gate.js',
    spec: './hooks_src/harness-health-util',
    count: 6,
    reason: 'text inside template literals: copy-paste instructions shown to the user, never executed',
  },
]);

// npm pack writes the tarball with the same invocation pattern as the MCP closure test.
function npmInvocation(args, options) {
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  return fs.existsSync(npmCli)
    ? spawnSync(process.execPath, [npmCli, ...args], options)
    : spawnSync('npm', args, options);
}

function tarString(buffer, offset, length) {
  const end = buffer.indexOf(0, offset);
  return buffer.toString('utf8', offset, end >= offset && end < offset + length ? end : offset + length);
}

function tarEntryName(header) {
  const name = tarString(header, 0, 100);
  const isUstar = header.toString('latin1', 257, 262) === 'ustar';
  const prefix = isUstar ? tarString(header, 345, 155) : '';
  return prefix ? `${prefix}/${name}` : name;
}

// A PAX extended header carries the full path for names longer than the ustar fields.
function paxPath(body) {
  let found = null;
  for (let index = 0; index < body.length;) {
    const space = body.indexOf(0x20, index);
    assert(space > index, 'invalid PAX record in npm pack archive');
    const length = Number.parseInt(body.toString('latin1', index, space), 10);
    assert(Number.isSafeInteger(length) && length > 0 && index + length <= body.length, 'invalid PAX record length');
    const record = body.toString('utf8', space + 1, index + length - 1);
    const equals = record.indexOf('=');
    if (record.slice(0, equals) === 'path') found = record.slice(equals + 1);
    index += length;
  }
  return found;
}

// Extracts an npm pack tarball, whose single root is always package/, and returns the
// set of shipped file paths relative to that root (posix separators).
function extractPackage(archivePath, destination) {
  const tar = zlib.gunzipSync(fs.readFileSync(archivePath));
  const files = new Set();
  let pendingPath = null;
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = Number.parseInt(tarString(header, 124, 12).trim() || '0', 8);
    assert(Number.isSafeInteger(size) && size >= 0, `invalid tar size at offset ${offset}`);
    const body = tar.subarray(offset + 512, offset + 512 + size);
    assert.equal(body.length, size, 'truncated tar entry in npm pack archive');
    offset += 512 + Math.ceil(size / 512) * 512;

    const typeFlag = header[156] === 0 ? '0' : String.fromCharCode(header[156]);
    if (typeFlag === 'x') { pendingPath = paxPath(body); continue; }
    if (typeFlag === 'g') continue;
    const name = (pendingPath || tarEntryName(header)).replace(/\/$/, '');
    pendingPath = null;
    const parts = name.split('/');
    assert(
      parts.every((part) => part && part !== '.' && part !== '..') && !name.includes(path.win32.sep),
      `unsafe npm pack path: ${name}`
    );
    assert.equal(parts[0], 'package', `npm pack root must be package/: ${name}`);
    if (typeFlag === '5') continue;
    assert(typeFlag === '0', `unsupported tar entry type ${typeFlag} for ${name}`);
    assert(parts.length >= 2, `npm pack contains a file at the root: ${name}`);
    const target = path.join(destination, ...parts);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
    files.add(parts.slice(1).join('/'));
  }
  assert(files.size > 0, 'npm pack archive was empty');
  return { root: path.join(destination, 'package'), files };
}

function resolveRelativeRequire(fromFile, spec, shipped) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec)).replace(/\/+$/, '');
  const candidates = [base, `${base}.js`, `${base}.cjs`, `${base}.json`, `${base}/index.js`];
  return { base, resolved: candidates.find((candidate) => shipped.has(candidate)) || null };
}

function staticProblems(packageRoot, shipped) {
  const problems = [];
  const used = new Map(NOT_A_REQUIRE_ALLOWLIST.map((entry) => [entry, []]));
  const scripts = [...shipped].filter((candidate) => /\.(c?js)$/.test(candidate)).sort();
  let checkedRequires = 0;
  for (const file of scripts) {
    const source = fs.readFileSync(path.join(packageRoot, ...file.split('/')), 'utf8');
    for (const match of source.matchAll(RELATIVE_REQUIRE)) {
      const spec = match[2];
      checkedRequires += 1;
      const { base, resolved } = resolveRelativeRequire(file, spec, shipped);
      if (resolved) continue;
      const entry = NOT_A_REQUIRE_ALLOWLIST.find((candidate) => candidate.file === file && candidate.spec === spec);
      if (entry) {
        used.get(entry).push(match.index);
        continue;
      }
      const line = source.slice(0, match.index).split('\n').length;
      problems.push(`${file}:${line} -> ${spec} (no shipped ${base} with .js, .cjs, .json or /index.js)`);
    }
  }
  for (const entry of NOT_A_REQUIRE_ALLOWLIST) {
    assert(entry.reason, `allowlist entry ${entry.file} -> ${entry.spec} needs a reason`);
    const observed = used.get(entry).length;
    if (observed !== entry.count) {
      problems.push(
        `allowlist ${entry.file} -> ${entry.spec} expects ${entry.count} unresolved hit(s) but found ${observed}; ` +
        'update the count or remove the entry'
      );
    }
  }
  assert(checkedRequires > 0, 'static closure scanned no relative requires');
  return { problems, checkedFiles: scripts.length, checkedRequires };
}

// Hook commands are read from the shipped hooks/hooks-template.json, so the runtime
// check covers exactly the entrypoints an installed package registers.
function hookScripts(packageRoot) {
  const template = JSON.parse(fs.readFileSync(path.join(packageRoot, 'hooks', 'hooks-template.json'), 'utf8'));
  const names = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'command' && typeof child === 'string') {
        for (const match of child.matchAll(/hooks_src\/([\w-]+)\.js\b/g)) names.add(match[1]);
      } else {
        visit(child);
      }
    }
  };
  visit(template);
  return [...names].sort();
}

function runtimeProblems(packageRoot, scratch, environment = process.env) {
  const problems = [];
  const names = hookScripts(packageRoot);
  assert(names.length > 0, 'hooks/hooks-template.json registers no hooks_src scripts');
  for (const name of names) {
    const script = path.join(packageRoot, 'hooks_src', `${name}.js`);
    if (!fs.existsSync(script)) {
      problems.push(`hooks/hooks-template.json registers hooks_src/${name}.js, which is not in the package`);
      continue;
    }
    // Isolate project, home and plugin data; inherited plugin data can point at live checkpoints.
    const workdir = fs.mkdtempSync(path.join(scratch, `${name}-`));
    const home = path.join(workdir, 'home');
    fs.mkdirSync(home);
    const result = spawnSync(process.execPath, [script], {
      cwd: workdir,
      input: '{}',
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: HOOK_TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...environment,
        CLAUDE_PROJECT_DIR: workdir,
        CLAUDE_PLUGIN_ROOT: packageRoot,
        CLAUDE_PLUGIN_DATA: path.join(workdir, 'plugin-data'),
        HOME: home,
        USERPROFILE: home,
      },
    });
    if (result.error || result.signal) {
      problems.push(`hooks_src/${name}.js did not finish: ${result.error?.message || result.signal}`);
    }
    // Exit codes are ignored on purpose: hooks legitimately exit 2 to block.
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    const line = output.split(/\r?\n/).find((candidate) => MODULE_MISSING.test(candidate));
    if (line) problems.push(`hooks_src/${name}.js failed to load a module: ${line.trim()}`);
  }
  return { problems, hookCount: names.length };
}

function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-package-require-'));
  try {
    const npmRoot = path.join(temp, 'npm');
    fs.mkdirSync(npmRoot, { recursive: true });
    const npmEnvironment = { ...process.env, npm_config_cache: path.join(temp, 'npm-cache') };
    const packed = npmInvocation(['pack', '--ignore-scripts', '--json', '--pack-destination', npmRoot], {
      cwd: ROOT,
      env: npmEnvironment,
      encoding: 'utf8',
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.equal(packed.status, 0, packed.stderr);
    const packInfo = JSON.parse(packed.stdout)[0];
    const { root, files } = extractPackage(path.join(npmRoot, packInfo.filename), path.join(temp, 'extracted'));

    const statics = staticProblems(root, files);
    const scratch = path.join(temp, 'hook-runs');
    fs.mkdirSync(scratch);
    // Simulate a caller with a live checkpoint outside the per-hook sandboxes.
    // pre-compact writes plugin data unconditionally, so this catches environment leaks.
    const inheritedPluginData = path.join(temp, 'inherited-plugin-data');
    fs.mkdirSync(inheritedPluginData);
    const checkpointPath = path.join(inheritedPluginData, 'compact-state.json');
    const checkpoint = JSON.stringify({ activeCampaign: 'preserve-inherited-checkpoint' });
    fs.writeFileSync(checkpointPath, checkpoint);
    const runtime = runtimeProblems(root, scratch, { ...process.env, CLAUDE_PLUGIN_DATA: inheritedPluginData });
    assert.equal(fs.readFileSync(checkpointPath, 'utf8'), checkpoint, 'hook probes overwrote inherited plugin state');
    assert.deepEqual(fs.readdirSync(inheritedPluginData), ['compact-state.json'], 'hook probes wrote to inherited plugin data');
    const problems = [...statics.problems, ...runtime.problems];
    if (problems.length > 0) {
      process.stderr.write(`Package require closure failed (${problems.length} problem(s)):\n`);
      for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(
      `Package require closure passed: ${statics.checkedFiles} shipped scripts, ` +
      `${statics.checkedRequires} relative requires resolved or allowlisted, ` +
      `${runtime.hookCount} hook entrypoints started without a missing module.\n`
    );
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main();

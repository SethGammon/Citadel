#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const { buildRelease } = require('./release-package');

const ROOT = path.resolve(__dirname, '..');
const DISTRIBUTED_SERVERS = ['citadel-state', 'codebase-memory'];
const PROTOCOL_VERSION = '2025-11-25';

// This is deliberately an end-to-end boundary test: its branches model the two
// npm launch forms, defensive tar parsing, two distribution formats, and both
// configured MCP entrypoints. Keeping those paths together prevents a manifest
// assertion from passing while an extracted artifact still fails to start.

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

function extractRelease(archivePath, destination) {
  const tar = zlib.gunzipSync(fs.readFileSync(archivePath));
  let offset = 0;
  let releaseRoot = null;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 155);
    const archivePathName = prefix ? `${prefix}/${name}` : name;
    const size = Number.parseInt(tarString(header, 124, 12).trim() || '0', 8);
    assert(Number.isSafeInteger(size) && size >= 0, `invalid tar size for ${archivePathName}`);
    const parts = archivePathName.split('/');
    assert(parts.length >= 2 && parts.every((part) => part && part !== '.' && part !== '..'), `unsafe release path: ${archivePathName}`);
    releaseRoot ||= parts[0];
    assert.equal(parts[0], releaseRoot, `release archive contains multiple roots: ${archivePathName}`);
    const relative = parts.slice(1);
    const target = path.join(destination, releaseRoot, ...relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert(releaseRoot, 'release archive was empty');
  return path.join(destination, releaseRoot);
}

function assertHandshake(artifactRoot, label) {
  for (const server of DISTRIBUTED_SERVERS) {
    const entrypoint = path.join(artifactRoot, 'mcp-servers', server, 'index.js');
    assert(fs.existsSync(entrypoint), `${label} omitted ${server} entrypoint`);
    const request = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'package-closure', version: '1' } },
    });
    const result = spawnSync(process.execPath, [entrypoint], {
      cwd: artifactRoot,
      env: { ...process.env, CITADEL_PROJECT_ROOT: artifactRoot },
      input: `${request}\n`,
      encoding: 'utf8',
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    assert.equal(result.status, 0, `${label} ${server} failed to load:\n${result.stderr}`);
    const response = JSON.parse(result.stdout.trim().split(/\r?\n/)[0]);
    assert.equal(response.id, 1, `${label} ${server} did not echo the request id`);
    assert.equal(response.result?.protocolVersion, PROTOCOL_VERSION, `${label} ${server} did not negotiate from the artifact`);
  }
}

function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-mcp-package-'));
  try {
    const npmRoot = path.join(temp, 'npm');
    fs.mkdirSync(npmRoot, { recursive: true });
    const npmEnvironment = { ...process.env, npm_config_cache: path.join(temp, 'npm-cache') };
    const packed = npmInvocation(['pack', '--json', '--ignore-scripts', '--pack-destination', npmRoot], {
      cwd: ROOT,
      env: npmEnvironment,
      encoding: 'utf8',
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.equal(packed.status, 0, packed.stderr);
    const packInfo = JSON.parse(packed.stdout)[0];
    const packedPaths = new Set(packInfo.files.map((file) => file.path.replace(/\\/g, '/')));
    assert(packedPaths.has('mcp-servers/protocol-adapter.js'), 'npm pack omitted the shared protocol adapter');
    assert(packedPaths.has('docs/MCP_PROTOCOL_SUPPORT.md'), 'npm pack omitted the MCP protocol contract');
    assert(!packedPaths.has('mcp-servers/context-compress/index.js'), 'npm pack included source-local context-compress');
    for (const server of DISTRIBUTED_SERVERS) {
      assert(packedPaths.has(`mcp-servers/${server}/index.js`), `npm pack omitted ${server}`);
    }

    const installed = path.join(temp, 'installed');
    const install = npmInvocation([
      'install', '--ignore-scripts', '--offline', '--no-audit', '--no-fund',
      '--prefix', installed, path.join(npmRoot, packInfo.filename),
    ], {
      cwd: npmRoot,
      env: npmEnvironment,
      encoding: 'utf8',
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.equal(install.status, 0, install.stderr);
    const installedPackage = path.join(installed, 'node_modules', 'citadel');
    assertHandshake(installedPackage, 'npm pack');

    const release = buildRelease({ sourceDir: ROOT, outputDir: path.join(temp, 'release') });
    const releasePaths = new Set(release.manifest.files.map((file) => file.path));
    assert(releasePaths.has('mcp-servers/protocol-adapter.js'), 'release omitted the shared protocol adapter');
    assert(releasePaths.has('docs/MCP_PROTOCOL_SUPPORT.md'), 'release omitted the MCP protocol contract');
    assert(!releasePaths.has('mcp-servers/context-compress/index.js'), 'release included source-local context-compress');
    for (const server of DISTRIBUTED_SERVERS) {
      assert(releasePaths.has(`mcp-servers/${server}/index.js`), `release omitted ${server}`);
    }
    const extractedRelease = extractRelease(release.archivePath, path.join(temp, 'extracted-release'));
    assertHandshake(extractedRelease, 'GitHub release');

    process.stdout.write('MCP package closure passed: npm and release artifacts load both distributed servers.\n');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main();

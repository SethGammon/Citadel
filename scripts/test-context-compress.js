#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(REPO_ROOT, 'mcp-servers', 'context-compress', 'index.js');

function call(id, filePath) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name: 'smart_read', arguments: { path: filePath } },
  };
}

function request(id, method, params = {}) {
  return { jsonrpc: '2.0', id, method, params };
}

function drive(requests, options = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.CITADEL_PROJECT_ROOT;
    if (options.projectRoot !== undefined) env.CITADEL_PROJECT_ROOT = options.projectRoot;

    const child = spawn(process.execPath, [SERVER], {
      cwd: options.cwd || REPO_ROOT,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const responses = new Map();
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => finish(new Error(`MCP timeout: ${stderr}`)), 15000);

    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      if (error) reject(error);
      else resolve(responses);
    }

    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const lines = stdout.split('\n');
      stdout = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const response = JSON.parse(line);
          if (response.id !== undefined) responses.set(response.id, response);
        } catch (error) {
          finish(error);
          return;
        }
      }
      if (responses.size === requests.length) finish();
    });
    child.on('error', finish);
    child.on('exit', (code) => {
      if (!settled && responses.size !== requests.length) {
        finish(new Error(`MCP exited ${code}: ${stderr}`));
      }
    });
    for (const request of requests) child.stdin.write(`${JSON.stringify(request)}\n`);
  });
}

function text(response) {
  return response?.result?.content?.[0]?.text || '';
}

function assertBlocked(response, forbiddenContent, label) {
  assert.equal(response?.result?.isError, true, `${label} should return an MCP tool error`);
  assert(!text(response).includes(forbiddenContent), `${label} leaked protected content`);
}

function tryCreateLink(target, linkPath, type) {
  try {
    fs.symlinkSync(target, linkPath, type);
    return true;
  } catch (error) {
    if (['EACCES', 'EPERM', 'UNKNOWN'].includes(error.code)) return false;
    throw error;
  }
}

async function run() {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'context-compress-security-'));
  const project = path.join(fixture, 'project');
  const outside = path.join(fixture, 'outside');
  const sibling = path.join(fixture, 'project-sibling');
  fs.mkdirSync(path.join(project, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(project, '.aws'), { recursive: true });
  fs.mkdirSync(path.join(project, '.git'), { recursive: true });
  fs.mkdirSync(path.join(project, '.ssh'), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.mkdirSync(sibling, { recursive: true });

  const validContent = 'SAFE_PROJECT_CONTENT_42';
  const outsideContent = 'OUTSIDE_SECRET_73';
  const envContent = 'DOTENV_SECRET_91';
  const credentialContent = 'CREDENTIAL_SECRET_58';
  const validRelative = path.join('docs', 'guide.txt');
  const validAbsolute = path.join(project, validRelative);
  const validDotDotName = path.join(project, '..notes.txt');
  const outsideFile = path.join(outside, 'outside-secret.txt');
  const siblingFile = path.join(sibling, 'prefix-secret.txt');
  fs.writeFileSync(validAbsolute, validContent);
  fs.writeFileSync(validDotDotName, validContent);
  fs.writeFileSync(outsideFile, outsideContent);
  fs.writeFileSync(siblingFile, outsideContent);

  const dotenvFiles = [
    path.join(project, '.env'),
    path.join(project, '.env.local'),
    path.join(project, '.ENV.production'),
    path.join(project, 'docs', '.env.example'),
  ];
  for (const file of dotenvFiles) fs.writeFileSync(file, envContent);
  const credentialFiles = [
    path.join(project, '.npmrc'),
    path.join(project, '.aws', 'credentials'),
    path.join(project, 'id_rsa'),
    path.join(project, 'signing.pem'),
    path.join(project, '.git', 'config'),
    path.join(project, '.ssh', 'custom-deploy-key'),
  ];
  for (const file of credentialFiles) fs.writeFileSync(file, credentialContent);

  try {
    const unconfigured = await drive([call(1, validRelative)]);
    assertBlocked(unconfigured.get(1), validContent, 'missing project root');
    assert(text(unconfigured.get(1)).includes('CITADEL_PROJECT_ROOT'));

    const commandCanary = path.join(fixture, 'smart-bash-command-ran.txt');
    const removedCommand = await drive([
      request(3, 'tools/list'),
      request(4, 'tools/call', {
        name: 'smart_bash',
        arguments: { command: `echo PWNED > "${commandCanary}"`, cwd: fixture },
      }),
    ], { projectRoot: project });
    assert.deepEqual(removedCommand.get(3).result.tools.map((tool) => tool.name), ['smart_read']);
    assert.equal(removedCommand.get(4).error.code, -32601, 'removed smart_bash must fail as an unknown tool');
    assert(!fs.existsSync(commandCanary), 'removed smart_bash executed a shell side effect');

    const relativeRoot = await drive([call(2, validRelative)], {
      projectRoot: 'project',
      cwd: fixture,
    });
    assertBlocked(relativeRoot.get(2), validContent, 'relative project root');
    assert(text(relativeRoot.get(2)).includes('absolute'));

    const requests = [
      call(10, validRelative),
      call(11, validAbsolute),
      call(15, '..notes.txt'),
      call(12, path.join('..', 'outside', 'outside-secret.txt')),
      call(13, outsideFile),
      call(14, siblingFile),
      ...dotenvFiles.map((file, index) => call(20 + index, path.relative(project, file))),
      ...credentialFiles.map((file, index) => call(30 + index, path.relative(project, file))),
      call(40, '.'),
    ];
    const responses = await drive(requests, { projectRoot: project, cwd: outside });

    assert(text(responses.get(10)).includes(validContent), 'relative in-project read failed');
    assert(text(responses.get(11)).includes(validContent), 'absolute in-project read failed');
    assert(text(responses.get(15)).includes(validContent), 'legitimate dot-prefixed in-project read failed');
    assertBlocked(responses.get(12), outsideContent, 'parent traversal');
    assertBlocked(responses.get(13), outsideContent, 'absolute root escape');
    assertBlocked(responses.get(14), outsideContent, 'sibling-prefix escape');
    for (let id = 20; id < 20 + dotenvFiles.length; id += 1) {
      assertBlocked(responses.get(id), envContent, `dotenv variant ${id}`);
    }
    for (let id = 30; id < 30 + credentialFiles.length; id += 1) {
      assertBlocked(responses.get(id), credentialContent, `credential variant ${id}`);
    }
    const listing = text(responses.get(40)).toLowerCase();
    assert(!listing.includes('.env'), 'directory listing exposed a dotenv name');
    assert(!listing.includes('.npmrc'), 'directory listing exposed a credential name');
    assert(!listing.includes('id_rsa'), 'directory listing exposed a private-key name');

    let linkChecks = 0;
    const junction = path.join(project, 'outside-link');
    if (tryCreateLink(outside, junction, process.platform === 'win32' ? 'junction' : 'dir')) {
      const linked = await drive([call(50, path.join('outside-link', 'outside-secret.txt'))], {
        projectRoot: project,
      });
      assertBlocked(linked.get(50), outsideContent, 'symlink or junction escape');
      linkChecks += 1;
    }

    const fileLink = path.join(project, 'outside-file-link.txt');
    if (tryCreateLink(outsideFile, fileLink, 'file')) {
      const linked = await drive([call(51, 'outside-file-link.txt')], { projectRoot: project });
      assertBlocked(linked.get(51), outsideContent, 'file symlink escape');
      linkChecks += 1;
    }

    process.stdout.write(
      `Context compress MCP security tests passed (${requests.length + 2 + linkChecks} calls; ${linkChecks} link checks).\n`,
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});

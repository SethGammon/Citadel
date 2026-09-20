#!/usr/bin/env node

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(__dirname, 'mcp-conformance-pins.json');
const DEFAULT_REPORT_PATH = path.join(ROOT, '.planning', 'verification', 'mcp-external-conformance.json');
const MODERN_REVISION = '2026-07-28';
const PROTOCOL_VERSION_META_KEY = 'io.modelcontextprotocol/protocolVersion';
const CLIENT_CAPABILITIES_META_KEY = 'io.modelcontextprotocol/clientCapabilities';
const CLIENT_INFO_META_KEY = 'io.modelcontextprotocol/clientInfo';
const SERVER_INFO_META_KEY = 'io.modelcontextprotocol/serverInfo';

// Duplicated deliberately: routine offline tests must detect an edited pin
// manifest rather than accepting whatever the manifest happens to contain.
const EXPECTED_PINS = Object.freeze([
  ['2024-11-05', '0d63bea927001bedf3be3e59be735c979ba0aacb', 'schema/schema.json', '56d9e706cc8b0daf690a483960aa4ba62217c863d36ff1d7f8bbb83ab049903d'],
  ['2025-03-26', '9236eb1cbfa02c17ab45c83a7bdbe55c450070be', 'schema/2025-03-26/schema.json', 'dd1619bf96fcd8c50fe46f0dd05b4b9bb9356010040ae985fa595fee226ff4ed'],
  ['2025-06-18', 'f5ccad944fdf2b7d9cc70cf817f66ca5a8aa03a4', 'schema/2025-06-18/schema.json', '05020a692319467847cdb1794b1306567f52860353b5ff2f2bc2b0140819305b'],
  ['2025-11-25', '38c84e9f93ad191d9eb26d92b945d17bd0efcaf3', 'schema/2025-11-25/schema.json', '1ffe4c5577974012f5fa02af14ea88df4b7146679df1abaaad497c8d9230ca8a'],
  ['2026-07-28', '5f5440bb26a62e2cf3440b92da5a667efa03b267', 'schema/2026-07-28/schema.json', 'ef70b61f99b6d2e5e3b46863822eab08dff6a45bedc7a08914e0e5b133f40203'],
]);
const EXPECTED_CONFORMANCE_PIN = Object.freeze([
  '7169291ec0b68eb370fddcd9947313ab0d5e4156',
  'README.md',
  '8bd88fc81dec8dcf27a544848246f54c0e3d71b18bef4becdcc093ac876a29f5',
]);

const SERVERS = Object.freeze([
  {
    name: 'citadel-state',
    entrypoint: 'mcp-servers/citadel-state/index.js',
    serverInfo: { name: 'citadel-state', version: '1.2.0' },
    callParams: { name: 'citadel_status', arguments: { includeFiles: false } },
    resource: { uri: 'citadel://status' },
  },
  {
    name: 'codebase-memory',
    entrypoint: 'mcp-servers/codebase-memory/index.js',
    serverInfo: { name: 'codebase-memory', version: '1.0.0' },
    callParams: { name: 'index_status', arguments: {} },
    resource: { uri: 'codebase://architecture' },
  },
  {
    name: 'context-compress',
    entrypoint: 'mcp-servers/context-compress/index.js',
    serverInfo: { name: 'context-compress', version: '1.0.2' },
    callParams: { name: 'smart_read', arguments: { path: 'sample.txt', hint: 'external conformance fixture' } },
  },
]);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function rawUrl(repository, commit, artifactPath) {
  const parsed = new URL(repository);
  assert.equal(parsed.protocol, 'https:', 'upstream repository must use HTTPS');
  assert.equal(parsed.hostname, 'github.com', 'upstream repository must be on github.com');
  const segments = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/');
  assert.equal(segments.length, 2, 'upstream repository must have owner/repository form');
  return `https://raw.githubusercontent.com/${segments[0]}/${segments[1]}/${commit}/${artifactPath}`;
}

function loadAndVerifyManifest() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  assert.equal(manifest.formatVersion, 1);
  assert.equal(manifest.schemaRepository, 'https://github.com/modelcontextprotocol/modelcontextprotocol');
  assert.deepStrictEqual(
    manifest.artifacts.map(({ revision, commit, path: artifactPath, sha256: digest }) => (
      [revision, commit, artifactPath, digest]
    )),
    EXPECTED_PINS,
    'official schema pins changed without updating the offline trust anchor',
  );
  assert.deepStrictEqual(
    [
      manifest.upstreamConformanceBoundary.commit,
      manifest.upstreamConformanceBoundary.path,
      manifest.upstreamConformanceBoundary.sha256,
    ],
    EXPECTED_CONFORMANCE_PIN,
    'official conformance boundary pin changed without updating the offline trust anchor',
  );
  assert.equal(
    manifest.upstreamConformanceBoundary.repository,
    'https://github.com/modelcontextprotocol/conformance',
  );
  assert.equal(
    manifest.upstreamConformanceBoundary.stdioServerTrackingIssue,
    'https://github.com/modelcontextprotocol/conformance/issues/258',
  );
  for (const artifact of manifest.artifacts) {
    assert.match(artifact.commit, /^[0-9a-f]{40}$/);
    assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
    artifact.url = rawUrl(manifest.schemaRepository, artifact.commit, artifact.path);
  }
  const boundary = manifest.upstreamConformanceBoundary;
  assert.match(boundary.commit, /^[0-9a-f]{40}$/);
  assert.match(boundary.sha256, /^[0-9a-f]{64}$/);
  boundary.url = rawUrl(boundary.repository, boundary.commit, boundary.path);
  return manifest;
}

function download(url, redirects = 0) {
  assert(redirects <= 3, `too many redirects while fetching ${url}`);
  const parsed = new URL(url);
  assert.equal(parsed.protocol, 'https:', `refusing non-HTTPS artifact URL: ${url}`);
  assert.equal(parsed.hostname, 'raw.githubusercontent.com', `refusing untrusted artifact host: ${url}`);
  return new Promise((resolve, reject) => {
    const request = https.get(parsed, {
      headers: { 'User-Agent': 'citadel-mcp-external-conformance/1' },
      timeout: 30000,
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        try {
          const redirected = new URL(response.headers.location, parsed).toString();
          resolve(download(redirected, redirects + 1));
        } catch (error) {
          reject(error);
        }
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`artifact fetch returned HTTP ${response.statusCode}: ${url}`));
        return;
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error(`artifact fetch timed out: ${url}`)));
    request.on('error', reject);
  });
}

function deepEqual(left, right) {
  try {
    assert.deepStrictEqual(left, right);
    return true;
  } catch (_error) {
    return false;
  }
}

function valueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function resolvePointer(root, reference) {
  assert(reference.startsWith('#/'), `external schema reference is not allowed: ${reference}`);
  return reference.slice(2).split('/').reduce((value, token) => {
    const key = token.replace(/~1/g, '/').replace(/~0/g, '~');
    assert(value && Object.prototype.hasOwnProperty.call(value, key), `unresolved schema reference: ${reference}`);
    return value[key];
  }, root);
}

// This is intentionally one recursive dispatcher: each branch mirrors one
// structural JSON Schema keyword used by the five pinned upstream documents.
// Keeping keyword evaluation together makes reference/branch depth limits and
// fail-closed error accumulation visible in one audit surface.
function validateSchema(root, schema, value, location = '$', depth = 0) {
  if (depth > 100) return [`${location}: schema recursion exceeded`];
  if (schema === true || schema === undefined) return [];
  if (schema === false) return [`${location}: false schema rejected value`];
  if (schema.$ref) return validateSchema(root, resolvePointer(root, schema.$ref), value, location, depth + 1);

  const errors = [];
  const branchErrors = (branches) => branches.map((branch) => validateSchema(root, branch, value, location, depth + 1));
  if (schema.allOf) for (const result of branchErrors(schema.allOf)) errors.push(...result);
  if (schema.anyOf) {
    const results = branchErrors(schema.anyOf);
    if (!results.some((result) => result.length === 0)) errors.push(`${location}: did not match anyOf (${results.map((result) => result[0]).join('; ')})`);
  }
  if (schema.oneOf) {
    const matches = branchErrors(schema.oneOf).filter((result) => result.length === 0).length;
    if (matches !== 1) errors.push(`${location}: matched ${matches} oneOf branches`);
  }
  if (schema.not && validateSchema(root, schema.not, value, location, depth + 1).length === 0) {
    errors.push(`${location}: matched forbidden schema`);
  }
  if (schema.if) {
    const matches = validateSchema(root, schema.if, value, location, depth + 1).length === 0;
    if (matches && schema.then) errors.push(...validateSchema(root, schema.then, value, location, depth + 1));
    if (!matches && schema.else) errors.push(...validateSchema(root, schema.else, value, location, depth + 1));
  }

  if (Object.prototype.hasOwnProperty.call(schema, 'const') && !deepEqual(value, schema.const)) {
    errors.push(`${location}: does not equal const`);
  }
  if (schema.enum && !schema.enum.some((candidate) => deepEqual(value, candidate))) {
    errors.push(`${location}: value is not in enum`);
  }

  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = valueType(value);
    const matches = allowed.some((type) => type === actual || (type === 'number' && actual === 'integer'));
    if (!matches) return [...errors, `${location}: expected ${allowed.join('|')}, received ${actual}`];
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${location}: shorter than minLength`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${location}: longer than maxLength`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) errors.push(`${location}: does not match pattern`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${location}: below minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${location}: above maximum`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) errors.push(`${location}: below exclusiveMinimum`);
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) errors.push(`${location}: above exclusiveMaximum`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${location}: fewer than minItems`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${location}: more than maxItems`);
    if (schema.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) errors.push(`${location}: items are not unique`);
    if (schema.items) value.forEach((item, index) => errors.push(...validateSchema(root, schema.items, item, `${location}[${index}]`, depth + 1)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const required of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, required)) errors.push(`${location}: missing required property ${required}`);
    }
    const properties = schema.properties || {};
    for (const [key, child] of Object.entries(value)) {
      if (Object.prototype.hasOwnProperty.call(properties, key)) {
        errors.push(...validateSchema(root, properties[key], child, `${location}.${key}`, depth + 1));
      } else if (schema.additionalProperties === false) {
        errors.push(`${location}: unexpected property ${key}`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        errors.push(...validateSchema(root, schema.additionalProperties, child, `${location}.${key}`, depth + 1));
      }
    }
    if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) errors.push(`${location}: fewer than minProperties`);
    if (schema.maxProperties !== undefined && Object.keys(value).length > schema.maxProperties) errors.push(`${location}: more than maxProperties`);
  }
  return errors;
}

function schemaDefinitions(schema) {
  return schema.definitions || schema.$defs;
}

function assertDefinition(schema, name, value, label) {
  const definitions = schemaDefinitions(schema);
  assert(definitions && definitions[name], `${label}: official schema is missing ${name}`);
  const errors = validateSchema(schema, definitions[name], value);
  assert.equal(errors.length, 0, `${label}: ${name} schema violations:\n${errors.slice(0, 8).join('\n')}`);
}

function request(id, method, params) {
  return { jsonrpc: '2.0', id, method, params };
}

function modernParams(params = {}) {
  return {
    ...params,
    _meta: {
      [PROTOCOL_VERSION_META_KEY]: MODERN_REVISION,
      [CLIENT_CAPABILITIES_META_KEY]: { roots: {} },
      [CLIENT_INFO_META_KEY]: { name: 'citadel-external-conformance', version: '1.0.0' },
    },
  };
}

function buildRequests(server, revision) {
  const modern = revision === MODERN_REVISION;
  const requests = modern
    ? [
      request('discover', 'server/discover', modernParams()),
      request('tools-list', 'tools/list', modernParams()),
      request('tools-call', 'tools/call', modernParams(server.callParams)),
    ]
    : [
      request('initialize', 'initialize', {
        protocolVersion: revision,
        capabilities: {},
        clientInfo: { name: 'citadel-external-conformance', version: '1.0.0' },
      }),
      { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
      request('tools-list', 'tools/list', {}),
      request('tools-call', 'tools/call', server.callParams),
    ];
  if (server.resource) {
    requests.push(request('resources-list', 'resources/list', modern ? modernParams() : {}));
    requests.push(request('resources-read', 'resources/read', modern ? modernParams(server.resource) : server.resource));
  }
  return requests;
}

function parseFrames(server, revision, stdout, expectedIds) {
  assert(stdout.endsWith('\n'), `${server.name} ${revision}: stdout ended with an incomplete frame`);
  const lines = stdout.split(/\n/);
  assert.equal(lines.pop(), '', `${server.name} ${revision}: malformed terminal frame`);
  const messages = lines.filter((line) => line.length > 0).map((line, index) => {
    assert(!line.includes('\r'), `${server.name} ${revision}: response frame ${index + 1} contains CR data`);
    let parsed;
    try { parsed = JSON.parse(line); } catch (error) {
      throw new Error(`${server.name} ${revision}: response frame ${index + 1} is not JSON: ${error.message}`);
    }
    assert(parsed && typeof parsed === 'object' && !Array.isArray(parsed), `${server.name} ${revision}: response frame is not an object`);
    assert.equal(parsed.jsonrpc, '2.0', `${server.name} ${revision}: response is not JSON-RPC 2.0`);
    return parsed;
  });
  assert.equal(messages.length, expectedIds.length, `${server.name} ${revision}: unexpected response count`);
  assert.deepStrictEqual(messages.map((message) => message.id).sort(), [...expectedIds].sort(), `${server.name} ${revision}: response IDs do not match requests`);
  return new Map(messages.map((message) => [message.id, message]));
}

function runServer(server, revision, projectRoot) {
  const requests = buildRequests(server, revision);
  const expectedIds = requests.filter((message) => Object.prototype.hasOwnProperty.call(message, 'id')).map((message) => message.id);
  const result = spawnSync(process.execPath, [path.join(ROOT, server.entrypoint)], {
    cwd: projectRoot,
    env: { ...process.env, CITADEL_PROJECT_ROOT: projectRoot },
    input: `${requests.map((message) => JSON.stringify(message)).join('\n')}\n`,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 10 * 1024 * 1024,
  });
  assert.equal(result.error, undefined, `${server.name} ${revision}: process error: ${result.error?.message}`);
  assert.equal(result.signal, null, `${server.name} ${revision}: process killed by ${result.signal}`);
  assert.equal(result.status, 0, `${server.name} ${revision}: process exited ${result.status}: ${result.stderr}`);
  return { requests, messages: parseFrames(server, revision, result.stdout, expectedIds) };
}

function validateTranscript(schema, server, revision, requests, messages) {
  const modern = revision === MODERN_REVISION;
  const checks = [
    ['tools-list', 'ListToolsResult'],
    ['tools-call', 'CallToolResult'],
  ];
  if (server.resource) checks.push(['resources-list', 'ListResourcesResult'], ['resources-read', 'ReadResourceResult']);
  if (modern) checks.unshift(['discover', 'DiscoverResult']);
  else checks.unshift(['initialize', 'InitializeResult']);

  let schemaChecks = 0;
  const requestDefinitions = {
    initialize: 'InitializeRequest',
    'notifications/initialized': 'InitializedNotification',
    'server/discover': 'DiscoverRequest',
    'tools/list': 'ListToolsRequest',
    'tools/call': 'CallToolRequest',
    'resources/list': 'ListResourcesRequest',
    'resources/read': 'ReadResourceRequest',
  };
  for (const outbound of requests) {
    const definition = requestDefinitions[outbound.method];
    assert(definition, `${server.name} ${revision}: no request definition for ${outbound.method}`);
    assertDefinition(schema, definition, outbound, `${server.name} ${revision} outbound ${outbound.method}`);
    schemaChecks += 1;
  }
  for (const [id, definition] of checks) {
    const response = messages.get(id);
    assert(response, `${server.name} ${revision}: missing ${id} response`);
    assert(!response.error, `${server.name} ${revision}: ${id} returned ${JSON.stringify(response.error)}`);
    assert(response.result && typeof response.result === 'object', `${server.name} ${revision}: ${id} has no object result`);
    const responseDefinition = modern ? `${definition}Response` : 'JSONRPCResponse';
    assertDefinition(schema, responseDefinition, response, `${server.name} ${revision} ${id}`);
    assertDefinition(schema, definition, response.result, `${server.name} ${revision} ${id} result`);
    schemaChecks += 2;
  }

  if (modern) {
    const discover = messages.get('discover').result;
    assert.deepStrictEqual(discover.supportedVersions, [MODERN_REVISION], `${server.name}: wrong discovered version`);
    assert.deepStrictEqual(discover._meta?.[SERVER_INFO_META_KEY], server.serverInfo, `${server.name}: missing modern server identity`);
    for (const [id] of checks) {
      const result = messages.get(id).result;
      assert.equal(result.resultType, 'complete', `${server.name} ${id}: missing complete resultType`);
      assert.deepStrictEqual(result._meta?.[SERVER_INFO_META_KEY], server.serverInfo, `${server.name} ${id}: wrong modern server identity`);
    }
    for (const id of ['discover', 'tools-list', 'resources-list', 'resources-read']) {
      if (!messages.has(id)) continue;
      assert.equal(messages.get(id).result.ttlMs, 0, `${server.name} ${id}: expected conservative ttlMs`);
      assert.equal(messages.get(id).result.cacheScope, 'private', `${server.name} ${id}: expected private cache scope`);
    }
  } else {
    const initialized = messages.get('initialize').result;
    assert.equal(initialized.protocolVersion, revision, `${server.name}: negotiated ${initialized.protocolVersion}, expected ${revision}`);
    assert.deepStrictEqual(initialized.serverInfo, server.serverInfo, `${server.name}: wrong initialize serverInfo`);
  }
  assert(messages.get('tools-list').result.tools.length > 0, `${server.name} ${revision}: empty tool list`);
  assert(messages.get('tools-call').result.content.length > 0, `${server.name} ${revision}: empty tool result`);
  return { responseCount: messages.size, schemaChecks };
}

async function fetchPinnedArtifacts(manifest) {
  const artifacts = await Promise.all(manifest.artifacts.map(async (pin) => {
    const bytes = await download(pin.url);
    assert.equal(sha256(bytes), pin.sha256, `${pin.revision}: official schema digest mismatch`);
    let schema;
    try { schema = JSON.parse(bytes); } catch (error) {
      throw new Error(`${pin.revision}: official schema is not JSON: ${error.message}`);
    }
    const definitions = schemaDefinitions(schema);
    assert(definitions, `${pin.revision}: official schema has no definitions`);
    for (const name of ['ListToolsResult', 'CallToolResult', 'ListResourcesResult', 'ReadResourceResult']) {
      assert(definitions[name], `${pin.revision}: official schema is missing ${name}`);
    }
    assert(definitions[pin.revision === MODERN_REVISION ? 'DiscoverResult' : 'InitializeResult'], `${pin.revision}: official schema has the wrong lifecycle era`);
    return { pin, schema, bytes: bytes.length };
  }));

  const boundary = manifest.upstreamConformanceBoundary;
  const readme = await download(boundary.url);
  assert.equal(sha256(readme), boundary.sha256, 'official conformance README digest mismatch');
  const readmeText = readme.toString('utf8');
  assert(readmeText.includes('server --url <url>'), 'official conformance README no longer documents URL-based server testing');
  assert(!readmeText.includes('server --stdio'), 'official conformance runner now appears to support stdio servers; revisit this gate');
  return { artifacts, conformanceReadmeBytes: readme.length };
}

function writeReport(reportPath, report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function runExternal(reportPath) {
  const manifest = loadAndVerifyManifest();
  const report = {
    formatVersion: 1,
    kind: 'citadel-mcp-pinned-external-schema-conformance',
    status: 'running',
    generatedAt: new Date().toISOString(),
    claimBoundary: 'Pinned official MCP schemas plus Citadel-owned stdio wire validation; not official upstream server certification.',
    upstream: {
      schemaRepository: manifest.schemaRepository,
      schemaPins: manifest.artifacts.map(({ revision, commit, path: artifactPath, sha256: digest, url }) => ({ revision, commit, path: artifactPath, sha256: digest, url })),
      conformanceRunner: { ...manifest.upstreamConformanceBoundary },
    },
    revisions: [],
    summary: { combinationsPassed: 0, combinationsTotal: EXPECTED_PINS.length * SERVERS.length, responsesValidated: 0, schemaChecks: 0 },
  };
  try {
    const fetched = await fetchPinnedArtifacts(manifest);
    report.upstream.artifactsVerified = fetched.artifacts.length + 1;
    report.upstream.conformanceReadmeBytes = fetched.conformanceReadmeBytes;
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-mcp-external-conformance-'));
    try {
      fs.mkdirSync(path.join(fixtureRoot, '.planning', 'campaigns'), { recursive: true });
      fs.mkdirSync(path.join(fixtureRoot, 'src'), { recursive: true });
      fs.writeFileSync(path.join(fixtureRoot, '.planning', 'campaigns', 'fixture.md'), '# External conformance fixture\n', 'utf8');
      fs.writeFileSync(path.join(fixtureRoot, 'src', 'fixture.js'), 'module.exports = 42;\n', 'utf8');
      fs.writeFileSync(path.join(fixtureRoot, 'sample.txt'), 'external conformance fixture\n', 'utf8');
      for (const { pin, schema } of fetched.artifacts) {
        const revisionReport = { revision: pin.revision, schemaSha256: pin.sha256, combinationsPassed: 0, responsesValidated: 0, schemaChecks: 0, servers: [] };
        for (const server of SERVERS) {
          const { requests, messages } = runServer(server, pin.revision, fixtureRoot);
          const counts = validateTranscript(schema, server, pin.revision, requests, messages);
          revisionReport.servers.push({ server: server.name, status: 'passed', ...counts });
          revisionReport.combinationsPassed += 1;
          revisionReport.responsesValidated += counts.responseCount;
          revisionReport.schemaChecks += counts.schemaChecks;
          report.summary.combinationsPassed += 1;
          report.summary.responsesValidated += counts.responseCount;
          report.summary.schemaChecks += counts.schemaChecks;
        }
        report.revisions.push(revisionReport);
      }
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
    assert.equal(report.summary.combinationsPassed, report.summary.combinationsTotal);
    report.status = 'passed';
    writeReport(reportPath, report);
    process.stdout.write(
      `Pinned external MCP schema conformance: ${report.summary.combinationsPassed}/${report.summary.combinationsTotal} server-revision combinations, `
      + `${report.summary.responsesValidated} wire responses, ${report.summary.schemaChecks} schema checks passed.\n`
      + `Report: ${path.relative(ROOT, reportPath).replace(/\\/g, '/')}\n`,
    );
  } catch (error) {
    report.status = 'failed';
    report.error = error.stack || error.message;
    writeReport(reportPath, report);
    throw error;
  }
}

function parseArgs(argv) {
  const verifyManifest = argv.includes('--verify-manifest');
  argv.forEach((arg) => assert.equal(arg, '--verify-manifest', `unknown argument: ${arg}`));
  return { verifyManifest };
}

async function main() {
  const { verifyManifest } = parseArgs(process.argv.slice(2));
  if (verifyManifest) {
    const manifest = loadAndVerifyManifest();
    process.stdout.write(`MCP external conformance pins: ${manifest.artifacts.length}/5 revisions and conformance boundary verified offline.\n`);
    return;
  }
  await runExternal(DEFAULT_REPORT_PATH);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { EXPECTED_PINS, loadAndVerifyManifest, validateSchema };

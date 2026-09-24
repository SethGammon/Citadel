#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const config = require('../core/config');
const claudeRuntime = require('../runtimes/claude-code/runtime');
const codexRuntime = require('../runtimes/codex/runtime');
const { installClaudeHooks } = require('../runtimes/claude-code/generators/install-hooks');
const {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  MODERN_PROTOCOL_VERSION,
  PROTOCOL_VERSION_META_KEY,
  SERVER_INFO_META_KEY,
} = require('../mcp-servers/protocol-adapter');

const {
  buildCodexExecArgs,
  createAppServerProbe,
  createAutomationPlan,
  createFleetExecutionPlan,
  createPrReviewPlan,
  detectWindowsCodexSetup,
  readAppArtifacts,
  recordAppArtifact,
} = require('../core/codex/native-integrations');

const CITADEL_ROOT = path.resolve(__dirname, '..');
const CODEX_PLUGIN_HOOKS_PATH = './runtimes/codex/hooks.json';
const MCP_SERVER = path.join(CITADEL_ROOT, 'mcp-servers', 'citadel-state', 'index.js');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\/\/.*\n/, ''));
}

function stagePluginRoot(targetRoot) {
  const excluded = new Set(['.git', '.planning', 'node_modules']);
  fs.cpSync(CITADEL_ROOT, targetRoot, {
    recursive: true,
    filter(source) {
      const relative = path.relative(CITADEL_ROOT, source);
      return !excluded.has(relative.split(path.sep)[0]);
    },
  });
}

function parseGeneratedMcpServer(config, name) {
  const marker = `[mcp_servers.${name}]`;
  const start = config.indexOf(marker);
  assert(start >= 0, `missing ${marker}`);
  const remainder = config.slice(start + marker.length);
  const end = remainder.search(/\n\[[^\]]+\]/);
  const section = end >= 0 ? remainder.slice(0, end) : remainder;
  const readJsonValue = (key) => {
    const match = section.match(new RegExp(`^${key} = (.+)$`, 'm'));
    return match ? JSON.parse(match[1]) : undefined;
  };
  const env = {};
  const envMatch = section.match(/^env = \{ (.*) \}$/m);
  if (envMatch) {
    for (const assignment of envMatch[1].split(', ')) {
      const match = assignment.match(/^([A-Za-z_][A-Za-z0-9_]*) = (.+)$/);
      assert(match, `invalid generated MCP env assignment: ${assignment}`);
      env[match[1]] = JSON.parse(match[2]);
    }
  }
  return {
    command: readJsonValue('command'),
    args: readJsonValue('args') || [],
    cwd: readJsonValue('cwd'),
    env,
  };
}

function runMcpConversation(projectRoot, server, requests) {
  const commandAndArgs = [server.command, ...server.args];
  assert(!commandAndArgs.some((value) => String(value).includes('${CLAUDE_PLUGIN_ROOT}')),
    'Claude-only plugin-root placeholder reached a Codex MCP command');
  const cwd = server.cwd ? path.resolve(projectRoot, server.cwd) : projectRoot;
  const result = spawnSync(server.command, server.args, {
    cwd,
    input: [...requests.map((request) => JSON.stringify(request)), ''].join('\n'),
    env: { ...process.env, ...server.env },
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert(!result.stderr.includes('MODULE_NOT_FOUND'), result.stderr);
  return result.stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function modernMcpRequest(id, method, params = {}) {
  return {
    jsonrpc: '2.0',
    id,
    method,
    params: {
      ...params,
      _meta: {
        [PROTOCOL_VERSION_META_KEY]: MODERN_PROTOCOL_VERSION,
        [CLIENT_CAPABILITIES_META_KEY]: {},
        [CLIENT_INFO_META_KEY]: { name: 'codex-native-integration', version: '1.0.0' },
      },
    },
  };
}

function assertModernMcpResult(message, serverInfo, { cacheable = false } = {}) {
  assert.equal(message?.result?.resultType, 'complete');
  assert.deepEqual(message.result._meta, { [SERVER_INFO_META_KEY]: serverInfo });
  if (cacheable) {
    assert.equal(message.result.ttlMs, 0);
    assert.equal(message.result.cacheScope, 'private');
  } else {
    assert.equal(message.result.ttlMs, undefined);
    assert.equal(message.result.cacheScope, undefined);
  }
}

function mcpToolResponse(projectRoot, server, runtimeId) {
  const input = [
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'citadel_operation_list', arguments: {} },
    }),
    '',
  ].join('\n');
  const result = spawnSync(process.execPath, [MCP_SERVER], {
    cwd: projectRoot,
    input,
    env: {
      ...process.env,
      CITADEL_RUNTIME: runtimeId,
      ...(server.env || {}),
    },
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .find((message) => message.id === 2);
}

function writeOperationsHarness(projectRoot) {
  const harness = config.createDefaultConfig();
  harness.activation = {
    ...harness.activation,
    bundles: config.dependencyClosure(['operations']),
    allowDegradedRuntime: true,
  };
  fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, '.claude', 'harness.json'),
    `${JSON.stringify(harness, null, 2)}\n`,
    'utf8',
  );
}

function testRepositoryHookPackagingBoundary() {
  const claudeAutoDiscoveryPath = path.join(CITADEL_ROOT, 'hooks', 'hooks.json');
  assert(!fs.existsSync(claudeAutoDiscoveryPath),
    'hooks/hooks.json must stay absent because Claude Code auto-discovers it and project settings already install hooks');

  const claudeTemplatePath = path.join(CITADEL_ROOT, 'hooks', 'hooks-template.json');
  const claudeTemplate = fs.readFileSync(claudeTemplatePath, 'utf8');
  assert(claudeTemplate.includes('${CLAUDE_PLUGIN_ROOT}'), 'Claude hook template must use CLAUDE_PLUGIN_ROOT');
  assert(!claudeTemplate.includes('${PLUGIN_ROOT}'), 'Claude hook template must not use Codex PLUGIN_ROOT');
  assert(!claudeTemplate.includes('codex-adapter.js'), 'Claude hooks must invoke their scripts directly');

  const codexManifest = readJson(path.join(CITADEL_ROOT, '.codex-plugin', 'plugin.json'));
  assert.equal(codexManifest.hooks, CODEX_PLUGIN_HOOKS_PATH,
    'Codex manifest must keep its hook bundle outside Claude auto-discovery');
  assert(fs.existsSync(path.resolve(CITADEL_ROOT, codexManifest.hooks)),
    'Codex manifest hook bundle must exist at its runtime-owned path');
}

function testGeneratedCodexArtifacts() {
  const codexFallbackMcp = readJson(path.join(CITADEL_ROOT, '.mcp.json'));
  assert.deepEqual(codexFallbackMcp.mcpServers, {},
    'plugin-root .mcp.json must remain empty because Codex auto-discovers it');
  const claudeManifest = readJson(path.join(CITADEL_ROOT, '.claude-plugin', 'plugin.json'));
  assert.equal(claudeManifest.mcpServers, './.claude-plugin/.mcp.json');
  const bundledMcp = readJson(path.resolve(CITADEL_ROOT, claudeManifest.mcpServers));
  for (const server of Object.values(bundledMcp.mcpServers)) {
    assert.equal(server.cwd, '.', 'bundled MCP servers must preserve the consuming project as cwd');
    assert.match(server.args[0], /^\$\{CLAUDE_PLUGIN_ROOT\}\//,
      'Claude plugin MCP entrypoints must resolve from the plugin root');
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-codex-native-'));
  try {
    execFileSync(process.execPath, [path.join(CITADEL_ROOT, 'scripts', 'codex-compat.js'), tmp], {
      cwd: CITADEL_ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 20000,
    });

    const guidance = fs.readFileSync(path.join(tmp, 'AGENTS.md'), 'utf8');
    assert(guidance.includes('`$citadel.do setup`'), 'fallback guidance must use Codex plugin-skill syntax');
    assert(!guidance.includes('/do setup'), 'fallback guidance must not emit Claude slash commands');

    const config = fs.readFileSync(path.join(tmp, '.codex', 'config.toml'), 'utf8');
    assert(config.includes('hooks = true'), 'Codex config must use canonical hooks feature');
    assert(!config.includes('codex_hooks = true'), 'Codex config must not emit deprecated codex_hooks feature');
    assert(config.includes('[mcp_servers.citadel-state]'), 'Codex config must include citadel-state MCP server');
    assert(config.includes('[mcp_servers.codebase-memory]'), 'Codex config must include codebase-memory MCP server');
    assert(!config.includes('${CLAUDE_PLUGIN_ROOT}'),
      'Claude-only plugin-root placeholders must not leak into Codex MCP configuration');

    const manifestPath = path.join(tmp, '.codex-plugin', 'plugin.json');
    const manifest = readJson(manifestPath);
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(manifestPath, 'utf8')), 'Codex plugin manifest must be strict JSON');
    assert.equal(manifest.skills, './.agents/skills/');
    assert.equal(manifest.hooks, CODEX_PLUGIN_HOOKS_PATH);
    assert.equal(manifest.mcpServers, undefined,
      'Codex plugin manifest must not auto-load Claude-only MCP declarations');
    assert(!/claude/i.test(manifest.description), 'Codex manifest description should not be Claude-specific');
    assert(/Codex-native/.test(manifest.interface.shortDescription), 'manifest should be Codex-native');

    const mcp = readJson(path.join(tmp, '.mcp.json'));
    assert(mcp.mcpServers['citadel-state'], 'generated plugin MCP config must include citadel-state');

    assert(!fs.existsSync(path.join(tmp, 'hooks', 'hooks.json')),
      'Codex generation must not recreate Claude Code auto-discovery path');
    const pluginHooks = readJson(path.resolve(tmp, manifest.hooks));
    for (const event of ['PermissionRequest', 'PreCompact', 'PostCompact', 'SubagentStart', 'SubagentStop']) {
      assert(pluginHooks.hooks[event], `plugin hooks missing ${event}`);
    }
    const firstPluginHook = pluginHooks.hooks.PreToolUse
      .flatMap((entry) => entry.hooks)
      .find((hook) => hook.command && hook.command.includes('${PLUGIN_ROOT}'));
    assert(firstPluginHook, 'plugin hooks should include generated PLUGIN_ROOT commands');
    const firstCommand = firstPluginHook.command;
    assert(firstCommand.includes('${PLUGIN_ROOT}'), 'plugin hook command should use PLUGIN_ROOT');
    assert(firstPluginHook.commandWindows.includes('process.env.PLUGIN_ROOT'), 'plugin hook commandWindows should use PLUGIN_ROOT');

    const fleetAgent = fs.readFileSync(path.join(tmp, '.codex', 'agents', 'fleet.toml'), 'utf8');
    assert(fleetAgent.includes('developer_instructions'), 'Codex fleet agent projection must include developer instructions');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function testInstalledCodexMcpEntrypoints() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-codex-mcp-install-'));
  const pluginRoot = path.join(tmp, 'cache', 'citadel-local', 'citadel', 'test-version');
  const projectRoot = path.join(tmp, 'consumer repository');
  try {
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'src', 'consumer-only.js'), 'module.exports = 42;\n', 'utf8');
    stagePluginRoot(pluginRoot);

    execFileSync(process.execPath, [
      path.join(pluginRoot, 'scripts', 'codex-install.js'),
      '--plugin-root', pluginRoot,
      '--project-root', projectRoot,
      '--skip-windows-check',
      '--json',
    ], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 60000,
    });

    const manifest = readJson(path.join(pluginRoot, '.codex-plugin', 'plugin.json'));
    assert.equal(manifest.mcpServers, undefined,
      'installed Codex manifest must not reference Claude .mcp.json');
    const codexFallbackMcp = readJson(path.join(pluginRoot, '.mcp.json'));
    assert.deepEqual(codexFallbackMcp.mcpServers, {},
      'installed plugin-root .mcp.json must not expose Claude-only commands to Codex');
    const claudeManifest = readJson(path.join(pluginRoot, '.claude-plugin', 'plugin.json'));
    const claudeMcp = readJson(path.resolve(pluginRoot, claudeManifest.mcpServers));
    for (const server of Object.values(claudeMcp.mcpServers)) {
      assert.match(server.args[0], /^\$\{CLAUDE_PLUGIN_ROOT\}\//,
        'cache-like installation must preserve Claude MCP entrypoints');
    }

    const config = fs.readFileSync(path.join(projectRoot, '.codex', 'config.toml'), 'utf8');
    assert(!config.includes('${CLAUDE_PLUGIN_ROOT}'));
    const commonRequests = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'citadel-regression-test', version: '1' } } },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ];

    const state = parseGeneratedMcpServer(config, 'citadel-state');
    const stateMessages = runMcpConversation(projectRoot, state, [
      ...commonRequests,
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'citadel_status', arguments: {} } },
    ]);
    assert(stateMessages.find((message) => message.id === 1)?.result, 'citadel-state initialize failed');
    assert(stateMessages.find((message) => message.id === 2)?.result?.tools?.length, 'citadel-state tools/list failed');
    const status = JSON.parse(stateMessages.find((message) => message.id === 3).result.content[0].text);
    assert.equal(fs.realpathSync(status.projectRoot), fs.realpathSync(projectRoot),
      'citadel-state must operate on the consumer repository');

    const stateModernMessages = runMcpConversation(projectRoot, state, [
      modernMcpRequest('state-discover', 'server/discover'),
      modernMcpRequest('state-list', 'tools/list'),
      modernMcpRequest('state-status', 'tools/call', { name: 'citadel_status', arguments: {} }),
    ]);
    const stateInfo = { name: 'citadel-state', version: '1.2.0' };
    assertModernMcpResult(
      stateModernMessages.find((message) => message.id === 'state-discover'),
      stateInfo,
      { cacheable: true },
    );
    assertModernMcpResult(
      stateModernMessages.find((message) => message.id === 'state-list'),
      stateInfo,
      { cacheable: true },
    );
    assertModernMcpResult(
      stateModernMessages.find((message) => message.id === 'state-status'),
      stateInfo,
    );

    const memory = parseGeneratedMcpServer(config, 'codebase-memory');
    const memoryMessages = runMcpConversation(projectRoot, memory, [
      ...commonRequests,
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'index_status', arguments: {} } },
    ]);
    assert(memoryMessages.find((message) => message.id === 1)?.result, 'codebase-memory initialize failed');
    assert(memoryMessages.find((message) => message.id === 2)?.result?.tools?.length, 'codebase-memory tools/list failed');
    assert(memoryMessages.find((message) => message.id === 3)?.result, 'codebase-memory index_status failed');
    const consumerIndexPath = path.join(projectRoot, '.planning', 'map', 'index.json');
    assert(fs.existsSync(consumerIndexPath), 'codebase-memory must write its index under the consumer repository');
    const consumerIndex = fs.readFileSync(consumerIndexPath, 'utf8');
    assert(consumerIndex.includes('src/consumer-only.js'), 'codebase-memory indexed the wrong repository');
    assert(!fs.existsSync(path.join(pluginRoot, '.planning', 'map', 'index.json')),
      'codebase-memory must not index the installed plugin root');

    const memoryModernMessages = runMcpConversation(projectRoot, memory, [
      modernMcpRequest('memory-discover', 'server/discover'),
      modernMcpRequest('memory-list', 'tools/list'),
      modernMcpRequest('memory-status', 'tools/call', { name: 'index_status', arguments: {} }),
    ]);
    const memoryInfo = { name: 'codebase-memory', version: '1.0.0' };
    assertModernMcpResult(
      memoryModernMessages.find((message) => message.id === 'memory-discover'),
      memoryInfo,
      { cacheable: true },
    );
    assertModernMcpResult(
      memoryModernMessages.find((message) => message.id === 'memory-list'),
      memoryInfo,
      { cacheable: true },
    );
    assertModernMcpResult(
      memoryModernMessages.find((message) => message.id === 'memory-status'),
      memoryInfo,
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function testCodexAndClaudeMcpRuntimeCoexistence() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-mcp-runtime-coexistence-'));
  try {
    installClaudeHooks({ projectRoot: tmp, citadelRoot: CITADEL_ROOT });
    const claudeSettings = readJson(path.join(tmp, '.claude', 'settings.json'));
    assert.equal(claudeSettings.env.CITADEL_RUNTIME, 'claude-code');

    execFileSync(process.execPath, [path.join(CITADEL_ROOT, 'scripts', 'codex-compat.js'), tmp], {
      cwd: CITADEL_ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 20000,
    });

    const codexConfig = fs.readFileSync(path.join(tmp, '.codex', 'config.toml'), 'utf8');
    assert.match(codexConfig, /CITADEL_RUNTIME = "codex"/,
      'Codex must keep its runtime identity in .codex/config.toml');
    const citadelState = readJson(path.join(tmp, '.mcp.json')).mcpServers['citadel-state'];
    assert(citadelState, 'Codex installation must keep the shared Citadel MCP entry');
    assert.equal(citadelState.env.CITADEL_RUNTIME, undefined,
      'shared MCP config must not stamp Codex over the launching runtime');

    writeOperationsHarness(tmp);
    config.reconcileEffectiveConfig(tmp, {
      runtime: claudeRuntime,
      reconciledAt: '2026-09-11T12:00:00.000Z',
    });
    const claudeActivation = mcpToolResponse(tmp, citadelState, 'claude-code');
    assert(claudeActivation?.result && !claudeActivation.error,
      `Claude MCP activation should use claude-code: ${JSON.stringify(claudeActivation)}`);

    config.reconcileEffectiveConfig(tmp, {
      runtime: codexRuntime,
      reconciledAt: '2026-09-11T12:01:00.000Z',
    });
    const codexActivation = mcpToolResponse(tmp, citadelState, 'codex');
    assert(codexActivation?.result && !codexActivation.error,
      `Codex MCP activation should use codex: ${JSON.stringify(codexActivation)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function testClaudePluginMcpEntrypoints() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel mcp consumer '));
  try {
    fs.mkdirSync(path.join(projectRoot, '.planning'), { recursive: true });
    const claudeManifest = readJson(path.join(CITADEL_ROOT, '.claude-plugin', 'plugin.json'));
    const bundledMcp = readJson(path.resolve(CITADEL_ROOT, claudeManifest.mcpServers));
    const requests = [
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
      '',
    ].join('\n');

    for (const [name, server] of Object.entries(bundledMcp.mcpServers)) {
      const entrypoint = server.args[0].replace('${CLAUDE_PLUGIN_ROOT}', CITADEL_ROOT);
      const result = spawnSync(process.execPath, [entrypoint], {
        cwd: projectRoot,
        input: requests,
        env: { ...process.env, ...(server.env || {}) },
        encoding: 'utf8',
        timeout: 20000,
      });
      assert.equal(result.status, 0, `${name} failed from consumer project: ${result.stderr}`);
      const responses = result.stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
      assert(responses.find((response) => response.id === 1)?.result,
        `${name} did not complete MCP initialization`);
      assert(responses.find((response) => response.id === 2)?.result?.tools?.length,
        `${name} did not expose MCP tools`);
    }

    const stateServer = bundledMcp.mcpServers['citadel-state'];
    const statusInput = [
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'citadel_status', arguments: {} } }),
      '',
    ].join('\n');
    const statusResult = spawnSync(
      process.execPath,
      [stateServer.args[0].replace('${CLAUDE_PLUGIN_ROOT}', CITADEL_ROOT)],
      {
        cwd: projectRoot,
        input: statusInput,
        env: { ...process.env, ...(stateServer.env || {}) },
        encoding: 'utf8',
        timeout: 20000,
      }
    );
    assert.equal(statusResult.status, 0, statusResult.stderr);
    const statusResponse = statusResult.stdout.split(/\r?\n/).filter(Boolean)
      .map((line) => JSON.parse(line)).find((response) => response.id === 2);
    const status = JSON.parse(statusResponse.result.content[0].text);
    assert.equal(fs.realpathSync(status.projectRoot), fs.realpathSync(projectRoot),
      'plugin-root entrypoint must preserve the consuming project as MCP project root');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
}

function testMcpServer() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-mcp-state-'));
  try {
    fs.mkdirSync(path.join(tmp, '.planning', 'campaigns'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.planning', 'campaigns', 'demo.md'), '# Demo\n', 'utf8');
    const input = [
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
      JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'citadel_status', arguments: { includeFiles: true }, _meta: { progressToken: 3 } } }),
      JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: 'citadel://status' } }),
      '',
    ].join('\n');
    const result = spawnSync(process.execPath, [path.join(CITADEL_ROOT, 'mcp-servers', 'citadel-state', 'index.js')], {
      input,
      env: { ...process.env, CITADEL_PROJECT_ROOT: tmp },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(result.status, 0, result.stderr);
    const messages = result.stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    assert(messages.find((msg) => msg.id === 2).result.tools.some((tool) => tool.name === 'citadel_status'));
    const statusText = messages.find((msg) => msg.id === 3).result.content[0].text;
    assert(statusText.includes('"campaigns": 1'), 'citadel_status should report campaign count');
    assert(messages.find((msg) => msg.id === 4).result.contents[0].text.includes('"planningExists": true'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function testBridgeUtilities() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-native-bridges-'));
  try {
    const automation = createAutomationPlan({
      projectRoot: tmp,
      type: 'daemon',
      command: '/daemon tick',
      cadence: 'every 30 minutes',
      now: '2026-06-01T00:00:00.000Z',
      write: true,
    });
    assert(fs.existsSync(path.join(tmp, '.planning', 'codex-automations', `${automation.id}.json`)));
    assert(automation.prompt.includes('.planning/daemon.json'));
    assert(automation.loopId.startsWith('loop-codex-daemon-'));
    assert(automation.loopStopConditions.includes('budget-exhausted'));

    const prPlan = createPrReviewPlan({
      projectRoot: tmp,
      repo: 'owner/repo',
      prNumber: 42,
      risk: 'high',
      changedFiles: 25,
      write: true,
    });
    assert.equal(prPlan.decision, 'combined');
    assert(prPlan.followUpPrompt.includes('@codex review'));

    const artifact = recordAppArtifact({
      projectRoot: tmp,
      kind: 'screenshot',
      path: '.planning/screenshots/qa-flow-1.png',
      workflow: 'qa',
      status: 'pass',
    });
    assert.equal(artifact.workflow, 'qa');
    assert.equal(readAppArtifacts(tmp).length, 1);

    const execArgs = buildCodexExecArgs({
      projectRoot: tmp,
      sandbox: 'read-only',
      outputLastMessagePath: path.join(tmp, '.planning', 'bench.md'),
      prompt: '$do --list',
    });
    assert.deepEqual(execArgs.slice(0, 3), ['exec', '--cd', tmp]);
    assert(execArgs.includes('--json'), 'codex exec benchmark should stream JSON for machine parsing');
    assert(execArgs.includes('--output-last-message'), 'codex exec benchmark should capture final answer');

    const resumeArgs = buildCodexExecArgs({ projectRoot: tmp, resumeSessionId: 'thread-123', prompt: 'continue' });
    assert.deepEqual(resumeArgs.slice(0, 4), ['exec', 'resume', '--cd', tmp]);

    const fleet = createFleetExecutionPlan({ projectRoot: tmp, write: true });
    assert.equal(fleet.mode, 'codex-subagents');
    assert(fs.existsSync(path.join(tmp, '.planning', 'fleet', 'codex-native-plan.json')));

    fs.mkdirSync(path.join(tmp, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.codex', 'config.toml'), '[windows]\nsandbox = "elevated"\nagent_shell = "git-bash"\n', 'utf8');
    const windows = detectWindowsCodexSetup({ projectRoot: tmp, platform: 'win32' });
    assert(windows.pass, 'Windows Codex setup check should pass with sandbox and shell config');

    const appServer = createAppServerProbe({ listen: 'stdio://' });
    assert.deepEqual(appServer.args.slice(0, 3), ['app-server', '--listen', 'stdio://']);
    assert.equal(appServer.localOnly, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function testDocsMatrix() {
  const doc = fs.readFileSync(path.join(CITADEL_ROOT, 'docs', 'CODEX_NATIVE_INTEGRATIONS.md'), 'utf8');
  for (let i = 1; i <= 12; i++) {
    assert(doc.includes(`## ${i}.`), `Codex native matrix missing entry ${i}`);
  }
  for (const term of ['codex-automation.js', 'codex-pr-review.js', 'codex-app-artifacts.js', 'codex-windows-check.js', 'codex-app-server-probe.js']) {
    assert(doc.includes(term), `Codex native matrix missing ${term}`);
  }
}

testGeneratedCodexArtifacts();
testRepositoryHookPackagingBoundary();
testClaudePluginMcpEntrypoints();
testInstalledCodexMcpEntrypoints();
testCodexAndClaudeMcpRuntimeCoexistence();
testMcpServer();
testBridgeUtilities();
testDocsMatrix();

console.log('codex native integration tests passed');

#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\/\/.*\n/, ''));
}

function testGeneratedCodexArtifacts() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-codex-native-'));
  try {
    execFileSync(process.execPath, [path.join(CITADEL_ROOT, 'scripts', 'codex-compat.js'), tmp], {
      cwd: CITADEL_ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 20000,
    });

    const config = fs.readFileSync(path.join(tmp, '.codex', 'config.toml'), 'utf8');
    assert(config.includes('hooks = true'), 'Codex config must use canonical hooks feature');
    assert(!config.includes('codex_hooks = true'), 'Codex config must not emit deprecated codex_hooks feature');
    assert(config.includes('[mcp_servers.citadel-state]'), 'Codex config must include citadel-state MCP server');

    const manifestPath = path.join(tmp, '.codex-plugin', 'plugin.json');
    const manifest = readJson(manifestPath);
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(manifestPath, 'utf8')), 'Codex plugin manifest must be strict JSON');
    assert.equal(manifest.skills, './.agents/skills/');
    assert.equal(manifest.hooks, './hooks/hooks.json');
    assert.equal(manifest.mcpServers, './.mcp.json');
    assert(!/claude/i.test(manifest.description), 'Codex manifest description should not be Claude-specific');
    assert(/Codex-native/.test(manifest.interface.shortDescription), 'manifest should be Codex-native');

    const mcp = readJson(path.join(tmp, '.mcp.json'));
    assert(mcp.mcpServers['citadel-state'], 'generated plugin MCP config must include citadel-state');

    const pluginHooks = readJson(path.join(tmp, 'hooks', 'hooks.json'));
    for (const event of ['PermissionRequest', 'PreCompact', 'PostCompact', 'SubagentStart', 'SubagentStop']) {
      assert(pluginHooks.hooks[event], `plugin hooks missing ${event}`);
    }
    const firstPluginHook = pluginHooks.hooks.PreToolUse
      .flatMap((entry) => entry.hooks)
      .find((hook) => hook.command && hook.command.includes('${PLUGIN_ROOT}'));
    assert(firstPluginHook, 'plugin hooks should include generated PLUGIN_ROOT commands');
    const firstCommand = firstPluginHook.command;
    assert(firstCommand.includes('${PLUGIN_ROOT}'), 'plugin hook command should use PLUGIN_ROOT');
    assert(firstPluginHook.commandWindows.includes('%PLUGIN_ROOT%'), 'plugin hook commandWindows should use PLUGIN_ROOT');

    const fleetAgent = fs.readFileSync(path.join(tmp, '.codex', 'agents', 'fleet.toml'), 'utf8');
    assert(fleetAgent.includes('developer_instructions'), 'Codex fleet agent projection must include developer instructions');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
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
      JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'citadel_status', arguments: { includeFiles: true } } }),
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
testMcpServer();
testBridgeUtilities();
testDocsMatrix();

console.log('codex native integration tests passed');

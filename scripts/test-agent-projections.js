#!/usr/bin/env node

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require(path.join(__dirname, '..', 'core', 'config'));
const { loadAgent } = require(path.join(__dirname, '..', 'core', 'agents', 'parse-agent'));
const { renderCodexToml, projectAgentToCodex } = require(path.join(__dirname, '..', 'core', 'agents', 'project-agent'));
const {
  CODEX_AGENT_EXTENSION,
  configFromHarness,
} = require(path.join(__dirname, '..', 'core', 'agents', 'model-config'));
const { projectCodexAgents } = require(path.join(__dirname, '..', 'runtimes', 'codex', 'generators', 'project-agents'));
const {
  buildPlan,
  parseArgs,
} = require(path.join(__dirname, 'citadel-config'));

function fail(message) {
  console.error(message);
  process.exit(1);
}

function main() {
  const agentPath = path.join(__dirname, '..', 'agents', 'archon.md');
  const parsed = loadAgent(agentPath);
  if (parsed.errors.length > 0) {
    fail(`Parsed agent has validation errors: ${parsed.errors.join('; ')}`);
  }

  const toml = renderCodexToml(parsed);
  if (!toml.includes('name = "archon"')) {
    fail('Generated TOML is missing the expected agent name');
  }
  if (!toml.includes('model = "gpt-5.6-sol"')) {
    fail('Generated TOML is missing the expected model mapping');
  }
  if (!toml.includes('model_reasoning_effort = "high"')) {
    fail('Generated TOML is missing the expected reasoning effort');
  }

  const reviewer = loadAgent(path.join(__dirname, '..', 'agents', 'arch-reviewer.md'));
  const reviewerToml = renderCodexToml(reviewer);
  if (!reviewerToml.includes('does not machine-enforce Citadel tool allow/deny lists')
    || !reviewerToml.includes('Use only these declared tools: Read, Grep, Glob.')
    || !reviewerToml.includes('Do not use these declared tools: Edit, Write, Bash, NotebookEdit.')) {
    fail('Restricted Codex projection did not disclose and preserve the canonical tool policy');
  }

  const fleetSkill = fs.readFileSync(path.join(__dirname, '..', 'skills', 'fleet', 'SKILL.md'), 'utf8');
  if (/mode:\s*["']bypassPermissions["']/.test(fleetSkill)) {
    fail('Fleet skill still directs spawned agents to bypass native permissions');
  }
  if (!fleetSkill.includes("the host's native permission policy")) {
    fail('Fleet skill does not explicitly preserve the host permission policy');
  }

  const arbiter = loadAgent(path.join(__dirname, '..', 'agents', 'arbiter.md'));
  const arbiterToml = renderCodexToml(arbiter);
  if (!arbiterToml.includes('model = "gpt-5.6-sol"')) {
    fail('Current Claude Fable role did not map to Codex Sol');
  }
  if (!arbiterToml.includes('model_reasoning_effort = "max"')) {
    fail('Arbiter did not retain its current max effort default');
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-agent-proj-'));
  const targetBase = path.join(tmpRoot, '.codex', 'agents');
  const result = projectAgentToCodex(agentPath, targetBase);

  if (!fs.existsSync(result.output.tomlPath)) {
    fail('Projected agent TOML was not written');
  }

  const projectedToml = fs.readFileSync(result.output.tomlPath, 'utf8');
  if (!projectedToml.includes('developer_instructions = """')) {
    fail('Projected TOML is missing developer instructions');
  }

  const raw = config.createDefaultConfig();
  const args = parseArgs([
    'configure-codex-agents',
    '--model-alias', 'opus=gpt-5.6-terra',
    '--agent-model', 'archon=gpt-5.6-sol',
    '--agent-effort', 'archon=ultra',
  ]);
  const plan = buildPlan(raw, args);
  if (plan.blocked || !plan.candidateConfig) {
    fail(`Configurable agent plan was blocked: ${plan.errors.join('; ')}`);
  }
  const extension = plan.candidateConfig.extensions[CODEX_AGENT_EXTENSION];
  if (extension.agents.archon.reasoningEffort !== 'ultra') {
    fail('Config plan did not preserve the Codex-only ultra override');
  }
  const configured = configFromHarness(plan.candidateConfig);
  const configuredToml = renderCodexToml(parsed, { agentConfig: configured });
  if (!configuredToml.includes('model = "gpt-5.6-sol"')
    || !configuredToml.includes('model_reasoning_effort = "ultra"')) {
    fail('Per-agent model and effort overrides did not win over the family mapping');
  }

  const projectRoot = path.join(tmpRoot, 'configured-project');
  fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, '.claude', 'harness.json'),
    `${JSON.stringify(plan.candidateConfig, null, 2)}\n`,
    'utf8',
  );
  projectCodexAgents({
    citadelRoot: path.join(__dirname, '..'),
    projectRoot,
    agentName: 'archon',
  });
  const configuredProjection = fs.readFileSync(
    path.join(projectRoot, '.codex', 'agents', 'archon.toml'),
    'utf8',
  );
  if (!configuredProjection.includes('model_reasoning_effort = "ultra"')) {
    fail('Project generator did not load the governed model configuration');
  }

  const rejectedPlan = buildPlan(raw, parseArgs([
    'configure-codex-agents',
    '--agent-effort', 'archon=extreme',
  ]));
  if (!rejectedPlan.blocked
    || !rejectedPlan.errors.some((error) => /low, medium, high, xhigh, max, ultra/.test(error))) {
    fail('Unsupported Codex reasoning effort did not fail closed');
  }

  fs.rmSync(tmpRoot, { recursive: true, force: true });
  console.log('Agent projection tests pass.');
}

main();

#!/usr/bin/env node

'use strict';

// Verifies a project is actually ready to run Citadel under opencode, and says
// plainly what is missing when it is not. Checks only things that are observably
// true on disk — it never claims a capability opencode does not have.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { PLUGIN_STUB_NAME, MCP_SERVER_NAME, citadelSkillsPath } = require('../runtimes/opencode/generators/install-plugin');
const { runHooksForEvent, resolveNodeBinary } = require('../runtimes/opencode/plugin/hook-runner');
const runtime = require('../runtimes/opencode/runtime');
const { rewriteSkillCommand } = require('../runtimes/opencode/plugin/skill-command');

const CITADEL_ROOT = path.resolve(__dirname, '..');

function arg(argv, name, fallback = null) {
  const inline = argv.find((item) => item.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

// Two severities, because the installer does not write everything the runtime
// can use. REQUIRED covers what `opencode-install.js` guarantees plus the live
// proof that enforcement works — a failure there means the install is broken, so
// it sets the exit code. ADVISORY covers capability a project gains by having
// something Citadel does not (yet) project: missing means less Citadel, not a
// broken install. Before this split a correct fresh install failed its own
// readiness check, which teaches operators to ignore the tool.
const REQUIRED = 'required';
const ADVISORY = 'advisory';

function check(name, pass, detail, severity = REQUIRED, remedy = '') {
  return { name, pass: Boolean(pass), detail: detail || '', severity, remedy };
}

function advisory(name, pass, detail, remedy) {
  return check(name, pass, detail, ADVISORY, remedy);
}

async function collect(projectRoot) {
  const checks = [];

  const pluginPath = path.join(projectRoot, '.opencode', 'plugin', PLUGIN_STUB_NAME);
  checks.push(check('plugin stub present', fs.existsSync(pluginPath), pluginPath));

  const configPath = path.join(projectRoot, 'opencode.json');
  let config = null;
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      checks.push(check('opencode.json parses', true, configPath));
    } catch (error) {
      checks.push(check('opencode.json parses', false, error.message));
    }
  } else {
    checks.push(check('opencode.json parses', false, 'missing'));
  }

  const mcp = config?.mcp?.[MCP_SERVER_NAME];
  checks.push(check(
    'citadel-state MCP registered',
    Boolean(mcp) && mcp.type === 'local' && Array.isArray(mcp.command),
    mcp ? `type=${mcp.type} command=${Array.isArray(mcp.command) ? mcp.command.length + ' args' : typeof mcp.command}` : 'missing',
  ));

  // Advisory from here. opencode reads guidance natively but the installer does
  // not render it, so its presence is the project's own business.
  const guidance = ['AGENTS.md', 'CLAUDE.md'].find((name) => fs.existsSync(path.join(projectRoot, name)));
  checks.push(advisory(
    'guidance file present',
    Boolean(guidance),
    guidance || 'neither AGENTS.md nor CLAUDE.md',
    'add an AGENTS.md (or CLAUDE.md); opencode reads it natively, Citadel does not write one',
  ));

  // Skills reach opencode through a project-local projection in `skills.paths`.
  // Check the configured paths actually resolve to directories holding SKILL.md
  // files. Project-local `.claude/skills` also counts because opencode scans it.
  const configuredPaths = Array.isArray(config?.skills?.paths) ? config.skills.paths : [];
  const citadelSkills = citadelSkillsPath(CITADEL_ROOT);
  const resolvedSkillCounts = configuredPaths.map((item) => {
    const dir = path.isAbsolute(item) ? item : path.join(projectRoot, item);
    if (!fs.existsSync(dir)) return { dir, count: 0, missing: true };
    const count = fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, 'SKILL.md')))
      .length;
    return { dir, count, missing: false };
  });
  const externalSkillsDir = path.join(projectRoot, '.claude', 'skills');
  const externalCount = fs.existsSync(externalSkillsDir)
    ? fs.readdirSync(externalSkillsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length
    : 0;
  const totalSkills = resolvedSkillCounts.reduce((sum, item) => sum + item.count, 0) + externalCount;
  const broken = resolvedSkillCounts.filter((item) => item.missing || item.count === 0);

  checks.push(advisory(
    'skills discoverable by opencode',
    totalSkills > 0 && broken.length === 0,
    broken.length > 0
      ? `${totalSkills} found, but these skills.paths resolve to nothing: ${broken.map((item) => item.dir).join(', ')}`
      : `${totalSkills} (${resolvedSkillCounts.length} configured path(s), ${externalCount} in .claude/skills)`,
    broken.length > 0
      ? 're-run opencode-install.js; a skills.paths entry points somewhere that no longer holds skills'
      : `run opencode-install.js without --skip-skills to add ${citadelSkills} to skills.paths`,
  ));

  // OpenCode's skill slash-command surface has no argument channel. Citadel
  // therefore installs explicit command wrappers that pass $ARGUMENTS into the
  // selected skill prompt.
  const commandDir = path.join(projectRoot, '.opencode', 'commands');
  const expectedCommands = fs.existsSync(path.join(CITADEL_ROOT, 'skills'))
    ? fs.readdirSync(path.join(CITADEL_ROOT, 'skills'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(CITADEL_ROOT, 'skills', entry.name, 'SKILL.md')))
      .map((entry) => entry.name)
    : [];
  const missingCommands = expectedCommands.filter((name) => {
    const commandPath = path.join(commandDir, `${name}.md`);
    return !fs.existsSync(commandPath) || !fs.readFileSync(commandPath, 'utf8').includes('$ARGUMENTS');
  });
  checks.push(check(
    'argument-bearing skill commands projected',
    missingCommands.length === 0,
    missingCommands.length === 0
      ? `${expectedCommands.length} in .opencode/commands`
      : `missing or invalid: ${missingCommands.join(', ')}`,
    ADVISORY,
    're-run opencode-install.js to create .opencode/commands skill wrappers, then restart opencode',
  ));

  // Agents are projected by default, but --skip-agents is a supported choice, so
  // their absence is a deliberate configuration rather than a broken install.
  const agentDir = path.join(projectRoot, '.opencode', 'agent');
  const agentCount = fs.existsSync(agentDir)
    ? fs.readdirSync(agentDir).filter((name) => name.endsWith('.md')).length
    : 0;
  checks.push(advisory(
    'agents projected',
    agentCount > 0,
    `${agentCount} in .opencode/agent`,
    'run opencode-install.js without --skip-agents to project them',
  ));

  // The hooks have to actually run. Node resolution is the usual failure here,
  // because under Bun process.execPath is the Bun binary.
  const nodeBinary = resolveNodeBinary();
  const nodeLooksRight = /node(\.exe)?$/i.test(nodeBinary);
  checks.push(check('node binary resolved for hooks', nodeLooksRight, nodeBinary));

  // Discovery is not execution. Exercise the same relative command written in
  // /do, translate it through the plugin's allowlisted route mapper, and run the
  // resulting delegate with the environment shell.env supplies in a live process.
  const sourceCommand = 'node scripts/dashboard.js';
  const routedCommand = rewriteSkillCommand(sourceCommand, projectRoot);
  const expectedCommand = 'node .citadel/scripts/dashboard.js';
  let routePass = routedCommand === expectedCommand;
  let routeDetail = routePass ? routedCommand : `not translated: ${routedCommand}`;
  if (routePass) {
    const delegatePath = path.join(projectRoot, '.citadel', 'scripts', 'dashboard.js');
    const probe = spawnSync(process.execPath, [delegatePath], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        CITADEL_RUNTIME: 'opencode',
        CITADEL_PROJECT_ROOT: projectRoot,
        CLAUDE_PROJECT_DIR: projectRoot,
      },
      timeout: 15000,
    });
    const output = `${probe.stdout || ''}\n${probe.stderr || ''}`;
    routePass = !probe.error && probe.status === 0
      && !/MODULE_NOT_FOUND|CITADEL_RUNTIME_AMBIGUOUS/.test(output);
    routeDetail = routePass
      ? `${routedCommand} (cwd=${projectRoot})`
      : (probe.error?.message || output.trim().slice(0, 500) || `exit ${probe.status}`);
  }
  checks.push(check(
    'skill route executes from project root',
    routePass,
    routeDetail,
    REQUIRED,
    're-run opencode-install.js to restore project delegates, then restart opencode',
  ));

  // End-to-end proof that the gate refuses something it must refuse.
  const probeDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'citadel-oc-probe-'));
  try {
    fs.writeFileSync(path.join(probeDir, '.env'), 'SECRET=1\n');
    const outcome = await runHooksForEvent('tool.execute.before', {
      tool: 'read',
      args: { filePath: path.join(probeDir, '.env') },
      directory: probeDir,
    }, { projectRoot: probeDir });
    checks.push(check('pre-tool gate blocks a .env read', outcome.blocked, outcome.reason || 'not blocked'));
  } finally {
    fs.rmSync(probeDir, { recursive: true, force: true });
  }

  return checks;
}

// A required failure is FAIL; an advisory failure is WARN. Only required failures
// decide the exit code, unless --strict is given.
function statusOf(item) {
  if (item.pass) return 'PASS';
  return item.severity === ADVISORY ? 'WARN' : 'FAIL';
}

function summarize(checks, { strict = false } = {}) {
  const blocking = checks.filter((item) => !item.pass && item.severity === REQUIRED);
  const warnings = checks.filter((item) => !item.pass && item.severity === ADVISORY);
  return {
    blocking,
    warnings,
    ok: blocking.length === 0 && (!strict || warnings.length === 0),
  };
}

function render(projectRoot, checks, { strict = false } = {}) {
  const { blocking, warnings, ok } = summarize(checks, { strict });
  const lines = [];
  lines.push('Citadel opencode readiness');
  lines.push('='.repeat(40));
  lines.push(`project: ${projectRoot}`);
  lines.push('');
  for (const item of checks) {
    lines.push(`  ${statusOf(item).padEnd(4)}  ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
    if (!item.pass && item.remedy) lines.push(`        ${item.remedy}`);
  }
  lines.push('');
  if (blocking.length > 0) {
    lines.push(`NOT READY: ${blocking.length} required check(s) failed.`);
  } else if (warnings.length > 0) {
    lines.push(strict
      ? `NOT READY (--strict): ${warnings.length} advisory check(s) failed.`
      : `READY, with ${warnings.length} advisory gap(s) above — Citadel's gates work, but you get less of Citadel.`);
  } else {
    lines.push('READY.');
  }
  lines.push('');
  lines.push('Declared degradations (not failures — opencode cannot do these):');
  for (const item of runtime.degradations) lines.push(`  - ${item}`);
  return `${lines.join('\n')}\n`;
}

async function main() {
  const argv = process.argv.slice(2);
  const projectRoot = path.resolve(arg(argv, '--project-root', process.cwd()));
  const strict = argv.includes('--strict');
  const checks = await collect(projectRoot);
  const { blocking, warnings, ok } = summarize(checks, { strict });

  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({
      ok,
      strict,
      projectRoot,
      citadelRoot: CITADEL_ROOT,
      blocking: blocking.map((item) => item.name),
      warnings: warnings.map((item) => item.name),
      checks,
      degradations: runtime.degradations,
    }, null, 2)}\n`);
  } else {
    process.stdout.write(render(projectRoot, checks, { strict }));
  }
  return ok ? 0 : 1;
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = Object.freeze({ ADVISORY, REQUIRED, collect, render, statusOf, summarize });

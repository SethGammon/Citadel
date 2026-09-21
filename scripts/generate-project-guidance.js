#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadProjectSpec } = require(path.join(__dirname, '..', 'core', 'project', 'load-project-spec'));
const { inspectClaudeGuidance } = require(path.join(__dirname, '..', 'core', 'project', 'bootstrap-project-guidance'));
const { CLAUDE_GUIDANCE_TARGET } = require(path.join(__dirname, '..', 'runtimes', 'claude-code', 'guidance', 'render'));
const { selectClaudeGuidanceTarget } = require(path.join(__dirname, '..', 'runtimes', 'claude-code', 'guidance', 'select-target'));
const { CODEX_GUIDANCE_TARGET } = require(path.join(__dirname, '..', 'runtimes', 'codex', 'guidance', 'render'));
const { renderSharedGuidance } = require(path.join(__dirname, '..', 'core', 'project', 'render-shared-guidance'));

function parseArgs(argv) {
  const args = {
    projectRoot: process.cwd(),
    specPath: null,
    target: 'all',
    write: false,
    overwrite: false,
    claudeVersion: null,
    agentsMdCapability: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--project-root') args.projectRoot = path.resolve(argv[++i]);
    else if (arg === '--spec') args.specPath = path.resolve(argv[++i]);
    else if (arg === '--target') args.target = argv[++i];
    else if (arg === '--write') args.write = true;
    else if (arg === '--overwrite') args.overwrite = true;
    else if (arg === '--claude-version') args.claudeVersion = argv[++i];
    else if (arg === '--claude-agents-md-supported') args.agentsMdCapability = true;
  }

  return args;
}

function detectClaudeVersion(args) {
  if (args.claudeVersion) return;
  const detected = spawnSync('claude', ['--version'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    timeout: 10000,
  });
  if (detected.status === 0) args.claudeVersion = detected.stdout || detected.stderr;
}

function buildTargets(spec, options = {}) {
  let persisted = null;
  try {
    persisted = JSON.parse(fs.readFileSync(path.join(options.projectRoot, '.citadel', 'claude-guidance.json'), 'utf8'));
  } catch {
    persisted = null;
  }
  const capability = options.agentsMdCapability === true || persisted?.nativeAgentsMd === true;
  const blockingClaude = inspectClaudeGuidance(options.projectRoot).blockingPaths;
  const selection = selectClaudeGuidanceTarget({
    ...options,
    agentsMdCapability: capability,
    claudeGuidancePresent: blockingClaude.length > 0,
  });
  const shared = {
    filePath: 'AGENTS.md',
    content: renderSharedGuidance(spec),
  };
  return {
    claude: selection.nativeAgentsMd ? shared : {
      filePath: CLAUDE_GUIDANCE_TARGET.filePath,
      content: CLAUDE_GUIDANCE_TARGET.render(spec),
    },
    codex: selection.nativeAgentsMd ? shared : {
      filePath: CODEX_GUIDANCE_TARGET.filePath,
      content: CODEX_GUIDANCE_TARGET.render(spec),
    },
  };
}

function shouldWrite(targetPath, overwrite) {
  if (!fs.existsSync(targetPath)) return true;
  return overwrite;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  detectClaudeVersion(args);
  const loaded = loadProjectSpec(args.projectRoot, args.specPath);

  if (loaded.errors.length > 0) {
    console.error(`Project spec is invalid: ${loaded.errors.join('; ')}`);
    process.exit(1);
  }

  const allTargets = buildTargets(loaded.spec, args);
  const targetNames = args.target === 'all' ? ['claude', 'codex'] : [args.target];

  for (const targetName of targetNames) {
    const target = allTargets[targetName];
    if (!target) {
      console.error(`Unknown target: ${targetName}`);
      process.exit(1);
    }

    const absolutePath = path.join(args.projectRoot, target.filePath);
    if (!args.write) {
      const status = fs.existsSync(absolutePath) ? 'exists' : 'missing';
      console.log(`[dry-run] ${target.filePath}: ${status}`);
      continue;
    }

    if (!shouldWrite(absolutePath, args.overwrite)) {
      console.log(`[skip] ${target.filePath} already exists. Use --overwrite to replace it.`);
      continue;
    }

    fs.writeFileSync(absolutePath, target.content, 'utf8');
    console.log(`[write] ${target.filePath}`);
  }
}

if (require.main === module) main();

module.exports = Object.freeze({ buildTargets, parseArgs });

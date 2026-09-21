#!/usr/bin/env node

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { bootstrapProjectGuidance } = require(path.join(__dirname, '..', 'core', 'project', 'bootstrap-project-guidance'));

function parseArgs(argv) {
  const args = {
    projectRoot: process.cwd(),
    overwriteGuidance: false,
    projectName: null,
    projectSummary: null,
    agentsMdCapability: null,
    claudeVersion: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--project-root') args.projectRoot = path.resolve(argv[++i]);
    else if (arg === '--overwrite-guidance') args.overwriteGuidance = true;
    else if (arg === '--project-name') args.projectName = argv[++i];
    else if (arg === '--project-summary') args.projectSummary = argv[++i];
    else if (arg === '--claude-agents-md-supported') args.agentsMdCapability = true;
    else if (arg === '--claude-version') args.claudeVersion = argv[++i];
  }

  if (!args.claudeVersion) {
    const detected = spawnSync('claude', ['--version'], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
      timeout: 10000,
    });
    if (detected.status === 0) args.claudeVersion = detected.stdout || detected.stderr;
  }

  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = bootstrapProjectGuidance({
    citadelRoot: path.resolve(__dirname, '..'),
    ...args,
  });

  console.log(`[spec] ${result.specCreated ? 'created' : 'reused'} ${result.specPath}`);
  console.log(`[guidance] claude ${result.claude.written ? 'written' : 'skipped'} ${result.claude.filePath}`);
  console.log(`[guidance] codex ${result.codex.written ? 'written' : 'skipped'} ${result.codex.filePath}`);
  console.log(`[guidance] claude target ${result.claudeGuidanceSelection.filePath}: ${result.claudeGuidanceSelection.reason}`);
}

main();

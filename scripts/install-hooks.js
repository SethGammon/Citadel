#!/usr/bin/env node

/**
 * install-hooks.js — Resolves Citadel hook paths into a project's .claude/settings.json
 *
 * Why this exists:
 *   ${CLAUDE_PLUGIN_ROOT} in hooks.json doesn't expand in hook commands
 *   (anthropics/claude-code#24529). This script resolves the variable to an
 *   absolute path and writes working hooks into the project's settings.json.
 *
 * Usage:
 *   node /path/to/Citadel/scripts/install-hooks.js                            # from project dir
 *   node /path/to/Citadel/scripts/install-hooks.js /project                   # explicit project path
 *   node /path/to/Citadel/scripts/install-hooks.js --hook-profile latest      # force full hook set
 *   node /path/to/Citadel/scripts/install-hooks.js --claude-version 2.1.75    # test compatibility mode
 */

'use strict';

const path = require('path');
const { installClaudeHooks } = require('../runtimes/claude-code/generators/install-hooks');

const CITADEL_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    projectRoot: process.env.CLAUDE_PROJECT_DIR || process.cwd(),
    hookProfile: process.env.CITADEL_CLAUDE_HOOK_PROFILE || 'auto',
    claudeVersion: process.env.CITADEL_CLAUDE_VERSION || null,
  };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];

    if (arg === '--hook-profile' && args[index + 1]) {
      options.hookProfile = args[++index];
      continue;
    }

    if (arg.startsWith('--hook-profile=')) {
      options.hookProfile = arg.split('=')[1];
      continue;
    }

    if (arg === '--claude-version' && args[index + 1]) {
      options.claudeVersion = args[++index];
      continue;
    }

    if (arg.startsWith('--claude-version=')) {
      options.claudeVersion = arg.split('=')[1];
      continue;
    }

    if (!arg.startsWith('--') && options.projectRoot === (process.env.CLAUDE_PROJECT_DIR || process.cwd())) {
      options.projectRoot = arg;
    }
  }

  return options;
}

function main() {
  try {
    const options = parseArgs(process.argv);
    const result = installClaudeHooks({
      citadelRoot: CITADEL_ROOT,
      projectRoot: options.projectRoot,
      hookProfile: options.hookProfile,
      claudeVersion: options.claudeVersion,
    });
    console.log(`Citadel hooks installed to ${result.settingsPath}`);
    console.log(`  ${result.hookCount} Citadel hooks resolved (${result.citadelRoot})`);
    if (result.preservedCount > 0) {
      console.log(`  ${result.preservedCount} existing user hooks preserved`);
    }
    if (result.compatibility?.reason) {
      console.log(`  Hook compatibility: ${result.compatibility.reason}`);
    }
    if (result.compatibility?.skippedEvents?.length) {
      console.log(`  Skipped unsupported hook events: ${result.compatibility.skippedEvents.join(', ')}`);
      console.log('  Re-run with --hook-profile latest after upgrading Claude Code to enable them.');
    }
    console.log('Hooks are ready. No restart needed.');
  } catch (error) {
    console.error(`Error: ${error.message}`);
    console.error('Is this script inside a Citadel installation?');
    process.exit(1);
  }
}

main();
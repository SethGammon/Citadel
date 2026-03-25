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
 *   node /path/to/Citadel/scripts/install-hooks.js          # from project dir
 *   node /path/to/Citadel/scripts/install-hooks.js /project  # explicit project path
 *
 * What it does:
 *   1. Reads hooks/hooks.json from the Citadel plugin
 *   2. Replaces ${CLAUDE_PLUGIN_ROOT} with the actual absolute path
 *   3. Merges the resolved hooks into .claude/settings.json in the target project
 *   4. Preserves any existing non-hook settings (permissions, env, mcpServers, etc.)
 *
 * Idempotent — safe to re-run after Citadel updates. Overwrites Citadel hooks
 * but preserves user-added hooks (identified by commands that don't reference
 * the Citadel hooks_src directory).
 */

const fs = require('fs');
const path = require('path');

const CITADEL_ROOT = path.resolve(__dirname, '..');
const HOOKS_JSON = path.join(CITADEL_ROOT, 'hooks', 'hooks.json');
const PROJECT_ROOT = process.argv[2] || process.env.CLAUDE_PROJECT_DIR || process.cwd();
const SETTINGS_PATH = path.join(PROJECT_ROOT, '.claude', 'settings.json');

function resolveHooks() {
  const raw = fs.readFileSync(HOOKS_JSON, 'utf8');
  // Replace the variable with the actual path (forward slashes for cross-platform node)
  const citadelPath = CITADEL_ROOT.replace(/\\/g, '/');
  const resolved = raw.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, citadelPath);
  // Also strip single quotes that wrapped the variable (leftover from plugin convention)
  const cleaned = resolved.replace(/node\s+'([^']+)'/g, 'node "$1"');
  return JSON.parse(cleaned);
}

function readExistingSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function isCitadelHook(hookEntry) {
  if (!hookEntry.hooks) return false;
  return hookEntry.hooks.some(h =>
    h.command && h.command.includes('hooks_src/')
  );
}

function mergeHooks(existing, citadel) {
  const merged = { ...existing };
  merged.hooks = merged.hooks || {};

  for (const [event, citadelEntries] of Object.entries(citadel.hooks)) {
    const existingEntries = merged.hooks[event] || [];

    // Keep user hooks that don't reference Citadel's hooks_src
    const userHooks = existingEntries.filter(entry => !isCitadelHook(entry));

    // Citadel hooks first, then user hooks
    merged.hooks[event] = [...citadelEntries, ...userHooks];
  }

  return merged;
}

function main() {
  // Validate
  if (!fs.existsSync(HOOKS_JSON)) {
    console.error(`Error: hooks.json not found at ${HOOKS_JSON}`);
    console.error('Is this script inside a Citadel installation?');
    process.exit(1);
  }

  // Ensure .claude/ exists in the project
  const claudeDir = path.join(PROJECT_ROOT, '.claude');
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }

  // Resolve hooks
  const citadelHooks = resolveHooks();
  const existing = readExistingSettings();
  const merged = mergeHooks(existing, citadelHooks);

  // Write
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(merged, null, 2) + '\n');

  // Count what we installed
  let hookCount = 0;
  for (const entries of Object.values(citadelHooks.hooks)) {
    hookCount += entries.length;
  }

  const preservedCount = Object.values(merged.hooks).reduce(
    (sum, entries) => sum + entries.filter(e => !isCitadelHook(e)).length, 0
  );

  console.log(`Citadel hooks installed to ${SETTINGS_PATH}`);
  console.log(`  ${hookCount} Citadel hooks resolved (${CITADEL_ROOT})`);
  if (preservedCount > 0) {
    console.log(`  ${preservedCount} existing user hooks preserved`);
  }
  console.log('Hooks are ready. No restart needed.');
}

main();

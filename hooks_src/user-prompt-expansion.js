#!/usr/bin/env node

/**
 * user-prompt-expansion.js — UserPromptExpansion hook
 *
 * Fires when a slash command (skill) expands before Claude processes it.
 * This is the earliest point where Citadel knows which skill is being invoked.
 *
 * Key behaviors:
 *   - Log skill invocation to telemetry for usage tracking
 *   - Track invocation frequency per skill (feeds /telemetry skill stats)
 *   - Can inject additionalContext to prime the skill with session state
 *     (e.g., "active campaign: X, phase: 2") before Claude sees the expansion
 *
 * Design:
 *   - Observer by default: always exit 0
 *   - Exit 2 = block the expansion (for future security gate use only)
 *   - Fast: <5ms budget (fires on every skill invocation)
 *
 * Exit codes:
 *   0 = allow expansion (always, currently)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const health = require('./harness-health-util');

const PROJECT_ROOT = health.PROJECT_ROOT;
const TELEMETRY_DIR = path.join(PROJECT_ROOT, '.planning', 'telemetry');

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    let event = {};
    try { event = JSON.parse(input); } catch { /* partial input ok */ }

    // The expanding slash command or skill name
    const skillName = event.skill_name || event.command_name ||
      extractSkillFromPrompt(event.original_prompt || event.prompt || '');
    const sessionId = event.session_id || null;
    const agentId = event.agent_id || null;

    health.increment('user-prompt-expansion', 'count');

    health.logTiming('user-prompt-expansion', 0, {
      event: 'skill-invoked',
      skill: skillName,
      session_id: sessionId,
      agent_id: agentId,
    });

    // Append to skill-usage.jsonl for /telemetry skill stats
    recordSkillUsage(skillName);

    process.exit(0);
  });
}

/**
 * Extract the skill name from a prompt string like "/marshal fix auth".
 * Returns the bare command name or null if not a slash command.
 */
function extractSkillFromPrompt(prompt) {
  if (!prompt) return null;
  const match = String(prompt).match(/^\/([a-z][a-z0-9-]*)/i);
  return match ? match[1] : null;
}

function recordSkillUsage(skillName) {
  if (!skillName) return;
  try {
    if (!fs.existsSync(TELEMETRY_DIR)) return;
    const usagePath = path.join(TELEMETRY_DIR, 'skill-usage.jsonl');
    const entry = JSON.stringify({
      event: 'skill-invoked',
      skill: skillName,
      timestamp: new Date().toISOString(),
    });
    fs.appendFileSync(usagePath, entry + '\n');
  } catch { /* fail-safe: never block */ }
}

main();

#!/usr/bin/env node

/**
 * cost-tracker.js -- PostToolUse hook (all tools)
 *
 * Real-time session cost monitoring. Reads Claude Code's session JSONL
 * to compute actual token spend. Silent most of the time -- only outputs
 * a one-line summary when cost crosses a threshold.
 *
 * Design principles:
 *   - Never nag. Surfaces at meaningful thresholds, not every tool call.
 *   - Time-gated: checks at most once per CHECK_INTERVAL_MS (3 min default).
 *   - One line of output max. No walls of text.
 *   - Tracks burn rate ($/min over recent window) so users can spot runaway sessions.
 *   - Writes state to .planning/telemetry/cost-tracker-state.json for persistence.
 *
 * Thresholds (configurable via policy.costTracker in harness.json):
 *   $5, $15, $30, $50, $75, $100, $150, $200, $300, $500
 *
 * Output format:
 *   [cost] $27.43 this session (23 min, $1.19/min) -- next alert at $30
 *
 * Exit codes:
 *   0 = always (never blocks)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const health = require('./harness-health-util');

const PROJECT_ROOT = health.PROJECT_ROOT;
const TELEMETRY_DIR = path.join(PROJECT_ROOT, '.planning', 'telemetry');
const STATE_FILE = path.join(TELEMETRY_DIR, 'cost-tracker-state.json');

// Time gate: don't check more than once per interval
const CHECK_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes

// Default thresholds in dollars
const DEFAULT_THRESHOLDS = [5, 15, 30, 50, 75, 100, 150, 200, 300, 500];

const CITADEL_UI = process.env.CITADEL_UI === 'true';

// ── State management ─────────────────────────────────────────────────────────

function readState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return null;
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch { return null; }
}

function writeState(state) {
  try {
    if (!fs.existsSync(TELEMETRY_DIR)) {
      fs.mkdirSync(TELEMETRY_DIR, { recursive: true });
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch { /* non-critical */ }
}

// ── Policy ───────────────────────────────────────────────────────────────────

function readPolicy() {
  try {
    const config = health.readConfig();
    // Support new telemetry block, then cost section, then legacy policy.costTracker
    const tel = config?.telemetry || {};
    const ct = config?.cost || config?.policy?.costTracker || {};
    const mode = ct.mode || 'api';

    // telemetry.enabled=false or telemetry.costAlerts=false both disable alerts.
    const telemetryEnabled = tel.enabled !== false && tel.costAlerts !== false;

    return {
      enabled: telemetryEnabled && mode !== 'off' && ct.enabled !== false,
      mode, // 'api' | 'pro' | 'max' | 'off'
      thresholds: Array.isArray(ct.thresholds) ? ct.thresholds : DEFAULT_THRESHOLDS,
      checkIntervalMs: ct.checkIntervalMs || CHECK_INTERVAL_MS,
      campaignBudgetAlerts: ct.campaignBudgetAlerts !== false,
    };
  } catch {
    return {
      enabled: true, mode: 'api', thresholds: DEFAULT_THRESHOLDS,
      checkIntervalMs: CHECK_INTERVAL_MS, campaignBudgetAlerts: true,
    };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/**
 * Check if the active campaign has a budget and whether we're near it.
 * Reads budget from campaign frontmatter, cumulative cost from session-costs.jsonl.
 * Returns a one-line alert string or null.
 */
function checkCampaignBudget(sessionCost) {
  try {
    const campaignsDir = path.join(PROJECT_ROOT, '.planning', 'campaigns');
    if (!fs.existsSync(campaignsDir)) return null;

    // Find active campaign with a budget
    const files = fs.readdirSync(campaignsDir).filter(f => f.endsWith('.md'));
    let slug = null;
    let budget = null;

    for (const f of files) {
      const content = fs.readFileSync(path.join(campaignsDir, f), 'utf8');
      if (!/^status:\s*active/mi.test(content)) continue;
      slug = f.replace(/\.md$/, '');
      const budgetMatch = content.match(/^budget:\s*(\d+(?:\.\d+)?)/mi);
      if (budgetMatch) budget = parseFloat(budgetMatch[1]);
      break;
    }

    if (!slug || !budget) return null;

    // Sum session costs for this campaign from session-costs.jsonl
    const costFile = path.join(TELEMETRY_DIR, 'session-costs.jsonl');
    if (!fs.existsSync(costFile)) return null;

    let campaignTotal = 0;
    const lines = fs.readFileSync(costFile, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.campaign_slug !== slug) continue;
        // Prefer real_cost > override_cost > estimated_cost
        campaignTotal += entry.real_cost ?? entry.override_cost ?? entry.estimated_cost ?? 0;
      } catch { continue; }
    }

    // Add current session cost (not yet written to JSONL)
    campaignTotal += sessionCost;

    const pct = Math.round((campaignTotal / budget) * 100);

    // Read state to check if we already alerted at this level
    const state = readState();
    const lastBudgetPct = state?.lastBudgetPct || 0;

    if (pct >= 100 && lastBudgetPct < 100) {
      return `[cost] Campaign "${slug}" budget exceeded: $${campaignTotal.toFixed(0)}/$${budget} (${pct}%)`;
    }
    if (pct >= 80 && lastBudgetPct < 80) {
      return `[cost] Campaign "${slug}": $${campaignTotal.toFixed(0)}/$${budget} budget (${pct}%)`;
    }

    return null;
  } catch { return null; }
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      run();
    } catch {
      process.exit(0); // fail open
    }
  });
}

function run() {
  const policy = readPolicy();
  if (!policy.enabled) {
    process.exit(0);
  }

  const now = Date.now();
  const state = readState();

  // Time gate: skip if we checked recently
  if (state && state.lastCheckMs && (now - state.lastCheckMs) < policy.checkIntervalMs) {
    process.exit(0);
  }

  // Load the Claude runtime token adapter
  let sessionTokens;
  try {
    sessionTokens = require(path.join(PLUGIN_ROOT, 'runtimes', 'claude-code', 'adapters', 'session-tokens'));
  } catch {
    process.exit(0); // module not available
  }

  // Find current session
  const sessionId = sessionTokens.getCurrentSessionId();
  if (!sessionId) {
    process.exit(0);
  }

  // Read real token data
  const result = sessionTokens.readSessionTokens(sessionId);
  if (!result || result.combined.messages === 0) {
    writeState({ lastCheckMs: now, sessionId, lastThresholdIndex: -1 });
    process.exit(0);
  }

  const cost = sessionTokens.computeCost(result.combined);
  const tokens = result.combined;

  // Calculate duration and burn rate
  let durationMin = 0;
  let burnRate = 0;
  if (tokens.first_timestamp && tokens.last_timestamp) {
    durationMin = Math.max(1, Math.round(
      (new Date(tokens.last_timestamp) - new Date(tokens.first_timestamp)) / 60000
    ));
    burnRate = cost / durationMin;
  }

  // Find which threshold we've crossed
  const thresholds = policy.thresholds.sort((a, b) => a - b);
  let currentThresholdIndex = -1;
  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (cost >= thresholds[i]) {
      currentThresholdIndex = i;
      break;
    }
  }

  // Check if we've crossed a NEW threshold since last check
  const lastIndex = (state && state.sessionId === sessionId)
    ? (state.lastThresholdIndex ?? -1)
    : -1;

  // Check campaign budget (informational only, never blocks)
  // Done before state write so checkCampaignBudget can read prior state
  let budgetAlert = null;
  if (policy.campaignBudgetAlerts) {
    budgetAlert = checkCampaignBudget(cost);
  }

  // Save state regardless (includes budget tracking)
  writeState({
    lastCheckMs: now,
    sessionId,
    lastThresholdIndex: currentThresholdIndex,
    lastBudgetPct: budgetAlert ? (budgetAlert.includes('exceeded') ? 100 : 80) : (state?.lastBudgetPct || 0),
    cost,
    durationMin,
    burnRate: Math.round(burnRate * 100) / 100,
    messages: tokens.messages,
    subagents: result.subagents.length,
  });

  // Determine what to output
  const crossedNewThreshold = currentThresholdIndex > lastIndex;

  if (!crossedNewThreshold && !budgetAlert) {
    process.exit(0);
  }

  // Format the notification based on mode
  const messages = [];

  if (crossedNewThreshold) {
    const nextThreshold = currentThresholdIndex + 1 < thresholds.length
      ? thresholds[currentThresholdIndex + 1]
      : null;

    if (policy.mode === 'pro' || policy.mode === 'max') {
      // Token-focused output for subscribers (no dollar amounts)
      const totalTokens = tokens.input_tokens + tokens.output_tokens +
        tokens.cache_creation_input_tokens + tokens.cache_read_input_tokens;
      const cacheHitRate = tokens.cache_read_input_tokens > 0
        ? Math.round(tokens.cache_read_input_tokens / (tokens.cache_read_input_tokens + tokens.input_tokens + tokens.cache_creation_input_tokens) * 100)
        : 0;
      const tokPerMin = durationMin > 0 ? Math.round(totalTokens / durationMin) : 0;

      messages.push(
        `[usage] ${formatTokens(totalTokens)} tokens (${cacheHitRate}% cache hits, ${durationMin} min, ${formatTokens(tokPerMin)}/min, ${tokens.messages} msgs)`
      );
    } else {
      // Dollar-focused output for API users
      const costStr = '$' + cost.toFixed(2);
      const rateStr = '$' + burnRate.toFixed(2) + '/min';
      const nextStr = nextThreshold ? ` | next alert at $${nextThreshold}` : '';

      messages.push(
        `[cost] ${costStr} this session (${durationMin} min, ${rateStr}, ${tokens.messages} msgs, ${result.subagents.length} agents)${nextStr}`
      );
    }

    health.logTiming('cost-tracker', 0, {
      event: 'threshold-crossed',
      cost,
      threshold: thresholds[currentThresholdIndex],
      durationMin,
      burnRate: Math.round(burnRate * 100) / 100,
    });
  }

  if (budgetAlert) {
    messages.push(budgetAlert);
  }

  const output = messages.join('\n');

  if (CITADEL_UI) {
    process.stdout.write(JSON.stringify({
      hook: 'cost-tracker',
      action: crossedNewThreshold ? 'threshold' : 'budget-alert',
      message: output,
      timestamp: new Date().toISOString(),
      data: {
        cost,
        durationMin,
        burnRate: Math.round(burnRate * 100) / 100,
        threshold: crossedNewThreshold ? thresholds[currentThresholdIndex] : null,
        messages: tokens.messages,
        subagents: result.subagents.length,
        budgetAlert: budgetAlert || null,
      },
    }));
  } else {
    process.stdout.write(output);
  }

  process.exit(0);
}

main();

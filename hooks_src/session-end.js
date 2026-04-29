#!/usr/bin/env node

/**
 * session-end.js — SessionEnd hook
 *
 * Fires when the Claude Code session ends (user closes, times out, or exits).
 * Responsibilities:
 *   1. Log session end to telemetry
 *   2. Update active campaign continuation state if mid-campaign
 *   3. Write a doc-sync queue entry if there are pending doc updates
 *   4. Mark any in-progress fleet agents as needing-continue
 *   5. Update daemon.json if this was a daemon session (cron/scheduled task flow)
 *
 * This hook fires AFTER the session is done — it cannot send output to Claude.
 * It only writes state files for the next session to read.
 *
 * Fringe cases:
 * - Session ends mid-campaign: continuation state is updated so next session picks up
 * - Session ends with no active work: quiet exit, nothing written
 * - Session ends during fleet execution: fleet agents should already have their own state
 * - Hook crashes: non-critical, logs error but doesn't block
 */

const fs = require('fs');
const path = require('path');
const health = require('./harness-health-util');

// Real token reader -- gracefully falls back if not available
let sessionTokens = null;
try {
  const pluginRoot = path.resolve(__dirname, '..');
  sessionTokens = require(path.join(pluginRoot, 'runtimes', 'claude-code', 'adapters', 'session-tokens'));
} catch { /* session-tokens.js not available -- use estimation fallback */ }

const PROJECT_ROOT = health.PROJECT_ROOT;

// Idempotency guard. In Claude Code this hook fires once at SessionEnd. In
// Codex, the bridge maps SessionEnd → Stop because Codex has no native
// SessionEnd event, so without a guard the hook would fire on every turn.
// We mark which session_id has already run and short-circuit re-fires.
//
// The guard is keyed on session_id, not runtime. That means it works
// uniformly across Claude Code (where it's a no-op) and Codex (where it
// actually prevents duplicate fires) — and if Codex ever ships a real
// SessionEnd event, the same code keeps working without changes.
function alreadyFiredForSession(sessionId) {
  if (!sessionId) return false; // can't guard without an id; allow through
  try {
    const markerPath = path.join(PROJECT_ROOT, '.planning', 'telemetry', 'session-end.lock');
    if (!fs.existsSync(markerPath)) return false;
    const content = fs.readFileSync(markerPath, 'utf8').trim();
    // Marker holds the most recent session_id that ran session-end.
    // If it matches, we've already fired for this session.
    return content === sessionId;
  } catch {
    return false; // on any error, allow the hook to fire
  }
}

function recordFiredForSession(sessionId) {
  if (!sessionId) return;
  try {
    const telemetryDir = path.join(PROJECT_ROOT, '.planning', 'telemetry');
    if (!fs.existsSync(telemetryDir)) fs.mkdirSync(telemetryDir, { recursive: true });
    fs.writeFileSync(path.join(telemetryDir, 'session-end.lock'), sessionId, 'utf8');
  } catch { /* non-critical */ }
}

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    let event = {};
    try { event = JSON.parse(input); } catch { /* partial input ok */ }

    const sessionId = event.session_id || null;

    // Idempotency: skip if we've already run for this session_id.
    // This is what makes the hook safe under Codex's SessionEnd→Stop collapse.
    if (alreadyFiredForSession(sessionId)) {
      process.exit(0);
    }
    recordFiredForSession(sessionId);

    health.increment('session-end', 'count');

    // Log session end
    health.logTiming('session-end', 0, {
      event: 'session-end',
      session_id: sessionId,
    });

    // Log session cost data to telemetry
    logSessionCost(event);

    // Increment trust counters for contextual appropriateness
    incrementTrustCounters();

    // Check for active campaigns and mark continuation point
    markCampaignContinuation();

    // Clean up expired dynamic directories per organization manifest
    cleanupDynamicDirectories();

    // Update daemon state if this was a daemon-driven session
    updateDaemonState();

    // Write doc sync queue entry (Tier 6 - processed by next session or doc-sync hook)
    queueDocSync();

    process.exit(0);
  });
}

/**
 * Log session cost data to .planning/telemetry/session-costs.jsonl.
 *
 * Two-layer approach:
 *   1. Real tokens: Read Claude Code's session JSONL for exact token counts and
 *      compute real cost from API pricing. This is the source of truth.
 *   2. Estimation fallback: If session JSONL isn't available (permissions, path
 *      issues), fall back to the heuristic model (base + agents + duration).
 *
 * The daemon and dashboard read this file. Real cost fields are present only when
 * real data was available -- consumers check for their presence.
 */
function logSessionCost(event) {
  try {
    const telemetryDir = path.join(PROJECT_ROOT, '.planning', 'telemetry');
    if (!fs.existsSync(telemetryDir)) {
      fs.mkdirSync(telemetryDir, { recursive: true });
    }

    const now = new Date();
    // Resolve session ID: prefer event input, fall back to latest session file
    const sessionId = event.session_id
      || (sessionTokens ? sessionTokens.getCurrentSessionId() : null);

    // Count agent-start events from this session by scanning agent-runs.jsonl.
    const agentRunsPath = path.join(telemetryDir, 'agent-runs.jsonl');
    let agentCount = 0;
    let sessionStartTime = null;

    if (fs.existsSync(agentRunsPath)) {
      const lines = fs.readFileSync(agentRunsPath, 'utf8').split('\n').filter(Boolean);
      const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString();

      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const entry = JSON.parse(lines[i]);
          if (!entry.timestamp || entry.timestamp < fourHoursAgo) break;
          if (entry.event === 'agent-start') agentCount++;
          if (!sessionStartTime && (entry.event === 'campaign-start' || entry.event === 'wave-start')) {
            sessionStartTime = entry.timestamp;
          }
        } catch { /* skip malformed lines */ }
      }
    }

    // Find active campaign slug
    let campaignSlug = null;
    const campaignsDir = path.join(PROJECT_ROOT, '.planning', 'campaigns');
    if (fs.existsSync(campaignsDir)) {
      const files = fs.readdirSync(campaignsDir).filter(f => f.endsWith('.md'));
      for (const f of files) {
        try {
          const content = fs.readFileSync(path.join(campaignsDir, f), 'utf8');
          if (/^status:\s*active/mi.test(content)) {
            campaignSlug = f.replace(/\.md$/, '');
            break;
          }
        } catch { /* skip unreadable files */ }
      }
    }

    // Layer 1: Try to read real token data from Claude Code session JSONL
    let realTokens = null;
    let realCost = null;
    let durationMinutes = 0;

    if (sessionTokens && sessionId) {
      try {
        const result = sessionTokens.readSessionTokens(sessionId);
        if (result && result.combined.messages > 0) {
          realTokens = result.combined;
          realCost = sessionTokens.computeCost(result.combined);

          // Compute duration from real timestamps
          if (realTokens.first_timestamp && realTokens.last_timestamp) {
            durationMinutes = Math.max(1, Math.round(
              (new Date(realTokens.last_timestamp) - new Date(realTokens.first_timestamp)) / 60000
            ));
          }
        }
      } catch { /* real data unavailable -- fall back */ }
    }

    // Layer 2: Estimation fallback
    if (!durationMinutes) {
      const startTime = sessionStartTime
        ? new Date(sessionStartTime)
        : new Date(now.getTime() - 10 * 60 * 1000);
      durationMinutes = Math.max(1, Math.round((now - startTime) / 60000));
    }

    const BASE_SESSION_COST = 1.00;
    const COST_PER_SUBAGENT = 0.50;
    const COST_PER_MINUTE = 0.10;
    const estimatedCost = Math.round(
      (BASE_SESSION_COST + (agentCount * COST_PER_SUBAGENT) + (durationMinutes * COST_PER_MINUTE)) * 100
    ) / 100;

    // Build the cost entry -- real fields present only when real data available
    const costEntry = {
      schema: 2,
      timestamp: now.toISOString(),
      campaign_slug: campaignSlug,
      session_id: sessionId,
      agent_count: agentCount,
      duration_minutes: durationMinutes,
      estimated_cost: estimatedCost,
      override_cost: null,
    };

    // Enrich with real token data when available
    if (realTokens) {
      costEntry.real_cost = realCost;
      costEntry.input_tokens = realTokens.input_tokens;
      costEntry.output_tokens = realTokens.output_tokens;
      costEntry.cache_creation_input_tokens = realTokens.cache_creation_input_tokens;
      costEntry.cache_read_input_tokens = realTokens.cache_read_input_tokens;
      costEntry.messages = realTokens.messages;
      costEntry.subagent_count = realTokens.messages > 0 ? (agentCount || 0) : 0;
      costEntry.models = realTokens.models;
    }

    fs.appendFileSync(
      path.join(telemetryDir, 'session-costs.jsonl'),
      JSON.stringify(costEntry) + '\n',
      'utf8'
    );

    // Output one-line session cost summary to terminal.
    // This fires AFTER the session -- stdout goes to the user's terminal, not Claude.
    // Configurable via telemetry.sessionSummary in harness.json (default: "auto").
    // Legacy key cost.sessionEndSummary also respected for backward compatibility.
    try {
      const config = health.readConfig();
      const telemetryCfg = config?.telemetry || {};
      const costConfig = config?.cost || config?.policy?.costTracker || {};
      const summaryMode = telemetryCfg.sessionSummary ?? (costConfig.sessionEndSummary === false ? 'off' : 'auto');
      const showSummary = telemetryCfg.enabled !== false && summaryMode !== 'off';

      if (showSummary) {
        const cost = realCost !== null ? realCost : estimatedCost;
        const source = realCost !== null ? '' : ' (est)';
        const rate = durationMinutes > 0 ? (cost / durationMinutes).toFixed(2) : '?';
        const campaign = campaignSlug ? ` | campaign: ${campaignSlug}` : '';
        const agents = agentCount > 0 ? ` | ${agentCount} agents` : '';
        const msgs = realTokens ? ` | ${realTokens.messages} msgs` : '';

        process.stdout.write(
          `[session] $${cost.toFixed(2)}${source} | ${durationMinutes} min | $${rate}/min${msgs}${agents}${campaign}\n`
        );
      }
    } catch { /* summary is non-critical */ }
  } catch { /* non-critical -- never block session end */ }
}

/**
 * Increment trust counters in harness.json for contextual appropriateness.
 * Tracks sessions completed and campaigns completed this session.
 * Non-critical -- wrapped in try/catch.
 */
function incrementTrustCounters() {
  try {
    const configPath = path.join(PROJECT_ROOT, '.claude', 'harness.json');
    if (!fs.existsSync(configPath)) return; // trust isn't tracked without config

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!config.trust) {
      config.trust = {
        sessions_completed: 0,
        campaigns_completed: 0,
        campaigns_reverted: 0,
        fleet_clean_merges: 0,
        improve_loops_accepted: 0,
        daemon_runs: 0,
        override: null,
      };
    }

    // Always increment sessions_completed
    config.trust.sessions_completed = (config.trust.sessions_completed || 0) + 1;

    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

    // Check if a campaign completed this session
    const completedDir = path.join(PROJECT_ROOT, '.planning', 'campaigns', 'completed');
    if (fs.existsSync(completedDir)) {
      const completedFiles = fs.readdirSync(completedDir).filter(f => f.endsWith('.md'));
      for (const f of completedFiles) {
        try {
          const stat = fs.statSync(path.join(completedDir, f));
          if (stat.mtimeMs >= fiveMinutesAgo) {
            config.trust.campaigns_completed = (config.trust.campaigns_completed || 0) + 1;
            break; // count at most one campaign completion per session
          }
        } catch { /* skip unreadable files */ }
      }
    }

    // Check if a fleet session merged cleanly this session
    const fleetDir = path.join(PROJECT_ROOT, '.planning', 'fleet');
    if (fs.existsSync(fleetDir)) {
      const fleetFiles = fs.readdirSync(fleetDir).filter(f => f.endsWith('.md'));
      for (const f of fleetFiles) {
        try {
          const content = fs.readFileSync(path.join(fleetDir, f), 'utf8');
          const stat = fs.statSync(path.join(fleetDir, f));
          if (stat.mtimeMs >= fiveMinutesAgo && /status:\s*completed/i.test(content) && !/conflict/i.test(content)) {
            config.trust.fleet_clean_merges = (config.trust.fleet_clean_merges || 0) + 1;
            break;
          }
        } catch { /* skip unreadable files */ }
      }
    }

    // Check if an improve loop completed this session
    const improveLogsDir = path.join(PROJECT_ROOT, '.planning', 'improvement-logs');
    if (fs.existsSync(improveLogsDir)) {
      try {
        const targets = fs.readdirSync(improveLogsDir).filter(d => {
          try { return fs.statSync(path.join(improveLogsDir, d)).isDirectory(); } catch { return false; }
        });
        for (const target of targets) {
          const loopFiles = fs.readdirSync(path.join(improveLogsDir, target)).filter(f => f.startsWith('loop-') && f.endsWith('.md'));
          for (const lf of loopFiles) {
            try {
              const stat = fs.statSync(path.join(improveLogsDir, target, lf));
              if (stat.mtimeMs >= fiveMinutesAgo) {
                config.trust.improve_loops_accepted = (config.trust.improve_loops_accepted || 0) + 1;
                break;
              }
            } catch { /* skip */ }
          }
        }
      } catch { /* skip */ }
    }

    // Check if this was a daemon-driven session
    const isNonInteractive = process.env.CLAUDE_NON_INTERACTIVE === '1';
    if (isNonInteractive) {
      const daemonPath = path.join(PROJECT_ROOT, '.planning', 'daemon.json');
      if (fs.existsSync(daemonPath)) {
        try {
          const daemon = JSON.parse(fs.readFileSync(daemonPath, 'utf8'));
          if (daemon.status === 'running') {
            config.trust.daemon_runs = (config.trust.daemon_runs || 0) + 1;
          }
        } catch { /* skip */ }
      }
    }

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  } catch { /* non-critical -- never block session end */ }
}

function markCampaignContinuation() {
  try {
    const campaignsDir = path.join(PROJECT_ROOT, '.planning', 'campaigns');
    if (!fs.existsSync(campaignsDir)) return;

    const files = fs.readdirSync(campaignsDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const filePath = path.join(campaignsDir, file);
      const content = fs.readFileSync(filePath, 'utf8');
      if (!/^Status:\s*active/mi.test(content)) continue;

      // Add a session-end marker to the continuation state
      const marker = `\n<!-- session-end: ${new Date().toISOString()} -->\n`;
      const updated = content.replace(
        /(## Continuation State[\s\S]*?)(\n## |$)/,
        (match, section, next) => section + marker + next
      );
      if (updated !== content) {
        fs.writeFileSync(filePath, updated);
      }
      break; // only one active campaign at a time
    }
  } catch { /* non-critical */ }
}

/**
 * Update daemon.json after a daemon-driven session completes.
 * In the cron/scheduled-task flow, there's no /daemon tick to do this --
 * the session runs /do continue directly and exits. This hook fills that gap.
 *
 * Only fires when: daemon.json exists, status is "running", and the session
 * was non-interactive (indicating a daemon tick, not a human typing /do continue).
 */
function updateDaemonState() {
  try {
    const daemonPath = path.join(PROJECT_ROOT, '.planning', 'daemon.json');
    if (!fs.existsSync(daemonPath)) return;

    const daemon = JSON.parse(fs.readFileSync(daemonPath, 'utf8'));
    if (daemon.status !== 'running') return;

    // Only auto-update for non-interactive sessions (cron/scheduled task).
    // Interactive sessions where a human typed /do continue shouldn't
    // silently increment the daemon's session counter.
    // CLAUDE_NON_INTERACTIVE is set by the scheduled task script.
    // process.argv won't contain the parent's -p flag -- hooks are child processes.
    const isNonInteractive = process.env.CLAUDE_NON_INTERACTIVE === '1';
    if (!isNonInteractive) return;

    // Read the campaign to get the latest loop info
    const slug = daemon.campaignSlug;
    let loopSummary = 'session completed';
    let campaignStatus = 'active';
    if (slug) {
      const campaignPath = path.join(PROJECT_ROOT, '.planning', 'campaigns', `${slug}.md`);
      if (fs.existsSync(campaignPath)) {
        const content = fs.readFileSync(campaignPath, 'utf8');
        // Extract status
        const statusMatch = content.match(/^status:\s*(.+)$/mi);
        if (statusMatch) campaignStatus = statusMatch[1].trim();
        // Extract last loop from the Loop History table
        const rows = content.match(/\|\s*\d+\s*\|[^|]+\|[^|]+\|[^|]+\|/g);
        if (rows && rows.length > 0) {
          const lastRow = rows[rows.length - 1];
          const cells = lastRow.split('|').filter(c => c.trim());
          if (cells.length >= 4) {
            loopSummary = `Loop ${cells[0].trim()}: ${cells[1].trim()} ${cells[3].trim()}`;
          }
        }
      }
    }

    // Update daemon state
    const now = new Date().toISOString();
    daemon.sessionCount = (daemon.sessionCount || 0) + 1;

    // Prefer real cost from session-costs.jsonl over flat estimate
    let sessionCost = daemon.costPerSession || 12;
    try {
      const costFile = path.join(PROJECT_ROOT, '.planning', 'telemetry', 'session-costs.jsonl');
      if (fs.existsSync(costFile)) {
        const lines = fs.readFileSync(costFile, 'utf8').split('\n').filter(Boolean);
        if (lines.length > 0) {
          const latest = JSON.parse(lines[lines.length - 1]);
          if (latest && typeof latest.estimated_cost === 'number') {
            sessionCost = typeof latest.override_cost === 'number' ? latest.override_cost : latest.estimated_cost;
          }
        }
      }
    } catch { /* fall back to flat estimate */ }

    daemon.estimatedSpend = (daemon.estimatedSpend || 0) + sessionCost;
    daemon.lastTickAt = now;
    daemon.lastTickStatus = 'completed';

    // Append to log
    if (!Array.isArray(daemon.log)) daemon.log = [];
    daemon.log.push({
      session: daemon.sessionCount,
      timestamp: now,
      status: 'completed',
      phase: loopSummary.split(':')[0] || 'unknown',
      summary: loopSummary,
      estimatedCost: sessionCost,
    });

    // Check if campaign completed -- stop the daemon
    if (campaignStatus === 'completed' || campaignStatus === 'parked') {
      daemon.status = 'completed';
      daemon.stoppedAt = now;
      daemon.stopReason = `campaign-${campaignStatus}`;
    }

    // Check if campaign hit level-up -- pause the daemon
    if (campaignStatus === 'level-up-pending') {
      daemon.status = 'paused-level-up';
    }

    // Budget gate: stop if budget exhausted
    if (typeof daemon.budget === 'number' && daemon.estimatedSpend >= daemon.budget) {
      daemon.status = 'stopped';
      daemon.stoppedAt = now;
      daemon.stopReason = 'budget-exhausted';
    }

    fs.writeFileSync(daemonPath, JSON.stringify(daemon, null, 2) + '\n', 'utf8');
  } catch { /* non-critical -- don't block session end */ }
}

/**
 * Clean up expired dynamic directories based on the organization manifest.
 * Only runs cleanup for 'auto' policy and 'session'-scoped directories.
 * Campaign-scoped cleanup happens when campaigns complete, not on session end.
 *
 * Respects cleanupPolicy:
 *   - 'auto': clean silently
 *   - 'prompt' or 'manual': skip (can't prompt at session end)
 */
function cleanupDynamicDirectories() {
  try {
    const config = health.readConfig();
    const org = config.organization;
    if (!org || !Array.isArray(org.dynamic)) return;

    // Only auto-clean. Prompt/manual can't work at session-end (no user interaction).
    if (org.cleanupPolicy !== 'auto') return;

    for (const entry of org.dynamic) {
      if (!entry.path || !entry.scope || !entry.cleanup) continue;

      // Only clean session-scoped directories at session end
      if (entry.scope !== 'session') continue;

      const dirPath = path.join(PROJECT_ROOT, entry.path);
      if (!fs.existsSync(dirPath)) continue;

      const strategy = entry.cleanup;

      if (strategy === 'empty-on-expire') {
        // Delete contents but keep the directory
        try {
          const items = fs.readdirSync(dirPath);
          for (const item of items) {
            if (item.startsWith('.gitkeep') || item.startsWith('_TEMPLATE')) continue;
            const itemPath = path.join(dirPath, item);
            const stat = fs.statSync(itemPath);
            if (stat.isDirectory()) {
              fs.rmSync(itemPath, { recursive: true, force: true });
            } else {
              fs.unlinkSync(itemPath);
            }
          }
        } catch { /* best effort */ }
      } else if (strategy === 'archive-then-delete') {
        // Move contents to archive, then empty
        try {
          const items = fs.readdirSync(dirPath).filter(i => !i.startsWith('.gitkeep') && !i.startsWith('_TEMPLATE'));
          if (items.length === 0) continue;

          const dateStr = new Date().toISOString().slice(0, 10);
          const archiveDir = path.join(PROJECT_ROOT, '.planning', 'archive', dateStr, path.basename(entry.path.replace(/\/$/, '')));
          fs.mkdirSync(archiveDir, { recursive: true });

          for (const item of items) {
            const src = path.join(dirPath, item);
            const dest = path.join(archiveDir, item);
            fs.renameSync(src, dest);
          }
        } catch { /* best effort */ }
      } else if (strategy === 'delete') {
        // Remove directory entirely, then recreate if it's a standard planning dir
        try {
          fs.rmSync(dirPath, { recursive: true, force: true });
          // Recreate if it's a known planning directory
          const relativePath = path.relative(PROJECT_ROOT, dirPath).replace(/\\/g, '/');
          if (relativePath.startsWith('.planning/')) {
            fs.mkdirSync(dirPath, { recursive: true });
          }
        } catch { /* best effort */ }
      }
      // 'ignore' strategy: do nothing
    }

    // Log cleanup
    health.logTiming('session-end', 0, {
      event: 'dynamic-cleanup',
      policy: org.cleanupPolicy,
      entries: org.dynamic.filter(e => e.scope === 'session').length,
    });
  } catch { /* non-critical -- never block session end */ }
}

function queueDocSync() {
  try {
    const config = health.readConfig();
    const docConfig = config.docs || {};
    if (docConfig.auto === false) return; // opted out

    const queueFile = path.join(PROJECT_ROOT, '.planning', 'telemetry', 'doc-sync-queue.jsonl');
    const entry = JSON.stringify({
      event: 'session-end',
      timestamp: new Date().toISOString(),
      audiences: docConfig.audiences || ['user', 'org', 'agents'],
      status: 'pending',
    });
    fs.appendFileSync(queueFile, entry + '\n', 'utf8');
  } catch { /* non-critical */ }
}

main();

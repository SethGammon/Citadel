#!/usr/bin/env node

/**
 * telemetry-stats.js — Shared telemetry data readers used by health.js and telemetry-report.cjs.
 *
 * All functions return plain data objects — no console output.
 * Gracefully degrades when files are missing (returns null / empty values).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { readJsonlDetailed } = require('../core/telemetry/io');
const { readCampaignStats: readCampaignStatsCore } = require('../core/campaigns/load-campaign');
const { getCoordinationStatus } = require('../core/coordination/instances');
const { getClaimStatus } = require('../core/coordination/claims');

// Real token reader for enriched cost data
let sessionTokens = null;
try { sessionTokens = require('../runtimes/claude-code/adapters/session-tokens'); } catch { /* not available */ }

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const PLANNING_DIR = path.join(ROOT, '.planning');
const TELEMETRY_DIR = path.join(PLANNING_DIR, 'telemetry');
const FLEET_DIR = path.join(PLANNING_DIR, 'fleet');
const SETTINGS_PATH = path.join(ROOT, '.claude', 'settings.json');

// Token estimation constants
const TOKENS_PER_TIER_RESOLUTION = 500;   // avg Tier 3 cost avoided per Tier 0-2 resolution
const TOKENS_PER_CIRCUIT_TRIP = 15000;    // avg spiral cost before intervention
const TOKENS_PER_QUALITY_VIOLATION = 8000; // avg fix session avoided per violation caught

// ── Generic helpers ───────────────────────────────────────────────────────────

function readJsonl(file) {
  return readJsonlDetailed(file).entries;
}

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function listFiles(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => !ext || f.endsWith(ext));
}

function todayPrefix() {
  return new Date().toISOString().slice(0, 10);
}

// ── Campaign stats ────────────────────────────────────────────────────────────

function readCampaignStats() {
  return readCampaignStatsCore(ROOT);
}

// ── Fleet stats ───────────────────────────────────────────────────────────────

function readFleetStats() {
  const sessions = [];

  if (!fs.existsSync(FLEET_DIR)) return { active_sessions: [], latest: null };

  const files = fs.readdirSync(FLEET_DIR).filter(f => f.startsWith('session-') && f.endsWith('.md'));

  for (const f of files) {
    const content = fs.readFileSync(path.join(FLEET_DIR, f), 'utf8');
    // Check for Status: active in frontmatter or body (case-insensitive)
    if (/Status:\s*active/i.test(content)) {
      sessions.push(f.replace(/\.md$/, ''));
    }
  }

  const latest = sessions.length > 0 ? sessions[sessions.length - 1] : null;
  return { active_sessions: sessions, latest };
}

// ── Hook install check ────────────────────────────────────────────────────────

function readHooksStats() {
  const settings = readJson(SETTINGS_PATH);
  const installed = settings !== null && typeof settings === 'object' &&
    (Array.isArray(settings.hooks) ? settings.hooks.length > 0 : !!settings.hooks);
  return {
    installed,
    settings_path: fs.existsSync(SETTINGS_PATH) ? SETTINGS_PATH : null,
  };
}

// ── Telemetry file stats ──────────────────────────────────────────────────────

function readTelemetryFileStats() {
  const agentRuns = readJsonl(path.join(TELEMETRY_DIR, 'agent-runs.jsonl'));
  const hookTiming = readJsonl(path.join(TELEMETRY_DIR, 'hook-timing.jsonl'));
  const today = todayPrefix();

  const last_event = agentRuns.length > 0
    ? agentRuns[agentRuns.length - 1].timestamp
    : null;

  const hook_fires_today = hookTiming.filter(
    e => typeof e.timestamp === 'string' && e.timestamp.startsWith(today)
  ).length;

  return {
    last_event,
    event_count: agentRuns.length,
    hook_fires_today,
  };
}

// ── Coordination stats ────────────────────────────────────────────────────────

function readCoordinationStats() {
  const claims = getClaimStatus({ projectRoot: ROOT }).claims.length;
  const instances = getCoordinationStatus({ projectRoot: ROOT }).instances.length;
  return { active_claims: claims, active_instances: instances };
}

// ── Cost observability ───────────────────────────────────────────────────────

// Cost model constants (derived from Claude API pricing, Opus-class models)
const BASE_SESSION_COST = 1.00;     // base overhead per session (context load, routing)
const COST_PER_SUBAGENT = 0.50;     // per sub-agent spawn
const COST_PER_MINUTE = 0.10;       // per minute of active agent time
const SESSION_COST_FILE = 'session-costs.jsonl';

/**
 * Read per-session cost events from session-costs.jsonl.
 * Each event is written by the session-end hook.
 *
 * @returns {Array<{timestamp:string, campaign_slug:string|null, session_id:string|null,
 *   agent_count:number, duration_minutes:number, estimated_cost:number, override_cost:number|null}>}
 */
function readSessionCosts() {
  return readJsonl(path.join(TELEMETRY_DIR, SESSION_COST_FILE));
}

/**
 * Get the best cost for a session-cost event.
 * Priority: override_cost > real_cost > estimated_cost
 */
function bestCost(e) {
  if (typeof e.override_cost === 'number') return e.override_cost;
  if (typeof e.real_cost === 'number') return e.real_cost;
  return e.estimated_cost || 0;
}

/**
 * Aggregate costs by campaign slug.
 * Returns a map of campaign slug -> { sessions, total_cost, agents_spawned, total_minutes, tokens }.
 * Sessions with no campaign_slug are grouped under "_unattached".
 *
 * Cost priority: override_cost > real_cost > estimated_cost
 *
 * @returns {Object<string, {sessions:number, total_cost:number, agents_spawned:number,
 *   total_minutes:number, input_tokens:number, output_tokens:number, has_real_data:boolean}>}
 */
function readCostByCampaign() {
  const events = readSessionCosts();
  const result = {};

  for (const e of events) {
    const slug = e.campaign_slug || '_unattached';
    if (!result[slug]) {
      result[slug] = {
        sessions: 0, total_cost: 0, agents_spawned: 0, total_minutes: 0,
        input_tokens: 0, output_tokens: 0, has_real_data: false,
      };
    }
    const r = result[slug];
    r.sessions++;
    r.total_cost += bestCost(e);
    r.agents_spawned += (e.agent_count || 0);
    r.total_minutes += (e.duration_minutes || 0);
    if (typeof e.input_tokens === 'number') {
      r.input_tokens += e.input_tokens;
      r.output_tokens += (e.output_tokens || 0);
      r.has_real_data = true;
    }
  }

  return result;
}

/**
 * Get total spend across all campaigns.
 * Uses real cost when available, falls back to estimated.
 * @returns {{ total: number, by_campaign: Object, session_count: number, has_real_data: boolean }}
 */
function readTotalCost() {
  const byCampaign = readCostByCampaign();
  let total = 0;
  let sessionCount = 0;
  let hasRealData = false;

  for (const slug of Object.keys(byCampaign)) {
    total += byCampaign[slug].total_cost;
    sessionCount += byCampaign[slug].sessions;
    if (byCampaign[slug].has_real_data) hasRealData = true;
  }

  return {
    total: Math.round(total * 100) / 100,
    by_campaign: byCampaign,
    session_count: sessionCount,
    has_real_data: hasRealData,
  };
}

/**
 * Compute estimated cost for a single session based on agent activity.
 * Used as fallback when real token data is not available.
 *
 * @param {number} agentCount - Number of sub-agents spawned this session
 * @param {number} durationMinutes - Session duration in minutes
 * @returns {number} Estimated cost in dollars (rounded to 2 decimal places)
 */
function estimateSessionCost(agentCount, durationMinutes) {
  const cost = BASE_SESSION_COST + (agentCount * COST_PER_SUBAGENT) + (durationMinutes * COST_PER_MINUTE);
  return Math.round(cost * 100) / 100;
}

/**
 * Read real token/cost data directly from Claude Code session JSONL files.
 * This bypasses the session-costs.jsonl intermediary and reads the source of truth.
 *
 * @param {object} [opts] - Options
 * @param {string} [opts.since] - ISO date string, only include sessions after this
 * @returns {{ sessions: object[], totals: object } | null} null if session-tokens.js not available
 */
function readRealCostSummary(opts = {}) {
  if (!sessionTokens) return null;
  try {
    return sessionTokens.readAllSessions(opts);
  } catch { return null; }
}

/**
 * Get a complete cost picture: Citadel telemetry + real Claude Code data.
 * Merges both sources, preferring real data. This is the primary read function
 * for dashboards and reports.
 *
 * @returns {{ total_cost: number, session_count: number, by_campaign: Object,
 *   real_total: number|null, real_sessions: number, data_source: string }}
 */
function readCostDashboard() {
  const citadel = readTotalCost();
  const real = readRealCostSummary();

  return {
    total_cost: real ? real.totals.total_cost : citadel.total,
    session_count: real ? real.totals.session_count : citadel.session_count,
    by_campaign: citadel.by_campaign,
    real_total: real ? real.totals.total_cost : null,
    real_sessions: real ? real.totals.session_count : 0,
    estimated_total: citadel.total,
    data_source: real ? 'real+estimated' : 'estimated-only',
    total_messages: real ? real.totals.messages : null,
    total_subagents: real ? real.totals.subagent_count : null,
  };
}

// ── Token economics ───────────────────────────────────────────────────────────

function readTokenEconomics() {
  const agentRuns = readJsonl(path.join(TELEMETRY_DIR, 'agent-runs.jsonl'));
  const hookTiming = readJsonl(path.join(TELEMETRY_DIR, 'hook-timing.jsonl'));
  const audit = readJsonl(path.join(TELEMETRY_DIR, 'audit.jsonl'));

  // Routing savings: look for meta.tier in agent-run events
  let tier0 = 0, tier1 = 0, tier2 = 0;
  let tierDataAvailable = false;

  for (const e of agentRuns) {
    if (e.meta && typeof e.meta.tier === 'number') {
      tierDataAvailable = true;
      if (e.meta.tier === 0) tier0++;
      else if (e.meta.tier === 1) tier1++;
      else if (e.meta.tier === 2) tier2++;
    }
  }

  const tierResolutions = tier0 + tier1 + tier2;
  const routingSavings = tierDataAvailable ? {
    tier0_resolutions: tier0,
    tier1_resolutions: tier1,
    tier2_resolutions: tier2,
    tokens_saved_estimate: tierResolutions * TOKENS_PER_TIER_RESOLUTION,
    methodology: 'Tier 0-2 resolutions * 500 tokens (avg Tier 3 cost)',
  } : null;

  // Circuit breaker trips from hook-timing counters (metric: trips)
  const circuitTrips = hookTiming.filter(
    e => (e.hook === 'circuit-breaker' || (typeof e.hook === 'string' && e.hook.includes('circuit')))
      && e.metric === 'trips'
  ).length;

  // Also count from audit log entries mentioning circuit-breaker trip
  const auditTrips = audit.filter(
    e => typeof e.event === 'string' &&
      (e.event.includes('circuit-breaker') || e.event.includes('circuit_breaker')) &&
      (e.event.includes('trip') || e.event.includes('blocked'))
  ).length;

  const totalTrips = circuitTrips + auditTrips;

  const circuitBreakerSaves = {
    total_trips: totalTrips,
    tokens_saved_estimate: totalTrips * TOKENS_PER_CIRCUIT_TRIP,
    methodology: 'trips * 15000 tokens (avg spiral before intervention)',
  };

  // Quality gate violations from hook-timing counters (metric: violations) or audit
  const timingViolations = hookTiming.filter(
    e => (e.hook === 'quality-gate' || (typeof e.hook === 'string' && e.hook.includes('quality')))
      && e.metric === 'violations'
  ).length;

  const auditViolations = audit.filter(
    e => typeof e.event === 'string' &&
      (e.event.includes('quality-gate') || e.event.includes('quality_gate') ||
       e.event.includes('violation'))
  ).length;

  const totalViolations = timingViolations + auditViolations;

  const qualityGateSaves = {
    violations_caught: totalViolations,
    tokens_saved_estimate: totalViolations * TOKENS_PER_QUALITY_VIOLATION,
    methodology: 'violations * 8000 tokens (avg fix session avoided)',
  };

  const routingTokens = routingSavings ? routingSavings.tokens_saved_estimate : 0;
  const total = routingTokens + circuitBreakerSaves.tokens_saved_estimate + qualityGateSaves.tokens_saved_estimate;

  return {
    routing_savings_estimate: routingSavings,
    circuit_breaker_saves: circuitBreakerSaves,
    quality_gate_saves: qualityGateSaves,
    total_estimated_savings: total,
  };
}

// ── Citadel value metrics ────────────────────────────────────────────────────

/**
 * Compute a comprehensive "Citadel value" report.
 * Combines token economics (what Citadel caught/saved) with real cost data
 * to tell the full story: what you spent, what you got, what was saved.
 *
 * @returns {{ spend: object, savings: object, hooks: object, value_ratio: number|null }}
 */
function readCitadelValueMetrics() {
  const cost = readCostDashboard();
  const economics = readTokenEconomics();
  const hookTiming = readJsonl(path.join(TELEMETRY_DIR, 'hook-timing.jsonl'));
  const hookErrors = readJsonl(path.join(TELEMETRY_DIR, 'hook-errors.jsonl'));

  // Count hook fires by hook name
  const hookCounts = {};
  for (const e of hookTiming) {
    const hook = e.hook || 'unknown';
    hookCounts[hook] = (hookCounts[hook] || 0) + 1;
  }

  // Count blocks by hook
  const blockCounts = {};
  for (const e of hookErrors) {
    const hook = e.hook || 'unknown';
    blockCounts[hook] = (blockCounts[hook] || 0) + 1;
  }

  // Estimate dollar savings from token savings (use dominant model pricing)
  const pricing = sessionTokens ? sessionTokens.PRICING['claude-opus-4-6'] : { output: 75.00 };
  const tokensSaved = economics.total_estimated_savings;
  const dollarsSaved = tokensSaved > 0
    ? Math.round((tokensSaved / 1_000_000) * pricing.output * 100) / 100
    : 0;

  // Security catches: blocks from protect-files, external-action-gate
  const securityBlocks = (blockCounts['protect-files'] || 0) +
    (blockCounts['external-action-gate'] || 0);

  // Quality catches: blocks from quality-gate
  const qualityBlocks = blockCounts['quality-gate'] || 0;

  return {
    spend: {
      total_cost: cost.total_cost,
      session_count: cost.session_count,
      data_source: cost.data_source,
      by_campaign: cost.by_campaign,
    },
    savings: {
      tokens_saved: tokensSaved,
      dollars_saved: dollarsSaved,
      routing_saves: economics.routing_savings_estimate,
      circuit_breaker_saves: economics.circuit_breaker_saves,
      quality_gate_saves: economics.quality_gate_saves,
    },
    hooks: {
      total_fires: hookTiming.length,
      by_hook: hookCounts,
      total_blocks: hookErrors.length,
      blocks_by_hook: blockCounts,
      security_blocks: securityBlocks,
      quality_blocks: qualityBlocks,
    },
    value_ratio: cost.total_cost > 0
      ? Math.round((dollarsSaved / cost.total_cost) * 100) / 100
      : null,
  };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  readCampaignStats,
  readFleetStats,
  readHooksStats,
  readTelemetryFileStats,
  readCoordinationStats,
  readTokenEconomics,
  readSessionCosts,
  readCostByCampaign,
  readTotalCost,
  estimateSessionCost,
  readRealCostSummary,
  readCostDashboard,
  readCitadelValueMetrics,
  bestCost,
  TOKENS_PER_TIER_RESOLUTION,
  TOKENS_PER_CIRCUIT_TRIP,
  TOKENS_PER_QUALITY_VIOLATION,
  BASE_SESSION_COST,
  COST_PER_SUBAGENT,
  COST_PER_MINUTE,
};

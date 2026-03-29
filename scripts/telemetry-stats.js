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

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const PLANNING_DIR = path.join(ROOT, '.planning');
const TELEMETRY_DIR = path.join(PLANNING_DIR, 'telemetry');
const CAMPAIGNS_DIR = path.join(PLANNING_DIR, 'campaigns');
const FLEET_DIR = path.join(PLANNING_DIR, 'fleet');
const COORD_DIR = path.join(PLANNING_DIR, 'coordination');
const INSTANCES_DIR = path.join(COORD_DIR, 'instances');
const CLAIMS_DIR = path.join(COORD_DIR, 'claims');
const SETTINGS_PATH = path.join(ROOT, '.claude', 'settings.json');

// Token estimation constants
const TOKENS_PER_TIER_RESOLUTION = 500;   // avg Tier 3 cost avoided per Tier 0-2 resolution
const TOKENS_PER_CIRCUIT_TRIP = 15000;    // avg spiral cost before intervention
const TOKENS_PER_QUALITY_VIOLATION = 8000; // avg fix session avoided per violation caught

// ── Generic helpers ───────────────────────────────────────────────────────────

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
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
  const active = [];
  const completedDir = path.join(CAMPAIGNS_DIR, 'completed');

  if (fs.existsSync(CAMPAIGNS_DIR)) {
    const files = fs.readdirSync(CAMPAIGNS_DIR);
    for (const f of files) {
      if (f.endsWith('.md') && !f.startsWith('_')) {
        active.push(f.replace(/\.md$/, ''));
      }
    }
  }

  let completed_count = 0;
  if (fs.existsSync(completedDir)) {
    completed_count = fs.readdirSync(completedDir).filter(f => f.endsWith('.md')).length;
  }

  return { active, completed_count };
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
  const claims = listFiles(CLAIMS_DIR, '.json').filter(f => !f.startsWith('.')).length;
  const instances = listFiles(INSTANCES_DIR, '.json').filter(f => !f.startsWith('.')).length;
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
 * Aggregate costs by campaign slug.
 * Returns a map of campaign slug -> { sessions, total_cost, agents_spawned, total_minutes }.
 * Sessions with no campaign_slug are grouped under "_unattached".
 *
 * When a session has override_cost (user-supplied real cost), that takes precedence
 * over the estimated_cost.
 *
 * @returns {Object<string, {sessions:number, total_cost:number, agents_spawned:number, total_minutes:number}>}
 */
function readCostByCampaign() {
  const events = readSessionCosts();
  const result = {};

  for (const e of events) {
    const slug = e.campaign_slug || '_unattached';
    if (!result[slug]) {
      result[slug] = { sessions: 0, total_cost: 0, agents_spawned: 0, total_minutes: 0 };
    }
    const r = result[slug];
    r.sessions++;
    r.total_cost += (typeof e.override_cost === 'number' ? e.override_cost : (e.estimated_cost || 0));
    r.agents_spawned += (e.agent_count || 0);
    r.total_minutes += (e.duration_minutes || 0);
  }

  return result;
}

/**
 * Get total estimated spend across all campaigns.
 * @returns {{ total: number, by_campaign: Object, session_count: number }}
 */
function readTotalCost() {
  const byCampaign = readCostByCampaign();
  let total = 0;
  let sessionCount = 0;

  for (const slug of Object.keys(byCampaign)) {
    total += byCampaign[slug].total_cost;
    sessionCount += byCampaign[slug].sessions;
  }

  return { total: Math.round(total * 100) / 100, by_campaign: byCampaign, session_count: sessionCount };
}

/**
 * Compute estimated cost for a single session based on agent activity.
 * Used by session-end hook to log cost events.
 *
 * @param {number} agentCount - Number of sub-agents spawned this session
 * @param {number} durationMinutes - Session duration in minutes
 * @returns {number} Estimated cost in dollars (rounded to 2 decimal places)
 */
function estimateSessionCost(agentCount, durationMinutes) {
  const cost = BASE_SESSION_COST + (agentCount * COST_PER_SUBAGENT) + (durationMinutes * COST_PER_MINUTE);
  return Math.round(cost * 100) / 100;
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
  TOKENS_PER_TIER_RESOLUTION,
  TOKENS_PER_CIRCUIT_TRIP,
  TOKENS_PER_QUALITY_VIOLATION,
  BASE_SESSION_COST,
  COST_PER_SUBAGENT,
  COST_PER_MINUTE,
};

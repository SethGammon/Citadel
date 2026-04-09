'use strict';

/**
 * synthesizer.js — Aggregate cross-session discoveries into a momentum signal.
 *
 * Reads all .planning/discoveries/*.jsonl records and produces
 * .planning/momentum.json — a ranked summary of:
 *   - Active work scopes (recency + frequency weighted)
 *   - Recurring decisions (seen across multiple sessions)
 *   - Recent failures (anti-patterns to avoid)
 *   - Recent handoff items (what was built)
 *
 * Fleet reads momentum.json at session start and injects it as
 * "Prior Session Context" into Wave 1 agents. This is the cross-session
 * institutional memory layer.
 */

const fs = require('fs');
const path = require('path');
const { readAllDiscoveries } = require('../fleet/discovery-writer');

const SCHEMA_VERSION = 1;
const RECENCY_HALF_LIFE_DAYS = 7;

/**
 * Exponential decay weight: recent records score higher.
 * At 7 days old = 0.5 weight; at 14 days = 0.25; at 28 days = 0.06.
 */
function recencyWeight(timestamp) {
  const ageMs = Date.now() - new Date(timestamp).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return Math.exp((-ageDays * Math.LN2) / RECENCY_HALF_LIFE_DAYS);
}

/**
 * Build the momentum object from all discovery records.
 * @param {string} projectRoot
 * @returns {object} momentum
 */
function synthesize(projectRoot) {
  const records = readAllDiscoveries(projectRoot);

  const scopeMap = new Map();   // scope → { sessions, last_worked, score }
  const decisionMap = new Map(); // normalized key → { decision, count, sessions, last_seen }
  const recentFailures = [];
  const recentHandoffs = [];

  for (const record of records) {
    const weight = recencyWeight(record.timestamp);

    for (const scope of (record.scope || [])) {
      if (!scopeMap.has(scope)) {
        scopeMap.set(scope, { scope, sessions: new Set(), last_worked: record.timestamp, score: 0 });
      }
      const s = scopeMap.get(scope);
      s.sessions.add(record.session);
      s.score += weight;
      if (record.timestamp > s.last_worked) s.last_worked = record.timestamp;
    }

    for (const decision of (record.decisions || [])) {
      const key = decision.slice(0, 80).toLowerCase().trim();
      if (!decisionMap.has(key)) {
        decisionMap.set(key, { decision, count: 0, sessions: new Set(), last_seen: record.timestamp });
      }
      const d = decisionMap.get(key);
      d.count++;
      d.sessions.add(record.session);
      if (record.timestamp > d.last_seen) d.last_seen = record.timestamp;
    }

    for (const failure of (record.failures || [])) {
      recentFailures.push({
        failure,
        agent: record.agent,
        session: record.session,
        timestamp: record.timestamp,
      });
    }

    for (const item of (record.handoff_items || [])) {
      recentHandoffs.push({
        item,
        session: record.session,
        agent: record.agent,
        timestamp: record.timestamp,
      });
    }
  }

  const active_scopes = [...scopeMap.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(s => ({ scope: s.scope, session_count: s.sessions.size, last_worked: s.last_worked }));

  // Only surface decisions seen more than once — single-occurrence decisions are noise
  const recurring_decisions = [...decisionMap.values()]
    .filter(d => d.count >= 2 || d.sessions.size >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 15)
    .map(d => ({ decision: d.decision, count: d.count, session_count: d.sessions.size, last_seen: d.last_seen }));

  const recent_failures = recentFailures
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 10);

  const recent_handoffs = recentHandoffs
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 20);

  return {
    schema: SCHEMA_VERSION,
    updated: new Date().toISOString(),
    discovery_count: records.length,
    active_scopes,
    recurring_decisions,
    recent_failures,
    recent_handoffs,
  };
}

/**
 * Synthesize and write momentum.json.
 * @param {string} projectRoot
 * @returns {{ file: string, momentum: object }}
 */
function writeMomentum(projectRoot) {
  const momentum = synthesize(projectRoot);
  const file = path.join(projectRoot, '.planning', 'momentum.json');
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(momentum, null, 2));
  return { file, momentum };
}

/**
 * Read existing momentum.json. Returns null if missing or invalid.
 * @param {string} projectRoot
 * @returns {object|null}
 */
function readMomentum(projectRoot) {
  const file = path.join(projectRoot, '.planning', 'momentum.json');
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/**
 * Format momentum as a context-injection block for Fleet agents.
 * Returns null if momentum is empty or missing.
 * @param {object|null} momentum
 * @returns {string|null}
 */
function formatMomentumContext(momentum) {
  if (!momentum || momentum.discovery_count === 0) return null;

  const lines = ['=== PRIOR SESSION CONTEXT ==='];
  lines.push(`${momentum.discovery_count} discoveries across all sessions. Updated: ${momentum.updated.slice(0, 10)}`);

  if (momentum.active_scopes.length > 0) {
    lines.push('\nActive work areas (recent + frequent):');
    for (const s of momentum.active_scopes.slice(0, 5)) {
      lines.push(`  ${s.scope}  (${s.session_count} sessions, last: ${s.last_worked.slice(0, 10)})`);
    }
  }

  if (momentum.recurring_decisions.length > 0) {
    lines.push('\nEstablished decisions (seen across multiple sessions — respect these):');
    for (const d of momentum.recurring_decisions.slice(0, 8)) {
      lines.push(`  - ${d.decision}  [${d.count}x, ${d.session_count} sessions]`);
    }
  }

  if (momentum.recent_failures.length > 0) {
    lines.push('\nRecent failures (avoid repeating):');
    for (const f of momentum.recent_failures.slice(0, 5)) {
      lines.push(`  - ${f.failure}  (${f.agent}, ${f.timestamp.slice(0, 10)})`);
    }
  }

  if (momentum.recent_handoffs.length > 0) {
    lines.push('\nRecently built (may inform your scope):');
    for (const h of momentum.recent_handoffs.slice(0, 8)) {
      lines.push(`  - ${h.item}  (${h.agent}, ${h.timestamp.slice(0, 10)})`);
    }
  }

  lines.push('=== END PRIOR SESSION CONTEXT ===');
  return lines.join('\n');
}

module.exports = { synthesize, writeMomentum, readMomentum, formatMomentumContext };

#!/usr/bin/env node

/**
 * permission-audit.js — Permission audit report from hook telemetry.
 *
 * Reads .planning/telemetry/permission-events.jsonl (written by
 * hooks_src/permission-request.js on PermissionRequest and PermissionDenied)
 * plus historical permission-request entries from audit.jsonl, and renders
 * a text report:
 *   - totals by tool
 *   - top 10 targets
 *   - denials (if any recorded)
 *   - busiest hour buckets
 *   - anomaly flag (denial rate > 20% or one tool > 80% of requests)
 *
 * Usage:
 *   node scripts/permission-audit.js [--root <projectRoot>]
 *
 * Zero dependencies. Read-only. Always exits 0 unless given a bad --root.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DENIAL_RATE_THRESHOLD = 0.20;   // flag if more than 20% denied
const TOOL_DOMINANCE_THRESHOLD = 0.80; // flag if one tool exceeds 80% of requests
const TOP_TARGETS = 10;
const TOP_HOURS = 5;

function resolveRoot() {
  const idx = process.argv.indexOf('--root');
  if (idx !== -1 && process.argv[idx + 1]) {
    return path.resolve(process.argv[idx + 1]);
  }
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

function readJsonl(file) {
  try {
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Load permission events from both sources, normalized to
 * { ts, tool, target, decision }.
 *
 * audit.jsonl entries (event === 'permission-request') predate the dedicated
 * log; to avoid double counting we only include audit entries older than the
 * earliest record in permission-events.jsonl.
 */
function loadEvents(root) {
  const telemetryDir = path.join(root, '.planning', 'telemetry');
  const dedicated = readJsonl(path.join(telemetryDir, 'permission-events.jsonl'))
    .filter((e) => e && e.ts)
    .map((e) => ({
      ts: e.ts,
      tool: e.tool || 'unknown',
      target: e.target || '',
      decision: e.decision || 'deferred',
    }));

  const earliestDedicated = dedicated.length
    ? dedicated.reduce((min, e) => (e.ts < min ? e.ts : min), dedicated[0].ts)
    : null;

  const historical = readJsonl(path.join(telemetryDir, 'audit.jsonl'))
    .filter((e) => e && e.event === 'permission-request' && e.timestamp)
    .filter((e) => earliestDedicated === null || e.timestamp < earliestDedicated)
    .map((e) => ({
      ts: e.timestamp,
      tool: e.tool || 'unknown',
      target: e.target || '',
      decision: e.decision || 'deferred',
    }));

  return historical.concat(dedicated).sort((a, b) => (a.ts < b.ts ? -1 : 1));
}

function countBy(events, keyFn) {
  const counts = new Map();
  for (const e of events) {
    const key = keyFn(e);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

function pct(n, total) {
  return total ? ((n / total) * 100).toFixed(1) + '%' : '0.0%';
}

function isDenial(e) {
  return e.decision === 'deny' || e.decision === 'denied';
}

function buildReport(events) {
  const lines = [];
  const total = events.length;

  lines.push('Permission Audit Report');
  lines.push('=======================');
  lines.push('');

  if (total === 0) {
    lines.push('No permission telemetry recorded yet.');
    lines.push('Events appear in .planning/telemetry/permission-events.jsonl once the');
    lines.push('PermissionRequest hook fires. Run a session that triggers a permission');
    lines.push('prompt, then re-run this report.');
    return lines.join('\n');
  }

  lines.push(`Total permission events: ${total}`);
  lines.push(`Window: ${events[0].ts} to ${events[total - 1].ts}`);
  lines.push('');

  // Totals by tool
  lines.push('Totals by tool');
  lines.push('--------------');
  const byTool = countBy(events, (e) => e.tool || 'unknown');
  for (const [tool, count] of byTool) {
    lines.push(`  ${tool.padEnd(18)} ${String(count).padStart(5)}  (${pct(count, total)})`);
  }
  lines.push('');

  // Top targets
  lines.push(`Top ${TOP_TARGETS} targets`);
  lines.push('--------------');
  const byTarget = countBy(events.filter((e) => e.target), (e) => e.target);
  if (byTarget.length === 0) {
    lines.push('  (no targets recorded)');
  } else {
    for (const [target, count] of byTarget.slice(0, TOP_TARGETS)) {
      lines.push(`  ${String(count).padStart(5)}  ${target}`);
    }
  }
  lines.push('');

  // Denials
  const denials = events.filter(isDenial);
  lines.push('Denials');
  lines.push('-------');
  if (denials.length === 0) {
    lines.push('  None recorded.');
  } else {
    lines.push(`  ${denials.length} of ${total} events denied (${pct(denials.length, total)})`);
    for (const [target, count] of countBy(denials, (e) => `${e.tool}: ${e.target || '(no target)'}`).slice(0, TOP_TARGETS)) {
      lines.push(`  ${String(count).padStart(5)}  ${target}`);
    }
  }
  lines.push('');

  // Busiest hour buckets (UTC hour of day)
  lines.push('Busiest hours (UTC)');
  lines.push('-------------------');
  const byHour = countBy(
    events.filter((e) => /T\d{2}/.test(e.ts)),
    (e) => e.ts.slice(11, 13) + ':00'
  );
  if (byHour.length === 0) {
    lines.push('  (no parseable timestamps)');
  } else {
    for (const [hour, count] of byHour.slice(0, TOP_HOURS)) {
      lines.push(`  ${hour}  ${String(count).padStart(5)}  (${pct(count, total)})`);
    }
  }
  lines.push('');

  // Anomaly detection
  const anomalies = [];
  const denialRate = denials.length / total;
  if (denialRate > DENIAL_RATE_THRESHOLD) {
    anomalies.push(`denial rate ${pct(denials.length, total)} exceeds ${DENIAL_RATE_THRESHOLD * 100}%`);
  }
  if (byTool.length > 1 || total >= 5) {
    const [topTool, topCount] = byTool[0];
    if (topCount / total > TOOL_DOMINANCE_THRESHOLD) {
      anomalies.push(`tool "${topTool}" accounts for ${pct(topCount, total)} of requests (over ${TOOL_DOMINANCE_THRESHOLD * 100}%)`);
    }
  }

  if (anomalies.length > 0) {
    lines.push(`ANOMALY: ${anomalies.join('; ')}`);
  } else {
    lines.push('No anomalies detected.');
  }

  return lines.join('\n');
}

function main() {
  const root = resolveRoot();
  const events = loadEvents(root);
  process.stdout.write(buildReport(events) + '\n');
  process.exit(0);
}

if (require.main === module) main();

module.exports = { loadEvents, buildReport };

'use strict';

/**
 * discovery-writer.js — Write structured agent discoveries to a persistent JSONL store.
 *
 * Each agent that completes (via Fleet or Daemon) writes one record here.
 * Records accumulate across sessions. The momentum synthesizer reads them all
 * to build a cross-session signal that Fleet injects into Wave 1 context.
 *
 * File layout: .planning/discoveries/YYYY-MM-DD.jsonl (daily rotation)
 */

const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    const val = argv[i + 1];
    if (key === '--session') { args.session = val; i++; }
    else if (key === '--agent') { args.agent = val; i++; }
    else if (key === '--wave') { args.wave = parseInt(val, 10); i++; }
    else if (key === '--status') { args.status = val; i++; }
    else if (key === '--scope') { args.scope = val; i++; }
    else if (key === '--handoff') {
      try { args.handoff_items = JSON.parse(val); } catch { args.handoff_items = []; }
      i++;
    }
    else if (key === '--decisions') {
      try { args.decisions = JSON.parse(val); } catch { args.decisions = []; }
      i++;
    }
    else if (key === '--files') {
      try { args.files_touched = JSON.parse(val); } catch { args.files_touched = []; }
      i++;
    }
    else if (key === '--failures') {
      try { args.failures = JSON.parse(val); } catch { args.failures = []; }
      i++;
    }
  }
  return args;
}

/**
 * Write one discovery record.
 * @param {string} projectRoot - Absolute path to project root
 * @param {object} entry - Discovery fields
 * @returns {{ file: string, record: object }}
 */
function writeDiscovery(projectRoot, entry) {
  const date = new Date().toISOString().slice(0, 10);
  const dir = path.join(projectRoot, '.planning', 'discoveries');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const file = path.join(dir, `${date}.jsonl`);
  const record = {
    schema: SCHEMA_VERSION,
    timestamp: new Date().toISOString(),
    session: entry.session || null,
    agent: entry.agent || 'unknown',
    wave: typeof entry.wave === 'number' && !isNaN(entry.wave) ? entry.wave : null,
    scope: Array.isArray(entry.scope) ? entry.scope
      : typeof entry.scope === 'string' ? entry.scope.split(',').map(s => s.trim()).filter(Boolean)
      : [],
    status: entry.status || 'success',
    handoff_items: Array.isArray(entry.handoff_items) ? entry.handoff_items : [],
    decisions: Array.isArray(entry.decisions) ? entry.decisions : [],
    files_touched: Array.isArray(entry.files_touched) ? entry.files_touched : [],
    failures: Array.isArray(entry.failures) ? entry.failures : [],
  };

  fs.appendFileSync(file, JSON.stringify(record) + '\n');
  return { file, record };
}

/**
 * Read all discovery records from all daily JSONL files, sorted oldest-first.
 * @param {string} projectRoot
 * @returns {object[]}
 */
function readAllDiscoveries(projectRoot) {
  const dir = path.join(projectRoot, '.planning', 'discoveries');
  if (!fs.existsSync(dir)) return [];

  const records = [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort();
  for (const file of files) {
    const lines = fs.readFileSync(path.join(dir, file), 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try { records.push(JSON.parse(line)); } catch { /* skip malformed */ }
    }
  }
  return records;
}

module.exports = { writeDiscovery, readAllDiscoveries, parseArgs, SCHEMA_VERSION };

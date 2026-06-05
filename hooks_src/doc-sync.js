#!/usr/bin/env node

/**
 * doc-sync.js - Standalone doc staleness processor
 *
 * Reads .planning/telemetry/doc-sync-queue.jsonl for pending staleness events
 * written by hooks during a session, then surfaces them to the agent at
 * session end or on manual invocation so documentation can be reviewed.
 *
 * It never modifies documentation. It only updates queue state and writes a
 * small review report under .planning/doc-sync/.
 *
 * Usage:
 *   node hooks_src/doc-sync.js                      # process full queue
 *   node hooks_src/doc-sync.js --dry-run            # show queue without marking
 *   node hooks_src/doc-sync.js --project-root path  # process another project
 */

'use strict';

const fs = require('fs');
const path = require('path');

let PROJECT_ROOT;
try {
  const health = require('./harness-health-util');
  PROJECT_ROOT = health.PROJECT_ROOT;
} catch {
  PROJECT_ROOT = process.cwd();
}

const ACTIONABLE_STATUSES = new Set(['needs-review', 'pending']);
const CITADEL_UI = process.env.CITADEL_UI === 'true';

function parseArgs(argv) {
  const args = {
    dryRun: false,
    projectRoot: PROJECT_ROOT,
  };

  for (let index = 2; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--project-root') args.projectRoot = path.resolve(argv[++index]);
    else if (arg === '--help' || arg === '-h') args.help = true;
  }

  return args;
}

function usage() {
  return [
    'Usage: node hooks_src/doc-sync.js [--dry-run] [--project-root path]',
    '',
    'Processes .planning/telemetry/doc-sync-queue.jsonl and writes',
    '.planning/doc-sync/latest.md without changing documentation files.',
  ].join('\n');
}

function hookOutput(hookName, action, message, data = {}) {
  if (CITADEL_UI) {
    process.stdout.write(JSON.stringify({
      hook: hookName,
      action,
      message,
      timestamp: new Date().toISOString(),
      data,
    }));
  } else {
    process.stdout.write(message);
  }
}

function readEntries(queuePath) {
  if (!fs.existsSync(queuePath)) return { exists: false, entries: [], malformed: 0 };
  const raw = fs.readFileSync(queuePath, 'utf8');
  const lines = raw.split('\n').filter(line => line.trim().length > 0);
  const entries = [];
  let malformed = 0;

  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      malformed++;
    }
  }

  return { exists: true, entries, malformed };
}

function eventTime(entry) {
  return entry.timestamp || entry.time || entry.created_at || null;
}

function summarizeEntries(projectRoot, entries) {
  const pending = entries.filter(entry => ACTIONABLE_STATUSES.has(entry.status));
  const byFile = new Map();
  const general = [];
  const deleted = [];

  for (const entry of pending) {
    if (!entry.file) {
      general.push(entry);
      continue;
    }

    const absolutePath = path.isAbsolute(entry.file) ? entry.file : path.join(projectRoot, entry.file);
    if (!fs.existsSync(absolutePath)) {
      deleted.push(entry);
      continue;
    }

    if (!byFile.has(entry.file)) {
      byFile.set(entry.file, {
        file: entry.file,
        events: [],
        firstSeen: eventTime(entry),
        lastSeen: eventTime(entry),
      });
    }

    const item = byFile.get(entry.file);
    item.events.push(entry);
    const timestamp = eventTime(entry);
    if (!timestamp) continue;
    if (!item.firstSeen || new Date(timestamp) < new Date(item.firstSeen)) item.firstSeen = timestamp;
    if (!item.lastSeen || new Date(timestamp) > new Date(item.lastSeen)) item.lastSeen = timestamp;
  }

  return {
    pending,
    files: [...byFile.values()].sort((left, right) => left.file.localeCompare(right.file)),
    general,
    deleted,
  };
}

function renderReport(projectRoot, summary, options = {}) {
  const generatedAt = options.now || new Date().toISOString();
  const lines = [];

  lines.push('# Doc Sync Review');
  lines.push('');
  lines.push(`Generated: ${generatedAt}`);
  lines.push(`Project: ${projectRoot}`);
  lines.push(`Pending entries: ${summary.pending.length}`);
  lines.push(`Files needing review: ${summary.files.length}`);
  lines.push(`General events: ${summary.general.length}`);
  lines.push(`Deleted/missing files skipped: ${summary.deleted.length}`);
  lines.push('');

  if (summary.files.length > 0) {
    lines.push('## Files');
    lines.push('');
    for (const item of summary.files) {
      const triggers = [...new Set(item.events.map(entry => entry.event || entry.trigger || 'doc-sync'))].join(', ');
      lines.push(`- ${item.file}`);
      lines.push(`  - Events: ${item.events.length}`);
      lines.push(`  - Triggers: ${triggers}`);
      if (item.lastSeen) lines.push(`  - Last seen: ${item.lastSeen}`);
    }
    lines.push('');
  }

  if (summary.general.length > 0) {
    lines.push('## General Events');
    lines.push('');
    const groups = new Map();
    for (const entry of summary.general) {
      const key = entry.event || 'doc-sync';
      groups.set(key, (groups.get(key) || 0) + 1);
    }
    for (const [event, count] of [...groups.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
      lines.push(`- ${event}: ${count}`);
    }
    lines.push('');
  }

  lines.push('## Suggested Review');
  lines.push('');
  if (summary.files.length === 0 && summary.general.length === 0) {
    lines.push('- No actionable doc-sync entries remain.');
  } else {
    lines.push('- Check whether the flagged guidance still matches current code and project behavior.');
    lines.push('- Update nearby README, JSDoc/docstrings, AGENTS.md, CLAUDE.md, or rule files only when source evidence supports it.');
    lines.push('- Leave source files unchanged unless the documentation review uncovers a separate implementation bug.');
  }
  lines.push('');

  return lines.join('\n');
}

function writeReport(projectRoot, summary, options = {}) {
  const dir = path.join(projectRoot, '.planning', 'doc-sync');
  fs.mkdirSync(dir, { recursive: true });
  const reportPath = path.join(dir, 'latest.md');
  fs.writeFileSync(reportPath, renderReport(projectRoot, summary, options) + '\n', 'utf8');
  return reportPath;
}

function updateQueue(queuePath, entries, summary, options = {}) {
  const now = options.now || new Date().toISOString();
  const fileSet = new Set(summary.files.map(item => item.file));
  const deletedSet = new Set(summary.deleted);
  const generalSet = new Set(summary.general);

  const updated = entries.map((entry) => {
    if (!ACTIONABLE_STATUSES.has(entry.status)) return entry;
    if (entry.file && fileSet.has(entry.file)) return { ...entry, status: 'surfaced', surfacedAt: now };
    if (deletedSet.has(entry)) return { ...entry, status: 'skipped-deleted', surfacedAt: now };
    if (generalSet.has(entry)) return { ...entry, status: 'surfaced', surfacedAt: now };
    return entry;
  });

  fs.writeFileSync(queuePath, updated.map(entry => JSON.stringify(entry)).join('\n') + (updated.length ? '\n' : ''), 'utf8');
}

function processDocSyncQueue(projectRoot, options = {}) {
  const queuePath = path.join(projectRoot, '.planning', 'telemetry', 'doc-sync-queue.jsonl');
  const detail = readEntries(queuePath);
  if (!detail.exists) {
    return {
      ok: true,
      queuePath,
      reportPath: null,
      exists: false,
      entries: 0,
      malformed: 0,
      summary: { pending: [], files: [], general: [], deleted: [] },
    };
  }

  const summary = summarizeEntries(projectRoot, detail.entries);
  let reportPath = null;
  if (!options.dryRun && (summary.pending.length > 0 || options.writeEmptyReport)) {
    reportPath = writeReport(projectRoot, summary, options);
  }

  if (!options.dryRun && summary.pending.length > 0) {
    updateQueue(queuePath, detail.entries, summary, options);
  }

  return {
    ok: true,
    queuePath,
    reportPath,
    exists: true,
    entries: detail.entries.length,
    malformed: detail.malformed,
    summary,
  };
}

function renderResult(result) {
  if (!result.exists) return '[doc-sync] No queue file found - nothing to process.\n';
  if (result.entries === 0) return '[doc-sync] Queue is empty - no doc updates needed.\n';
  if (result.summary.pending.length === 0) return '[doc-sync] All items already surfaced - nothing new.\n';

  const lines = [];
  lines.push(`[doc-sync] ${result.summary.pending.length} item(s) processed.`);
  if (result.summary.files.length > 0) {
    lines.push(`${result.summary.files.length} file(s) may need doc updates:`);
    for (const item of result.summary.files) lines.push(`  - ${item.file}`);
  } else {
    lines.push('No existing files were flagged for direct review.');
  }
  if (result.summary.general.length > 0) lines.push(`${result.summary.general.length} general event(s) surfaced.`);
  if (result.summary.deleted.length > 0) lines.push(`${result.summary.deleted.length} item(s) skipped because the source file no longer exists.`);
  if (result.reportPath) lines.push(`Report: ${path.relative(process.cwd(), result.reportPath).replace(/\\/g, '/')}`);
  else if (result.summary.pending.length > 0) lines.push('Report: not written (dry run)');
  if (result.malformed > 0) lines.push(`Malformed queue lines skipped: ${result.malformed}`);
  lines.push('');
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  try {
    const result = processDocSyncQueue(args.projectRoot, { dryRun: args.dryRun });
    hookOutput('doc-sync', 'info', renderResult(result), {
      files: result.summary.files.map(item => item.file),
      general: result.summary.general.length,
      skipped: result.summary.deleted.length,
      report: result.reportPath,
    });
  } catch (err) {
    process.stderr.write('[doc-sync] Failed to process queue: ' + err.message + '\n');
  }

  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = {
  ACTIONABLE_STATUSES,
  parseArgs,
  processDocSyncQueue,
  renderReport,
  renderResult,
  summarizeEntries,
};

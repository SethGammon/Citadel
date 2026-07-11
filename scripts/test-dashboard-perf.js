#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');

const { createDataSource, deriveViews } = require('./dashboard-server');

const FILE_COUNT = 1000;
const COLD_BUDGET_MS = 1000;
const UPDATE_BUDGET_MS = 500;
const ABSOLUTE_RSS_BUDGET_MB = 64;
const RSS_OVERHEAD_BUDGET_MB = 10;

function write(root, relativePath, value) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, value);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-dashboard-perf-'));
try {
  const baselineRss = process.memoryUsage().rss;
  for (let index = 0; index < FILE_COUNT; index++) {
    write(root, `.planning/handoffs/${String(index).padStart(4, '0')}.md`, `# Handoff ${index}\n\nDeterministic fixture.\n`);
  }
  write(root, '.planning/telemetry/hook-timing.jsonl', `${JSON.stringify({ timestamp: '2026-07-10T12:00:00.000Z', hook: 'quality-gate', duration_ms: 3 })}\n`);
  write(root, '.planning/product-proof/activation-report.json', JSON.stringify({
    schema: 1, redacted: true, transmitted: false, total_events: 0,
    unique_installations: 0, invalid_events: 0, migrated_events: 0,
    by_stage: {}, by_status: {}, by_failure_code: {}, by_acquisition_source: {},
  }));

  const coldStart = performance.now();
  const source = createDataSource(root);
  const initial = deriveViews(source.get());
  const coldMs = performance.now() - coldStart;
  assert.equal(initial.handoffs.handoffs.length, 50, 'handoff projection remains bounded');

  write(root, '.planning/handoffs/change.md', '# Changed\n');
  const updateStart = performance.now();
  source.invalidate();
  const updated = deriveViews(source.get());
  const updateMs = performance.now() - updateStart;
  assert(updated.handoffs.handoffs.some((entry) => entry.name === 'change.md'));

  const rssMb = process.memoryUsage().rss / 1024 / 1024;
  const rssOverheadMb = (process.memoryUsage().rss - baselineRss) / 1024 / 1024;
  assert(coldMs < COLD_BUDGET_MS, `cold start ${coldMs.toFixed(1)}ms exceeds ${COLD_BUDGET_MS}ms`);
  assert(updateMs < UPDATE_BUDGET_MS, `update ${updateMs.toFixed(1)}ms exceeds ${UPDATE_BUDGET_MS}ms`);
  // Node's platform baseline varies materially. Gate both the complete process and
  // the memory attributable to indexing/rendering the fixture so neither can hide
  // behind the other.
  assert(rssMb < ABSOLUTE_RSS_BUDGET_MB, `dashboard RSS ${rssMb.toFixed(1)}MB exceeds ${ABSOLUTE_RSS_BUDGET_MB}MB`);
  assert(rssOverheadMb < RSS_OVERHEAD_BUDGET_MB, `dashboard RSS overhead ${rssOverheadMb.toFixed(1)}MB exceeds ${RSS_OVERHEAD_BUDGET_MB}MB`);

  console.log(JSON.stringify({
    schema: 1, fixture_files: FILE_COUNT, cold_ms: Number(coldMs.toFixed(1)),
    update_ms: Number(updateMs.toFixed(1)), rss_mb: Number(rssMb.toFixed(1)),
    rss_overhead_mb: Number(rssOverheadMb.toFixed(1)), absolute_rss_gate: rssMb < ABSOLUTE_RSS_BUDGET_MB, budgets: {
      cold_ms: COLD_BUDGET_MS, update_ms: UPDATE_BUDGET_MS, absolute_rss_mb: ABSOLUTE_RSS_BUDGET_MB,
      portable_rss_overhead_mb: RSS_OVERHEAD_BUDGET_MB,
    },
  }, null, 2));
  console.log('dashboard performance budgets passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

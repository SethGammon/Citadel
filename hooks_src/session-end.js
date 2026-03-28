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

const PROJECT_ROOT = health.PROJECT_ROOT;

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    let event = {};
    try { event = JSON.parse(input); } catch { /* partial input ok */ }

    health.increment('session-end', 'count');

    // Log session end
    health.logTiming('session-end', 0, {
      event: 'session-end',
      session_id: event.session_id || null,
    });

    // Check for active campaigns and mark continuation point
    markCampaignContinuation();

    // Clean up expired dynamic directories per organization manifest
    cleanupDynamicDirectories();

    // Write doc sync queue entry (Tier 6 - processed by next session or doc-sync hook)
    queueDocSync();

    process.exit(0);
  });
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

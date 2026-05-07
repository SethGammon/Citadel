#!/usr/bin/env node

/**
 * intake-scanner.js — SessionStart hook
 *
 * Reports pending work items from .planning/intake/ on every new session.
 * Gives Claude awareness of what needs attention without human prompting.
 */

const fs = require('fs');
const path = require('path');
const health = require('./harness-health-util');

const CITADEL_UI = process.env.CITADEL_UI === 'true';

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

const PROJECT_ROOT = health.PROJECT_ROOT;
const INTAKE_DIR = path.join(PROJECT_ROOT, '.planning', 'intake');

function main() {
  try {
    run();
  } catch (err) {
    // Non-critical hook: log the error but don't block the session
    hookOutput('intake-scanner', 'error',
      `[intake-scanner] Could not scan intake directory: ${err.message || 'unknown error'}. ` +
      `This is non-critical — your session will continue normally. ` +
      `If this persists, check that .planning/intake/ exists and contains valid .md files.`,
      { error: err.message || 'unknown error' }
    );
    process.exit(0); // Non-critical: allow session to continue
  }
}

function run() {
  health.increment('intake-scanner', 'count');

  if (!fs.existsSync(INTAKE_DIR)) {
    process.exit(0);
  }

  // Check for uncompiled wiki staging entries (before the files early-exit so wiki-only
  // sessions still surface the message even when the intake directory is empty)
  const wikiStagingDir = path.join(PROJECT_ROOT, '.planning', 'wiki', '_staging');
  let stagedCount = 0;
  if (fs.existsSync(wikiStagingDir)) {
    try {
      const stagingFiles = fs.readdirSync(wikiStagingDir).filter(f => f.endsWith('.jsonl'));
      const wikiIndexPath = path.join(PROJECT_ROOT, '.planning', 'wiki', 'index.md');
      if (stagingFiles.length > 0) {
        // Surface if any staging file is newer than the wiki index (or index doesn't exist)
        let indexMtime = 0;
        try {
          if (fs.existsSync(wikiIndexPath)) {
            indexMtime = fs.statSync(wikiIndexPath).mtimeMs;
          }
        } catch { /* ignore */ }
        for (const sf of stagingFiles) {
          try {
            const sfMtime = fs.statSync(path.join(wikiStagingDir, sf)).mtimeMs;
            if (sfMtime > indexMtime) { stagedCount++; }
          } catch { /* ignore */ }
        }
      }
    } catch { /* non-critical */ }
  }

  const files = fs.readdirSync(INTAKE_DIR).filter(f =>
    f.endsWith('.md') && !f.startsWith('_') && !f.startsWith('.')
  );

  if (files.length === 0 && stagedCount === 0) {
    process.exit(0);
  }

  const items = [];
  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(path.join(INTAKE_DIR, file), 'utf8');
    } catch (err) {
      // Skip unreadable files rather than crashing
      hookOutput('intake-scanner', 'warned',
        `[intake-scanner] Could not read ${file}: ${err.message}. Skipping.`,
        { file, error: err.message }
      );
      continue;
    }
    const titleMatch = content.match(/^title:\s*"?(.+?)"?\s*$/m);
    const statusMatch = content.match(/^status:\s*(\w+)/m);
    const status = statusMatch ? statusMatch[1] : 'pending';

    if (status === 'completed' || status === 'archived') continue;

    items.push({
      file: file.replace('.md', ''),
      title: titleMatch ? titleMatch[1] : file.replace('.md', '').replace(/-/g, ' '),
      status,
    });
  }

  if (items.length === 0 && stagedCount === 0) {
    process.exit(0);
  }

  const pending = items.filter(i => i.status === 'pending');
  const inProgress = items.filter(i => i.status === 'in-progress' || i.status === 'briefed');

  if (pending.length === 0 && inProgress.length === 0 && stagedCount === 0) {
    process.exit(0);
  }

  const lines = ['[Intake] Work items detected:'];

  if (pending.length > 0) {
    lines.push(`  ${pending.length} pending:`);
    for (const item of pending) {
      lines.push(`    → ${item.file}: "${item.title}"`);
    }
  }

  if (inProgress.length > 0) {
    lines.push(`  ${inProgress.length} in progress:`);
    for (const item of inProgress) {
      lines.push(`    → ${item.file}: "${item.title}" [${item.status}]`);
    }
  }

  if (stagedCount > 0) {
    lines.push(`  ${stagedCount} wiki finding(s) staged but not compiled:`);
    lines.push(`    → Run /learn --compile to integrate into .planning/wiki/`);
  }

  lines.push('  Run /do status for details, or /autopilot to process pending items.');

  hookOutput('intake-scanner', 'allowed', lines.join('\n'), {
    pending: pending.map(i => i.file),
    inProgress: inProgress.map(i => i.file),
  });
  process.exit(0);
}

main();

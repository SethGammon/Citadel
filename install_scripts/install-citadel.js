#!/usr/bin/env node
'use strict';

// ── install-citadel.js ────────────────────────────────────────────────────────
// Installs Citadel (https://github.com/SethGammon/Citadel) into a project.
// Usage: node <path>/install-citadel.js --source=<citadel-clone> --target=<project>
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require('fs');
const path = require('path');

// ── Constants ─────────────────────────────────────────────────────────────────

const CITADEL_MARKERS = [
  '.claude/skills/do',
  '.claude/skills/archon',
  '.claude/skills/marshal',
];

// Top-level directories/files from Citadel to install (everything else skipped)
const INSTALL_PATHS = ['.claude', '.planning', 'scripts'];

// Valid values for the --conflict flag
const CONFLICT_MODES = ['overwrite', 'skip', 'backup'];

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Throws if the Node version string is below 18.
 * @param {string} versionString  e.g. 'v18.0.0'
 */
function checkNodeVersion(versionString) {
  const major = parseInt(versionString.replace(/^v/, '').split('.')[0], 10);
  if (major < 18) {
    throw new Error(
      `Node 18+ required. Current version: ${versionString}\n` +
      'Please upgrade Node.js before running this script.'
    );
  }
}

/**
 * Returns true if the given directory looks like a Citadel repo.
 * @param {string} dir  Absolute path to the candidate directory
 */
function isCitadelRepo(dir) {
  return CITADEL_MARKERS.every(marker =>
    fs.existsSync(path.join(dir, marker))
  );
}

// ── File utilities ────────────────────────────────────────────────────────────

/** Counts lines in a string. Splits on newline; a trailing newline produces one extra empty element. */
function countLines(content) {
  return content.split('\n').length;
}

/** Returns the backup path for a given file path. */
function backupPath(filePath) {
  return filePath + '.citadel-bak';
}

/**
 * Backs up a file to <file>.citadel-bak. Silently overwrites any existing backup.
 * @param {string} destFile  Absolute path to the file being backed up
 */
function backupFile(destFile) {
  fs.copyFileSync(destFile, backupPath(destFile));
}

// ── Path normalisation ────────────────────────────────────────────────────────

/**
 * Strips the $CLAUDE_PROJECT_DIR/ prefix from a hook command string for comparison.
 * Only strips the specific env-var prefix — other absolute paths are left as-is.
 * Input:  node "$CLAUDE_PROJECT_DIR/.claude/hooks/foo.js"
 * Output: node .claude/hooks/foo.js
 */
function normaliseCommand(cmd) {
  return cmd.replace(/"?\$CLAUDE_PROJECT_DIR\/([^"\s]+)"?/g, '$1');
}

/**
 * Returns true if two hook command strings refer to the same hook
 * (ignoring $CLAUDE_PROJECT_DIR prefix differences).
 */
function commandsEquivalent(a, b) {
  return normaliseCommand(a) === normaliseCommand(b);
}

// ── settings.json merge ───────────────────────────────────────────────────────

/**
 * Merges two arrays of hook event entries. Groups by matcher, deduplicates by command.
 * Matcher grouping takes priority: entries with same matcher are merged first,
 * then within each matcher group, hooks are deduplicated by normalised command.
 */
function mergeHookEvent(projectEntries, citadelEntries) {
  const byMatcher = new Map();

  for (const entry of projectEntries) {
    const key = entry.matcher ?? '__none__';
    byMatcher.set(key, {
      ...(entry.matcher ? { matcher: entry.matcher } : {}),
      hooks: [...(entry.hooks || [])],
    });
  }

  for (const citEntry of citadelEntries) {
    const key = citEntry.matcher ?? '__none__';
    if (!byMatcher.has(key)) {
      byMatcher.set(key, {
        ...(citEntry.matcher ? { matcher: citEntry.matcher } : {}),
        hooks: [...(citEntry.hooks || [])],
      });
    } else {
      const existing = byMatcher.get(key);
      for (const citHook of (citEntry.hooks || [])) {
        const alreadyPresent = existing.hooks.some(ph =>
          commandsEquivalent(ph.command, citHook.command)
        );
        if (!alreadyPresent) {
          existing.hooks.push({ ...citHook });
        }
      }
    }
  }

  return Array.from(byMatcher.values());
}

/**
 * Deep-merges two settings.json objects.
 * Hooks are merged by event key, then by matcher group, then by command.
 * Unknown top-level keys: project value wins.
 */
function mergeSettings(project, citadel) {
  const result = {};
  const allKeys = new Set([...Object.keys(project), ...Object.keys(citadel)]);

  for (const key of allKeys) {
    if (key !== 'hooks') {
      result[key] = key in project ? project[key] : citadel[key];
      continue;
    }

    const projectHooks = project.hooks || {};
    const citadelHooks = citadel.hooks || {};
    const mergedHooks = {};
    const allEvents = new Set([...Object.keys(projectHooks), ...Object.keys(citadelHooks)]);

    for (const event of allEvents) {
      const projEntries = projectHooks[event] || [];
      const citEntries  = citadelHooks[event]  || [];

      if (projEntries.length === 0) {
        mergedHooks[event] = citEntries.map(e => ({
          ...(e.matcher ? { matcher: e.matcher } : {}),
          hooks: [...(e.hooks || [])],
        }));
      } else if (citEntries.length === 0) {
        mergedHooks[event] = projEntries;
      } else {
        mergedHooks[event] = mergeHookEvent(projEntries, citEntries);
      }
    }

    result.hooks = mergedHooks;
  }

  return result;
}

// ── File walker ───────────────────────────────────────────────────────────────

/**
 * Recursively collects all files under a directory.
 * @param {string} dir   Absolute path to directory
 * @param {string} base  Root to strip when computing relative paths
 * @returns {string[]}   Array of relative file paths
 */
function walkDir(dir, base) {
  const results = [];
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      results.push(...walkDir(full, base));
    } else {
      results.push(path.relative(base, full));
    }
  }
  return results;
}

/**
 * Collects all files from Citadel's installed paths (.claude, .planning, scripts).
 * Everything else at the Citadel root is silently skipped.
 * @param {string} citadelRoot  Absolute path to the Citadel repo
 * @returns {string[]}          Relative file paths (e.g. '.claude/settings.json')
 */
function collectCitadelFiles(citadelRoot) {
  const files = [];
  for (const installPath of INSTALL_PATHS) {
    const full = path.join(citadelRoot, installPath);
    if (!fs.existsSync(full)) continue;
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      files.push(...walkDir(full, citadelRoot));
    } else {
      files.push(installPath);
    }
  }
  return files;
}

/**
 * Validates and returns a conflict mode string.
 * Throws if the value is not one of the valid modes.
 * @param {string} value
 * @returns {'overwrite'|'skip'|'backup'}
 */
function parseConflictMode(value) {
  if (!CONFLICT_MODES.includes(value)) {
    throw new Error(
      `Invalid --conflict value: "${value}". Must be one of: ${CONFLICT_MODES.join(', ')}`
    );
  }
  return value;
}

/**
 * Decision tree classification for a single file.
 * @param {string} relPath       Relative path of the file (e.g. '.claude/settings.json')
 * @param {string} projectRoot   Absolute path to the project root
 * @returns {'copy'|'merge'|'prompt'}
 */
function classifyFile(relPath, projectRoot) {
  const dest = path.join(projectRoot, relPath);
  if (!fs.existsSync(dest)) return 'copy';
  if (relPath === '.claude/settings.json') return 'merge';
  return 'prompt';
}

// ── Interactive prompt ────────────────────────────────────────────────────────

/**
 * Prompts the user to resolve a file conflict.
 * @param {string} relPath          Relative file path (for display)
 * @param {string} existingContent  Content of the project's existing file
 * @param {string} citadelContent   Content of Citadel's version
 * @param {object} [rl]             Optional readline interface (injectable for tests)
 * @param {string} [lastModified]   Optional ISO date string for the existing file's mtime
 * @returns {Promise<'overwrite'|'skip'|'backup'>}
 */
async function promptConflict(relPath, existingContent, citadelContent, rl, lastModified) {
  const ownRl = !rl;
  if (!rl) {
    rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
  }

  const existingLines = countLines(existingContent);
  const citadelLines  = countLines(citadelContent);
  const modifiedStr   = lastModified ? `  (last modified: ${lastModified.slice(0, 10)})` : '';

  console.log(`\nCONFLICT: ${relPath}`);
  console.log(`  Project: ${existingLines} lines${modifiedStr}`);
  console.log(`  Citadel: ${citadelLines} lines`);

  return new Promise((resolve) => {
    // Handle EOF (Ctrl-D) — treat as skip
    rl.once('close', () => resolve('skip'));

    function ask() {
      rl.question('  [o] overwrite   [s] skip   [d] diff   [b] overwrite + backup\nChoice: ', (answer) => {
        const choice = answer.trim().toLowerCase();
        if (choice === 'o') { resolve('overwrite'); if (ownRl) rl.close(); return; }
        if (choice === 's') { resolve('skip');     if (ownRl) rl.close(); return; }
        if (choice === 'b') { resolve('backup');   if (ownRl) rl.close(); return; }
        if (choice === 'd') {
          showDiff(relPath, existingContent, citadelContent);
          return ask();
        }
        console.log('  Invalid choice. Enter o, s, d, or b.');
        ask();
      });
    }
    ask();
  });
}

/**
 * Prints a unified diff using system `diff`. Gracefully handles missing binary.
 */
function showDiff(relPath, existingContent, citadelContent) {
  const { execSync } = require('child_process');
  const os = require('os');
  const tmpA = path.join(os.tmpdir(), 'citadel-install-existing.tmp');
  const tmpB = path.join(os.tmpdir(), 'citadel-install-citadel.tmp');
  try {
    fs.writeFileSync(tmpA, existingContent);
    fs.writeFileSync(tmpB, citadelContent);
    try {
      const diff = execSync(`diff -u "${tmpA}" "${tmpB}"`, { encoding: 'utf8' });
      console.log(diff || '(files are identical)');
    } catch (e) {
      if (e.stdout) console.log(e.stdout);
      else console.log('(diff unavailable or files could not be compared)');
    }
  } finally {
    if (fs.existsSync(tmpA)) fs.unlinkSync(tmpA);
    if (fs.existsSync(tmpB)) fs.unlinkSync(tmpB);
  }
}

// ── Install orchestrator ──────────────────────────────────────────────────────

/**
 * Installs a single file from Citadel into the project.
 * @param {string} relPath        Relative file path
 * @param {string} citadelRoot    Absolute path to Citadel repo
 * @param {string} projectRoot    Absolute path to project root
 * @param {object} counters       { copied, merged, overwritten, skipped, backedUp }
 * @param {object} manifest       { copied, merged, overwritten, skipped, backedUp } — arrays of relPaths
 * @param {string} [conflictMode] 'overwrite'|'skip'|'backup' — skips interactive prompt when set.
 *                                Has no effect on .claude/settings.json, which always deep-merges.
 */
async function installFile(relPath, citadelRoot, projectRoot, counters, manifest, conflictMode) {
  const src  = path.join(citadelRoot, relPath);
  const dest = path.join(projectRoot, relPath);
  const action = classifyFile(relPath, projectRoot);

  if (action === 'copy') {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    counters.copied++;
    manifest.copied.push(relPath);
    return;
  }

  if (action === 'merge') {
    // Parse Citadel's file FIRST — if it fails, skip with no backup (dest unchanged)
    let citadelSettings;
    try { citadelSettings = JSON.parse(fs.readFileSync(src, 'utf8')); }
    catch {
      console.warn(`  Warning: could not parse Citadel's ${relPath} as JSON — skipping`);
      counters.skipped++;
      manifest.skipped.push(relPath);
      return;
    }

    // Parse project's existing file
    let existingSettings;
    try { existingSettings = JSON.parse(fs.readFileSync(dest, 'utf8')); }
    catch {
      console.warn(`  Warning: could not parse existing ${relPath} as JSON — treating as conflict`);
      existingSettings = null;
    }

    if (!existingSettings) {
      // Fall back to interactive (or auto-resolve) — only back up if choice is 'backup'
      const existingRaw  = fs.readFileSync(dest, 'utf8');
      const citadelRaw   = fs.readFileSync(src,  'utf8');
      const lastModified = fs.statSync(dest).mtime.toISOString();
      let choice;
      if (conflictMode) {
        console.log(`  Auto-${conflictMode} (--conflict): ${relPath}`);
        choice = conflictMode;
      } else {
        choice = await promptConflict(relPath, existingRaw, citadelRaw, null, lastModified);
      }
      if (choice === 'skip') { counters.skipped++; manifest.skipped.push(relPath); return; }
      if (choice === 'backup') { backupFile(dest); counters.backedUp++; manifest.backedUp.push(relPath); }
      fs.copyFileSync(src, dest);
      counters.overwritten++;
      manifest.overwritten.push(relPath);
      return;
    }

    // Both parsed successfully — back up then merge
    backupFile(dest);
    counters.backedUp++;
    manifest.backedUp.push(relPath);
    const merged = mergeSettings(existingSettings, citadelSettings);
    fs.writeFileSync(dest, JSON.stringify(merged, null, 2) + '\n', 'utf8');
    counters.merged++;
    manifest.merged.push(relPath);
    console.log(`  Merged: ${relPath}`);
    return;
  }

  // action === 'prompt'
  const existingRaw    = fs.readFileSync(dest, 'utf8');
  const citadelRaw     = fs.readFileSync(src,  'utf8');
  const lastModified   = fs.statSync(dest).mtime.toISOString();
  let choice;
  if (conflictMode) {
    console.log(`  Auto-${conflictMode} (--conflict): ${relPath}`);
    choice = conflictMode;
  } else {
    choice = await promptConflict(relPath, existingRaw, citadelRaw, null, lastModified);
  }

  if (choice === 'skip') {
    counters.skipped++;
    manifest.skipped.push(relPath);
    return;
  }
  if (choice === 'backup') {
    backupFile(dest);
    counters.backedUp++;
    manifest.backedUp.push(relPath);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  counters.overwritten++;
  manifest.overwritten.push(relPath);
}

// ── Summary ───────────────────────────────────────────────────────────────────

function printSummary(counters) {
  const bar = '─'.repeat(45);
  console.log('\nCitadel install complete');
  console.log(bar);
  console.log(`  Copied   (new files):  ${String(counters.copied).padStart(4)} files`);
  console.log(`  Merged   (JSON):       ${String(counters.merged).padStart(4)} file${counters.merged !== 1 ? 's' : ''}${counters.merged > 0 ? '  (.claude/settings.json)' : ''}`);
  console.log(`  Overwritten:           ${String(counters.overwritten).padStart(4)} files`);
  console.log(`  Skipped:               ${String(counters.skipped).padStart(4)} files`);
  console.log(`  Backed up:             ${String(counters.backedUp).padStart(4)} files  → *.citadel-bak`);
  console.log('');
  console.log('Next step: run /do setup inside Claude Code');
  console.log('');
}

// ── Manifest ──────────────────────────────────────────────────────────────────

/**
 * Builds a markdown manifest string grouped by operation.
 * @param {object} manifest     { copied, merged, overwritten, backedUp, skipped }
 * @param {string} citadelRoot  Absolute path to Citadel source
 * @param {string} projectRoot  Absolute path to target project
 * @param {string} timestamp    'YYYY-MM-DD_HH:MM:SS'
 * @returns {string}
 */
function buildManifest(manifest, citadelRoot, projectRoot, timestamp) {
  const date = timestamp.replace('_', ' ');
  const lines = [
    '# Citadel Install Manifest',
    '',
    `**Date:** ${date}`,
    `**Source:** ${citadelRoot}`,
    `**Target:** ${projectRoot}`,
    '',
  ];

  const sections = [
    { key: 'overwritten', title: 'Overwritten' },
    { key: 'backedUp',    title: 'Backed Up' },
    { key: 'skipped',     title: 'Skipped' },
    { key: 'copied',      title: 'Copied (new files)' },
    { key: 'merged',      title: 'Merged (JSON deep-merge)' },
  ];

  for (const { key, title } of sections) {
    const files = manifest[key];
    lines.push(`## ${title} (${files.length})`);
    if (files.length === 0) {
      lines.push('_none_');
    } else {
      for (const f of files) {
        lines.push(`- \`${f}\``);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Exports (for testing) ─────────────────────────────────────────────────────
module.exports = {
  checkNodeVersion, isCitadelRepo,
  countLines, backupPath, backupFile,
  normaliseCommand, commandsEquivalent,
  mergeHookEvent, mergeSettings,
  walkDir, collectCitadelFiles, classifyFile,
  parseConflictMode,
  promptConflict, buildManifest,
};

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  checkNodeVersion(process.version);

  // Parse --source=<value>, --target=<value>, and --conflict=<value> named flags
  const argv = process.argv.slice(2);
  let sourcePath, targetPath, conflictMode;
  for (const arg of argv) {
    if (arg.startsWith('--source='))   sourcePath   = arg.slice('--source='.length);
    else if (arg.startsWith('--target='))   targetPath   = arg.slice('--target='.length);
    else if (arg.startsWith('--conflict=')) conflictMode = arg.slice('--conflict='.length);
  }

  if (!sourcePath || !targetPath) {
    console.error(
      'Usage: node <path>/install-citadel.js --source=<citadel-clone> --target=<project>' +
      ' [--conflict=overwrite|skip|backup]'
    );
    process.exit(1);
  }

  if (conflictMode !== undefined) {
    try { parseConflictMode(conflictMode); }
    catch (e) { console.error(e.message); process.exit(1); }
  }

  const citadelRoot = path.resolve(sourcePath.replace(/^~/, process.env.HOME || ''));
  if (!fs.existsSync(citadelRoot)) {
    console.error(`Path not found: ${citadelRoot}`);
    process.exit(1);
  }

  if (!isCitadelRepo(citadelRoot)) {
    console.error(
      'Path does not appear to be a Citadel repository ' +
      '(missing .claude/skills/do|archon|marshal)'
    );
    process.exit(1);
  }

  const projectRoot = path.resolve(targetPath.replace(/^~/, process.env.HOME || ''));
  if (!fs.existsSync(projectRoot)) {
    console.error(`Target path not found: ${projectRoot}`);
    process.exit(1);
  }
  console.log(`Installing Citadel from: ${citadelRoot}`);
  console.log(`Into project:            ${projectRoot}\n`);

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  const files = collectCitadelFiles(citadelRoot);

  // Count individual files in top-level Citadel entries not in INSTALL_PATHS (silently skipped)
  const silentlySkipped = fs.readdirSync(citadelRoot)
    .filter(entry => !INSTALL_PATHS.includes(entry))
    .reduce((count, entry) => {
      const full = path.join(citadelRoot, entry);
      return count + (fs.statSync(full).isDirectory() ? walkDir(full, citadelRoot).length : 1);
    }, 0);

  const counters = { copied: 0, merged: 0, overwritten: 0, skipped: silentlySkipped, backedUp: 0 };
  const manifest = { copied: [], merged: [], overwritten: [], skipped: [], backedUp: [] };

  for (const relPath of files) {
    try {
      await installFile(relPath, citadelRoot, projectRoot, counters, manifest, conflictMode);
    } catch (err) {
      console.error(`  Error processing ${relPath}: ${err.message}`);
      counters.skipped++;
      manifest.skipped.push(relPath);
    }
  }

  printSummary(counters);

  const manifestContent = buildManifest(manifest, citadelRoot, projectRoot, timestamp);
  console.log(manifestContent);

  const manifestFile = path.join(projectRoot, `citadel-install-manifest-${timestamp}.md`);
  fs.writeFileSync(manifestFile, manifestContent, 'utf8');
  console.log(`Manifest saved to: ${manifestFile}`);
}

if (require.main === module) {
  main().catch(err => {
    console.error('Install failed:', err.message);
    process.exit(1);
  });
}

#!/usr/bin/env node

/**
 * unharness.js — Exports valuable Citadel state then removes the harness from a project.
 *
 * Export: reads campaigns, postmortems, research, intake, discoveries, and project metadata,
 * writes them to docs/citadel/ as human-readable markdown with citadel-archive frontmatter.
 * Setup detects this archive on re-install and offers to restore it.
 *
 * Cleanup: removes .planning/, .citadel/, .claude/agent-context/, and strips all Citadel
 * hook entries from .claude/settings.json.
 *
 * Usage:
 *   node /path/to/Citadel/scripts/unharness.js                  # from project dir
 *   node /path/to/Citadel/scripts/unharness.js /project          # explicit project path
 *   node /path/to/Citadel/scripts/unharness.js --export-only     # export without deleting
 */

'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    projectRoot: process.env.CLAUDE_PROJECT_DIR || process.cwd(),
    exportOnly: false,
  };
  for (const arg of args) {
    if (arg === '--export-only') { options.exportOnly = true; continue; }
    if (!arg.startsWith('--')) options.projectRoot = path.resolve(arg);
  }
  return options;
}

function readMarkdownFiles(dir, skip = []) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    if (skip.some(s => entry.name.includes(s))) continue;
    const content = fs.readFileSync(path.join(dir, entry.name), 'utf8').trim();
    if (content) results.push({ name: entry.name, content });
  }
  return results;
}

function buildArchiveFile(source, files, exportedAt) {
  if (!files.length) return null;
  const frontmatter = `---\ncitadel-archive: true\nexported-at: ${exportedAt}\nsource: ${source}\n---`;
  const body = files
    .map(f => `## ${f.name.replace(/\.md$/, '')}\n\n${f.content}`)
    .join('\n\n---\n\n');
  return `${frontmatter}\n\n${body}\n`;
}

function removeCitadelHooks(settingsPath, citadelRoot) {
  if (!fs.existsSync(settingsPath)) return { removed: 0, preserved: 0 };

  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {
    return { removed: 0, preserved: 0, error: 'could not parse settings.json' };
  }

  if (!settings.hooks || typeof settings.hooks !== 'object') {
    return { removed: 0, preserved: 0 };
  }

  const citadelRootNorm = citadelRoot.replace(/\\/g, '/');
  let removed = 0;
  let preserved = 0;

  for (const event of Object.keys(settings.hooks)) {
    const hooks = settings.hooks[event];
    if (!Array.isArray(hooks)) continue;
    const filtered = hooks.filter(hook => {
      const cmd = (hook.command || '').replace(/\\/g, '/');
      const isCitadel = cmd.includes(citadelRootNorm) ||
        cmd.includes('/hooks_src/') ||
        cmd.includes('/.citadel/scripts/');
      if (isCitadel) { removed++; return false; }
      preserved++;
      return true;
    });
    if (filtered.length === 0) {
      delete settings.hooks[event];
    } else {
      settings.hooks[event] = filtered;
    }
  }

  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  // Remove the env var Citadel injects
  if (settings.env && settings.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB) {
    delete settings.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB;
    if (Object.keys(settings.env).length === 0) delete settings.env;
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  return { removed, preserved };
}

function removeDir(dir) {
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

function countFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(d, entry.name));
      else count++;
    }
  }
  walk(dir);
  return count;
}

function isCitadelRepo(dir) {
  // Refuse to run unharness against the Citadel plugin repo itself.
  // Detect by presence of skills/ and hooks_src/ at the root.
  return fs.existsSync(path.join(dir, 'hooks_src')) &&
    fs.existsSync(path.join(dir, 'skills')) &&
    fs.existsSync(path.join(dir, 'package.json')) &&
    JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name === 'citadel';
}

function main() {
  const options = parseArgs(process.argv);
  const { projectRoot, exportOnly } = options;

  if (isCitadelRepo(projectRoot)) {
    console.error('Error: unharness cannot run against the Citadel plugin repo itself.');
    console.error('Run this from your project directory, or pass the project path as an argument:');
    console.error('  node /path/to/Citadel/scripts/unharness.js /your/project');
    process.exit(1);
  }

  const planning = path.join(projectRoot, '.planning');
  const citadelDir = path.join(projectRoot, '.citadel');
  const pluginRootFile = path.join(citadelDir, 'plugin-root.txt');
  const citadelRoot = fs.existsSync(pluginRootFile)
    ? fs.readFileSync(pluginRootFile, 'utf8').trim()
    : path.resolve(__dirname, '..');

  const exportedAt = new Date().toISOString();
  const archiveDir = path.join(projectRoot, 'docs', 'citadel');

  // --- SCAN ---
  const campaigns = readMarkdownFiles(path.join(planning, 'campaigns', 'completed'));
  const postmortems = readMarkdownFiles(path.join(planning, 'postmortems'));
  const research = readMarkdownFiles(path.join(planning, 'research'));
  const intake = readMarkdownFiles(path.join(planning, 'intake'), ['_TEMPLATE']);
  const discoveries = readMarkdownFiles(path.join(planning, 'discoveries'));

  const hasContent = campaigns.length + postmortems.length + research.length +
    intake.length + discoveries.length > 0;

  const projectMd = path.join(citadelDir, 'project.md');
  const harnessJson = path.join(projectRoot, '.claude', 'harness.json');

  console.log('');
  console.log('Citadel Unharness');
  console.log('=================');
  console.log('');
  console.log('Found:');
  console.log(`  ${campaigns.length} completed campaigns`);
  console.log(`  ${postmortems.length} postmortems`);
  console.log(`  ${research.length} research notes`);
  console.log(`  ${intake.length} backlog items`);
  console.log(`  ${discoveries.length} discoveries`);

  // --- EXPORT ---
  if (hasContent || fs.existsSync(projectMd) || fs.existsSync(harnessJson)) {
    fs.mkdirSync(archiveDir, { recursive: true });

    const archives = [
      { source: 'campaigns',    files: campaigns   },
      { source: 'postmortems',  files: postmortems },
      { source: 'research',     files: research    },
      { source: 'backlog',      files: intake      },
      { source: 'discoveries',  files: discoveries },
    ];

    let written = 0;
    for (const { source, files } of archives) {
      const content = buildArchiveFile(source, files, exportedAt);
      if (!content) continue;
      fs.writeFileSync(path.join(archiveDir, `${source}.md`), content);
      written++;
    }

    if (fs.existsSync(projectMd)) {
      const projectContent = fs.readFileSync(projectMd, 'utf8').trim();
      const projectArchive = `---\ncitadel-archive: true\nexported-at: ${exportedAt}\nsource: project\n---\n\n${projectContent}\n`;
      fs.writeFileSync(path.join(archiveDir, 'project.md'), projectArchive);
      written++;
    }

    if (fs.existsSync(harnessJson)) {
      const harnessContent = fs.readFileSync(harnessJson, 'utf8');
      const harnessArchive = `---\ncitadel-archive: true\nexported-at: ${exportedAt}\nsource: harness-config\n---\n\n${harnessContent}\n`;
      fs.writeFileSync(path.join(archiveDir, 'harness.json.md'), harnessArchive);
      written++;
    }

    console.log('');
    console.log(`Archive written to docs/citadel/ (${written} files)`);
    console.log('  Review it, commit it, or delete it — your call.');
    console.log('  Run /do setup again anytime; it will offer to restore from this archive.');
  } else {
    console.log('  Nothing to export.');
  }

  if (exportOnly) {
    console.log('');
    console.log('--export-only: harness files left in place.');
    return;
  }

  // --- CLEANUP ---
  console.log('');
  console.log('Removing harness...');

  const planningFileCount = countFiles(planning);
  if (removeDir(planning)) {
    console.log(`  Removed .planning/ (${planningFileCount} files)`);
  }

  if (removeDir(citadelDir)) {
    console.log(`  Removed .citadel/`);
  }

  const agentContextDir = path.join(projectRoot, '.claude', 'agent-context');
  if (removeDir(agentContextDir)) {
    console.log(`  Removed .claude/agent-context/`);
  }

  const settingsPath = path.join(projectRoot, '.claude', 'settings.json');
  const hookResult = removeCitadelHooks(settingsPath, citadelRoot);
  if (hookResult.error) {
    console.log(`  settings.json: ${hookResult.error}`);
  } else if (hookResult.removed > 0) {
    const preservedNote = hookResult.preserved > 0 ? ` (${hookResult.preserved} user hooks preserved)` : '';
    console.log(`  Removed ${hookResult.removed} Citadel hooks from .claude/settings.json${preservedNote}`);
  }

  console.log('');
  console.log('Done. Citadel has been removed from this project.');
  if (hasContent) {
    console.log('Your history is in docs/citadel/ — delete it or keep it.');
  }
  console.log('');
}

main();

#!/usr/bin/env node

/**
 * issue-monitor.js — SessionStart hook
 *
 * Checks for new/updated GitHub issues since last session.
 * Reports count and titles so the user knows what needs attention.
 * Stores last-check timestamp in .claude/issue-monitor-state.json (gitignored).
 */

const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const CITADEL_DIR = path.join(PROJECT_ROOT, '.citadel');
const STATE_FILE = path.join(CITADEL_DIR, 'issue-monitor-state.json');

function getGhPath() {
  const windowsPath = '/c/Program Files/GitHub CLI/gh.exe';
  try {
    if (fs.existsSync(windowsPath) || fs.existsSync(windowsPath.replace(/\//g, '\\'))) {
      return windowsPath;
    }
  } catch {}
  return 'gh';
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { lastCheck: null, knownIssues: [] };
  }
}

function saveState(state) {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

const REPO_SLUG_RE = /^[\w.-]{1,100}\/[\w.-]{1,100}$/;

function getRepoSlug() {
  try {
    const remote = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
    const match = remote.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
    if (!match) return null;
    const slug = `${match[1]}/${match[2]}`;
    if (!REPO_SLUG_RE.test(slug)) return null;
    return slug;
  } catch {}
  return null;
}

function main() {
  const repo = getRepoSlug();
  if (!repo) process.exit(0);

  const gh = getGhPath();
  const state = loadState();

  try {
    const raw = execFileSync(gh, ['issue', 'list', '--repo', repo, '--state', 'open', '--json', 'number,title,labels,createdAt,updatedAt', '--limit', '50'], { encoding: 'utf8', timeout: 15000 });
    const issues = JSON.parse(raw);

    if (issues.length === 0) {
      saveState({ lastCheck: new Date().toISOString(), knownIssues: [] });
      process.exit(0);
    }

    const knownSet = new Set(state.knownIssues || []);
    const newIssues = issues.filter(i => !knownSet.has(i.number));
    const untriaged = issues.filter(i => !i.labels || i.labels.length === 0);

    const lines = [];

    if (newIssues.length > 0) {
      lines.push(`New issues since last session: ${newIssues.length}`);
      newIssues.slice(0, 5).forEach(i => {
        lines.push(`  #${i.number}: ${i.title}`);
      });
      if (newIssues.length > 5) {
        lines.push(`  ... and ${newIssues.length - 5} more`);
      }
    }

    if (untriaged.length > 0) {
      lines.push(`Untriaged (no labels): ${untriaged.length}`);
      untriaged.slice(0, 3).forEach(i => {
        lines.push(`  #${i.number}: ${i.title}`);
      });
    }

    lines.push(`Total open issues: ${issues.length}`);

    if (newIssues.length > 0 || untriaged.length > 0) {
      lines.push('Run /triage to investigate.');
    }

    saveState({
      lastCheck: new Date().toISOString(),
      knownIssues: issues.map(i => i.number),
    });

    if (lines.length > 0) {
      console.error(lines.join('\n'));
    }

  } catch (err) {
    // Non-fatal — don't block session start
    process.exit(0);
  }
}

main();

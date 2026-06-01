#!/usr/bin/env node

'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');
const {
  buildGitHubReviewFetchCommands,
  ingestCodexReview,
} = require('../core/codex/native-integrations');

function arg(name, fallback = null) {
  const prefix = `${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function parseJsonValues(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // gh --paginate can emit adjacent JSON pages. Decode them without assuming line boundaries.
  }

  const values = [];
  let i = 0;
  while (i < text.length) {
    while (/\s/.test(text[i])) i += 1;
    const start = i;
    const opener = text[i];
    const closer = opener === '[' ? ']' : (opener === '{' ? '}' : null);
    if (!closer) throw new Error(`Expected JSON value at offset ${i}`);

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
      } else if (ch === '"') {
        inString = true;
      } else if (ch === opener) {
        depth += 1;
      } else if (ch === closer) {
        depth -= 1;
        if (depth === 0) {
          i += 1;
          const parsed = JSON.parse(text.slice(start, i));
          values.push(...(Array.isArray(parsed) ? parsed : [parsed]));
          break;
        }
      }
    }
  }
  return values;
}

function sourceForArgs(args) {
  const pathArg = args.find((value) => value.startsWith('repos/')) || '';
  if (pathArg.includes('/issues/')) return 'github-issue-comment';
  if (pathArg.endsWith('/reviews')) return 'github-pr-review';
  return 'github-review-comment';
}

function fetchWithGh(commands, ghPath) {
  const batches = [];
  for (const [_command, args] of commands) {
    const result = spawnSync(ghPath, args, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
      shell: process.platform === 'win32',
    });
    if (result.status !== 0) {
      const detail = (result.stderr || result.stdout || result.error?.message || '').trim();
      throw new Error(`gh api failed for ${args[1]}: ${detail}`);
    }
    const source = sourceForArgs(args);
    batches.push(...parseJsonValues(result.stdout).map((item) => ({ source, ...item })));
  }
  return batches;
}

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/codex-review-fetch.js --repo owner/name --pr N [--write]');
  console.log('       node scripts/codex-review-fetch.js --repo owner/name --pr N --file comments.json [--write]');
  process.exit(0);
}

const repo = arg('--repo', null);
const prNumber = arg('--pr', null);
if (!repo || !prNumber) {
  console.error('Usage: node scripts/codex-review-fetch.js --repo owner/name --pr N [--write]');
  process.exit(1);
}

const commands = buildGitHubReviewFetchCommands({ repo, prNumber });
if (process.argv.includes('--print-commands')) {
  console.log(JSON.stringify({
    dryRun: true,
    commands: commands.map(([command, args]) => ({ command, args })),
  }, null, 2));
  process.exit(0);
}

const file = arg('--file', null);
const input = file
  ? fs.readFileSync(file, 'utf8')
  : (process.argv.includes('--stdin') ? readStdin() : null);
const items = input ? parseJsonValues(input) : fetchWithGh(commands, arg('--gh', 'gh'));
const result = ingestCodexReview({
  projectRoot: arg('--project-root', process.cwd()),
  repo,
  prNumber,
  authorHint: arg('--author', 'codex'),
  input: items,
  write: process.argv.includes('--write'),
});

console.log(JSON.stringify({
  fetchedItems: items.length,
  commands: commands.map(([command, args]) => ({ command, args })),
  result,
}, null, 2));
process.exit(0);

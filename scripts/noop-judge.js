#!/usr/bin/env node

/**
 * noop-judge.js - Tier 2 of the no-op pipeline: the LLM judge.
 *
 * Takes the candidate lines surfaced by Tier 1 (scripts/noop-scan.js) and asks
 * a model to adjudicate each one as delete / trim / keep, with a reason and (for
 * trims) the trimmed line. This is the cheap "verify without running the agent"
 * layer: it runs ONE batched `claude --print` call for ALL candidates, not one
 * call per line, and only ever sees the handful Tier 1 flagged.
 *
 * It is not ground truth - a no-op that only bites on an edge case can fool a
 * judge. Verdicts marked low-confidence or "keep-but-unsure" should escalate to
 * Tier 3 ablation (scripts/noop-ablate.js), the empirical Pocock test.
 *
 * Usage:
 *   node scripts/noop-judge.js                 # judge all candidates (1 batched call)
 *   node scripts/noop-judge.js --skill research
 *   node scripts/noop-judge.js --dry-run       # print the prompt, make no call (zero cost)
 *   node scripts/noop-judge.js --json          # machine-readable verdicts
 *
 * Output: writes verdicts to .planning/noop-audit/judge-verdicts-<ts>.json
 *
 * Exit codes: 0 = judged (or nothing to judge); 1 = judge call/parse failed.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { detectNoOps } = require('../core/skills/noop-detect');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const SKILLS_DIR  = path.join(PLUGIN_ROOT, 'skills');
const AUDIT_DIR   = path.join(PLUGIN_ROOT, '.planning', 'noop-audit');

const args     = process.argv.slice(2);
const DRY_RUN  = args.includes('--dry-run');
const JSON_MODE = args.includes('--json');
const CONTEXT_RADIUS = 3;

function getArgValue(flag) {
  const eq = args.find(a => a.startsWith(flag + '='));
  if (eq) return eq.slice(flag.length + 1);
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length && !args[idx + 1].startsWith('--')) return args[idx + 1];
  return null;
}
const skillFilter = getArgValue('--skill');

// ── Gather candidates with context ────────────────────────────────────────────

function gatherCandidates() {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  let skills = fs.readdirSync(SKILLS_DIR)
    .filter(n => fs.existsSync(path.join(SKILLS_DIR, n, 'SKILL.md')))
    .sort();
  if (skillFilter) skills = skills.filter(n => n === skillFilter || n.includes(skillFilter));

  const out = [];
  let id = 0;
  for (const skill of skills) {
    const file = path.join(SKILLS_DIR, skill, 'SKILL.md');
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split(/\r?\n/);
    for (const c of detectNoOps(content)) {
      const from = Math.max(0, c.lineNo - 1 - CONTEXT_RADIUS);
      const to   = Math.min(lines.length, c.lineNo + CONTEXT_RADIUS);
      const context = lines.slice(from, to).map((l, k) => {
        const n = from + k + 1;
        const marker = n === c.lineNo ? '>>' : '  ';
        return `   ${marker} ${n}: ${l}`;
      }).join('\n');
      out.push({ id: ++id, skill, file, lineNo: c.lineNo, text: c.text, hits: c.noopHits, context });
    }
  }
  return out;
}

// ── Prompt ────────────────────────────────────────────────────────────────────

function buildPrompt(candidates) {
  const header = [
    'You are auditing instruction lines from an AI coding agent\'s skill files for "no-ops".',
    '',
    'A NO-OP is an instruction aimed at the agent\'s own disposition or effort that carries no',
    'specific, checkable criterion. Test: delete the line - would a competent agent\'s behavior',
    'change? If not, it is a no-op ("be thorough", "make it high-quality", "write clean code").',
    'No-ops burn tokens and dilute the real instructions around them because agents already',
    'attempt these by default.',
    '',
    'NOT no-ops (keep): concrete commands, file/threshold references, named conditions, fringe',
    'guards (what to do when something is missing/unavailable), and anti-examples (a disposition',
    'word cited as what NOT to do).',
    '',
    'For each candidate, return a verdict:',
    '  "delete" - the whole line is inert filler; removing it changes nothing.',
    '  "trim"   - the line carries a real instruction but contains a filler fragment (e.g. a',
    '             trailing adverb); include trimmed_line with the filler removed, instruction kept.',
    '  "keep"   - the line is load-bearing, or the flagged word is used meaningfully; say why.',
    '',
    'Respond with ONLY a JSON array, no prose, no code fence. One object per candidate:',
    '[{"id":<n>,"verdict":"delete|trim|keep","confidence":0.0-1.0,"trimmed_line":"<only if trim>","reason":"<one sentence>"}]',
    '',
    '--- CANDIDATES ---',
  ];
  const body = candidates.map(c => [
    `[${c.id}] skill: ${c.skill}  line ${c.lineNo}`,
    `    flagged words: ${c.hits.join(', ')}`,
    `    context (>> is the candidate line):`,
    c.context,
  ].join('\n'));
  return header.join('\n') + '\n\n' + body.join('\n\n') + '\n';
}

// ── claude CLI ────────────────────────────────────────────────────────────────

function findClaudeCLI() {
  for (const cmd of ['claude', 'claude.exe']) {
    try {
      execFileSync(cmd, ['--version'], { stdio: 'pipe', timeout: 5000 });
      return cmd;
    } catch { /* keep looking */ }
  }
  return null;
}

function extractJsonArray(text) {
  // Strip code fences, then take the outermost [...] block.
  const stripped = text.replace(/```(?:json)?/gi, '');
  const start = stripped.indexOf('[');
  const end   = stripped.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return null;
  try { return JSON.parse(stripped.slice(start, end + 1)); }
  catch { return null; }
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const candidates = gatherCandidates();

  if (candidates.length === 0) {
    if (JSON_MODE) console.log(JSON.stringify({ verdicts: [], note: 'no candidates' }, null, 2));
    else console.log('\nNo Tier 1 candidates to judge. Nothing to do.\n');
    process.exit(0);
  }

  const prompt = buildPrompt(candidates);

  if (DRY_RUN) {
    console.log('\n=== noop-judge DRY RUN (no model call) ===\n');
    console.log(`Candidates: ${candidates.length}  |  Model calls that WOULD run: 1 (batched)\n`);
    console.log(prompt);
    process.exit(0);
  }

  const cli = findClaudeCLI();
  if (!cli) {
    console.error('\nclaude CLI not found. Re-run with --dry-run to inspect the prompt, or install the CLI.\n');
    process.exit(1);
  }

  if (!JSON_MODE) {
    console.log(`\nJudging ${candidates.length} candidate(s) in 1 batched claude call...\n`);
  }

  let output;
  try {
    output = execFileSync(cli, ['--print', prompt], {
      cwd: PLUGIN_ROOT,
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (e) {
    console.error(`Judge call failed: ${e.message}`);
    process.exit(1);
  }

  const verdicts = extractJsonArray(output);
  if (!verdicts) {
    console.error('Could not parse a JSON array from the judge response. Raw output:\n');
    console.error(output.slice(0, 2000));
    process.exit(1);
  }

  // Join verdicts back to candidates.
  const byId = new Map(verdicts.map(v => [v.id, v]));
  const merged = candidates.map(c => ({
    skill: c.skill, lineNo: c.lineNo, text: c.text, hits: c.hits,
    verdict: byId.get(c.id) || { verdict: 'unjudged', reason: 'no verdict returned' },
  }));

  // Persist.
  let outFile = null;
  try {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    outFile = path.join(AUDIT_DIR, `judge-verdicts-${ts}.json`);
    fs.writeFileSync(outFile, JSON.stringify({ generated: new Date().toISOString(), merged }, null, 2));
  } catch { /* best effort */ }

  if (JSON_MODE) {
    console.log(JSON.stringify({ verdicts: merged, outFile }, null, 2));
    process.exit(0);
  }

  console.log('No-op Judge Verdicts\n' + '='.repeat(44));
  for (const m of merged) {
    const v = m.verdict;
    console.log(`\n  ${m.skill} L${m.lineNo}  →  ${String(v.verdict).toUpperCase()}` +
                (v.confidence != null ? `  (conf ${v.confidence})` : ''));
    console.log(`    line:   ${m.text.slice(0, 84)}`);
    if (v.trimmed_line) console.log(`    trim →  ${v.trimmed_line.slice(0, 84)}`);
    if (v.reason) console.log(`    why:    ${v.reason}`);
  }
  const counts = merged.reduce((a, m) => { const k = m.verdict.verdict; a[k] = (a[k] || 0) + 1; return a; }, {});
  console.log('\n' + '='.repeat(44));
  console.log(`Verdicts: ${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ')}`);
  if (outFile) console.log(`Written: ${path.relative(PLUGIN_ROOT, outFile)}`);
  console.log('Escalate any low-confidence delete/trim to: node scripts/noop-ablate.js --skill <name>\n');
  process.exit(0);
}

main();

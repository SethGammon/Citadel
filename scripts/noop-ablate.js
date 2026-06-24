#!/usr/bin/env node

/**
 * noop-ablate.js - Tier 3 of the no-op pipeline: empirical ablation.
 *
 * The real Pocock test. For a skill's no-op candidates, it removes them (or
 * applies the judge's trim), reruns the skill's benchmark scenarios, and checks
 * whether behavior changed. "Behavior" is the scenario's ASSERTION OUTCOME
 * VECTOR (which assert-contains / assert-not-contains pass), which is robust to
 * harmless wording variance - only a change that crosses an assertion boundary
 * counts. Same vector as baseline => no behavioral change => no-op confirmed.
 *
 * COST MINIMIZATION (matches the design):
 *   - Only runs on Tier 1 candidates the judge did not mark "keep".
 *   - BATCH: ablate ALL candidates at once and run the scenarios once. If the
 *     outcome matches baseline, every candidate is confirmed in that single
 *     pass. Most candidates are genuine no-ops, so this branch dominates.
 *   - BISECT: only if the batch shows a change AND there are >1 candidates,
 *     split and recurse to isolate the load-bearing one in ~log2(K) passes.
 *   - Reuses existing scenarios (no new harness) and compares coarse vectors so
 *     a single greedy run per config is a valid diff.
 *
 * Usage:
 *   node scripts/noop-ablate.js --skill systematic-debugging
 *   node scripts/noop-ablate.js --skill research --scenario external-library
 *   node scripts/noop-ablate.js --skill systematic-debugging --dry-run   # plan + run-count math, no calls
 *   node scripts/noop-ablate.js --skill systematic-debugging --action delete
 *
 * Exit codes: 0 = ran (or dry-run / nothing to do); 1 = setup/CLI error.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { detectNoOps } = require('../core/skills/noop-detect');
const {
  discoverScenarios, setupProjectState, executeClaudeScenario,
  runAssertions, findClaudeCLI,
} = require('./skill-bench');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const SKILLS_DIR  = path.join(PLUGIN_ROOT, 'skills');
const AUDIT_DIR   = path.join(PLUGIN_ROOT, '.planning', 'noop-audit');

const args     = process.argv.slice(2);
const DRY_RUN  = args.includes('--dry-run');
const JSON_MODE = args.includes('--json');

function getArgValue(flag) {
  const eq = args.find(a => a.startsWith(flag + '='));
  if (eq) return eq.slice(flag.length + 1);
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length && !args[idx + 1].startsWith('--')) return args[idx + 1];
  return null;
}
const skillFilter    = getArgValue('--skill');
const scenarioFilter = getArgValue('--scenario');
const actionOverride = getArgValue('--action'); // 'delete' | 'trim'

// ── Verdict loading ───────────────────────────────────────────────────────────

function loadLatestVerdicts() {
  if (!fs.existsSync(AUDIT_DIR)) return [];
  const files = fs.readdirSync(AUDIT_DIR).filter(f => /^judge-verdicts-.*\.json$/.test(f)).sort();
  if (files.length === 0) return [];
  try {
    const data = JSON.parse(fs.readFileSync(path.join(AUDIT_DIR, files[files.length - 1]), 'utf8'));
    return data.merged || [];
  } catch { return []; }
}

/**
 * Build the ablation edit for a candidate: { lineNo, action, trimmed_line }.
 * Priority: explicit --action override, else the judge verdict, else default
 * 'delete' (test whether the whole line is inert).
 */
function resolveEdit(candidate, verdicts) {
  if (actionOverride === 'delete') return { ...candidate, action: 'delete' };
  if (actionOverride === 'trim')   return { ...candidate, action: 'trim' };

  const v = verdicts.find(m => m.skill === candidate.skill && m.lineNo === candidate.lineNo);
  const verdict = v && v.verdict ? v.verdict : null;
  if (verdict) {
    if (verdict.verdict === 'keep') return { ...candidate, action: 'keep' };
    if (verdict.verdict === 'trim') return { ...candidate, action: 'trim', trimmed_line: verdict.trimmed_line };
    if (verdict.verdict === 'delete') return { ...candidate, action: 'delete' };
  }
  return { ...candidate, action: 'delete' }; // default hypothesis
}

// ── Ablation edits ────────────────────────────────────────────────────────────

function applyEdits(content, edits) {
  const lines = content.split(/\r?\n/);
  // Apply bottom-up so line indices stay stable across deletes.
  const sorted = [...edits].sort((a, b) => b.lineNo - a.lineNo);
  for (const e of sorted) {
    const idx = e.lineNo - 1;
    if (idx < 0 || idx >= lines.length) continue;
    if (e.action === 'delete') {
      lines.splice(idx, 1);
    } else if (e.action === 'trim' && e.trimmed_line) {
      const lead = (lines[idx].match(/^(\s*)/) || ['', ''])[1];
      lines[idx] = lead + e.trimmed_line.replace(/^\s+/, '');
    }
  }
  return lines.join('\n');
}

// ── Scenario runs ─────────────────────────────────────────────────────────────

/** Run one scenario, return an outcome vector { pass, vector, error }. */
function runScenario(scenario, cli) {
  let tmpDir = null;
  try {
    tmpDir = setupProjectState(scenario.state);
    const exec = executeClaudeScenario(scenario, cli, tmpDir);
    if (exec.timedOut) return { pass: null, vector: null, error: 'timed out' };
    if (exec.error && !exec.output) return { pass: null, vector: null, error: exec.error };
    const ar = runAssertions(scenario, exec.output);
    return {
      pass: ar.every(a => a.passed),
      vector: ar.map(a => a.passed),
      error: null,
    };
  } catch (e) {
    return { pass: null, vector: null, error: e.message };
  } finally {
    if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ } }
  }
}

function vectorsEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/** Run all scenarios against whatever is currently on disk. */
function runAll(scenarios, cli) {
  return scenarios.map(s => ({ scenario: s.name, ...runScenario(s, cli) }));
}

/** True if every scenario outcome matches the baseline (behavior unchanged). */
function matchesBaseline(baseline, current) {
  return baseline.every((b, i) => vectorsEqual(b.vector, current[i] && current[i].vector));
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  if (!skillFilter) {
    console.error('Usage: node scripts/noop-ablate.js --skill <name> [--scenario <filter>] [--dry-run]');
    process.exit(1);
  }

  const skillFile = path.join(SKILLS_DIR, skillFilter, 'SKILL.md');
  if (!fs.existsSync(skillFile)) {
    console.error(`No SKILL.md for "${skillFilter}".`);
    process.exit(1);
  }

  const original = fs.readFileSync(skillFile, 'utf8');
  const rawCandidates = detectNoOps(original).map(c => ({ ...c, skill: skillFilter }));
  const verdicts = loadLatestVerdicts();
  const edits = rawCandidates.map(c => resolveEdit(c, verdicts)).filter(e => e.action !== 'keep');

  let scenarios = discoverScenarios().filter(s => s.skill === skillFilter && !s.skipExecute);
  if (scenarioFilter) scenarios = scenarios.filter(s => s.name.includes(scenarioFilter));

  if (rawCandidates.length === 0) {
    console.log(`\nNo Tier 1 candidates in ${skillFilter}. Nothing to ablate.\n`);
    process.exit(0);
  }
  if (edits.length === 0) {
    console.log(`\nAll candidates in ${skillFilter} were judged "keep". Nothing to ablate.\n`);
    process.exit(0);
  }
  if (scenarios.length === 0) {
    console.log(`\n${skillFilter} has no runnable benchmark scenarios - cannot ablate empirically.`);
    console.log('Add a scenario under skills/' + skillFilter + '/__benchmarks__/ to enable Tier 3.\n');
    process.exit(0);
  }

  // ── Run-count math (the cost story) ───────────────────────────────────────
  const S = scenarios.length;
  const K = edits.length;
  const bisectWorst = K > 1 ? S * Math.ceil(Math.log2(K)) * 2 : 0;
  const planCalls = S /*baseline*/ + S /*batch*/ + bisectWorst;

  console.log('\nNo-op Ablation (Tier 3, empirical)\n' + '='.repeat(44));
  console.log(`Skill:      ${skillFilter}`);
  console.log(`Candidates: ${K}  (${edits.map(e => `L${e.lineNo}:${e.action}`).join(', ')})`);
  console.log(`Scenarios:  ${S}  (${scenarios.map(s => s.name).join(', ')})`);
  console.log(`Plan:       ${S} baseline + ${S} batched ablation` + (K > 1 ? ` + ≤${bisectWorst} bisect` : '') + ` = ≤${planCalls} model call(s)`);
  console.log('Method:     compare assertion outcome vectors; same vector => behavior unchanged => no-op confirmed.');

  if (DRY_RUN) {
    console.log('\n[dry-run] No model calls made. Re-run without --dry-run to execute.\n');
    process.exit(0);
  }

  const cli = findClaudeCLI();
  if (!cli) {
    console.error('\nclaude CLI not found - cannot run ablation. Use --dry-run to see the plan.\n');
    process.exit(1);
  }

  const confirmed = [];   // edits whose removal did not change behavior
  const loadBearing = []; // edits whose removal DID change behavior

  try {
    // 1. Baseline.
    console.log('\n[1/2] Baseline (unmodified skill)...');
    const baseline = runAll(scenarios, cli);
    for (const b of baseline) {
      console.log(`      ${b.scenario}: ${b.error ? 'ERROR ' + b.error : 'vector ' + JSON.stringify(b.vector)}`);
    }
    if (baseline.some(b => b.vector === null)) {
      console.log('\nBaseline had an inconclusive scenario (timeout/error). Aborting - fix the scenario first.\n');
      process.exit(1);
    }

    // 2. Batched ablation: remove all candidates at once.
    console.log(`\n[2/2] Ablated (all ${K} candidate(s) removed/trimmed at once)...`);
    fs.writeFileSync(skillFile, applyEdits(original, edits));
    const ablated = runAll(scenarios, cli);
    for (const a of ablated) {
      console.log(`      ${a.scenario}: ${a.error ? 'ERROR ' + a.error : 'vector ' + JSON.stringify(a.vector)}`);
    }

    if (matchesBaseline(baseline, ablated)) {
      confirmed.push(...edits);
      console.log(`\n  → No behavioral change across ${S} scenario(s). All ${K} candidate(s) CONFIRMED no-op in 1 batched pass.`);
    } else if (K === 1) {
      loadBearing.push(edits[0]);
      console.log('\n  → Behavior changed. The single candidate is LOAD-BEARING (removing it altered an assertion outcome).');
    } else {
      console.log('\n  → Behavior changed with all removed. Bisecting to isolate the load-bearing line(s)...');
      // Restore before bisect passes (each pass applies its own subset).
      fs.writeFileSync(skillFile, original);
      const isolate = (subset) => {
        if (subset.length === 0) return;
        fs.writeFileSync(skillFile, applyEdits(original, subset));
        const out = runAll(scenarios, cli);
        fs.writeFileSync(skillFile, original);
        if (matchesBaseline(baseline, out)) { confirmed.push(...subset); return; }
        if (subset.length === 1) { loadBearing.push(subset[0]); return; }
        const mid = Math.floor(subset.length / 2);
        isolate(subset.slice(0, mid));
        isolate(subset.slice(mid));
      };
      isolate(edits);
    }
  } finally {
    // Always restore the original skill file.
    fs.writeFileSync(skillFile, original);
  }

  // ── Report ────────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(44));
  console.log('Result:');
  for (const e of confirmed) {
    console.log(`  CONFIRMED no-op   L${e.lineNo} (${e.action})  ${e.text.slice(0, 60)}`);
  }
  for (const e of loadBearing) {
    console.log(`  LOAD-BEARING      L${e.lineNo} (${e.action})  ${e.text.slice(0, 60)}  - keep`);
  }
  console.log('\nThe skill file was restored to its original state (ablation is non-destructive).');
  console.log('Apply confirmed removals with Phase 4 (node scripts/noop-apply.js) once you are satisfied.\n');

  if (JSON_MODE) console.log(JSON.stringify({ skill: skillFilter, confirmed, loadBearing }, null, 2));
  process.exit(0);
}

main();

#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILES = [
  'README.md',
  'docs/EVIDENCE_MANIFEST.md',
  'docs/evidence.html',
  'docs/index.html',
  'docs/operation-control.html',
  'docs/optimizer.html',
  'docs/research.html',
  'docs/walkthrough.html',
  'docs/grants/APPLICATION_CHECKLIST.md',
  'docs/grants/APPLICATION_MEDIA.md',
  'docs/grants/CLAIM_EVIDENCE_MATRIX.md',
  'docs/grants/EVALUATOR_START_HERE.md',
  'docs/grants/GITHUB_DELIVERY_EVIDENCE.md',
  'docs/grants/DEMO_SCRIPT.md',
  'docs/grants/SENTIENT_OPTIMIZER_APPLICATION_DRAFT.md',
  'docs/grants/SUBMISSION_READINESS.md',
  'docs/grants/TYPEFORM_ANSWER_PACK.md',
];

const FORBIDDEN = [
  [/independently frozen/gi, 'Freeze provenance must name separate identities or exact artifacts.'],
  [/(quality preserved|preserved quality)/gi, 'Use exact verified-cell counts, not an unbounded quality claim.'],
  [/latest prospective local economic comparison/gi, 'Do not call a superseded study latest.'],
  [/71\s*\/\s*72\s+completed/gi, 'A timeout is not a completed model attempt.'],
  [/two\s+Qwen/gi, 'Name the exact model sizes or model family.'],
  [/120\s+completed\s+actual-run/gi, 'Only 84 historical cells reached a model.'],
  [/5\s*\/\s*5\s+passed/gi, 'Fresh-clone stages completed; doctor semantic health is unknown.'],
  [/independent(?:ly)?\s+(?:verifier|verified|graded)/gi, 'Say model-external or verifier outside the routed model.'],
  [/citadel improved this result/gi, 'V1 apparent savings reverse under matched-timeout sensitivity.'],
  [/510\s+(?:repository\s+)?commits/gi, 'The merged main branch contains 542 commits.'],
];

const failures = [];
for (const relative of FILES) {
  const value = fs.readFileSync(path.join(ROOT, relative), 'utf8');
  for (const [pattern, reason] of FORBIDDEN) {
    const matches = value.match(pattern);
    if (matches) failures.push(`${relative}: ${JSON.stringify(matches[0])} - ${reason}`);
  }
  for (const match of value.matchAll(/9\.9% less (?:measured )?GPU energy/gi)) {
    const nearby = value.slice(Math.max(0, match.index - 500), match.index + match[0].length + 700);
    assert.match(nearby, /timeout|sensitivity|apparent/i, `${relative}: v1 aggregate requires a nearby timeout-sensitivity boundary`);
  }
}

const canonicalGateFiles = [
  'docs/grants/MILESTONES_AND_BUDGET.md',
  'docs/grants/SENTIENT_OPTIMIZER_APPLICATION_DRAFT.md',
  'docs/grants/EVALUATOR_START_HERE.md',
  'docs/grants/TYPEFORM_ANSWER_PACK.md',
  'docs/grants/DEMO_SCRIPT.md',
  'docs/research.html',
  'docs/evidence.html',
  'docs/optimizer.html',
  'docs/operation-control.html',
  'docs/walkthrough.html',
];
for (const relative of canonicalGateFiles) {
  const value = fs.readFileSync(path.join(ROOT, relative), 'utf8');
  assert.match(value, /80%|&ge;80%|≥80%/, `${relative}: missing the 80% absolute completion floor`);
  assert.match(value, /95%|&ge;95%|≥95%/, `${relative}: missing the 95% valid-frontier retention gate`);
  assert.match(value, /30%|&ge;30%|≥30%/, `${relative}: missing the 30% end-to-end cost gate`);
}

for (const relative of [
  'docs/grants/MILESTONES_AND_BUDGET.md',
  'docs/grants/SENTIENT_OPTIMIZER_APPLICATION_DRAFT.md',
  'docs/grants/EVALUATOR_START_HERE.md',
  'docs/research.html',
  'docs/evidence.html',
  'docs/optimizer.html',
  'docs/operation-control.html',
  'docs/walkthrough.html',
]) {
  const value = fs.readFileSync(path.join(ROOT, relative), 'utf8');
  assert.match(value, /70%|seventy percent/, `${relative}: missing the 70% per-stratum frontier validity floor`);
}

const applicationDraft = fs.readFileSync(path.join(ROOT, 'docs/grants/SENTIENT_OPTIMIZER_APPLICATION_DRAFT.md'), 'utf8');
assert.doesNotMatch(applicationDraft, /adaptive whole-operation control beats prompt-only routing/i);
assert.match(applicationDraft, /Prompt-only paired differences remain a reported routing diagnostic, not a pass\s+condition/i);

const budget = fs.readFileSync(path.join(ROOT, 'docs/grants/MILESTONES_AND_BUDGET.md'), 'utf8');
assert.match(budget, /9 months x \$11,000\/month/);
assert.match(budget, /900 operation cells/);
assert.match(budget, /reduce the applicable cash draw dollar-for-dollar/i);
assert.match(budget, /Cost-to-milestone crosswalk/);
assert.match(budget, /\*\*Milestone total\*\*\s*\|\s*\*\*\$30,000\*\*\s*\|\s*\*\*\$28,000\*\*\s*\|\s*\*\*\$35,000\*\*\s*\|\s*\*\*\$32,000\*\*\s*\|\s*\*\*\$25,000\*\*\s*\|\s*\*\*\$150,000\*\*/);
assert.doesNotMatch(budget, /15-20/);
assert.doesNotMatch(budget, /\| Bounded opt-in operator cohort \|/i);
assert.doesNotMatch(budget, /\$2,000[^\n]*honoraria|honoraria[^\n]*\$2,000/i);

for (const relative of [
  'docs/grants/APPLICANT_AND_ADOPTION.md',
  'docs/grants/SENTIENT_OPTIMIZER_APPLICATION_DRAFT.md',
  'docs/grants/SUBMISSION_READINESS.md',
  'docs/grants/TYPEFORM_ANSWER_PACK.md',
]) {
  const value = fs.readFileSync(path.join(ROOT, relative), 'utf8');
  assert.match(value, /542\s+commits|518\s+of\s+542\s+main-branch\s+commits/i, `${relative}: missing current main-branch delivery count`);
  assert.match(value, /524 unique cloners/i, `${relative}: missing qualified 14-day clone signal`);
  assert.match(value, /not\s+(?:users|installation|installations)|not\s+manually\s+typed\s+code/i, `${relative}: missing interest-signal boundary`);
}

assert.deepStrictEqual(failures, [], `Application claim-discipline failures:\n${failures.join('\n')}`);
console.log(`Application claim discipline passed (${FILES.length} public surfaces).`);

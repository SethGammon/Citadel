#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const answerFile = path.join(ROOT, 'docs', 'grants', 'TYPEFORM_ANSWER_PACK.md');
const readinessFile = path.join(ROOT, 'docs', 'grants', 'SUBMISSION_READINESS.md');
const checklistFile = path.join(ROOT, 'docs', 'grants', 'APPLICATION_CHECKLIST.md');
const rendererFile = path.join(ROOT, 'scripts', 'render-sentient-grant-packet.py');
const formCheckFile = path.join(ROOT, 'scripts', 'check-sentient-grant-form.js');
const pdfFile = path.join(ROOT, 'output', 'pdf', 'citadel-sentient-grant-packet.pdf');
const packageFile = path.join(ROOT, 'package.json');

for (const file of [answerFile, readinessFile, checklistFile, rendererFile, formCheckFile, pdfFile, packageFile]) {
  assert.ok(fs.existsSync(file), `missing application package file: ${path.relative(ROOT, file)}`);
}

const answers = fs.readFileSync(answerFile, 'utf8');
const readiness = fs.readFileSync(readinessFile, 'utf8');
const checklist = fs.readFileSync(checklistFile, 'utf8');
const renderer = fs.readFileSync(rendererFile, 'utf8');
const formCheck = fs.readFileSync(formCheckFile, 'utf8');
const pdf = fs.readFileSync(pdfFile);
const packageJson = JSON.parse(fs.readFileSync(packageFile, 'utf8'));

const oneLine = 'An open layer that finds the cheapest verified path through any agent stack.';
assert.ok(oneLine.length <= 80, `one-line answer exceeds Typeform limit: ${oneLine.length}`);
assert.match(answers, new RegExp(`Character count: ${oneLine.length} of 80\\.`));
assert.ok(answers.includes(`\`${oneLine}\``), 'one-line answer and recorded count drifted');

for (const placeholder of ['[CITY, COUNTRY]']) {
  assert.ok(answers.includes(placeholder), `missing human-owned placeholder: ${placeholder}`);
}
assert.match(answers, /seth@softwareshaped\.com/);
assert.ok(!answers.includes('[HOW SETH HEARD ABOUT SENTIENT]'), 'Grant path must not require the skipped how-heard field');
assert.match(answers, /jumps from the required supporting-document upload\s+directly to the thank-you screen/i);
assert.match(readiness, /Grant-branch logic jumps from the supporting\s+document field to the grant thank-you screen/i);
assert.strictEqual(packageJson.scripts['application:form:check'], 'node scripts/check-sentient-grant-form.js');
assert.match(readiness, /npm run application:form:check/);
assert.match(formCheck, /EXPECTED_GRANT_FIELDS/);
assert.match(formCheck, /611739716b3eb5ad7b16a2e93778f91b9b8cc06ff5ffcbe2eb843c4683544dcd/);
assert.match(readiness, /611739716b3eb5ad7b16a2e93778f91b9b8cc06ff5ffcbe2eb843c4683544dcd/);

for (const liveField of [
  'Email',
  'Role',
  'City, country',
  'What problem are you solving, and why now?',
  'Who does this help?',
  'In one line, what are you building?',
  'Who is building this, and why is the team right?',
  'What is open, what gets worse if it closed tomorrow, and for whom?',
  'Demo or trial link',
  'Track',
  'Funding range',
  'What would the grant unlock?',
  'Supporting document',
]) {
  assert.ok(answers.includes(liveField), `paste-ready pack is missing live Grant field: ${liveField}`);
}
assert.match(answers, /No form has been submitted/i);
assert.match(readiness, /Stop at the final submission action until Seth explicitly authorizes it/i);
assert.match(readiness, /https:\/\/form\.typeform\.com\/to\/IRj7WaKH/);
assert.match(checklist, /TYPEFORM_ANSWER_PACK\.md/);
assert.match(checklist, /SUBMISSION_READINESS\.md/);

assert.ok(pdf.length > 100_000, `supporting PDF is unexpectedly small: ${pdf.length} bytes`);
assert.strictEqual(pdf.subarray(0, 5).toString('ascii'), '%PDF-', 'supporting upload is not a PDF');
assert.match(pdf.subarray(Math.max(0, pdf.length - 2048)).toString('latin1'), /%%EOF/, 'supporting PDF has no EOF marker');
assert.match(renderer, /slides = \[slide_1, slide_2, slide_3, slide_4, slide_5, slide_6, slide_7, slide_8\]/, 'renderer must retain eight declared pages');

const digest = crypto.createHash('sha256').update(pdf).digest('hex');
assert.ok(readiness.includes(digest), `readiness digest drifted from PDF: ${digest}`);
assert.ok(readiness.includes(pdf.length.toLocaleString('en-US')), 'readiness byte count drifted from PDF');

for (const gate of ['80%', '95%', '30%']) {
  assert.ok(answers.includes(gate), `paste-ready grant answer is missing ${gate} gate`);
}
assert.match(answers, /unknown cost used\s+as savings/i);
assert.match(answers, /negative result/i);

console.log(`Sentient application package passed: ${pdf.length} bytes, sha256:${digest}, ${oneLine.length}/80 characters.`);

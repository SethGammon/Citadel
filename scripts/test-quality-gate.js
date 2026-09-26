#!/usr/bin/env node

/**
 * test-quality-gate.js -- Offline tests for quality-gate inline suppression.
 *
 * Verifies the <!-- citadel:ignore ... --> marker contract:
 *   (a) only explicit Markdown cross-reference waivers are honored
 *   (b) source files retain every configured lens, including blocking checks
 *   (c) markers in Markdown code examples are inert
 *   (d) files without a marker are unaffected
 *   (e) the cross-reference lens itself is unchanged (marker lives upstream)
 *
 * Stdlib only. No network, no LLM.
 *
 * Usage: node scripts/test-quality-gate.js
 */

'use strict';

// quality-gate reads harness.json via harness-health-util, which requires a
// resolvable runtime. Pin one so dual-marker checkouts stay hermetic.
process.env.CITADEL_RUNTIME = 'claude-code';

const path = require('path');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');
const health = require('../hooks_src/harness-health-util');
const originalReadConfig = health.readConfig;
let config = {};
health.readConfig = () => config;
const {
  parseInlineIgnores,
  selectColdPathLenses,
  lensCrossReference,
} = require(path.join(__dirname, '..', 'hooks_src', 'quality-gate.js'));

let failures = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}${detail ? ` -- ${detail}` : ''}`);
  }
}

console.log('quality-gate inline suppression tests\n');

const refDoc = 'See `planned/feature.ts` for the design.';
const markedDoc = '<!-- citadel:ignore cross-reference -->\n' + refDoc;
const bareMarkedDoc = '<!-- citadel:ignore -->\n' + refDoc;
const multiMarkedDoc = '<!-- citadel:ignore cross-reference, secrets -->\n' + refDoc;

const withMarker = selectColdPathLenses('docs/plan.md', markedDoc);
check('named marker drops only that lens',
  !withMarker.includes('cross-reference') && withMarker.includes('contractual'),
  JSON.stringify(withMarker));

const withoutMarker = selectColdPathLenses('docs/plan.md', refDoc);
check('unmarked file keeps all lenses',
  withoutMarker.includes('cross-reference') && withoutMarker.includes('contractual'),
  JSON.stringify(withoutMarker));

check('bare marker is inert',
  selectColdPathLenses('docs/plan.md', bareMarkedDoc).length === 2);

check('mixed comma-separated waiver is inert',
  parseInlineIgnores(multiMarkedDoc).size === 0);

check('mixed space-separated waiver is inert',
  parseInlineIgnores('<!-- citadel:ignore cross-reference secrets -->').size === 0);

check('unrelated comment is ignored',
  parseInlineIgnores('<!-- ignore this -->' + refDoc).size === 0);

check('lens itself still reports missing refs',
  lensCrossReference('docs/plan.md', markedDoc).length === 1,
  'marker must filter at dispatch, not inside the lens');

const marker = '<!-- citadel:ignore cross-reference -->';
for (const name of ['all', '*', 'contractual', 'secrets', 'custom', 'adversarial']) {
  check(`${name} cannot be waived inline`,
    parseInlineIgnores(`<!-- citadel:ignore ${name} -->`).size === 0);
}
check('skill contracts remain checked',
  selectColdPathLenses('skills/example/SKILL.md', markedDoc).includes('contractual'));
check('CRLF and up to three spaces of indentation are supported',
  parseInlineIgnores(`   ${marker}\r\n${refDoc}`).has('cross-reference'));
check('undefined content is supported', parseInlineIgnores(undefined).size === 0);

config = { qualityRules: { blocking: true } };
for (const ext of ['js', 'jsx', 'ts', 'tsx', 'py', 'go', 'rs', 'css', 'scss']) {
  const file = `src/app.${ext}`;
  const baseline = JSON.stringify(selectColdPathLenses(file, ''));
  for (const names of ['', 'all', 'secrets adversarial custom', 'cross-reference']) {
    const comment = `<!-- citadel:ignore ${names} -->`;
    check(`${ext}: ${names || 'bare'} marker cannot waive source checks`,
      [comment, `/* ${comment} */`, `const note = '${comment}';`].every(content =>
        JSON.stringify(selectColdPathLenses(file, content)) === baseline));
  }
}
config = {};

const examples = [
  `\`\`\`markdown\n${marker}\n\`\`\``,
  `~~~html\r\n${marker}\r\n~~~`,
  `   \`\`\`html\n${marker}\n   \`\`\``,
  `\`\`\`\`markdown\n\`\`\`\n${marker}\n\`\`\`\``,
  `~~~\n\`\`\`\n${marker}\n~~~`,
  `\`\`\`\n\`\`\`not-a-close\n${marker}\n\`\`\``,
  `\`\`\`html\n${marker}`,
  `    ${marker}`,
  `\t${marker}`,
  `\`${marker}\``,
  `For example: ${marker}`,
  `- \`\`\`html\n  ${marker}\n  \`\`\``,
  `1. ~~~html\n   ${marker}\n   ~~~`,
  `> \`\`\`html\n> ${marker}\n> \`\`\``,
];
for (const [index, example] of examples.entries()) {
  check(`Markdown code example ${index + 1} is inert`,
    selectColdPathLenses('docs/plan.md', example).includes('cross-reference'));
}
for (const fence of ['```', '~~~', '````']) {
  check(`real waiver after ${fence} fence is honored`,
    parseInlineIgnores(`${fence}html\n${marker}\n${fence}${fence[0]}\n${marker}`).has('cross-reference'));
}
config = { verification: { disabled: ['contractual', 'performance'] } };
check('project-level disabled configuration composes with inline waiver',
  selectColdPathLenses('docs/plan.md', markedDoc).length === 0 &&
  JSON.stringify(selectColdPathLenses('src/app.js', marker)) === JSON.stringify(['adversarial', 'custom', 'secrets']));
health.readConfig = originalReadConfig;

// Exercise the actual stdin runner, config loading, dispatch and blocking output.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-quality-gate-'));
try {
  const git = args => execFileSync('git', args, { cwd: sandbox, stdio: 'pipe' });
  git(['init']);
  fs.mkdirSync(path.join(sandbox, '.claude'));
  fs.writeFileSync(path.join(sandbox, '.claude', 'harness.json'), JSON.stringify({
    qualityRules: { blocking: true, custom: [{ pattern: 'REVIEW_SENTINEL', message: 'Custom check survived' }] },
  }));
  const files = ['source.js', 'fenced.md', 'waived.md'];
  for (const file of files) fs.writeFileSync(path.join(sandbox, file), 'baseline\n');
  git(['add', ...files]);
  git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture']);
  fs.writeFileSync(path.join(sandbox, 'source.js'), [
    '/* <!-- citadel:ignore --> */',
    '/* <!-- citadel:ignore secrets adversarial custom --> */',
    `/* ${marker} */`,
    // This file is only scanned, never executed. Exercise the adversarial lens
    // with an HTML assignment instead of a dynamic-execution example.
    'element.innerHTML = userInput; // REVIEW_SENTINEL',
    `const credential = '${'AKIA' + '0123456789ABCDEF'}';`,
  ].join('\n'));
  fs.writeFileSync(path.join(sandbox, 'fenced.md'), `\`\`\`html\n${marker}\n\`\`\`\n${refDoc}`);
  fs.writeFileSync(path.join(sandbox, 'waived.md'), markedDoc);
  const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks_src', 'quality-gate.js')], {
    cwd: sandbox, input: '{}', encoding: 'utf8', timeout: 15000,
    env: { ...process.env, CITADEL_RUNTIME: 'claude-code', CITADEL_UI: 'false',
      CLAUDE_PROJECT_DIR: sandbox, CLAUDE_PLUGIN_DATA: path.join(sandbox, '.claude') },
  });
  assert.strictEqual(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.strictEqual(output.decision, 'block');
  for (const lens of ['adversarial', 'custom', 'secrets']) {
    assert(output.reason.includes(`source.js: [${lens}]`), output.reason);
  }
  assert(output.reason.includes('fenced.md: [cross-reference]'), output.reason);
  assert(!output.reason.includes('waived.md:'), output.reason);
  check('blocking Stop hook preserves source checks and fenced-document warnings', true);
} catch (error) {
  check('blocking Stop hook preserves source checks and fenced-document warnings', false, error.message);
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll checks passed.');

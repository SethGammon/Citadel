#!/usr/bin/env node

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const { guidanceOwner } = require('../core/runtime/install-contract');
const { parseProjectSpec, validateProjectSpec } = require(path.join(__dirname, '..', 'core', 'project', 'load-project-spec'));
const { CLAUDE_GUIDANCE_TARGET, renderClaudeGuidance } = require(path.join(__dirname, '..', 'runtimes', 'claude-code', 'guidance', 'render'));
const { CODEX_GUIDANCE_TARGET, renderCodexGuidance } = require(path.join(__dirname, '..', 'runtimes', 'codex', 'guidance', 'render'));

function fail(message) {
  console.error(message);
  process.exit(1);
}

function main() {
  const templatePath = path.join(__dirname, '..', '.citadel', 'project.template.md');
  const template = fs.readFileSync(templatePath, 'utf8');
  const spec = parseProjectSpec(template);
  const errors = validateProjectSpec(spec);
  if (errors.length > 0) {
    fail(`Project template is invalid: ${errors.join('; ')}`);
  }

  const claude = renderClaudeGuidance(spec);
  const codex = renderCodexGuidance(spec);

  if (!claude.includes('# Claude Harness')) {
    fail('Claude guidance renderer must emit the Claude Harness heading');
  }
  if (CLAUDE_GUIDANCE_TARGET.filePath !== 'CLAUDE.md') {
    fail('Claude runtime guidance target must point to CLAUDE.md');
  }
  if (!codex.includes('## Citadel Project Guidance')) {
    fail('Codex guidance renderer must emit the Citadel Project Guidance section');
  }
  for (const section of ['## Verification', '## Review Guidelines', '## Codex Notes']) {
    if (!codex.includes(section)) {
      fail(`Codex guidance renderer missing ${section}`);
    }
  }
  if (CODEX_GUIDANCE_TARGET.filePath !== 'AGENTS.md') {
    fail('Codex runtime guidance target must point to AGENTS.md');
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-project-guidance-'));
  try {
    // Exercise both target layouts through the CLI: creation, guarded writes,
    // and repeated overwrites must preserve ownership without duplicate markers.
    for (const native of [false, true]) {
      const projectRoot = path.join(tempRoot, native ? 'shared' : 'legacy');
      const tempCitadel = path.join(projectRoot, '.citadel');
      fs.mkdirSync(tempCitadel, { recursive: true });
      fs.writeFileSync(path.join(tempCitadel, 'project.md'), template, 'utf8');
      const args = [path.join(__dirname, 'generate-project-guidance.js'),
        '--project-root', projectRoot, '--claude-version', '2.1.277'];
      if (native) args.push('--claude-agents-md-supported');
      const files = native ? ['AGENTS.md'] : ['AGENTS.md', 'CLAUDE.md'];
      const run = (...flags) => execFileSync(process.execPath, [...args, ...flags], { encoding: 'utf8' });
      run();
      for (const file of files) assert(!fs.existsSync(path.join(projectRoot, file)), 'Dry-run must not write guidance');
      run('--write');
      const checkOwnership = () => {
        for (const file of files) {
          const content = fs.readFileSync(path.join(projectRoot, file), 'utf8');
          assert.strictEqual(guidanceOwner(content), 'citadel:project-guidance', `${file} must remain Citadel-owned`);
          assert.strictEqual(content.split('<!-- citadel:project-guidance -->').length - 1, 1,
            `${file} must contain exactly one ownership marker`);
        }
      };
      checkOwnership();
      const agentsPath = path.join(projectRoot, 'AGENTS.md');
      fs.appendFileSync(agentsPath, '\nUser addition\n');
      const before = fs.readFileSync(agentsPath, 'utf8');
      run('--write');
      assert.strictEqual(fs.readFileSync(agentsPath, 'utf8'), before, 'Existing guidance requires --overwrite');
      run('--write', '--overwrite');
      checkOwnership();
      assert(!fs.readFileSync(agentsPath, 'utf8').includes('User addition'), 'Overwrite must regenerate guidance');
      run('--write', '--overwrite');
      checkOwnership();
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log('Project guidance tests pass.');
}

main();

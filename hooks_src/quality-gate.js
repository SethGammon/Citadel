#!/usr/bin/env node

/**
 * quality-gate.js — Stop hook
 *
 * Runs when Claude stops responding. Scans recently-edited files for
 * anti-patterns. If violations are found, outputs instructions to fix them.
 *
 * Anti-patterns (configurable via harness.json):
 *   - confirm() / alert() / prompt() in JS/TS files
 *   - transition-all in CSS/JSX (should name specific properties)
 *   - Hardcoded setInterval with magic numbers
 *
 * Users can add custom rules via harness.json qualityRules.custom array.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const health = require('./harness-health-util');

// Read stdin for hook context
let input = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const ctx = JSON.parse(input);
    // Prevent infinite loop — if this hook already fired, exit clean
    if (ctx.stop_hook_active) {
      process.exit(0);
      return;
    }
    run();
  } catch {
    run();
  }
});

function run() {
  health.increment('quality-gate', 'count');

  const projectDir = health.PROJECT_ROOT;
  const config = health.readConfig();

  // Get recently modified files from git
  let changedFiles = [];
  try {
    let output;
    try {
      output = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
        cwd: projectDir,
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      // HEAD may not exist (fresh repo) — fall back to plain diff
      output = execFileSync('git', ['diff', '--name-only'], {
        cwd: projectDir,
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }
    changedFiles = output.trim().split('\n').filter(Boolean);
  } catch {
    process.exit(0);
  }

  if (changedFiles.length === 0) {
    process.exit(0);
  }

  const violations = [];

  // Built-in rules
  const builtInRules = config.qualityRules?.builtIn || ['no-confirm-alert', 'no-transition-all'];

  for (const file of changedFiles) {
    const fullPath = path.join(projectDir, file);
    if (!fs.existsSync(fullPath)) continue;

    // Only check source files
    if (!/\.(ts|tsx|js|jsx|py|go|rs|css|scss)$/.test(file)) continue;

    let content;
    try {
      content = fs.readFileSync(fullPath, 'utf8');
    } catch {
      continue;
    }

    // Rule: no-confirm-alert
    if (builtInRules.includes('no-confirm-alert') && /\.(ts|tsx|js|jsx)$/.test(file)) {
      if (/\bconfirm\s*\(/.test(content)) {
        violations.push({ file, rule: 'no-confirm-alert', message: 'Uses confirm() — use an in-app modal' });
      }
      if (/\balert\s*\((?!.*eslint)/.test(content)) {
        violations.push({ file, rule: 'no-confirm-alert', message: 'Uses alert() — use an in-app notification' });
      }
    }

    // Rule: no-transition-all
    if (builtInRules.includes('no-transition-all')) {
      if (/transition-all/.test(content)) {
        violations.push({
          file,
          rule: 'no-transition-all',
          message: 'Uses transition-all — name specific properties (e.g., transition-[opacity,transform])',
        });
      }
    }

    // Rule: no-magic-intervals
    if (builtInRules.includes('no-magic-intervals') && /\.(ts|tsx|js|jsx)$/.test(file)) {
      const intervalMatch = content.match(/setInterval\s*\([^,]+,\s*\d+\s*\)/);
      if (intervalMatch) {
        violations.push({
          file,
          rule: 'no-magic-intervals',
          message: 'Hardcoded setInterval — use a named constant for the interval',
        });
      }
    }

    // Custom rules (regex-based)
    // Reject patterns with nested repetition or excessive alternation to prevent ReDoS.
    const REDOS_HEURISTIC = /(\+|\*|\{[\d,]+\}){2,}|(\|[^|]*){4,}/;
    const customRules = config.qualityRules?.custom || [];
    for (const rule of customRules) {
      if (rule.pattern && rule.message) {
        if (REDOS_HEURISTIC.test(rule.pattern)) continue; // skip dangerous patterns
        let regex, fileRegex;
        try {
          regex = new RegExp(rule.pattern);
          fileRegex = rule.filePattern ? new RegExp(rule.filePattern) : null;
        } catch {
          continue; // skip invalid patterns
        }
        if (fileRegex && !fileRegex.test(file)) continue;
        if (regex.test(content)) {
          violations.push({ file, rule: rule.name || 'custom', message: rule.message });
        }
      }
    }
  }

  if (violations.length > 0) {
    health.increment('quality-gate', 'violations');
    const msg = [
      `[Quality Gate] ${violations.length} issue(s) in recently modified files:`,
      '',
      ...violations.map(v => `  ${v.file}: ${v.message}`),
      '',
      'Fix these before finalizing your work.',
    ].join('\n');
    process.stdout.write(msg);
  }

  process.exit(0);
}

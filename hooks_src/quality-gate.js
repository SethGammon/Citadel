#!/usr/bin/env node

/**
 * quality-gate.js — Stop hook (Verification Dispatch: cold path)
 *
 * Runs when Claude stops responding. Applies cold-path verification lenses
 * to recently-edited files. More expensive checks than the hot path (post-edit)
 * since these only run once at session end.
 *
 * Cold-path lenses:
 *   - performance: transition-all, confirm/alert, magic intervals
 *   - accessibility: missing aria-labels, role attributes on interactive elements
 *   - adversarial: XSS vectors, unsafe patterns in source files
 *   - contractual: skill files match required structure
 *   - cross-reference: docs match code (function signatures vs documentation)
 *   - custom: user-defined regex rules via harness.json
 *
 * Users can configure via harness.json verification.cold and qualityRules.custom.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const health = require('./harness-health-util');

const CITADEL_UI = process.env.CITADEL_UI === 'true';

function hookOutput(hookName, action, message, data = {}) {
  if (CITADEL_UI) {
    process.stdout.write(JSON.stringify({
      hook: hookName,
      action,
      message,
      timestamp: new Date().toISOString(),
      data,
    }));
  } else {
    process.stdout.write(message);
  }
}

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

// ── Cold-Path Lens Dispatch ─────────────────────────────────────────────────

/**
 * Default cold-path lenses by file extension.
 * More expensive checks than hot-path — only runs at session end.
 */
const DEFAULT_COLD_LENSES = {
  '.ts':   ['performance', 'accessibility', 'adversarial'],
  '.tsx':  ['performance', 'accessibility', 'adversarial'],
  '.js':   ['performance', 'adversarial'],
  '.jsx':  ['performance', 'accessibility', 'adversarial'],
  '.css':  ['performance'],
  '.scss': ['performance'],
  '.py':   ['adversarial'],
  '.go':   ['adversarial'],
  '.rs':   [],
  '.md':   ['cross-reference', 'contractual'],
};

function selectColdPathLenses(file) {
  const config = health.readConfig();
  const verification = config.verification || {};
  const disabled = new Set(verification.disabled || []);
  const ext = path.extname(file).toLowerCase();

  const lenses = [...(DEFAULT_COLD_LENSES[ext] || [])];

  // Skill files always get contractual lens
  if (/^skills\/.*\.md$/.test(file) && !lenses.includes('contractual')) {
    lenses.push('contractual');
  }

  // Always include custom rules for source files
  if (/\.(ts|tsx|js|jsx|py|go|rs|css|scss)$/.test(file)) {
    lenses.push('custom');
  }

  return lenses.filter(l => !disabled.has(l));
}

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
  const builtInRules = config.qualityRules?.builtIn || ['no-confirm-alert', 'no-transition-all'];

  for (const file of changedFiles) {
    const fullPath = path.join(projectDir, file);
    if (!fs.existsSync(fullPath)) continue;
    if (!/\.(ts|tsx|js|jsx|py|go|rs|css|scss|md)$/.test(file)) continue;

    let content;
    try {
      content = fs.readFileSync(fullPath, 'utf8');
    } catch {
      continue;
    }

    const lenses = selectColdPathLenses(file);

    for (const lens of lenses) {
      const lensViolations = runColdLens(lens, file, content, config, builtInRules);
      violations.push(...lensViolations);
    }
  }

  if (violations.length > 0) {
    health.increment('quality-gate', 'violations');
    const msg = [
      `[Quality Gate] ${violations.length} issue(s) in recently modified files:`,
      '',
      ...violations.map(v => `  ${v.file}: [${v.lens || v.rule}] ${v.message}`),
      '',
      'Fix these before finalizing your work.',
    ].join('\n');
    hookOutput('quality-gate', 'warned', msg, { violations });
  }

  process.exit(0);
}

function runColdLens(lens, file, content, config, builtInRules) {
  switch (lens) {
    case 'performance':
      return lensPerformance(file, content, builtInRules);
    case 'accessibility':
      return lensAccessibility(file, content);
    case 'adversarial':
      return lensAdversarial(file, content);
    case 'contractual':
      return lensContractual(file, content);
    case 'cross-reference':
      return lensCrossReference(file, content);
    case 'custom':
      return lensCustom(file, content, config);
    default:
      return [];
  }
}

// ── Performance Lens ────────────────────────────────────────────────────────

function lensPerformance(file, content, builtInRules) {
  const violations = [];

  if (builtInRules.includes('no-confirm-alert') && /\.(ts|tsx|js|jsx)$/.test(file)) {
    if (/\bconfirm\s*\(/.test(content)) {
      violations.push({ file, lens: 'performance', rule: 'no-confirm-alert', message: 'Uses confirm() — use an in-app modal' });
    }
    if (/\balert\s*\((?!.*eslint)/.test(content)) {
      violations.push({ file, lens: 'performance', rule: 'no-confirm-alert', message: 'Uses alert() — use an in-app notification' });
    }
  }

  if (builtInRules.includes('no-transition-all')) {
    if (/transition-all/.test(content)) {
      violations.push({ file, lens: 'performance', rule: 'no-transition-all', message: 'Uses transition-all — name specific properties (e.g., transition-[opacity,transform])' });
    }
  }

  if (builtInRules.includes('no-magic-intervals') && /\.(ts|tsx|js|jsx)$/.test(file)) {
    if (/setInterval\s*\([^,]+,\s*\d+\s*\)/.test(content)) {
      violations.push({ file, lens: 'performance', rule: 'no-magic-intervals', message: 'Hardcoded setInterval — use a named constant for the interval' });
    }
  }

  return violations;
}

// ── Accessibility Lens ──────────────────────────────────────────────────────

function lensAccessibility(file, content) {
  if (!/\.(tsx|jsx)$/.test(file)) return [];

  const violations = [];

  // Check for onClick on non-button elements without role/tabIndex
  const onClickDivRegex = /<(?:div|span|a(?!\s+href))\s[^>]*onClick[^>]*>/g;
  let match;
  while ((match = onClickDivRegex.exec(content)) !== null) {
    const tag = match[0];
    if (!tag.includes('role=') && !tag.includes('tabIndex')) {
      violations.push({
        file,
        lens: 'accessibility',
        message: 'Interactive element with onClick but missing role and tabIndex',
      });
      break; // One warning per file to avoid noise
    }
  }

  // Check for img tags without alt attribute
  const imgNoAlt = /<img\s(?![^>]*alt=)[^>]*>/;
  if (imgNoAlt.test(content)) {
    violations.push({
      file,
      lens: 'accessibility',
      message: 'img element without alt attribute',
    });
  }

  // Check for icon-only buttons without aria-label
  const iconButtonRegex = /<button\s(?![^>]*aria-label)[^>]*>[\s]*<(?:svg|Icon|img)/;
  if (iconButtonRegex.test(content)) {
    violations.push({
      file,
      lens: 'accessibility',
      message: 'Icon-only button without aria-label',
    });
  }

  return violations;
}

// ── Adversarial Lens ────────────────────────────────────────────────────────

function lensAdversarial(file, content) {
  const violations = [];

  if (/\.(ts|tsx|js|jsx)$/.test(file)) {
    // Check for dangerouslySetInnerHTML
    if (/dangerouslySetInnerHTML/.test(content)) {
      violations.push({
        file,
        lens: 'adversarial',
        message: 'Uses dangerouslySetInnerHTML — verify input is sanitized',
      });
    }

    // Check for eval()
    if (/\beval\s*\(/.test(content)) {
      violations.push({
        file,
        lens: 'adversarial',
        message: 'Uses eval() — potential code injection vector',
      });
    }

    // Check for document.write
    if (/document\.write\s*\(/.test(content)) {
      violations.push({
        file,
        lens: 'adversarial',
        message: 'Uses document.write() — potential XSS vector',
      });
    }

    // Check for innerHTML assignment
    if (/\.innerHTML\s*=/.test(content)) {
      violations.push({
        file,
        lens: 'adversarial',
        message: 'Direct innerHTML assignment — use textContent or sanitize input',
      });
    }
  }

  if (/\.py$/.test(file)) {
    // Check for exec/eval in Python
    if (/\bexec\s*\(/.test(content) || /\beval\s*\(/.test(content)) {
      violations.push({
        file,
        lens: 'adversarial',
        message: 'Uses exec()/eval() — potential code injection',
      });
    }
  }

  if (/\.go$/.test(file)) {
    // Check for fmt.Sprintf in SQL queries
    if (/fmt\.Sprintf\s*\([^)]*(?:SELECT|INSERT|UPDATE|DELETE)/i.test(content)) {
      violations.push({
        file,
        lens: 'adversarial',
        message: 'fmt.Sprintf with SQL — use parameterized queries',
      });
    }
  }

  return violations;
}

// ── Contractual Lens ────────────────────────────────────────────────────────

function lensContractual(file, content) {
  // Only check skill files
  if (!/^skills\/.*\.md$/.test(file)) return [];

  const violations = [];

  // Check for required frontmatter fields
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    violations.push({
      file,
      lens: 'contractual',
      message: 'Skill file missing frontmatter block (---)',
    });
    return violations;
  }

  const fm = frontmatterMatch[1];
  const requiredFields = ['name', 'description'];
  for (const field of requiredFields) {
    if (!new RegExp(`^${field}:`, 'm').test(fm)) {
      violations.push({
        file,
        lens: 'contractual',
        message: `Skill file missing required frontmatter field: ${field}`,
      });
    }
  }

  // Check for required sections
  const requiredSections = ['## Protocol', '## Identity'];
  for (const section of requiredSections) {
    if (!content.includes(section)) {
      violations.push({
        file,
        lens: 'contractual',
        message: `Skill file missing required section: ${section}`,
      });
    }
  }

  return violations;
}

// ── Cross-Reference Lens ────────────────────────────────────────────────────

function lensCrossReference(file, content) {
  // For .md files, check if referenced file paths actually exist
  if (!/\.md$/.test(file)) return [];

  const violations = [];
  const projectDir = health.PROJECT_ROOT;

  // Find file path references like `path/to/file.ts` or (path/to/file.js)
  const pathRefRegex = /[`(]([a-zA-Z0-9_./-]+\.[a-z]{1,4})[`)\s]/g;
  let match;
  const checked = new Set();

  while ((match = pathRefRegex.exec(content)) !== null) {
    const refPath = match[1];
    // Skip URLs, common false positives
    if (refPath.includes('://') || refPath.startsWith('http')) continue;
    if (/\.(md|txt|log|png|jpg|svg)$/.test(refPath)) continue;
    if (checked.has(refPath)) continue;
    checked.add(refPath);

    // Only check paths that look like project files
    if (refPath.includes('/') && !fs.existsSync(path.join(projectDir, refPath))) {
      violations.push({
        file,
        lens: 'cross-reference',
        message: `References non-existent file: ${refPath}`,
      });
    }
  }

  return violations;
}

// ── Custom Rules Lens ───────────────────────────────────────────────────────

function lensCustom(file, content, config) {
  const violations = [];
  const REDOS_HEURISTIC = /(\+|\*|\{[\d,]+\}){2,}|(\|[^|]*){4,}/;
  const customRules = config.qualityRules?.custom || [];

  for (const rule of customRules) {
    if (rule.pattern && rule.message) {
      if (REDOS_HEURISTIC.test(rule.pattern)) continue;
      let regex, fileRegex;
      try {
        regex = new RegExp(rule.pattern);
        fileRegex = rule.filePattern ? new RegExp(rule.filePattern) : null;
      } catch {
        continue;
      }
      if (fileRegex && !fileRegex.test(file)) continue;
      if (regex.test(content)) {
        violations.push({ file, lens: 'custom', rule: rule.name || 'custom', message: rule.message });
      }
    }
  }

  return violations;
}

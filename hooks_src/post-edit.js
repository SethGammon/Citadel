#!/usr/bin/env node

/**
 * post-edit.js — PostToolUse hook (runs on every Edit/Write)
 *
 * Verification Dispatch: hot-path lenses that run on every edit.
 * Each lens is a lightweight check (<5ms budget) selected by file extension.
 *
 * Lenses (hot path):
 *   - programmatic: language-adaptive typecheck (tsc, mypy, go vet, cargo check)
 *   - structural: file placement, naming conventions, import layer violations
 *   - performance: transition-all, repeat:Infinity, confirm/alert/prompt
 *
 * Legacy checks (integrated as lenses):
 *   - dependencyPatternLint → structural
 *   - designManifestLint → visual (hot-path subset)
 *   - docStalenessCheck → cross-reference (hot-path subset)
 *
 * Exit codes:
 *   0 = success (or non-checkable file, or non-Edit/Write tool)
 *   2 = type errors found in edited file
 */

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const health = require('./harness-health-util');

const PROJECT_ROOT = health.PROJECT_ROOT;

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

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    const startTime = Date.now();
    let event;
    try {
      event = JSON.parse(input);
    } catch {
      process.exit(0);
    }

    const toolName = event.tool_name || '';

    // Only run on Edit and Write operations
    if (toolName !== 'Edit' && toolName !== 'Write') {
      process.exit(0);
    }

    // Extract file path from tool input
    const filePath = event.tool_input?.file_path || event.tool_input?.path || '';
    if (!filePath) {
      process.exit(0);
    }

    const pathCheck = health.validatePath(filePath);
    if (!pathCheck.safe) {
      health.securityWarning('post-edit', `Possible injection in file path — ${pathCheck.violation}. Skipping typecheck.`);
      process.exit(0);
    }

    const relativePath = path.relative(PROJECT_ROOT, filePath).replace(/\\/g, '/');

    // Determine which hot-path lenses apply to this file
    const lenses = selectHotPathLenses(filePath, relativePath);

    // Run selected lenses
    let exitCode = 0;
    for (const lens of lenses) {
      const lensResult = runHotLens(lens, filePath, relativePath);
      if (lensResult > exitCode) exitCode = lensResult;
    }

    health.logTiming('post-edit', Date.now() - startTime, {
      file: relativePath,
      lenses: lenses.join(','),
      typecheck: exitCode === 0 ? 'pass' : 'fail',
    });

    process.exit(exitCode);
  });
}

// ── Hot-Path Lens Dispatch ──────────────────────────────────────────────────

/**
 * Dispatch table: maps file extensions to the lenses that should run.
 * Each lens is a lightweight check. The table is read from harness.json
 * verification.hot if configured, otherwise uses these defaults.
 */
const DEFAULT_HOT_LENSES = {
  '.ts':   ['programmatic', 'structural', 'performance'],
  '.tsx':  ['programmatic', 'structural', 'performance'],
  '.js':   ['structural', 'performance'],
  '.jsx':  ['structural', 'performance'],
  '.mjs':  ['performance'],
  '.cjs':  ['performance'],
  '.py':   ['programmatic', 'structural'],
  '.go':   ['programmatic', 'structural'],
  '.rs':   ['programmatic'],
  '.css':  ['performance'],
  '.scss': ['performance'],
  '.md':   ['cross-reference'],
};

function selectHotPathLenses(filePath, relativePath) {
  const config = health.readConfig();
  const verification = config.verification || {};
  const disabled = new Set(verification.disabled || []);
  const ext = path.extname(filePath).toLowerCase();

  // Use configured hot lenses or fall back to defaults
  const candidates = DEFAULT_HOT_LENSES[ext] || [];

  // Always include dependency and design checks for source files (they're fast)
  const lenses = [...candidates];
  if (/\.(ts|tsx|js|jsx)$/.test(filePath) && !lenses.includes('structural')) {
    lenses.push('structural');
  }
  if (/\.(css|scss|tsx|jsx)$/.test(filePath) && !lenses.includes('visual')) {
    lenses.push('visual');
  }

  return lenses.filter(l => !disabled.has(l));
}

function runHotLens(lens, filePath, relativePath) {
  switch (lens) {
    case 'programmatic':
      return typeCheck(filePath, relativePath);
    case 'structural':
      structuralLint(filePath, relativePath);
      dependencyPatternLint(filePath, relativePath);
      return 0;
    case 'performance':
      performanceLint(filePath, relativePath);
      return 0;
    case 'visual':
      designManifestLint(filePath, relativePath);
      return 0;
    case 'cross-reference':
      docStalenessCheck(filePath, relativePath);
      return 0;
    default:
      return 0;
  }
}

// ── Structural Lint (hot-path) ──────────────────────────────────────────────

/**
 * Checks import layer boundaries for projects with layer architecture.
 * Only fires if the project has a layer config in harness.json or uses
 * common alias patterns (@kernel, @os, @domains).
 */
function structuralLint(filePath, relativePath) {
  if (!/\.(ts|tsx|js|jsx)$/.test(filePath)) return;

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return;
  }

  const warnings = [];

  // Detect file's layer from path
  const layer = detectLayer(relativePath);
  if (!layer) return;

  // Check import violations
  const importRegex = /(?:import|from)\s+['"](@(?:kernel|os|domains|ui|canvas)[^'"]*)['"]/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const importedAlias = match[1];
    const violation = checkLayerViolation(layer, importedAlias);
    if (violation) {
      warnings.push(violation);
    }
  }

  if (warnings.length > 0) {
    hookOutput('post-edit', 'warned',
      `[structural] ${relativePath}:\n` + warnings.map(w => `  - ${w}`).join('\n') + '\n',
      { file: relativePath, warnings, lens: 'structural' });
  }
}

function detectLayer(relativePath) {
  if (/^src\/kernel\//.test(relativePath)) return 'kernel';
  if (/^src\/os\//.test(relativePath)) return 'os';
  if (/^src\/domains\//.test(relativePath)) return 'domains';
  if (/^src\/canvas\//.test(relativePath)) return 'canvas';
  return null;
}

function checkLayerViolation(layer, importAlias) {
  const importLayer = importAlias.split('/')[0].replace('@', '');

  const rules = {
    kernel: [], // kernel cannot import app layers
    os: ['kernel'], // os can import kernel only
    domains: ['kernel', 'os'], // domains can import kernel + os
    canvas: ['kernel', 'os', 'ui'], // canvas can import kernel + os + design system
  };

  const allowed = rules[layer];
  if (!allowed) return null;

  // Same-layer imports are fine
  if (importLayer === layer) return null;

  if (!allowed.includes(importLayer)) {
    return `Layer violation: ${layer} cannot import @${importLayer} (allowed: ${allowed.map(l => '@' + l).join(', ') || 'none'})`;
  }
  return null;
}

// ── Type Checking ────────────────────────────────────────────────────────────

function typeCheck(filePath, relativePath) {
  const config = health.readConfig();
  const language = config.language || 'unknown';
  const typecheckConfig = config.typecheck || {};

  // No typecheck configured — skip gracefully
  if (!typecheckConfig.command) {
    // Log once per session so beginners know setup is available
    const notifiedFlag = path.join(PROJECT_ROOT, '.planning', 'telemetry', '.typecheck-notified');
    if (language === 'unknown' && !fs.existsSync(notifiedFlag)) {
      try {
        const telemetryDir = path.dirname(notifiedFlag);
        if (fs.existsSync(telemetryDir)) {
          fs.writeFileSync(notifiedFlag, Date.now().toString());
          hookOutput('post-edit', 'info', '[typecheck] No typecheck configured. Run /do setup to enable per-edit type checking.');
        }
      } catch {
        // Silently skip if we can't write the flag
      }
    }
    return 0;
  }

  try {
    if (language === 'typescript') {
      return typecheckTypeScript(filePath, relativePath);
    } else if (language === 'python') {
      return typecheckPython(filePath, relativePath, typecheckConfig.command);
    } else if (language === 'go') {
      return typecheckGo(filePath, relativePath);
    } else if (language === 'rust') {
      return typecheckRust();
    }
  } catch (err) {
    // Typecheck failure should not block the edit
    if (err.status === 2 || (err.stdout && err.stdout.includes('error'))) {
      return 2;
    }
  }

  return 0;
}

function typecheckTypeScript(filePath, relativePath) {
  // Only check .ts and .tsx files
  if (!/\.(ts|tsx)$/.test(filePath)) return 0;
  // Skip declaration files
  if (/\.d\.ts$/.test(filePath)) return 0;

  try {
    execFileSync('npx', ['tsc', '--noEmit', '--pretty', 'false'], {
      cwd: PROJECT_ROOT,
      timeout: 25000,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return 0;
  } catch (err) {
    const output = (err.stdout || '') + (err.stderr || '');
    // Filter to only errors in the edited file
    const lines = output.split('\n').filter(line => {
      const normalized = line.replace(/\\/g, '/');
      return normalized.includes(relativePath) && line.includes('error TS');
    });

    if (lines.length > 0) {
      const msg = [
        `[typecheck] ${lines.length} error(s) in ${relativePath}:`,
        ...lines.slice(0, 10),
        lines.length > 10 ? `  ... and ${lines.length - 10} more` : null,
      ].filter(Boolean).join('\n');
      hookOutput('post-edit', 'error', msg, { file: relativePath, errors: lines.slice(0, 10), exit_code: 2 });
      return 2;
    }
    return 0;
  }
}

function typecheckPython(filePath, relativePath, command) {
  if (!/\.py$/.test(filePath)) return 0;

  const cmdCheck = health.validateCommand(command);
  if (!cmdCheck.safe) {
    health.securityWarning('post-edit', `Possible injection in typecheck command — ${cmdCheck.violation}. Skipping typecheck.`);
    return 0;
  }

  // Command is expected to be simple whitespace-separated tokens (e.g., "mypy --strict").
  // Quoted arguments like --config-file "my config.ini" are not supported.
  const [cmd, ...cmdArgs] = command.split(/\s+/);
  try {
    execFileSync(cmd, [...cmdArgs, filePath], {
      cwd: PROJECT_ROOT,
      timeout: 20000,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return 0;
  } catch (err) {
    const output = (err.stdout || '') + (err.stderr || '');
    const lines = output.split('\n').filter(l => l.includes('error'));
    if (lines.length > 0) {
      hookOutput('post-edit', 'error', `[typecheck] Errors in ${relativePath}:\n${lines.slice(0, 10).join('\n')}`, { file: relativePath, errors: lines.slice(0, 10), exit_code: 2 });
      return 2;
    }
    return 0;
  }
}

function typecheckGo(filePath, relativePath) {
  if (!/\.go$/.test(filePath)) return 0;
  const dir = path.dirname(filePath);

  try {
    execFileSync('go', ['vet', './...'], {
      cwd: dir,
      timeout: 20000,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return 0;
  } catch (err) {
    const output = (err.stdout || '') + (err.stderr || '');
    if (output.trim()) {
      hookOutput('post-edit', 'error', `[typecheck] go vet issues:\n${output.slice(0, 500)}`, { file: relativePath, errors: [output.slice(0, 500)], exit_code: 2 });
      return 2;
    }
    return 0;
  }
}

function typecheckRust() {
  try {
    execFileSync('cargo', ['check', '--message-format=short'], {
      cwd: PROJECT_ROOT,
      timeout: 30000,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return 0;
  } catch (err) {
    const output = (err.stdout || '') + (err.stderr || '');
    const errors = output.split('\n').filter(l => l.includes('error'));
    if (errors.length > 0) {
      hookOutput('post-edit', 'error', `[typecheck] cargo check errors:\n${errors.slice(0, 10).join('\n')}`, { file: '', errors: errors.slice(0, 10), exit_code: 2 });
      return 2;
    }
    return 0;
  }
}

// ── Performance Lint ─────────────────────────────────────────────────────────

function performanceLint(filePath, relativePath) {
  // Only lint source files
  if (!/\.(ts|tsx|js|jsx|py|go|rs)$/.test(filePath)) return;

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return;
  }

  const warnings = [];

  // Check for confirm/alert/prompt (cross-language web anti-pattern)
  if (/\.(ts|tsx|js|jsx)$/.test(filePath)) {
    if (/\bconfirm\s*\(/.test(content)) warnings.push('Uses confirm() — use an in-app modal instead');
    if (/\balert\s*\(/.test(content)) warnings.push('Uses alert() — use an in-app notification instead');
    if (/\bprompt\s*\(/.test(content)) warnings.push('Uses prompt() — use an in-app input instead');
  }

  // Check for transition-all (CSS performance) — only in CSS/JS/TS files
  if (/\.(ts|tsx|js|jsx|css|scss)$/.test(filePath) && /transition-all/.test(content)) {
    warnings.push('Uses transition-all — specify properties explicitly (e.g., transition-[opacity,transform])');
  }

  if (warnings.length > 0) {
    hookOutput('post-edit', 'warned', `[lint] ${relativePath}:\n` + warnings.map(w => `  - ${w}`).join('\n') + '\n', { file: relativePath, warnings });
  }
}

// ── Dependency-Aware Pattern Detection ────────────────────────────────────────

// Cache package.json deps for the session (process lifetime)
let _cachedDeps = null;

function getProjectDeps() {
  if (_cachedDeps !== null) return _cachedDeps;
  try {
    const pkgPath = path.join(PROJECT_ROOT, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    _cachedDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };
  } catch {
    _cachedDeps = {};
  }
  return _cachedDeps;
}

function dependencyPatternLint(filePath, relativePath) {
  // Only check source files
  if (!/\.(ts|tsx|js|jsx)$/.test(filePath)) return;

  const config = health.readConfig();
  const patterns = config.dependencyPatterns;
  if (!patterns || !Array.isArray(patterns) || patterns.length === 0) return;

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return;
  }

  const deps = getProjectDeps();
  const warnings = [];

  for (const entry of patterns) {
    if (!entry.dependency || !deps[entry.dependency]) continue;
    if (!Array.isArray(entry.banned)) continue;

    for (const banned of entry.banned) {
      if (content.includes(banned)) {
        const msg = entry.message || 'Use the library instead.';
        warnings.push('Found ' + banned + ' but ' + entry.dependency + ' is installed. ' + msg);
        break; // One warning per dependency, not per match
      }
    }
  }

  if (warnings.length > 0) {
    hookOutput('post-edit', 'warned', '[dep-lint] ' + relativePath + ':\n' + warnings.map(function(w) { return '  - ' + w; }).join('\n') + '\n', { file: relativePath, warnings });
  }
}



// ── Design Manifest Lint ────────────────────────────────────────────────────

let _cachedManifest = null;
let _manifestChecked = false;

function loadDesignManifest() {
  if (_manifestChecked) return _cachedManifest;
  _manifestChecked = true;
  try {
    const manifestPath = path.join(PROJECT_ROOT, '.planning', 'design-manifest.md');
    if (!fs.existsSync(manifestPath)) return null;
    _cachedManifest = fs.readFileSync(manifestPath, 'utf8');
  } catch {
    _cachedManifest = null;
  }
  return _cachedManifest;
}

function extractManifestColors(manifest) {
  const colors = [];
  const colorRegex = /#[0-9a-fA-F]{3,8}\b/g;
  const lines = manifest.split('\n');
  let inColors = false;
  for (const line of lines) {
    if (/^## Colors/.test(line)) { inColors = true; continue; }
    if (/^## [^C]/.test(line) && inColors) break;
    if (inColors) {
      let match;
      while ((match = colorRegex.exec(line)) !== null) {
        colors.push(match[0].toLowerCase());
      }
    }
  }
  return colors;
}

function designManifestLint(filePath, relativePath) {
  // Only check style-relevant files
  if (!/\.(css|scss|tsx|jsx)$/.test(filePath)) return;

  const manifest = loadDesignManifest();
  if (!manifest) return;

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return;
  }

  const paletteColors = extractManifestColors(manifest);
  if (paletteColors.length === 0) return;

  // Find hex colors in the edited file
  const hexRegex = /#[0-9a-fA-F]{3,8}\b/g;
  const foundColors = new Set();
  let match;
  while ((match = hexRegex.exec(content)) !== null) {
    foundColors.add(match[0].toLowerCase());
  }

  const offPalette = [...foundColors].filter(c => !paletteColors.includes(c));

  if (offPalette.length > 0) {
    const msg = `[design] ${relativePath}: Found ${offPalette.length} color(s) not in design manifest palette: ${offPalette.slice(0, 5).join(', ')}` +
      (offPalette.length > 5 ? ` (+${offPalette.length - 5} more)` : '') +
      `\n  Palette: ${paletteColors.slice(0, 8).join(', ')}${paletteColors.length > 8 ? ' ...' : ''}\n`;
    hookOutput('post-edit', 'warned', msg, { file: relativePath, offPalette, palette: paletteColors });
  }
}

// ── Doc Staleness Detection ──────────────────────────────────────────────────

/**
 * Lightweight heuristic: if a source file with exported function signatures
 * was edited AND there's a README or .md file in the same directory,
 * queue a potential-staleness event for doc-sync processing.
 *
 * Never blocks. Exit 0 always.
 */
function docStalenessCheck(filePath, relativePath) {
  // Only check source files
  if (!/\.(ts|tsx|js|jsx|py|go|rs)$/.test(filePath)) return;

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return;
  }

  // Heuristic: does the file contain an exported function/method declaration?
  const signaturePatterns = [
    /^export\s+(async\s+)?function\s+\w+/m,  // export function / export async function
    /^export\s+(default\s+)?class\s+\w+/m,   // export class
    /^def\s+\w+/m,                            // Python def
    /^func\s+\w+/m,                           // Go func
    /^pub\s+fn\s+\w+/m,                       // Rust pub fn
  ];

  const hasSignature = signaturePatterns.some(re => re.test(content));
  if (!hasSignature) return;

  // Check if there's a README or other .md file in the same directory
  const dir = path.dirname(filePath);
  let hasDocs = false;
  try {
    const entries = fs.readdirSync(dir);
    hasDocs = entries.some(e => /\.md$/i.test(e));
  } catch {
    return;
  }

  if (!hasDocs) return;

  // Queue the staleness event
  try {
    const queuePath = path.join(PROJECT_ROOT, '.planning', 'telemetry', 'doc-sync-queue.jsonl');
    const queueDir = path.dirname(queuePath);
    if (!fs.existsSync(queueDir)) return;

    const entry = JSON.stringify({
      event: 'potential-staleness',
      file: relativePath,
      timestamp: new Date().toISOString(),
      status: 'needs-review',
    });
    fs.appendFileSync(queuePath, entry + '\n');
  } catch {
    // Never block on queue failures
  }
}

main();

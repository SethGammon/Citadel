#!/usr/bin/env node

/**
 * post-edit.js — PostToolUse hook (runs on every Edit/Write)
 *
 * Language-adaptive per-file type checking:
 *   - TypeScript: tsc --noEmit on the changed file
 *   - Python: mypy or pyright on the changed file
 *   - Go: go vet on the package
 *   - Rust: cargo check (whole project, but fast with incremental)
 *
 * Also runs lightweight performance lint on the changed file.
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

    // Run performance lint
    performanceLint(filePath, relativePath);

    // Run type check
    const exitCode = typeCheck(filePath, relativePath);

    health.logTiming('post-edit', Date.now() - startTime, {
      file: relativePath,
      typecheck: exitCode === 0 ? 'pass' : 'fail',
    });

    process.exit(exitCode);
  });
}

// ── Type Checking ────────────────────────────────────────────────────────────

function typeCheck(filePath, relativePath) {
  const config = health.readConfig();
  const language = config.language || 'unknown';
  const typecheckConfig = config.typecheck || {};

  // No typecheck configured
  if (!typecheckConfig.command) {
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
      process.stdout.write(msg);
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
      process.stdout.write(`[typecheck] Errors in ${relativePath}:\n${lines.slice(0, 10).join('\n')}`);
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
      process.stdout.write(`[typecheck] go vet issues:\n${output.slice(0, 500)}`);
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
      process.stdout.write(`[typecheck] cargo check errors:\n${errors.slice(0, 10).join('\n')}`);
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
    process.stdout.write(
      `[lint] ${relativePath}:\n` + warnings.map(w => `  - ${w}`).join('\n') + '\n'
    );
  }
}

main();

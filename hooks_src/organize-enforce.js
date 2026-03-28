#!/usr/bin/env node

/**
 * organize-enforce.js -- PostToolUse hook (runs on Edit/Write)
 *
 * Checks if newly written or edited files comply with the project's
 * organization manifest (harness.json -> organization). Warns or blocks
 * based on the manifest's `locked` flag.
 *
 * Enforcement levels:
 *   - locked: false -> advisory warning (exit 0)
 *   - locked: true  -> hard block (exit 2)
 *
 * Skips gracefully when:
 *   - No organization config exists
 *   - Tool is not Edit/Write
 *   - File is in an excluded directory (.planning, .claude, node_modules, etc.)
 *   - No placement rules match the file
 */

const fs = require('fs');
const path = require('path');
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

// Directories excluded from organization enforcement
const EXCLUDED_PREFIXES = [
  '.planning/',
  '.claude/',
  '.citadel/',
  '.git/',
  'node_modules/',
  'dist/',
  'build/',
  '.next/',
  '__pycache__/',
  'target/',        // Rust
  '.venv/',
  'venv/',
];

/**
 * Minimatch-lite: convert a simple glob to a regex.
 * Supports *, **, ?, and {a,b} brace expansion (one level).
 * Not a full glob engine -- covers the patterns used in placement rules.
 */
function globToRegex(glob) {
  // Expand braces: *.{ts,tsx} -> (.*\.ts|.*\.tsx)
  const braceMatch = glob.match(/^(.*)\{([^}]+)\}(.*)$/);
  if (braceMatch) {
    const [, prefix, options, suffix] = braceMatch;
    const alts = options.split(',').map(opt => globToRegex(prefix + opt + suffix).source);
    return new RegExp('^(' + alts.join('|') + ')$');
  }

  let re = glob
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '__DOUBLESTAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/__DOUBLESTAR__/g, '.*')
    .replace(/\?/g, '[^/]');

  return new RegExp('^' + re + '$');
}

/**
 * Check if a file path is under a given root directory.
 */
function isUnderRoot(filePath, rootPath) {
  const normalizedFile = filePath.replace(/\\/g, '/');
  const normalizedRoot = rootPath.replace(/\\/g, '/').replace(/\/$/, '') + '/';
  return normalizedFile.startsWith(normalizedRoot);
}

/**
 * Get the directory of a file path, normalized to forward slashes.
 */
function getDirOf(filePath) {
  return path.dirname(filePath).replace(/\\/g, '/');
}

/**
 * Known suffix patterns that indicate a "companion" file (test, types, stories, etc.).
 * Order matters: longer suffixes first to avoid partial matches.
 */
const COMPANION_SUFFIXES = [
  '.test', '.spec', '.types', '.stories', '.styles', '.mock', '.fixture',
];

/**
 * Known "collector" directory names -- directories that aggregate files
 * by type rather than colocating them with their source.
 */
const COLLECTOR_DIRS = [
  'tests', '__tests__', 'test', '__test__',
  'types', '__types__',
  'mocks', '__mocks__',
  'fixtures', '__fixtures__',
  'stories', '__stories__',
  'styles',
];

/**
 * Strip companion suffixes from a filename to get the base source name.
 * e.g., "Button.test.tsx" -> "Button", "auth.spec.js" -> "auth"
 */
function getBaseName(fileName) {
  // Remove extension first
  const ext = path.extname(fileName);
  let name = fileName.slice(0, -ext.length);

  // Strip companion suffix if present
  for (const suffix of COMPANION_SUFFIXES) {
    if (name.endsWith(suffix)) {
      return name.slice(0, -suffix.length);
    }
  }
  return name;
}

/**
 * Check if a source file exists in a given directory for a base name.
 * Tries common source extensions.
 */
function sourceExistsInDir(dir, baseName) {
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.rb'];
  const absDir = path.isAbsolute(dir) ? dir : path.join(PROJECT_ROOT, dir);
  for (const ext of extensions) {
    if (fs.existsSync(path.join(absDir, baseName + ext))) return true;
  }
  return false;
}

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    let event;
    try {
      event = JSON.parse(input);
    } catch {
      process.exit(0);
    }

    const toolName = event.tool_name || '';
    if (toolName !== 'Edit' && toolName !== 'Write') {
      process.exit(0);
    }

    const filePath = event.tool_input?.file_path || event.tool_input?.path || '';
    if (!filePath) {
      process.exit(0);
    }

    // Validate path safety
    const pathCheck = health.validatePath(filePath);
    if (!pathCheck.safe) {
      process.exit(0);
    }

    const relativePath = path.relative(PROJECT_ROOT, filePath).replace(/\\/g, '/');

    // Skip excluded directories
    for (const prefix of EXCLUDED_PREFIXES) {
      if (relativePath.startsWith(prefix)) {
        process.exit(0);
      }
    }

    // Read organization config
    const config = health.readConfig();
    const org = config.organization;
    if (!org) {
      process.exit(0); // No organization manifest -- nothing to enforce
    }

    const violations = [];

    // Check placement rules
    if (Array.isArray(org.placement)) {
      for (const rule of org.placement) {
        if (!rule.glob || !rule.rule) continue;

        const fileName = path.basename(relativePath);
        const regex = globToRegex(rule.glob);

        if (!regex.test(fileName)) continue;

        // File matches this rule -- check placement
        const fileDir = getDirOf(relativePath);

        switch (rule.rule) {
          case 'colocated': {
            // File should be in the same directory as its source file.
            // Strategy:
            //   1. Strip companion suffix to get base name (Button.test.tsx -> Button)
            //   2. Check if a source file exists in the SAME directory -> compliant
            //   3. If not, check if we're in a collector dir (tests/, __tests__/) -> violation
            //   4. If neither condition is clear -> skip (avoid false positives)
            const baseName = getBaseName(path.basename(relativePath));
            const dirName = path.basename(fileDir);
            const isInCollector = COLLECTOR_DIRS.includes(dirName);

            if (isInCollector) {
              // File is in a collector directory -- this violates colocated convention.
              // Check if a source exists in the parent dir to give a better message.
              const parentDir = getDirOf(fileDir);
              const sourceInParent = sourceExistsInDir(parentDir, baseName);
              violations.push({
                file: relativePath,
                rule: rule.glob,
                expected: sourceInParent ? parentDir + '/' : 'same directory as source file',
                actual: fileDir,
                reason: rule.reason || `File is in collector directory "${dirName}/" but should be colocated with its source`,
              });
            } else if (!sourceExistsInDir(fileDir, baseName)) {
              // No source file in the same directory. Could be a new file, could be misplaced.
              // Only warn if we can find the source elsewhere in declared roots.
              if (org.roots && typeof org.roots === 'object') {
                const rootPaths = Object.keys(org.roots);
                for (const root of rootPaths) {
                  const rootAbs = path.join(PROJECT_ROOT, root);
                  if (!fs.existsSync(rootAbs)) continue;
                  // Shallow search: check immediate subdirectories of roots (1 level)
                  try {
                    const subdirs = fs.readdirSync(rootAbs, { withFileTypes: true })
                      .filter(d => d.isDirectory())
                      .map(d => path.join(root, d.name).replace(/\\/g, '/'));
                    for (const subdir of subdirs) {
                      if (subdir === fileDir) continue; // same dir, skip
                      if (sourceExistsInDir(subdir, baseName)) {
                        violations.push({
                          file: relativePath,
                          rule: rule.glob,
                          expected: subdir + '/',
                          actual: fileDir,
                          reason: rule.reason || `Source file "${baseName}" found in ${subdir}/ -- companion should be colocated there`,
                        });
                        break;
                      }
                    }
                  } catch { /* skip unreadable dirs */ }
                  if (violations.some(v => v.file === relativePath)) break;
                }
              }
            }
            // If source IS in the same dir -> compliant, no violation added.
            break;
          }

          case 'sibling-dir': {
            // File should be in a specific sibling directory
            if (rule.target) {
              const parentDir = path.dirname(fileDir);
              const expectedDir = parentDir + '/' + rule.target.replace(/\/$/, '');
              if (fileDir !== expectedDir && !isUnderRoot(relativePath, rule.target)) {
                violations.push({
                  file: relativePath,
                  rule: rule.glob,
                  expected: rule.target,
                  actual: fileDir,
                  reason: rule.reason || `File should be in ${rule.target}`,
                });
              }
            }
            break;
          }

          case 'root-dir': {
            // File should be under a specific root directory
            if (rule.target && !isUnderRoot(relativePath, rule.target)) {
              violations.push({
                file: relativePath,
                rule: rule.glob,
                expected: rule.target,
                actual: fileDir,
                reason: rule.reason || `File should be under ${rule.target}`,
              });
            }
            break;
          }

          case 'within-root': {
            // File should be under one of the declared roots
            if (org.roots && typeof org.roots === 'object') {
              const rootPaths = Object.keys(org.roots);
              const inRoot = rootPaths.some(r => isUnderRoot(relativePath, r));
              if (!inRoot) {
                violations.push({
                  file: relativePath,
                  rule: rule.glob,
                  expected: `one of: ${rootPaths.join(', ')}`,
                  actual: fileDir,
                  reason: rule.reason || 'File should be within a declared root directory',
                });
              }
            }
            break;
          }
        }
      }
    }

    // Check that source files are within declared roots (general enforcement)
    if (org.roots && typeof org.roots === 'object') {
      const rootPaths = Object.keys(org.roots);
      if (rootPaths.length > 0) {
        // Only enforce for source-like files, not configs at project root
        const isSourceFile = /\.(ts|tsx|js|jsx|py|go|rs|java|rb|php|cs|cpp|c|h)$/.test(relativePath);
        const isAtProjectRoot = !relativePath.includes('/');

        if (isSourceFile && !isAtProjectRoot) {
          const inRoot = rootPaths.some(r => isUnderRoot(relativePath, r));
          if (!inRoot) {
            // Only warn, don't duplicate if a placement rule already caught this
            const alreadyCaught = violations.some(v => v.file === relativePath);
            if (!alreadyCaught) {
              violations.push({
                file: relativePath,
                rule: 'root-enforcement',
                expected: `one of: ${rootPaths.join(', ')}`,
                actual: path.dirname(relativePath).replace(/\\/g, '/'),
                reason: 'Source file is outside all declared root directories',
              });
            }
          }
        }
      }
    }

    if (violations.length === 0) {
      process.exit(0);
    }

    // Report violations
    const locked = org.locked === true;
    const severity = locked ? 'BLOCK' : 'WARN';
    const action = locked ? 'blocked' : 'warned';

    const lines = [
      `[organize] ${severity}: ${violations.length} placement violation(s):`,
      '',
    ];

    for (const v of violations) {
      lines.push(`  ${v.file}`);
      lines.push(`    Rule: ${v.rule} -- ${v.reason}`);
      lines.push(`    Expected: ${v.expected}`);
      lines.push(`    Actual: ${v.actual}`);
      lines.push('');
    }

    if (!locked) {
      lines.push('  (advisory -- run /organize --lock to enforce)');
    } else {
      lines.push('  Move the file to the correct location before continuing.');
    }

    hookOutput('organize-enforce', action, lines.join('\n') + '\n', { violations, locked });

    health.increment('organize-enforce', locked ? 'blocks' : 'warnings');

    process.exit(locked ? 2 : 0);
  });
}

main();

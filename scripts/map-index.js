#!/usr/bin/env node

/**
 * map-index.js -- Structural index generator for codebases.
 *
 * Scans a project tree and produces a JSON index at .planning/map/index.json
 * containing file metadata, exports, imports, symbols, roles, and a
 * dependency graph. Supports TypeScript/JavaScript, Python, Go, and Rust.
 *
 * Usage:
 *   node scripts/map-index.js [options]
 *
 * Modes:
 *   --generate (default)   Build or refresh the index
 *   --query <terms>        Search the index by keyword
 *   --stats                Print summary statistics
 *
 * Options:
 *   --root <dir>           Project root (default: cwd)
 *   --output <path>        Output path (default: .planning/map/index.json)
 *   --force                Rebuild even if cache is fresh
 *   --max-files <n>        Max files returned by --query (default: 20)
 */

'use strict';

const fs   = require('fs');
const path = require('path');
// -- Constants ----------------------------------------------------------------

const ALWAYS_SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt',
  'coverage', '__pycache__', '.mypy_cache', '.pytest_cache', 'target',
  'vendor', '.terraform', '.planning',
]);

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.bmp', '.webp', '.svg',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv',
  '.exe', '.dll', '.so', '.dylib', '.o', '.a',
  '.bin', '.dat', '.db', '.sqlite', '.lock',
]);

const LANG_MAP = {
  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript',
  '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python', '.go': 'go', '.rs': 'rust',
};

const RESOLVABLE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

const CACHE_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

// -- CLI argument parser ------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    mode: 'generate',
    root: process.cwd(),
    output: null,
    force: false,
    query: '',
    maxFiles: 20,
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--generate')        { opts.mode = 'generate'; }
    else if (arg === '--query')      { opts.mode = 'query'; opts.query = argv[++i] || ''; }
    else if (arg === '--stats')      { opts.mode = 'stats'; }
    else if (arg === '--root')       { opts.root = path.resolve(argv[++i] || '.'); }
    else if (arg === '--output')     { opts.output = argv[++i]; }
    else if (arg === '--force')      { opts.force = true; }
    else if (arg === '--max-files')  { opts.maxFiles = parseInt(argv[++i], 10) || 20; }
    else if (!arg.startsWith('--'))  { if (!opts.query) opts.query = arg; }
    i++;
  }

  if (!opts.output) {
    opts.output = path.join(opts.root, '.planning', 'map', 'index.json');
  } else {
    opts.output = path.resolve(opts.output);
  }

  return opts;
}

// -- .gitignore parser ------------------------------------------------------

function globToRegex(glob) {
  let negated = false;
  let g = glob.trim();
  if (!g || g.startsWith('#')) return null;
  if (g.startsWith('!')) { negated = true; g = g.slice(1); }

  // Normalize: strip trailing slash (directory marker)
  g = g.replace(/\/+$/, '');

  // Build regex from glob
  let re = '';
  let i = 0;
  while (i < g.length) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') {
      re += '.*';
      i += 2;
      if (g[i] === '/') i++; // skip separator after **
    } else if (c === '*') {
      re += '[^/]*';
      i++;
    } else if (c === '?') {
      re += '[^/]';
      i++;
    } else if (c === '.') {
      re += '\\.';
      i++;
    } else {
      re += c;
      i++;
    }
  }

  // If pattern has no slash, it matches any path component
  if (!glob.includes('/')) {
    re = '(?:^|/)' + re + '(?:/|$)';
  } else {
    re = '(?:^|/)' + re + '(?:/|$)?';
  }

  return { regex: new RegExp(re), negated };
}

function loadGitignore(rootDir) {
  const gitignorePath = path.join(rootDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) return () => false;

  const content = fs.readFileSync(gitignorePath, 'utf8');
  const rules = content
    .split(/\r?\n/)
    .map(globToRegex)
    .filter(Boolean);

  return function isIgnored(relPath) {
    let ignored = false;
    for (const rule of rules) {
      if (rule.regex.test(relPath)) {
        ignored = !rule.negated;
      }
    }
    return ignored;
  };
}

// -- File tree walker (iterative) -------------------------------------------

function walkFiles(rootDir, isIgnored) {
  const results = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath  = path.relative(rootDir, fullPath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        if (ALWAYS_SKIP_DIRS.has(entry.name)) continue;
        if (isIgnored(relPath)) continue;
        stack.push(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (BINARY_EXTENSIONS.has(ext)) continue;
        if (isIgnored(relPath)) continue;

        const lang = LANG_MAP[ext] || null;
        if (lang) {
          results.push({ relPath, fullPath, lang, ext });
        }
      }
    }
  }

  return results;
}

// -- Language extractors ----------------------------------------------------

function extractTS(content) {
  const exports  = [];
  const imports  = [];
  const symbols  = [];

  // Named exports: export (const|function|class|type|interface|enum) Name
  const exportRe = /\bexport\s+(?:default\s+)?(?:const|let|function|class|type|interface|enum|abstract\s+class)\s+(\w+)/g;
  let m;
  while ((m = exportRe.exec(content)) !== null) {
    exports.push(m[1]);
    symbols.push(m[1]);
  }

  // Default export of identifier: export default SomeName
  const defaultIdRe = /\bexport\s+default\s+([A-Z]\w*)\s*[;\n]/g;
  while ((m = defaultIdRe.exec(content)) !== null) {
    if (!exports.includes(m[1])) exports.push(m[1]);
  }

  // Re-exports: export { ... } from '...'
  const reExportRe = /\bexport\s*\{(([^}]+))\}\s*from\s*['"]([^'"]+)['"]/g;
  while ((m = reExportRe.exec(content)) !== null) {
    imports.push(m[2]);
    const names = m[1].split(',').map(s => s.trim().split(/\s+as\s+/).pop().trim());
    for (const n of names) { if (n && !exports.includes(n)) exports.push(n); }
  }

  // Imports: import ... from '...'
  const importRe = /\bimport\s+(?:(?:type\s+)?(?:\{[^}]*\}|[\w*]+(?:\s*,\s*\{[^}]*\})?)\s+from\s+)?['"]([^'"]+)['"]/g;
  while ((m = importRe.exec(content)) !== null) {
    imports.push(m[1]);
  }

  // Require: require('...')
  const requireRe = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = requireRe.exec(content)) !== null) {
    imports.push(m[1]);
  }

  // Additional symbols: top-level const/function/class (non-exported)
  const topLevelRe = /^(?:const|let|function|class|interface|type|enum)\s+(\w+)/gm;
  while ((m = topLevelRe.exec(content)) !== null) {
    if (!symbols.includes(m[1])) symbols.push(m[1]);
  }

  return { exports, imports, symbols };
}

function extractPython(content) {
  const exports  = [];
  const imports  = [];
  const symbols  = [];

  // __all__ exports
  const allRe = /__all__\s*=\s*\[([^\]]*)\]/g;
  let m;
  while ((m = allRe.exec(content)) !== null) {
    const names = m[1].match(/['"](\w+)['"]/g) || [];
    for (const n of names) {
      const clean = n.replace(/['"]/g, '');
      exports.push(clean);
      if (!symbols.includes(clean)) symbols.push(clean);
    }
  }

  // def / class at top level
  const defRe = /^(?:def|class)\s+(\w+)/gm;
  while ((m = defRe.exec(content)) !== null) {
    symbols.push(m[1]);
    if (exports.length === 0 && !m[1].startsWith('_')) exports.push(m[1]);
  }

  // import X / from X import Y
  const importRe = /^(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm;
  while ((m = importRe.exec(content)) !== null) {
    imports.push(m[1] || m[2]);
  }

  return { exports, imports, symbols };
}

function extractGo(content) {
  const exports  = [];
  const imports  = [];
  const symbols  = [];

  // Exported functions/types (capitalized)
  const funcRe = /^func\s+(?:\([^)]*\)\s+)?([A-Z]\w*)/gm;
  let m;
  while ((m = funcRe.exec(content)) !== null) {
    exports.push(m[1]);
    symbols.push(m[1]);
  }

  const typeRe = /^type\s+([A-Z]\w*)/gm;
  while ((m = typeRe.exec(content)) !== null) {
    exports.push(m[1]);
    symbols.push(m[1]);
  }

  // Imports
  const importBlockRe = /import\s*\(([\s\S]*?)\)/g;
  while ((m = importBlockRe.exec(content)) !== null) {
    const lines = m[1].split(/\r?\n/);
    for (const line of lines) {
      const im = line.match(/["']([^"']+)["']/);
      if (im) imports.push(im[1]);
    }
  }

  const singleImportRe = /^import\s+["']([^"']+)["']/gm;
  while ((m = singleImportRe.exec(content)) !== null) {
    imports.push(m[1]);
  }

  return { exports, imports, symbols };
}

function extractRust(content) {
  const exports  = [];
  const imports  = [];
  const symbols  = [];

  // pub fn / pub struct / pub enum / pub trait / pub type
  const pubRe = /\bpub\s+(?:async\s+)?(?:fn|struct|enum|trait|type|const|static)\s+(\w+)/g;
  let m;
  while ((m = pubRe.exec(content)) !== null) {
    exports.push(m[1]);
    symbols.push(m[1]);
  }

  // use statements
  const useRe = /^\s*use\s+([\w:]+)/gm;
  while ((m = useRe.exec(content)) !== null) {
    imports.push(m[1]);
  }

  return { exports, imports, symbols };
}

function extractFile(content, lang) {
  switch (lang) {
    case 'typescript':
    case 'javascript':
      return extractTS(content);
    case 'python':
      return extractPython(content);
    case 'go':
      return extractGo(content);
    case 'rust':
      return extractRust(content);
    default:
      return { exports: [], imports: [], symbols: [] };
  }
}

// -- Role inference ---------------------------------------------------------

function inferRole(relPath) {
  const p = relPath.toLowerCase();

  if (p.startsWith('skills/') || p.includes('/skills/'))         return 'skill';
  if (p.startsWith('agents/') || p.includes('/agents/'))         return 'agent';
  if (p.startsWith('hooks_src/') || p.includes('/hooks/'))       return 'hook';
  if (p.startsWith('scripts/') || p.includes('/scripts/'))       return 'script';

  if (/\.(?:test|spec)\.[^/]+$/.test(p))                        return 'test';
  if (p.includes('__test') || p.includes('__spec'))            return 'test';

  if (/\.(?:stories|story)\.[^/]+$/.test(p))                    return 'story';

  if (p.includes('/components/') || p.includes('/component/'))   return 'component';
  if (p.includes('/screens/') || p.includes('/pages/'))         return 'screen';
  if (p.includes('/store') || p.includes('Store.'))             return 'store';
  if (p.includes('/route') || p.includes('/api/'))               return 'route';
  if (p.includes('/types') || p.endsWith('.d.ts'))               return 'types';
  if (p.includes('/hook') || p.match(/\/use[A-Z]/))             return 'hook';
  if (p.includes('/util') || p.includes('/helper'))              return 'utility';
  if (p.includes('/config') || p.includes('/settings'))         return 'config';
  if (p.includes('/kernel/'))                                    return 'kernel';
  if (p.includes('/domain'))                                     return 'domain';

  return 'module';
}

// -- Import resolution ------------------------------------------------------

function resolveImportPath(importSpec, fromFile, rootDir, fileSet) {
  // Skip package imports (no leading . or /)
  if (!importSpec.startsWith('.') && !importSpec.startsWith('/')) return null;

  const fromDir  = path.dirname(path.join(rootDir, fromFile));
  const resolved = path.resolve(fromDir, importSpec);
  const relResolved = path.relative(rootDir, resolved).replace(/\\/g, '/');

  // Try exact match first
  if (fileSet.has(relResolved)) return relResolved;

  // Try with extensions
  for (const ext of RESOLVABLE_EXTS) {
    if (fileSet.has(relResolved + ext)) return relResolved + ext;
  }

  // Try /index with extensions
  for (const ext of RESOLVABLE_EXTS) {
    const indexPath = relResolved + '/index' + ext;
    if (fileSet.has(indexPath)) return indexPath;
  }

  return null;
}

// -- Dependency graph builder ------------------------------------------------

function buildGraph(filesMap, rootDir) {
  const fileSet = new Set(Object.keys(filesMap));
  const graph = {};

  for (const [relPath, info] of Object.entries(filesMap)) {
    const deps = [];
    for (const imp of info.imports) {
      const resolved = resolveImportPath(imp, relPath, rootDir, fileSet);
      if (resolved && resolved !== relPath) {
        deps.push(resolved);
      }
    }
    if (deps.length > 0) {
      graph[relPath] = deps;
    }
  }

  return graph;
}

// -- Index generation -------------------------------------------------------

function generateIndex(rootDir) {
  const isIgnored = loadGitignore(rootDir);
  const fileEntries = walkFiles(rootDir, isIgnored);

  const files = {};

  for (const entry of fileEntries) {
    let content;
    try {
      content = fs.readFileSync(entry.fullPath, 'utf8');
    } catch (_) {
      continue;
    }

    const lineCount = content.split(/\r?\n/).length;
    const extracted = extractFile(content, entry.lang);

    files[entry.relPath] = {
      lang:     entry.lang,
      lines:    lineCount,
      role:     inferRole(entry.relPath),
      exports:  extracted.exports,
      imports:  extracted.imports,
      symbols:  extracted.symbols,
    };
  }

  const graph = buildGraph(files, rootDir);

  return {
    version:   1,
    generated: new Date().toISOString(),
    root:      rootDir.replace(/\\/g, '/'),
    fileCount: Object.keys(files).length,
    files,
    graph,
  };
}

// -- Query mode -------------------------------------------------------------

function queryIndex(index, queryStr, maxFiles) {
  const terms = queryStr.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const scored = [];

  for (const [relPath, info] of Object.entries(index.files)) {
    let score = 0;
    const lowerPath = relPath.toLowerCase();

    for (const term of terms) {
      // Path match: +3
      if (lowerPath.includes(term)) score += 3;

      // Export match: +5
      for (const exp of info.exports) {
        if (exp.toLowerCase().includes(term)) { score += 5; break; }
      }

      // Symbol match: +2
      for (const sym of info.symbols) {
        if (sym.toLowerCase().includes(term)) { score += 2; break; }
      }

      // Role match: +1
      if (info.role.toLowerCase().includes(term)) score += 1;
    }

    if (score > 0) {
      scored.push({ relPath, score, role: info.role, exports: info.exports, lines: info.lines });
    }
  }

  // Sort by score descending, then by path
  scored.sort((a, b) => b.score - a.score || a.relPath.localeCompare(b.relPath));

  // Trim to budget: max 8000 chars total output
  const results = scored.slice(0, maxFiles);
  let output = '';
  const budgetResults = [];

  for (const r of results) {
    const line = `  ${r.score.toString().padStart(3)}  ${r.role.padEnd(10)} ${r.relPath}  [${r.exports.slice(0, 5).join(', ')}]  (${r.lines}L)\n`;
    if (output.length + line.length > 8000) break;
    output += line;
    budgetResults.push(r);
  }

  return budgetResults;
}

// -- Stats mode -------------------------------------------------------------

function showStats(index) {
  const langCounts = {};
  const roleCounts = {};
  let totalLines = 0;
  let totalExports = 0;

  for (const info of Object.values(index.files)) {
    langCounts[info.lang] = (langCounts[info.lang] || 0) + 1;
    roleCounts[info.role] = (roleCounts[info.role] || 0) + 1;
    totalLines += info.lines;
    totalExports += info.exports.length;
  }

  const graphEdges = Object.values(index.graph).reduce((sum, deps) => sum + deps.length, 0);

  console.log('\nCodebase Index Statistics\n' + '='.repeat(40));
  console.log(`Files:    ${index.fileCount}`);
  console.log(`Lines:    ${totalLines.toLocaleString()}`);
  console.log(`Exports:  ${totalExports}`);
  console.log(`Edges:    ${graphEdges} (dependency links)`);

  console.log('\nBy language:');
  for (const [lang, count] of Object.entries(langCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${lang.padEnd(14)} ${count}`);
  }

  console.log('\nBy role:');
  for (const [role, count] of Object.entries(roleCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${role.padEnd(14)} ${count}`);
  }

  console.log('');
}

// -- Main --------------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.mode === 'generate') {
    // Check cache freshness
    if (!opts.force && fs.existsSync(opts.output)) {
      const stat = fs.statSync(opts.output);
      const age  = Date.now() - stat.mtimeMs;
      if (age < CACHE_MAX_AGE_MS) {
        console.log(`Index is fresh (${Math.round(age / 1000)}s old). Use --force to rebuild.`);
        process.exit(0);
      }
    }

    console.log(`Scanning ${opts.root} ...`);
    const index = generateIndex(opts.root);

    // Ensure output directory exists
    const outDir = path.dirname(opts.output);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    fs.writeFileSync(opts.output, JSON.stringify(index, null, 2), 'utf8');
    console.log(`Index written: ${opts.output}`);
    console.log(`  ${index.fileCount} files, ${Object.keys(index.graph).length} graph entries`);
    process.exit(0);
  }

  // Both query and stats need an existing index
  if (!fs.existsSync(opts.output)) {
    console.error(`Index not found at ${opts.output}. Run --generate first.`);
    process.exit(1);
  }

  const index = JSON.parse(fs.readFileSync(opts.output, 'utf8'));

  if (opts.mode === 'query') {
    if (!opts.query) {
      console.error('Usage: --query <terms>');
      process.exit(1);
    }

    const results = queryIndex(index, opts.query, opts.maxFiles);

    if (results.length === 0) {
      console.log(`No results for "${opts.query}".`);
      process.exit(0);
    }

    console.log(`\nResults for "${opts.query}" (${results.length} matches):\n`);
    console.log('  Score  Role        Path');
    console.log('  ' + '-'.repeat(60));
    for (const r of results) {
      const exportsStr = r.exports.length > 0
        ? `  [${r.exports.slice(0, 5).join(', ')}${r.exports.length > 5 ? ', ...' : ''}]`
        : '';
      console.log(`  ${r.score.toString().padStart(3)}  ${r.role.padEnd(10)}  ${r.relPath}${exportsStr}  (${r.lines}L)`);
    }
    console.log('');
    process.exit(0);
  }

  if (opts.mode === 'stats') {
    showStats(index);
    process.exit(0);
  }
}

main();

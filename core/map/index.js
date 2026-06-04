'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

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
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
};

const RESOLVABLE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const DEFAULT_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
const DEFAULT_OUTPUT_RELATIVE = path.join('.planning', 'map', 'index.json');
const VERIFICATION_SCRIPT_PATTERN = /(test|lint|typecheck|verify|check|doctor|gate|bench)/i;

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function defaultOutputPath(rootDir) {
  return path.join(rootDir, DEFAULT_OUTPUT_RELATIVE);
}

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function globToRegex(glob) {
  let negated = false;
  let g = glob.trim();
  if (!g || g.startsWith('#')) return null;
  if (g.startsWith('!')) {
    negated = true;
    g = g.slice(1);
  }

  g = g.replace(/\/+$/, '');

  let re = '';
  let i = 0;
  while (i < g.length) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') {
      re += '.*';
      i += 2;
      if (g[i] === '/') i++;
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
      re += c.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
      i++;
    }
  }

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
  const rules = content.split(/\r?\n/).map(globToRegex).filter(Boolean);

  return function isIgnored(relPath) {
    let ignored = false;
    for (const rule of rules) {
      if (rule.regex.test(relPath)) ignored = !rule.negated;
    }
    return ignored;
  };
}

function walkFiles(rootDir, isIgnored = loadGitignore(rootDir)) {
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
      const relPath = normalizePath(path.relative(rootDir, fullPath));

      if (entry.isDirectory()) {
        if (ALWAYS_SKIP_DIRS.has(entry.name)) continue;
        if (isIgnored(relPath)) continue;
        stack.push(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (BINARY_EXTENSIONS.has(ext)) continue;
        if (isIgnored(relPath)) continue;

        const lang = LANG_MAP[ext] || null;
        if (lang) results.push({ relPath, fullPath, lang, ext });
      }
    }
  }

  return results.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

function extractTS(content) {
  const exports = [];
  const imports = [];
  const symbols = [];
  let m;

  const exportRe = /\bexport\s+(?:default\s+)?(?:const|let|function|class|type|interface|enum|abstract\s+class)\s+(\w+)/g;
  while ((m = exportRe.exec(content)) !== null) {
    exports.push(m[1]);
    symbols.push(m[1]);
  }

  const defaultIdRe = /\bexport\s+default\s+([A-Z]\w*)\s*[;\n]/g;
  while ((m = defaultIdRe.exec(content)) !== null) {
    if (!exports.includes(m[1])) exports.push(m[1]);
  }

  const reExportRe = /\bexport\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
  while ((m = reExportRe.exec(content)) !== null) {
    imports.push(m[2]);
    const names = m[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop().trim());
    for (const name of names) {
      if (name && !exports.includes(name)) exports.push(name);
    }
  }

  const importRe = /\bimport\s+(?:(?:type\s+)?(?:\{[^}]*\}|[\w*]+(?:\s*,\s*\{[^}]*\})?)\s+from\s+)?['"]([^'"]+)['"]/g;
  while ((m = importRe.exec(content)) !== null) imports.push(m[1]);

  const requireRe = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = requireRe.exec(content)) !== null) imports.push(m[1]);

  const topLevelRe = /^(?:const|let|function|class|interface|type|enum)\s+(\w+)/gm;
  while ((m = topLevelRe.exec(content)) !== null) {
    if (!symbols.includes(m[1])) symbols.push(m[1]);
  }

  return { exports: dedupe(exports), imports: dedupe(imports), symbols: dedupe(symbols) };
}

function extractPython(content) {
  const exports = [];
  const imports = [];
  const symbols = [];
  let m;

  const allRe = /__all__\s*=\s*\[([^\]]*)\]/g;
  while ((m = allRe.exec(content)) !== null) {
    const names = m[1].match(/['"](\w+)['"]/g) || [];
    for (const quoted of names) {
      const clean = quoted.replace(/['"]/g, '');
      exports.push(clean);
      symbols.push(clean);
    }
  }

  const defRe = /^(?:def|class)\s+(\w+)/gm;
  while ((m = defRe.exec(content)) !== null) {
    symbols.push(m[1]);
    if (exports.length === 0 && !m[1].startsWith('_')) exports.push(m[1]);
  }

  const importRe = /^(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm;
  while ((m = importRe.exec(content)) !== null) imports.push(m[1] || m[2]);

  return { exports: dedupe(exports), imports: dedupe(imports), symbols: dedupe(symbols) };
}

function extractGo(content) {
  const exports = [];
  const imports = [];
  const symbols = [];
  let m;

  const funcRe = /^func\s+(?:\([^)]*\)\s+)?([A-Z]\w*)/gm;
  while ((m = funcRe.exec(content)) !== null) {
    exports.push(m[1]);
    symbols.push(m[1]);
  }

  const typeRe = /^type\s+([A-Z]\w*)/gm;
  while ((m = typeRe.exec(content)) !== null) {
    exports.push(m[1]);
    symbols.push(m[1]);
  }

  const importBlockRe = /import\s*\(([\s\S]*?)\)/g;
  while ((m = importBlockRe.exec(content)) !== null) {
    for (const line of m[1].split(/\r?\n/)) {
      const im = line.match(/["']([^"']+)["']/);
      if (im) imports.push(im[1]);
    }
  }

  const singleImportRe = /^import\s+["']([^"']+)["']/gm;
  while ((m = singleImportRe.exec(content)) !== null) imports.push(m[1]);

  return { exports: dedupe(exports), imports: dedupe(imports), symbols: dedupe(symbols) };
}

function extractRust(content) {
  const exports = [];
  const imports = [];
  const symbols = [];
  let m;

  const pubRe = /\bpub\s+(?:async\s+)?(?:fn|struct|enum|trait|type|const|static)\s+(\w+)/g;
  while ((m = pubRe.exec(content)) !== null) {
    exports.push(m[1]);
    symbols.push(m[1]);
  }

  const useRe = /^\s*use\s+([\w:]+)/gm;
  while ((m = useRe.exec(content)) !== null) imports.push(m[1]);

  return { exports: dedupe(exports), imports: dedupe(imports), symbols: dedupe(symbols) };
}

function dedupe(values) {
  return Array.from(new Set(values.filter(Boolean)));
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

function inferRole(relPath) {
  const p = relPath.toLowerCase();

  if (/\btest-[^/]+\.js$/.test(p) || /\.(?:test|spec)\.[^/]+$/.test(p) || p.includes('__test') || p.includes('__spec')) return 'test';
  if (p.startsWith('skills/') || p.includes('/skills/')) return 'skill';
  if (p.startsWith('agents/') || p.includes('/agents/')) return 'agent';
  if (p.startsWith('hooks_src/') || p.includes('/hooks/')) return 'hook';
  if (p.startsWith('scripts/') || p.includes('/scripts/')) return 'script';
  if (/\.(?:stories|story)\.[^/]+$/.test(p)) return 'story';
  if (p.includes('/components/') || p.includes('/component/')) return 'component';
  if (p.includes('/screens/') || p.includes('/pages/')) return 'screen';
  if (p.includes('/store') || p.includes('store.')) return 'store';
  if (p.includes('/route') || p.includes('/api/')) return 'route';
  if (p.includes('/types') || p.endsWith('.d.ts')) return 'types';
  if (p.includes('/hook') || /\/use[A-Z]/.test(relPath)) return 'hook';
  if (p.includes('/util') || p.includes('/helper')) return 'utility';
  if (p.includes('/config') || p.includes('/settings')) return 'config';
  if (p.includes('/kernel/')) return 'kernel';
  if (p.includes('/domain')) return 'domain';

  return 'module';
}

function resolveImportPath(importSpec, fromFile, rootDir, fileSet) {
  if (!importSpec.startsWith('.') && !importSpec.startsWith('/')) return null;

  const fromDir = path.dirname(path.join(rootDir, fromFile));
  const resolved = path.resolve(fromDir, importSpec);
  const relResolved = normalizePath(path.relative(rootDir, resolved));

  if (fileSet.has(relResolved)) return relResolved;

  for (const ext of RESOLVABLE_EXTS) {
    if (fileSet.has(relResolved + ext)) return relResolved + ext;
  }

  for (const ext of RESOLVABLE_EXTS) {
    const indexPath = relResolved + '/index' + ext;
    if (fileSet.has(indexPath)) return indexPath;
  }

  return null;
}

function buildGraph(filesMap, rootDir) {
  const fileSet = new Set(Object.keys(filesMap));
  const graph = {};

  for (const [relPath, info] of Object.entries(filesMap)) {
    const deps = [];
    for (const imp of info.imports) {
      const resolved = resolveImportPath(imp, relPath, rootDir, fileSet);
      if (resolved && resolved !== relPath) deps.push(resolved);
    }
    if (deps.length > 0) graph[relPath] = dedupe(deps);
  }

  return graph;
}

function extractRoutesFromFile(relPath, content) {
  const routes = [];
  const p = normalizePath(relPath);

  if (/(^|\/)(app|pages)\//.test(p) && /\.(tsx?|jsx?|mjs|cjs)$/.test(p)) {
    let route = p
      .replace(/^(src\/)?(app|pages)\//, '/')
      .replace(/\/(page|route|index)\.[^.]+$/, '')
      .replace(/\.[^.]+$/, '')
      .replace(/\[(\w+)\]/g, ':$1');
    if (route === '') route = '/';
    if (!route.startsWith('/')) route = '/' + route;
    routes.push(route);
  }

  const routePatterns = [
    /\bpath\s*[:=]\s*['"]([^'"]+)['"]/g,
    /\broute\s*[:=]\s*['"]([^'"]+)['"]/g,
    /\burl\s*[:=]\s*['"]([^'"]+)['"]/g,
  ];

  for (const pattern of routePatterns) {
    let m;
    while ((m = pattern.exec(content)) !== null) {
      if (m[1].startsWith('/')) routes.push(m[1]);
    }
  }

  return dedupe(routes).slice(0, 20);
}

function readPackageMetadata(rootDir) {
  const packagePath = path.join(rootDir, 'package.json');
  if (!fs.existsSync(packagePath)) {
    return { packageScripts: {}, verificationCommands: [] };
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  } catch (_) {
    return { packageScripts: {}, verificationCommands: [] };
  }

  const scripts = parsed.scripts || {};
  const packageScripts = {};
  const verificationCommands = [];

  for (const [name, command] of Object.entries(scripts)) {
    packageScripts[name] = command;
    if (VERIFICATION_SCRIPT_PATTERN.test(name) || VERIFICATION_SCRIPT_PATTERN.test(command)) {
      verificationCommands.push(`npm run ${name}`);
    }
  }

  return { packageScripts, verificationCommands };
}

function generateMapIndex(rootDir) {
  const resolvedRoot = path.resolve(rootDir || process.cwd());
  const fileEntries = walkFiles(resolvedRoot);
  const files = {};
  const routes = [];
  const sourceHashes = {};

  for (const entry of fileEntries) {
    let content;
    try {
      content = fs.readFileSync(entry.fullPath, 'utf8');
    } catch (_) {
      continue;
    }

    const lineCount = content.split(/\r?\n/).length;
    const extracted = extractFile(content, entry.lang);
    const hash = hashContent(content);
    const role = inferRole(entry.relPath);
    const fileRoutes = role === 'test' ? [] : extractRoutesFromFile(entry.relPath, content);

    sourceHashes[entry.relPath] = hash;
    for (const route of fileRoutes) {
      routes.push({ path: route, file: entry.relPath });
    }

    files[entry.relPath] = {
      lang: entry.lang,
      lines: lineCount,
      role,
      exports: extracted.exports,
      imports: extracted.imports,
      symbols: extracted.symbols,
      routes: fileRoutes,
      hash,
    };
  }

  const graph = buildGraph(files, resolvedRoot);
  const { packageScripts, verificationCommands } = readPackageMetadata(resolvedRoot);
  const graphEdgeCount = Object.values(graph).reduce((sum, deps) => sum + deps.length, 0);
  const sourceSignature = hashContent(JSON.stringify(sourceHashes));

  return {
    version: 2,
    generated: new Date().toISOString(),
    generatedAt: new Date().toISOString(),
    root: normalizePath(resolvedRoot),
    fileCount: Object.keys(files).length,
    graphEdgeCount,
    sourceSignature,
    sourceHashes,
    files,
    graph,
    routes: routes.sort((a, b) => a.path.localeCompare(b.path) || a.file.localeCompare(b.file)),
    packageScripts,
    verificationCommands,
  };
}

function writeMapIndex(index, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(index, null, 2), 'utf8');
}

function loadMapIndex(outputPath) {
  return JSON.parse(fs.readFileSync(outputPath, 'utf8'));
}

function isMapIndexFresh(outputPath, maxAgeMs = DEFAULT_CACHE_MAX_AGE_MS) {
  if (!fs.existsSync(outputPath)) return false;
  const stat = fs.statSync(outputPath);
  return Date.now() - stat.mtimeMs < maxAgeMs;
}

function detectMapStaleness(rootDir, index) {
  const resolvedRoot = path.resolve(rootDir || index.root || process.cwd());
  const currentEntries = walkFiles(resolvedRoot);
  const currentPaths = new Set(currentEntries.map((entry) => entry.relPath));
  const indexedHashes = index.sourceHashes || Object.fromEntries(
    Object.entries(index.files || {}).map(([relPath, info]) => [relPath, info.hash]).filter(([, hash]) => hash)
  );
  const indexedPaths = new Set(Object.keys(indexedHashes));
  const added = [];
  const removed = [];
  const changed = [];

  for (const entry of currentEntries) {
    if (!indexedPaths.has(entry.relPath)) {
      added.push(entry.relPath);
      continue;
    }

    let content;
    try {
      content = fs.readFileSync(entry.fullPath, 'utf8');
    } catch (_) {
      continue;
    }

    const currentHash = hashContent(content);
    if (indexedHashes[entry.relPath] !== currentHash) changed.push(entry.relPath);
  }

  for (const relPath of indexedPaths) {
    if (!currentPaths.has(relPath)) removed.push(relPath);
  }

  return {
    stale: added.length > 0 || removed.length > 0 || changed.length > 0,
    added,
    removed,
    changed,
  };
}

function queryMapIndex(index, queryStr, maxFiles = 20) {
  const terms = String(queryStr || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const scored = [];

  for (const [relPath, info] of Object.entries(index.files || {})) {
    let score = 0;
    const lowerPath = relPath.toLowerCase();
    const exports = info.exports || [];
    const symbols = info.symbols || [];
    const routes = info.routes || [];

    for (const term of terms) {
      if (lowerPath.includes(term)) score += 3;
      if (exports.some((exp) => exp.toLowerCase().includes(term))) score += 5;
      if (symbols.some((sym) => sym.toLowerCase().includes(term))) score += 2;
      if (String(info.role || '').toLowerCase().includes(term)) score += 1;
      if (routes.some((route) => route.toLowerCase().includes(term))) score += 4;
    }

    if (score > 0 && info.role === 'test' && !terms.includes('test') && !terms.includes('spec')) {
      score = Math.max(1, score - 10);
    }

    if (score > 0) {
      scored.push({
        relPath,
        score,
        role: info.role,
        exports,
        routes,
        lines: info.lines,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.relPath.localeCompare(b.relPath));

  const results = [];
  let outputLength = 0;
  for (const item of scored.slice(0, maxFiles)) {
    const line = `${item.score} ${item.role} ${item.relPath} ${item.exports.slice(0, 5).join(',')} ${item.lines}`;
    if (outputLength + line.length > 8000) break;
    outputLength += line.length;
    results.push(item);
  }

  return results;
}

function createMapSlice(index, queryStr, options = {}) {
  const maxFiles = options.maxFiles || 15;
  const results = queryMapIndex(index, queryStr, maxFiles);
  const lines = [`=== MAP SLICE: ${queryStr} ===`];

  if (detectLikelyStale(index)) {
    lines.push(`Generated: ${index.generatedAt || index.generated || 'unknown'} (staleness requires --stale check)`);
  } else {
    lines.push(`Generated: ${index.generatedAt || index.generated || 'unknown'}`);
  }

  if (index.verificationCommands && index.verificationCommands.length > 0) {
    lines.push(`Verification: ${index.verificationCommands.slice(0, 8).join(' | ')}`);
  }

  for (const result of results) {
    const exportsStr = result.exports.length > 0 ? ` [${result.exports.slice(0, 5).join(', ')}]` : '';
    const routesStr = result.routes.length > 0 ? ` routes=${result.routes.slice(0, 3).join(',')}` : '';
    lines.push(`${String(result.score).padStart(3)} ${String(result.role || '').padEnd(10)} ${result.relPath}${exportsStr}${routesStr} (${result.lines}L)`);
  }

  if (results.length === 0) lines.push('No matching files.');
  lines.push('=== END MAP SLICE ===');
  return lines.join('\n');
}

function detectLikelyStale(index) {
  return !index.sourceSignature || !index.sourceHashes;
}

function mapStats(index) {
  const langCounts = {};
  const roleCounts = {};
  let totalLines = 0;
  let totalExports = 0;

  for (const info of Object.values(index.files || {})) {
    langCounts[info.lang] = (langCounts[info.lang] || 0) + 1;
    roleCounts[info.role] = (roleCounts[info.role] || 0) + 1;
    totalLines += info.lines || 0;
    totalExports += (info.exports || []).length;
  }

  return {
    files: index.fileCount || Object.keys(index.files || {}).length,
    lines: totalLines,
    exports: totalExports,
    edges: index.graphEdgeCount || Object.values(index.graph || {}).reduce((sum, deps) => sum + deps.length, 0),
    routes: (index.routes || []).length,
    packageScripts: Object.keys(index.packageScripts || {}).length,
    verificationCommands: (index.verificationCommands || []).length,
    byLanguage: langCounts,
    byRole: roleCounts,
  };
}

module.exports = {
  DEFAULT_CACHE_MAX_AGE_MS,
  defaultOutputPath,
  detectMapStaleness,
  generateMapIndex,
  isMapIndexFresh,
  loadMapIndex,
  mapStats,
  queryMapIndex,
  createMapSlice,
  writeMapIndex,
  _internals: {
    extractRoutesFromFile,
    hashContent,
    inferRole,
    readPackageMetadata,
    walkFiles,
  },
};

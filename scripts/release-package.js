#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_NAME = '.citadel-release.json';
const RELEASE_FILES_NAME = 'release-files.json';
const GIT_MAX_BUFFER = 256 * 1024 * 1024;
const MATRIX = { operatingSystems: ['linux', 'macos', 'windows'], node: ['22', '24'], runtimes: ['claude', 'codex'] };

function compareNames(left, right) {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function arg(name, fallback = null) {
  const inline = process.argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function runGit(args, cwd, encoding = 'utf8') {
  return execFileSync('git', args, {
    cwd,
    encoding,
    maxBuffer: GIT_MAX_BUFFER,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function gitValue(args, cwd, fallback) {
  try {
    return String(runGit(args, cwd)).trim() || fallback;
  } catch {
    return fallback;
  }
}

function isExcluded(relativePath, tracked) {
  const normalized = relativePath.replace(/\\/g, '/');
  if (normalized === MANIFEST_NAME) return true;
  if (/^(?:\.git|node_modules|dist)(?:\/|$)/.test(normalized)) return true;
  if (normalized.startsWith('.planning/')) {
    const distributablePlanning = normalized.startsWith('.planning/_templates/')
      || normalized.startsWith('.planning/rubrics/')
      || normalized === '.planning/intake/_TEMPLATE.md';
    if (!distributablePlanning || !tracked) return true;
  }
  return false;
}

function worktreeEntries(sourceDir) {
  let tracked = new Set();
  let names;
  try {
    tracked = new Set(String(runGit(['ls-files', '-c', '-z'], sourceDir)).split('\0').filter(Boolean));
    names = [...tracked];
    const policyPath = path.join(sourceDir, RELEASE_FILES_NAME);
    if (fs.existsSync(policyPath)) {
      const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8').replace(/^\uFEFF/, ''));
      for (const relative of [RELEASE_FILES_NAME, ...(Array.isArray(policy.includeFiles) ? policy.includeFiles : [])]) {
        if (!tracked.has(relative) && fs.existsSync(path.join(sourceDir, ...relative.split('/')))) names.push(relative);
      }
    }
  } catch {
    names = [];
    const walk = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        const relative = path.relative(sourceDir, absolute).replace(/\\/g, '/');
        if (isExcluded(relative, false)) continue;
        if (entry.isDirectory()) walk(absolute);
        else if (entry.isFile()) names.push(relative);
      }
    };
    walk(sourceDir);
  }
  return [...new Set(names)].filter((name) => {
    const absolute = path.join(sourceDir, ...name.split('/'));
    return fs.existsSync(absolute) && !isExcluded(name, tracked.has(name));
  }).sort().map((name) => {
    const absolute = path.join(sourceDir, ...name.split('/'));
    const stat = fs.statSync(absolute);
    return { name, data: fs.readFileSync(absolute), mode: stat.mode & 0o111 ? 0o755 : 0o644 };
  });
}

function refEntries(sourceDir, ref) {
  const records = String(runGit(['ls-tree', '-r', '-z', ref], sourceDir)).split('\0').filter(Boolean);
  return records.map((record) => {
    const match = /^(\d+)\s+\w+\s+[0-9a-f]+\t(.+)$/.exec(record);
    if (!match) throw new Error(`Cannot parse git tree record: ${record}`);
    const name = match[2].replace(/\\/g, '/');
    const data = runGit(['show', `${ref}:${name}`], sourceDir, null);
    return { name, data, mode: match[1] === '100755' ? 0o755 : 0o644 };
  }).filter((entry) => !isExcluded(entry.name, true)).sort(compareNames);
}

function jsonFromEntries(entries, name) {
  const entry = entries.find((candidate) => candidate.name === name);
  if (!entry) throw new Error(`Release source is missing ${name}`);
  return JSON.parse(entry.data.toString('utf8').replace(/^\uFEFF/, ''));
}

function releasePolicy(entries) {
  const policy = jsonFromEntries(entries, RELEASE_FILES_NAME);
  const fields = [
    'includeFiles', 'includeDirectories', 'excludeFiles',
    'excludeDirectories', 'excludePrefixes', 'excludeSegments',
  ];
  if (policy.schema !== 1) throw new Error(`Unsupported ${RELEASE_FILES_NAME} schema: ${policy.schema}`);
  for (const field of fields) {
    if (!Array.isArray(policy[field]) || policy[field].some((value) => typeof value !== 'string' || !value)) {
      throw new Error(`${RELEASE_FILES_NAME} field ${field} must be an array of non-empty strings`);
    }
    if (new Set(policy[field]).size !== policy[field].length) {
      throw new Error(`${RELEASE_FILES_NAME} field ${field} contains duplicates`);
    }
  }
  for (const file of [...policy.includeFiles, ...policy.excludeFiles]) {
    if (file.endsWith('/')) throw new Error(`${RELEASE_FILES_NAME} file rule must not end with /: ${file}`);
  }
  for (const directory of [...policy.includeDirectories, ...policy.excludeDirectories]) {
    if (!directory.endsWith('/')) throw new Error(`${RELEASE_FILES_NAME} directory rule must end with /: ${directory}`);
  }
  for (const rule of fields.flatMap((field) => policy[field])) {
    const normalized = rule.replace(/\\/g, '/');
    if (normalized !== rule || normalized.startsWith('/') || normalized.split('/').includes('..')) {
      throw new Error(`Unsafe ${RELEASE_FILES_NAME} rule: ${rule}`);
    }
  }
  return policy;
}

function applyReleasePolicy(entries) {
  const policy = releasePolicy(entries);
  const available = new Set(entries.map((entry) => entry.name));
  for (const file of policy.includeFiles) {
    if (!available.has(file)) throw new Error(`${RELEASE_FILES_NAME} includes missing file: ${file}`);
  }
  for (const directory of policy.includeDirectories) {
    if (![...available].some((name) => name.startsWith(directory))) {
      throw new Error(`${RELEASE_FILES_NAME} includes empty directory: ${directory}`);
    }
  }
  return entries.filter((entry) => {
    const name = entry.name;
    const included = policy.includeFiles.includes(name)
      || policy.includeDirectories.some((directory) => name.startsWith(directory));
    if (!included) return false;
    if (policy.excludeFiles.includes(name)) return false;
    if (policy.excludeDirectories.some((directory) => name.startsWith(directory))) return false;
    if (policy.excludePrefixes.some((prefix) => name.startsWith(prefix))) return false;
    if (policy.excludeSegments.some((segment) => name.split('/').includes(segment))) return false;
    return true;
  }).sort(compareNames);
}

const RELEASE_TEXT_EXTENSIONS = new Set([
  '.cjs', '.css', '.html', '.js', '.json', '.jsx', '.md', '.mjs', '.ps1',
  '.sh', '.svg', '.toml', '.ts', '.tsx', '.txt', '.yaml', '.yml',
]);

function normalizeReleaseTextEntries(entries) {
  return entries.map((entry) => {
    const extension = path.posix.extname(entry.name).toLowerCase();
    if (!RELEASE_TEXT_EXTENSIONS.has(extension) && entry.name !== 'LICENSE') return entry;
    const source = entry.data.toString('utf8');
    if (!Buffer.from(source, 'utf8').equals(entry.data)) {
      throw new Error(`Release text entry is not valid UTF-8: ${entry.name}`);
    }
    const data = Buffer.from(source.replace(/\r\n?/g, '\n'));
    return data.equals(entry.data) ? entry : { ...entry, data };
  });
}

function sanitizeReleasePackage(entries) {
  const pkg = jsonFromEntries(entries, 'package.json');
  const releasePackage = {
    name: pkg.name,
    version: pkg.version,
    private: true,
    description: 'Verified Citadel GitHub release artifact and lifecycle CLI',
    license: pkg.license,
    bin: pkg.bin,
    scripts: {
      'citadel:install': 'node scripts/install.js',
      'claude:install': 'node scripts/claude-install.js',
      'codex:install': 'node scripts/codex-install.js',
      'release:verify': 'node scripts/release-verify.js',
      update: 'node scripts/update.js',
    },
    repository: pkg.repository,
    engines: pkg.engines,
    citadelRelease: {
      channel: 'github-release-trio',
      lifecycleCommands: ['install', 'doctor', 'update', 'rollback', 'uninstall'],
    },
  };
  const data = Buffer.from(`${JSON.stringify(releasePackage, null, 2)}\n`);
  return entries.map((entry) => (entry.name === 'package.json' ? { ...entry, data } : entry));
}

function sanitizeReleaseCli(entries) {
  const cliName = 'core/cli/package-cli.js';
  const cliEntry = entries.find((entry) => entry.name === cliName);
  if (!cliEntry) return entries;
  let source = cliEntry.data.toString('utf8');
  const releaseHelp = [
    'const HELP = `Citadel ${VERSION}',
    '',
    'Usage: citadel <command> [options]',
    '',
    'Commands:',
    '  install      Install the Citadel runtime package for Claude Code or Codex',
    '  doctor       Check package integrity and runtime availability',
    '  update       Plan/apply a receipt-owned update',
    '  rollback     Plan/apply a receipt-owned rollback',
    '  uninstall    Plan/apply receipt-owned removal',
    '  help         Show this help',
    '',
    'Run citadel <command> --help for command-specific help.',
    '`;',
  ].join('\n');
  const releaseCommandHelp = [
    'const COMMAND_HELP = Object.freeze({',
    '  install: `Usage: citadel install [--runtime claude|codex] [--project-root PATH] [--dry-run] [--json]',
    '',
    'Runtime is selected from --runtime, CITADEL_RUNTIME, project markers, or an',
    'installed Claude Code or Codex command. Ambiguous detection fails closed.',
    '`,',
    "  doctor: 'Usage: citadel doctor [--project-root PATH] [--runtime claude|codex] [--json]\\n',",
    "  update: 'Usage: citadel update <plan SOURCE --migration FILE | apply PLAN> [options]\\n',",
    "  rollback: 'Usage: citadel rollback <plan | apply PLAN> [options]\\n',",
    "  uninstall: 'Usage: citadel uninstall [PROJECT] [--project-root PATH] [--dry-run] [--json]\\n       citadel uninstall --apply --plan PLAN [--confirm TOKEN] [--json]\\n',",
    '});',
  ].join('\n');
  const withHelp = source.replace(/const HELP = `Citadel \$\{VERSION\}[\s\S]*?`;\r?\n/, `${releaseHelp}\n`);
  if (withHelp === source) throw new Error('Release CLI projection could not replace root help');
  source = withHelp;
  const withCommandHelp = source.replace(/const COMMAND_HELP = Object\.freeze\(\{[\s\S]*?^\}\);/m, releaseCommandHelp);
  if (withCommandHelp === source) throw new Error('Release CLI projection could not replace command help');
  source = withCommandHelp;
  const withoutControlPlane = source.replace(/\r?\nfunction controlPlane\([\s\S]*?(?=\r?\nfunction main\()/, '\n');
  if (withoutControlPlane === source) throw new Error('Release CLI projection could not remove advanced helpers');
  source = withoutControlPlane;
  const advanced = new Set([
    'pack', 'journey', 'receipt', 'fork', 'adopt', 'config', 'governance',
    'control-plane', 'trial', 'memory', 'operation',
  ]);
  let removed = 0;
  source = source.split(/\r?\n/).filter((line) => {
    const match = /^\s*if \(command === '([^']+)'\)/.exec(line);
    if (!match || !advanced.has(match[1])) return true;
    removed += 1;
    return false;
  }).join('\n');
  if (removed !== advanced.size) {
    throw new Error(`Release CLI projection removed ${removed} of ${advanced.size} advanced dispatches`);
  }
  const data = Buffer.from(source);
  return entries.map((entry) => (entry.name === cliName ? { ...entry, data } : entry));
}

function sanitizeReleaseMcp(entries) {
  if (!entries.some((entry) => entry.name === '.mcp.json')) return entries;
  const codexFallback = jsonFromEntries(entries, '.mcp.json');
  if (Object.keys(codexFallback.mcpServers || {}).length !== 0) {
    throw new Error('Release plugin-root .mcp.json must stay empty for Codex auto-discovery');
  }
  const claudeManifest = jsonFromEntries(entries, '.claude-plugin/plugin.json');
  const claudeMcpPath = String(claudeManifest.mcpServers || '').replace(/^\.\//, '');
  if (!claudeMcpPath.startsWith('.claude-plugin/')) {
    throw new Error('Release Claude manifest must own its MCP configuration');
  }
  const config = jsonFromEntries(entries, claudeMcpPath);
  const state = config.mcpServers?.['citadel-state'];
  const memory = config.mcpServers?.['codebase-memory'];
  if (!state) throw new Error('Release MCP config requires citadel-state');
  if (!memory) throw new Error('Release MCP config requires codebase-memory');
  return entries;
}

function sanitizeReleaseBundleCatalog(entries) {
  const catalogName = 'core/config/bundle-catalog.js';
  const catalogEntry = entries.find((entry) => entry.name === catalogName);
  if (!catalogEntry) return entries;
  const resolveName = 'core/config/resolve.js';
  const migrateName = 'core/config/migrate.js';
  const contractEntry = entries.find((entry) => entry.name === 'core/config/contract.js');
  const resolveEntry = entries.find((entry) => entry.name === resolveName);
  const migrateEntry = entries.find((entry) => entry.name === migrateName);
  if (!contractEntry || !resolveEntry || !migrateEntry) {
    throw new Error('Release bundle projection requires contract, resolve, and migration owners');
  }
  const shippedSkills = new Set(entries
    .map((entry) => /^skills\/([^/]+)\/SKILL\.md$/.exec(entry.name)?.[1])
    .filter(Boolean));
  const contractSource = contractEntry.data.toString('utf8');
  const bundleIdsMatch = /const BUNDLE_IDS = Object\.freeze\(\[([\s\S]*?)\]\);/.exec(contractSource);
  if (!bundleIdsMatch) throw new Error('Release bundle projection could not read BUNDLE_IDS');
  const bundleIds = [...bundleIdsMatch[1].matchAll(/'([a-z][a-z0-9-]*)'/g)].map((match) => match[1]);
  if (!bundleIds.length) throw new Error('Release bundle projection found no bundle IDs');
  const projectedSkillsByBundle = new Map();
  let blockCount = 0;
  let catalogSource = catalogEntry.data.toString('utf8').replace(
    /^(\s*)skills:\s*\[([\s\S]*?)\],\r?\n(\s*)hooks:/gm,
    (_match, skillIndent, body, hookIndent) => {
      const bundleId = bundleIds[blockCount];
      if (!bundleId) throw new Error(`Release bundle projection found an unexpected skill block at ${blockCount + 1}`);
      blockCount += 1;
      const declared = [...body.matchAll(/'([a-z][a-z0-9-]*)'/g)].map((match) => match[1]);
      const projected = declared.filter((skill) => shippedSkills.has(skill));
      projectedSkillsByBundle.set(bundleId, projected);
      return `${skillIndent}skills: [${projected.map((skill) => `'${skill}'`).join(', ')}],\n${hookIndent}hooks:`;
    },
  );
  if (blockCount !== bundleIds.length) {
    throw new Error(`Release bundle projection expected ${bundleIds.length} skill ownership blocks, found ${blockCount}`);
  }
  const hookBlocks = [...catalogSource.matchAll(/^\s*hooks:\s*\[([\s\S]*?)\],\r?\n\s*state:/gm)];
  if (hookBlocks.length !== bundleIds.length) {
    throw new Error(`Release bundle projection expected ${bundleIds.length} hook ownership blocks, found ${hookBlocks.length}`);
  }
  const hookCountByBundle = new Map(bundleIds.map((id, index) => [
    id,
    [...hookBlocks[index][1].matchAll(/'([a-z][a-z0-9-]*)'/g)].length,
  ]));
  const availableBundleIds = bundleIds.filter((id) => (
    projectedSkillsByBundle.get(id)?.length > 0 || hookCountByBundle.get(id) > 0
  ));
  const unavailableBundleIds = bundleIds.filter((id) => !availableBundleIds.includes(id));
  if (!availableBundleIds.includes('core')) throw new Error('Release bundle projection cannot omit core');

  const replaceOnce = (source, pattern, replacement, owner, label) => {
    const matches = source.match(new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`)) || [];
    if (matches.length !== 1) {
      throw new Error(`${owner}: release bundle projection expected one ${label}, found ${matches.length}`);
    }
    return source.replace(pattern, replacement);
  };
  for (const bundleId of unavailableBundleIds) {
    const escaped = bundleId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    catalogSource = replaceOnce(
      catalogSource,
      new RegExp(`(^  ${escaped}: \\{\\r?\\n    id: '${escaped}',\\r?\\n)`, 'm'),
      `$1    available: false,\n    unavailableReasonCode: 'BUNDLE_EXECUTABLES_NOT_SHIPPED',\n`,
      catalogName,
      `${bundleId} availability marker`,
    );
    catalogSource = replaceOnce(
      catalogSource,
      new RegExp(`(^  ${escaped}: \\{[\\s\\S]*?^    stage: )'stable'`, 'm'),
      "$1'source-only'",
      catalogName,
      `${bundleId} source-only stage`,
    );
  }
  catalogSource = replaceOnce(
    catalogSource,
    /(^  for \(const id of closed\) \{\r?\n    const bundle = BUNDLE_CATALOG\[id\];\r?\n)/m,
    [
      '$1',
      '    if (bundle.available === false) {',
      "      statuses.set(id, 'unavailable');",
      "      unavailable.push(unavailableEntry(id, bundle.unavailableReasonCode || 'BUNDLE_UNAVAILABLE'));",
      '      continue;',
      '    }',
      '',
    ].join('\n'),
    catalogName,
    'unavailable-bundle negotiation gate',
  );
  catalogSource = replaceOnce(
    catalogSource,
    /(function assertBundleId\(id\) \{\r?\n  if \(!BUNDLE_IDS\.includes\(id\)\) throw new TypeError\(`Unknown product bundle: \$\{String\(id\)\}`\);\r?\n  return id;\r?\n\})/m,
    [
      '$1',
      '',
      'function assertActivatableBundleId(id) {',
      '  assertBundleId(id);',
      '  const bundle = BUNDLE_CATALOG[id];',
      '  if (bundle.available === false) {',
      '    throw new TypeError(`Product bundle ${id} is unavailable in this release: ${bundle.unavailableReasonCode}`);',
      '  }',
      '  return id;',
      '}',
    ].join('\n'),
    catalogName,
    'activatable-bundle guard',
  );
  catalogSource = replaceOnce(
    catalogSource,
    /(  assertBundleId,\r?\n)/,
    '  assertActivatableBundleId,\n$1',
    catalogName,
    'activatable-bundle export',
  );

  let resolveSource = resolveEntry.data.toString('utf8');
  let legacyBundleListMatches = 0;
  resolveSource = resolveSource.replace(/requested:\s*\[((?:\s*'[^']+'\s*,?)+)\],/g, (match, body) => {
    const ids = [...body.matchAll(/'([^']+)'/g)].map((item) => item[1]);
    if (JSON.stringify(ids) !== JSON.stringify(bundleIds)) return match;
    legacyBundleListMatches += 1;
    return `requested: [${availableBundleIds.map((id) => `'${id}'`).join(', ')}],`;
  });
  if (legacyBundleListMatches !== 1) {
    throw new Error(`${resolveName}: release bundle projection expected one legacy bundle list, found ${legacyBundleListMatches}`);
  }

  let migrateSource = migrateEntry.data.toString('utf8');
  migrateSource = replaceOnce(
    migrateSource,
    /const \{ dependencyClosure, dependentsOf, assertBundleId \} = require\('\.\/bundle-catalog'\);/,
    "const { dependencyClosure, dependentsOf, assertBundleId, assertActivatableBundleId } = require('./bundle-catalog');",
    migrateName,
    'activatable-bundle import',
  );
  migrateSource = replaceOnce(
    migrateSource,
    /(function withBundleEnabled\(raw, bundleId\) \{\r?\n)  assertBundleId\(bundleId\);/,
    '$1  assertActivatableBundleId(bundleId);',
    migrateName,
    'enable-bundle guard',
  );

  const replacements = new Map([
    [catalogName, Buffer.from(catalogSource)],
    [resolveName, Buffer.from(resolveSource)],
    [migrateName, Buffer.from(migrateSource)],
  ]);
  return entries.map((entry) => (replacements.has(entry.name)
    ? { ...entry, data: replacements.get(entry.name) }
    : entry));
}

function sanitizeReleaseRouting(entries) {
  const tableName = 'core/skills/routing-table.json';
  const doName = 'skills/do/SKILL.md';
  const hasTable = entries.some((entry) => entry.name === tableName);
  const hasDo = entries.some((entry) => entry.name === doName);
  if (!hasTable && !hasDo) return entries;
  if (!hasTable || !hasDo) throw new Error('Release routing requires both routing-table.json and skills/do/SKILL.md');
  const shippedSkills = new Set(entries.map((entry) => {
    const match = /^skills\/([^/]+)\/SKILL\.md$/.exec(entry.name);
    return match?.[1] || null;
  }).filter(Boolean));
  const table = jsonFromEntries(entries, tableName);
  table.skills = (table.skills || []).filter((skill) => shippedSkills.has(skill.name));
  const doEntry = entries.find((entry) => entry.name === doName);
  if (!doEntry) throw new Error(`Release source is missing ${doName}`);
  const lines = doEntry.data.toString('utf8').split(/\r?\n/);
  let inRoutingTable = false;
  const filtered = lines.filter((line) => {
    if (line === '<!-- BEGIN GENERATED: routing-table -->') inRoutingTable = true;
    if (line === '<!-- END GENERATED: routing-table -->') inRoutingTable = false;
    if (!inRoutingTable) return true;
    const match = /\| `\/([a-z0-9-]+)/.exec(line);
    return !match || shippedSkills.has(match[1]);
  });
  const sanitized = [];
  for (let index = 0; index < filtered.length; index += 1) {
    const line = filtered[index];
    if (line.startsWith('4. **Improve campaigns')) {
      sanitized.push(
        '4. **Campaign types without an installed orchestrator:** run',
        '   `node scripts/continue-action.js --run`; if it cannot resume the type, report',
        '   it under Needs You instead of inventing a route.',
      );
      while (index + 1 < filtered.length && !filtered[index + 1].startsWith('5. ')) index += 1;
      continue;
    }
    if (line.includes('**If `.planning/daemon.json` exists')) {
      sanitized.push('    - Do not mutate state owned by an orchestrator that is not installed; report it under Needs You.');
      while (index + 1 < filtered.length && !filtered[index + 1].includes('Output: "[daemon]')) index += 1;
      if (index + 1 < filtered.length) index += 1;
      continue;
    }
    sanitized.push(line);
  }
  const tableData = Buffer.from(`${JSON.stringify(table, null, 2)}\n`);
  const doData = Buffer.from(sanitized.join('\n'));
  return entries.map((entry) => {
    if (entry.name === tableName) return { ...entry, data: tableData };
    if (entry.name === doName) return { ...entry, data: doData };
    return entry;
  });
}

function sanitizeReleaseMetadata(entries) {
  const metadataName = 'citadel-metadata.json';
  if (!entries.some((entry) => entry.name === metadataName)) return entries;
  const available = new Set(entries.map((entry) => entry.name));
  const shippedSkills = entries.filter((entry) => /^skills\/[^/]+\/SKILL\.md$/.test(entry.name));
  const metadata = jsonFromEntries(entries, metadataName);
  metadata.skills = {
    ...(metadata.skills || {}),
    path: 'skills/',
    count: shippedSkills.length,
  };
  metadata.proof_links = (metadata.proof_links || []).filter((link) => {
    const target = String(link).split('#')[0];
    return target && available.has(target);
  });
  metadata.interoperability = { remote_registry_verification: 'not-claimed' };
  const data = Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`);
  return entries.map((entry) => (entry.name === metadataName ? { ...entry, data } : entry));
}

function sanitizeReleaseSkillCounts(entries) {
  const shippedSkillCount = entries.filter((entry) => /^skills\/[^/]+\/SKILL\.md$/.test(entry.name)).length;
  const textEntry = /\.(?:html|json|md|svg|txt)$/i;
  const marker = /(<!-- GENERATED: skill-count -->)\d+(<!-- \/GENERATED -->)/g;
  return entries.map((entry) => {
    if (!textEntry.test(entry.name)) return entry;
    const source = entry.data.toString('utf8');
    const sanitized = source.replace(marker, (_match, open, close) => `${open}${shippedSkillCount}${close}`);
    return sanitized === source ? entry : { ...entry, data: Buffer.from(sanitized) };
  });
}

const RELEASE_INSTRUCTION_RULES = new Map([
  ['INSTALL.md', [
    {
      id: 'omit-source-only-improvement-example',
      whenOmitted: ['improve'],
      from: '/improve citadel --n=5              # Autonomous quality loops',
      to: '',
    },
    {
      id: 'project-source-only-delivery-bundle',
      whenOmitted: ['deploy-steward', 'pr-watch', 'triage'],
      from: [
        '- **Full Tour**: everything in Recommended, then offers separate plan/apply',
        '  decisions for Parallel and Operations. Delivery remains off unless explicitly',
        '  selected and supported.',
      ].join('\n'),
      to: [
        '- **Full Tour**: everything in Recommended, then offers separate plan/apply',
        '  decisions for Parallel and Operations. Delivery workflows require the full',
        '  source distribution.',
      ].join('\n'),
      preserves: [/Full Tour/, /Parallel and Operations/, /Delivery workflows require the full/, /source distribution/],
    },
  ]],
  ['skills/cost/SKILL.md', [
    {
      id: 'project-runtime-pricing-owner',
      whenOmitted: [],
      from: 'scripts/pricing.json',
      to: 'runtimes/claude-code/adapters/pricing.json',
      expected: 2,
      preserves: [/runtimes\/claude-code\/adapters\/pricing\.json/],
    },
  ]],
  ['docs/CAMPAIGNS.md', [
    {
      id: 'fix-campaign-archive-path',
      whenOmitted: [],
      from: '6. **Archive**: Campaign moves to `campaigns/completed/`',
      to: '6. **Archive**: Campaign moves to `.planning/campaigns/completed/`',
      preserves: [/\.planning\/campaigns\/completed/],
    },
    {
      id: 'omit-source-only-campaign-example',
      whenOmitted: [],
      from: '- `examples/campaign-example.md` — A complete, realistic campaign',
      to: '',
    },
    {
      id: 'omit-source-only-report-artifact-guide-link',
      whenOmitted: [],
      from: "- [REPORT_ARTIFACTS.md](REPORT_ARTIFACTS.md) — Guide to Citadel's research,",
      to: '',
    },
    {
      id: 'omit-source-only-report-artifact-guide-continuation',
      whenOmitted: [],
      from: '  verification, review, approval, readiness, and handoff reports',
      to: '',
    },
    {
      id: 'replace-package-operator-summary-alias',
      whenOmitted: [],
      from: 'npm run operator:summary',
      to: 'node scripts/operator-console.js --summary',
    },
    {
      id: 'replace-package-stack-plan-json-alias',
      whenOmitted: [],
      from: 'npm run stack:plan:json',
      to: 'node scripts/stack-plan.js --json',
    },
    {
      id: 'replace-package-stack-plan-alias',
      whenOmitted: [],
      from: 'npm run stack:plan',
      to: 'node scripts/stack-plan.js',
    },
  ]],
  ['docs/FLEET.md', [
    {
      id: 'project-source-only-wiki-compilation',
      whenOmitted: [],
      from: '| `.planning/wiki/_staging/*.jsonl` | append-only | Each agent writes a uniquely-named staging file. Compile step resolves all of them in order. No concurrent write conflicts possible. |',
      to: '| `.planning/wiki/_staging/*.jsonl` | append-only | Each agent writes a uniquely-named staging file. Preserve staged findings for review; compilation requires a full source checkout. |',
      preserves: [/Preserve staged findings/, /full source checkout/],
    },
    {
      id: 'fix-fleet-vote-telemetry-path',
      whenOmitted: [],
      from: '4. Log the vote and outcome to `telemetry/agent-runs.jsonl`',
      to: '4. Log the vote and outcome to `.planning/telemetry/agent-runs.jsonl`',
      preserves: [/\.planning\/telemetry\/agent-runs\.jsonl/],
    },
    {
      id: 'omit-source-only-handoff-parser',
      whenOmitted: [],
      from: '| `.citadel/scripts/parse-handoff.cjs` | Extract HANDOFF blocks from agent output |',
      to: '',
    },
    {
      id: 'omit-source-only-telemetry-report',
      whenOmitted: [],
      from: '| `.citadel/scripts/telemetry-report.cjs` | Generate performance summaries |',
      to: '',
    },
    {
      id: 'project-worktree-readiness-owner',
      whenOmitted: [],
      from: '| `scripts/worktree-readiness.js` | Record dependency, env, port, and health readiness for worktrees |',
      to: '| `hooks_src/worktree-setup.js` | Record dependency, env, port, and health readiness during worktree setup |',
      preserves: [/hooks_src\/worktree-setup\.js/, /readiness during worktree setup/],
    },
    {
      id: 'replace-package-coordination-sweep-alias',
      whenOmitted: [],
      from: 'npm run coord:sweep',
      to: 'node scripts/coordination.js sweep',
    },
  ]],
  ['docs/SETUP_REFERENCE.md', [
    {
      id: 'project-packaged-routing-surfaces',
      whenOmitted: [],
      from: '- The demo routing data in `docs/index.html`',
      to: '- Source checkouts also update demo routing data; the slim release omits that site-only surface.',
    },
    {
      id: 'project-packaged-routing-surface-count',
      whenOmitted: [],
      from: 'means all three surfaces are in sync.',
      to: 'means both packaged routing surfaces are in sync.',
      preserves: [/both packaged routing surfaces/],
    },
    {
      id: 'omit-source-only-learn-tour-item',
      whenOmitted: ['learn'],
      from: '/learn                 — extract reusable patterns from a completed campaign',
      to: '',
    },
    {
      id: 'omit-source-only-improve-reference-card-item',
      whenOmitted: ['improve'],
      from: '│  4. /improve [target]   autonomous quality loop          │',
      to: '',
    },
    {
      id: 'remove-omitted-skills-catalog-footer',
      whenOmitted: [],
      from: '│  docs/SKILLS.md · INSTALL.md · /do --list               │',
      to: '│  INSTALL.md · /do --list                                  │',
    },
  ]],
  ['skills/archon/SKILL.md', [
    {
      id: 'preserve-visual-verification-condition',
      whenOmitted: ['live-preview'],
      from: '   - `visual_verify`: invoke /live-preview on the specified route',
      to: '   - `visual_verify`: run the target project\'s declared visual verifier; if none is available, record `blocked/HUMAN_INPUT_REQUIRED`',
      preserves: [/visual_verify/, /blocked\/HUMAN_INPUT_REQUIRED/],
    },
    {
      id: 'preserve-rendered-view-spot-check',
      whenOmitted: ['live-preview'],
      from: '3. If view files (.tsx, .jsx, .vue, .svelte, .html) were modified: invoke /live-preview',
      to: '3. If view files (.tsx, .jsx, .vue, .svelte, .html) were modified: run the target project\'s declared visual verifier and attach evidence; if none is available, record `blocked/HUMAN_INPUT_REQUIRED`',
      preserves: [/view files/, /visual verifier/, /blocked\/HUMAN_INPUT_REQUIRED/],
    },
    {
      id: 'omit-unavailable-local-pr-watcher',
      whenOmitted: ['pr-watch'],
      from: '     Local  →  /pr-watch <N>          fixes failures in this terminal',
      to: '',
    },
    {
      id: 'preserve-continuation-trust-gate',
      whenOmitted: ['daemon'],
      from: 'Step 2.5 trust gating: **Novice** — skip Step 2.5 entirely, do not offer daemon. **Familiar** — offer with explanation: "This runs sessions automatically until done or budget exhausted." **Trusted** — offer with cost only: "Run continuously? (~${cost}) [y/n]"',
      to: 'Step 2.5 continuation gating: **Novice**: explain the resume boundary. **Familiar** and **Trusted**: persist state and stop at the explicit Needs You / Resume boundary.',
      preserves: [/Novice/, /Familiar/, /Trusted/, /Needs You \/ Resume/],
    },
  ]],
  ['skills/create-app/SKILL.md', [
    {
      id: 'preserve-prd-verification-contract',
      whenOmitted: ['live-preview'],
      from: 'Check each PRD end condition (run commands, check files, invoke /live-preview for visual checks). Report PASS / PARTIAL / FAIL with specifics.',
      to: 'Check each PRD end condition (run commands, check files, and inspect rendered output for visual checks). Report PASS / PARTIAL / FAIL with specifics.',
      preserves: [/each PRD end condition/i, /visual checks/i, /PASS \/ PARTIAL \/ FAIL/],
    },
  ]],
  ['skills/dashboard/SKILL.md', [
    {
      id: 'inline-routine-quota-warning',
      whenOmitted: [],
      from: '  account; see `docs/ROUTINE-QUOTA.md`)',
      to: '  account)',
    },
    {
      id: 'inline-rendered-routine-quota-warning',
      whenOmitted: [],
      from: '  WARNING: {N} of 15 routine runs used in the last 24h. Hitting the cap pauses every routine on the account. See docs/ROUTINE-QUOTA.md.',
      to: '  WARNING: {N} of 15 routine runs used in the last 24h. Hitting the account-wide cap pauses every routine.',
    },
    {
      id: 'remove-source-only-local-runner-names',
      whenOmitted: ['daemon'],
      from: '  (`local-watch.js`, `local-daemon.js`, `local-schedule.js`) never consume quota',
      to: '  provided by the active runtime do not consume routine quota',
    },
    {
      id: 'preserve-actionable-repair-policy',
      whenOmitted: ['telemetry'],
      from: '- The `/telemetry` repair action should appear only when actionable entries are',
      to: '- The `node scripts/dashboard.js --json` repair action should appear only when actionable entries are',
      preserves: [/repair action/, /only when actionable entries are/],
    },
    {
      id: 'omit-telemetry-quick-command',
      whenOmitted: ['telemetry'],
      from: '  /telemetry      — cost breakdown, hook activity, telemetry settings',
      to: '',
    },
    {
      id: 'omit-triage-quick-command',
      whenOmitted: ['triage'],
      from: '  /triage prs     — review open PRs',
      to: '',
    },
    {
      id: 'omit-pr-watch-quick-command',
      whenOmitted: ['pr-watch'],
      from: '  /pr-watch       — watch PR CI',
      to: '',
    },
    {
      id: 'omit-learn-quick-command',
      whenOmitted: ['learn'],
      from: '  /learn          — extract patterns from last completed campaign',
      to: '',
    },
    {
      id: 'preserve-doc-sync-backlog',
      whenOmitted: ['learn'],
      from: '**Doc-sync backlog:** Surface `/learn --doc-sync` as a repair action with `skills/learn/SKILL.md` as runbook.',
      to: '**Doc-sync backlog:** Surface `node hooks_src/doc-sync.js --project-root .` as the repair action with `hooks_src/doc-sync.js` as the runbook.',
      preserves: [/Doc-sync backlog/, /node hooks_src\/doc-sync\.js --project-root \./, /hooks_src\/doc-sync\.js/],
    },
    {
      id: 'preserve-safety-only-action-policy',
      whenOmitted: ['telemetry'],
      from: '**Only safety blocks recorded:** Show them in PROBLEMS and HOOKS VALUE, but do not surface `/telemetry` as NEXT ACTION.',
      to: '**Only safety blocks recorded:** Show them in PROBLEMS and HOOKS VALUE, but do not surface `node scripts/dashboard.js --json` as NEXT ACTION.',
    },
    {
      id: 'preserve-actionable-hook-problem-policy',
      whenOmitted: ['telemetry'],
      from: '**Actionable hook problem recorded:** Surface `/telemetry` as repair action with `skills/telemetry/SKILL.md` as runbook.',
      to: '**Actionable hook problem recorded:** Surface `node scripts/dashboard.js --json` as a review action and include the affected record paths.',
    },
  ]],
  ['skills/do/SKILL.md', [
    {
      id: 'omit-unavailable-daemon-downgrade',
      whenOmitted: ['daemon'],
      from: '| Routed to Daemon AND user is Novice trust level | Block. Output: "Daemon mode requires familiarity with the harness. Complete a few sessions first." |',
      to: '',
    },
    {
      id: 'replace-unattended-upgrade-suggestion',
      whenOmitted: ['daemon'],
      from: '| Input mentions "overnight" or "continuous" AND routed to Archon | Suggest daemon. "This sounds like continuous work. Want to run it as a daemon?" (skip if Novice) |',
      to: '| Input mentions "overnight" or "continuous" AND routed to Archon | Confirm a bounded multi-session campaign and an explicit Needs You / Resume boundary; do not imply unattended execution. |',
      preserves: [/overnight/, /continuous/, /Needs You \/ Resume/, /unattended/],
    },
  ]],
  ['skills/experiment/SKILL.md', [
    {
      id: 'preserve-manual-review-trust-gate',
      whenOmitted: ['improve'],
      from: '- Familiar (5+ sessions): iterates and commits autonomously; novices should use /improve with manual review between steps.',
      to: '- Familiar (5+ sessions): iterates and commits autonomously; novices must stop for manual review between every step and must not run unattended iterations.',
      preserves: [/Familiar \(5\+ sessions\)/, /iterates and commits autonomously/, /novices.*manual review/i],
    },
  ]],
  ['skills/houseclean/SKILL.md', [
    {
      id: 'preserve-monthly-check-guidance',
      whenOmitted: ['schedule'],
      from: '4. Suggest: "/houseclean runs well as a monthly check — use /schedule to add it"',
      to: '4. Suggest: "/houseclean works well as a monthly manual check; this release does not install scheduled runs."',
      preserves: [/monthly/, /manual check/],
    },
  ]],
  ['skills/merge-review/SKILL.md', [
    {
      id: 'preserve-merge-review-orientation',
      whenOmitted: ['pr-watch'],
      from: "**Don't use when:** reviewing general code quality (use /review); checking CI status before merging (use /pr-watch).",
      to: "**Don't use when:** reviewing general code quality (use /review) or merely checking CI status; this skill arbitrates completed fleet worktree merges.",
      preserves: [/general code quality/, /\/review/, /CI status/],
    },
  ]],
  ['skills/postmortem/SKILL.md', [
    {
      id: 'preserve-postmortem-orientation',
      whenOmitted: ['learn', 'improve'],
      from: "**Don't use when:** You want to preserve session context for the next conversation (use `/session-handoff`), extract reusable patterns from findings into the knowledge base (use `/learn`), or score and improve quality iteratively (use `/improve`).",
      to: "**Don't use when:** You want to preserve session context for the next conversation (use `/session-handoff`), curate reusable patterns into the knowledge base, or run an iterative quality experiment.",
      preserves: [/session context/, /\/session-handoff/, /reusable patterns/, /iterative quality/],
    },
    {
      id: 'preserve-postmortem-handoff-step',
      whenOmitted: ['learn'],
      from: 'Output the HANDOFF block from the Exit Protocol, then suggest: `Run /learn {campaign-slug} to extract patterns into the knowledge base.`',
      to: 'Output the HANDOFF block from the Exit Protocol, then note that reusable patterns may be curated into the project knowledge base when requested.',
      preserves: [/HANDOFF block/, /reusable patterns/, /knowledge base/],
    },
    {
      id: 'remove-duplicate-source-only-learn-suggestion',
      whenOmitted: ['learn'],
      from: 'After displaying the HANDOFF block, suggest: `Run /learn {campaign-slug} to extract patterns into the knowledge base.`',
      to: '',
    },
  ]],
  ['skills/review/SKILL.md', [
    {
      id: 'preserve-review-orientation',
      whenOmitted: ['improve'],
      from: "**Don't use when:** generating tests (use /test-gen); security audit (use /security-review); skill file review (use /improve skill-md).",
      to: "**Don't use when:** generating tests (use /test-gen); conducting a dedicated security audit; or a skill file review without an explicit rubric (use /marshal).",
      preserves: [/generating tests/, /\/test-gen/, /security audit/, /skill file review/],
    },
  ]],
  ['skills/session-handoff/SKILL.md', [
    {
      id: 'preserve-session-handoff-orientation',
      whenOmitted: ['learn'],
      from: "**Don't use when:** You want to extract reusable patterns from a completed campaign (use `/learn`), write a structured postmortem for a failed campaign (use `/postmortem`), or produce documentation rather than a context transfer.",
      to: "**Don't use when:** You want to curate reusable patterns from a completed campaign, write a structured postmortem for a failed campaign (use `/postmortem`), or produce documentation rather than a context transfer.",
      preserves: [/reusable patterns/, /\/postmortem/, /documentation/, /context transfer/],
    },
  ]],
  ['skills/setup/SKILL.md', [
    {
      id: 'preserve-setup-orientation',
      whenOmitted: ['verify'],
      from: "**Don't use when:** harness is already configured and you want to verify it (use /verify); adding a single skill to an existing project (copy SKILL.md manually).",
      to: "**Don't use when:** the harness is already configured and you only want to inspect its readiness; or when adding a single skill to an existing project (copy SKILL.md manually).",
      preserves: [/already configured/, /readiness/, /adding a single skill/, /copy SKILL\.md manually/],
    },
    {
      id: 'preserve-observability-tour-item',
      whenOmitted: ['learn'],
      from: '5. **Observability** (1 min): `/do next`, `/dashboard`, `/cost`, `/learn`',
      to: '5. **Observability** (1 min): `/do next`, `/dashboard`, `/cost`',
      preserves: [/5\. \*\*Observability\*\*/, /\/do next/, /\/dashboard/, /\/cost/],
    },
    {
      id: 'preserve-setup-next-steps',
      whenOmitted: ['improve'],
      from: '- NEXT STEPS: add conventions to CLAUDE.md, `/do --list`, `/create-skill`, `/improve [target]`',
      to: '- NEXT STEPS: add conventions to CLAUDE.md, `/do --list`, `/create-skill`',
      preserves: [/NEXT STEPS/, /CLAUDE\.md/, /\/do --list/, /\/create-skill/],
    },
    {
      id: 'remove-omitted-skills-catalog-footer',
      whenOmitted: [],
      from: '- Footer: `docs/SKILLS.md · INSTALL.md · /do --list`',
      to: '- Footer: `INSTALL.md · /do --list`',
    },
    {
      id: 'project-source-only-delivery-activation',
      whenOmitted: ['deploy-steward', 'pr-watch', 'triage'],
      from: [
        'Recommended and Express use `standard@1.0.0` with Core + Persistence. Full Tour',
        'may preview Parallel and Operations, but each bundle needs an explicit enable',
        'plan. If the runtime is partial, show the named adapter and require',
        '`--allow-degraded-runtime`; never silently describe degraded support as full.',
        'Delivery remains off until the user explicitly enables it.',
      ].join('\n'),
      to: [
        'Recommended and Express use `standard@1.0.0` with Core + Persistence. Full Tour',
        'may preview Parallel and Operations, but each bundle needs an explicit enable',
        'plan. If the runtime is partial, show the named adapter and require',
        '`--allow-degraded-runtime`; never silently describe degraded support as full.',
        'The slim release does not expose Delivery; those workflows require the full source distribution.',
      ].join('\n'),
      preserves: [/Core \+ Persistence/, /Parallel and Operations/, /explicit enable/, /slim release does not expose Delivery/, /full source distribution/],
    },
  ]],
  ['skills/test-gen/SKILL.md', [
    {
      id: 'preserve-test-gen-orientation',
      whenOmitted: ['improve'],
      from: "**Don't use when:** tests already exist and need updating (use /review or /improve); writing integration tests across services (use /marshal with an explicit test plan).",
      to: "**Don't use when:** tests already exist and need updating (use /review); writing integration tests across services (use /marshal with an explicit test plan).",
      preserves: [/tests already exist/, /\/review/, /integration tests across services/, /\/marshal/],
    },
  ]],
  ['skills/wiki/SKILL.md', [
    {
      id: 'preserve-wiki-orientation',
      whenOmitted: ['learn'],
      from: "**Don't use when:** capturing session learnings into the evolve pipeline (use /learn); generating structured code documentation (use /doc-gen).",
      to: "**Don't use when:** preserving transient session learnings (use /session-handoff); generating structured code documentation (use /doc-gen).",
      preserves: [/session learnings/, /structured code documentation/, /\/doc-gen/],
    },
  ]],
]);

function replaceRequiredInstruction(source, entryName, rule) {
  source = source.replace(/\r\n/g, '\n');
  const expected = rule.expected || 1;
  let count = 0;
  let offset = 0;
  while ((offset = source.indexOf(rule.from, offset)) !== -1) {
    count += 1;
    offset += rule.from.length;
  }
  if (count !== expected) {
    throw new Error(`${entryName}: release projection ${rule.id} expected ${expected} source match(es), found ${count}`);
  }
  const projected = source.split(rule.from).join(rule.to);
  for (const pattern of rule.preserves || []) {
    if (!pattern.test(projected)) throw new Error(`${entryName}: release projection ${rule.id} lost required semantics: ${pattern}`);
  }
  return projected;
}

function projectReleaseReadme(source) {
  const sourceOnlyProof = /### Source-only proof program\r?\n[\s\S]*?(?=## Trust boundary)/;
  if (!sourceOnlyProof.test(source)) {
    throw new Error('Release README projection cannot find the source-only proof boundary');
  }
  return source.replace(sourceOnlyProof, '');
}

function sanitizeReleaseInstructions(entries, knownSkillNames) {
  const releaseVersion = jsonFromEntries(entries, 'package.json').version;
  const shippedSkillNames = new Set(entries
    .map((entry) => /^skills\/([^/]+)\/SKILL\.md$/.exec(entry.name)?.[1])
    .filter(Boolean));
  const rootInstructionDocs = new Set(['CHANGELOG.md', 'README.md', 'INSTALL.md', 'PRIVACY.md', 'SECURITY.md']);
  const instructionEntry = (name) => rootInstructionDocs.has(name)
    || (name.startsWith('docs/') && name.endsWith('.md'))
    || /^skills\/[^/]+\/SKILL\.md$/.test(name);
  const omittedRoutes = (line) => [...line.matchAll(/\/([a-z][a-z0-9-]*)\b/g)]
    .filter((match) => {
      const before = match.index === 0 ? '' : line[match.index - 1];
      const commandBoundary = match.index === 0 || /[\s`"'(]/.test(before);
      return commandBoundary && knownSkillNames.has(match[1]) && !shippedSkillNames.has(match[1]);
    })
    .map((match) => match[1]);
  const omittedSkill = (name) => knownSkillNames.has(name) && !shippedSkillNames.has(name);

  return entries.map((entry) => {
    if (!instructionEntry(entry.name)) return entry;
    let source = entry.data.toString('utf8');
    if (entry.name === 'INSTALL.md') {
      const verifyStart = '## Verify';
      const updateStart = '## Update, rollback, restore, and leave';
      if (!source.includes(verifyStart) || !source.includes(updateStart)) {
        throw new Error('Release INSTALL projection cannot find the verification boundary');
      }
      source = source.replace(
        /## Verify\r?\n[\s\S]*?(?=## Update, rollback, restore, and leave)/,
        '## Verify\n\nFrom the extracted release root, verify that the packaged CLI loads:\n\n```bash\nnode bin/citadel.js --help\n```\n\nA zero exit code confirms the release front door and its packaged dependencies load.\nThe GitHub Actions release matrix performs the maintainer-only test suite before publication.\n\n'
      );
      source = source.replace(
        /\*\*Daemon won't start \/ "No active campaign" error:\*\*[\s\S]*?(?=## Next Steps)/,
        ''
      );
      source = source.replace(
        'Campaign logs in `.planning/improvement-logs/` and `.planning/telemetry/` are preserved independently.',
        'Other campaign records are preserved independently.'
      );
    }
    if (entry.name === 'README.md') {
      source = projectReleaseReadme(source);
    }
    if (entry.name === 'SECURITY.md') {
      const directChecks = /Run the security checks directly, or the full suite:\r?\n\r?\n```bash\r?\nnode scripts\/test-security\.js\r?\nnpm test\r?\n```/;
      if (!directChecks.test(source)) throw new Error('Release SECURITY projection cannot find maintainer checks');
      source = source.replace(
        directChecks,
        'The extracted release omits maintainer-only test programs. Contributors validate security changes in a full source checkout; release consumers verify the signed release trio as described in `docs/RELEASES.md`.'
      );
      source = source.replace(
        '- [ ] Run `npm test`.',
        '- [ ] Validate the change in a full source checkout; the release artifact does not contain the maintainer test suite.'
      );
    }
    if (entry.name === 'CHANGELOG.md') {
      const escapedVersion = releaseVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const currentHeading = new RegExp(`^## ${escapedVersion} - (?:Unreleased|\\d{4}-\\d{2}-\\d{2})\\s*$`, 'gm');
      const headingMatches = [...source.matchAll(currentHeading)];
      if (headingMatches.length !== 1) {
        throw new Error('Release changelog projection requires exactly one current version heading with Unreleased or an ISO date');
      }
      // Historical source notes can reference tools omitted from this artifact.
      // Keep the exact current release section; full history stays in Git.
      const currentStart = headingMatches[0].index;
      const rest = source.slice(currentStart + headingMatches[0][0].length);
      const nextHeading = rest.search(/^## /m);
      const currentEnd = nextHeading < 0 ? source.length
        : currentStart + headingMatches[0][0].length + nextHeading;
      source = source.slice(currentStart, currentEnd).trim() + '\n';
      source = source.replace(currentHeading, `## ${releaseVersion}`);
      const addedSection = /### Added\r?\n[\s\S]*?(?=\r?\n### |$)/;
      const consumerSurface = [
          '### Included consumer surface',
          '',
          '- The slim GitHub Release artifact ships `/do`, durable continuation, coordinated work,',
          '  the five-command lifecycle CLI, and local evidence/state adapters.',
          '- Hook policy enforcement and Codex/Claude projection fixes are included in the',
          '  extracted runtime.',
          '- Update and rollback preserve unowned files and verify target-bound backup receipts.',
          '- Broad Operation Control, Fork, Mission Control, scheduling, and lab command',
          '  surfaces remain source-only; a dependency subset ships only to support installed workflows.',
          '',
        ].join('\n');
      source = addedSection.test(source)
        ? source.replace(addedSection, consumerSurface)
        : source + '\n' + consumerSurface;
    }
    if (entry.name === 'docs/RELEASES.md') {
      const maintainerSection = /## Maintainer build and verification\r?\n[\s\S]*?(?=## Consumer verification)/;
      if (!maintainerSection.test(source)) throw new Error('Release documentation projection cannot find maintainer section');
      source = source.replace(
        maintainerSection,
        '## Maintainer build and verification\n\nRelease creation runs only from a clean, tagged source checkout through the protected GitHub workflow. The extracted artifact is a consumer package, not a release-authoring checkout.\n\n'
      );
    }
    if (entry.name === 'skills/archon/SKILL.md') {
      const daemonSection = /### Step 2\.5: DAEMONIZE\?[\s\S]*?(?=### Step 3: EXECUTE PHASES)/;
      if (!daemonSection.test(source)) throw new Error('Release Archon projection cannot find the daemon section');
      source = source.replace(
        daemonSection,
        '### Step 2.5: CONTINUATION BOUNDARY\n\nFor multi-session work, persist the campaign state and stop at the explicit Needs You / Resume boundary. Do not create a resident background owner.\n\n'
      );
      source = source.replace(
        /^3\.5\. \*\*Propagate knowledge\*\*:.*$/m,
        '3.5. Record reusable knowledge in the campaign file for later review.'
      );
    }
    if (entry.name === 'skills/fleet/SKILL.md') {
      source = source.replace(
        /^7\.5\. \*\*Propagate knowledge\*\*:.*$/m,
        '7.5. Record reusable knowledge in the fleet session file for later review.'
      );
    }
    if (entry.name === 'skills/dashboard/SKILL.md') {
      const packageDashboard = /If the package scripts are available, this equivalent command is also valid:\r?\n\r?\n```bash\r?\nnpm run dashboard\r?\n```\r?\n\r?\n/;
      if (!packageDashboard.test(source)) throw new Error('Release dashboard projection cannot find package-only launch command');
      source = source.replace(packageDashboard, '');
    }

    for (const rule of RELEASE_INSTRUCTION_RULES.get(entry.name) || []) {
      if (!rule.whenOmitted.every(omittedSkill)) continue;
      source = replaceRequiredInstruction(source, entry.name, rule);
    }

    const violations = [];
    source.split(/\r?\n/).forEach((line, index) => {
      for (const route of omittedRoutes(line)) violations.push(`${entry.name}:${index + 1} /${route}: ${line}`);
      if (omittedSkill('daemon') && /\bdaemon\b/i.test(line)) {
        violations.push(`${entry.name}:${index + 1} daemon: ${line}`);
      }
    });
    if (violations.length) {
      throw new Error(`Unhandled release instruction references:\n${violations.join('\n')}`);
    }

    const data = Buffer.from(source);
    return data.equals(entry.data) ? entry : { ...entry, data };
  });
}

function sanitizeReleaseRuntimeInstructions(entries) {
  const shippedSkills = new Set(entries
    .map((entry) => /^skills\/([^/]+)\/SKILL\.md$/.exec(entry.name)?.[1])
    .filter(Boolean));
  const project = (name, transform) => {
    const entry = entries.find((candidate) => candidate.name === name);
    if (!entry) return;
    const source = entry.data.toString('utf8');
    const projected = transform(source);
    if (projected === source) throw new Error(`Release runtime projection did not change ${name}`);
    entry.data = Buffer.from(projected);
  };

  project('core/verification/profiles.js', (source) => source.replace(
    /function profileForFiles\(changedFiles, scripts = \{\}\) \{[\s\S]*?\r?\n\}\r?\n\r?\nfunction selectVerificationProfile/,
    [
      'function profileForFiles(changedFiles, scripts = {}) {',
      '  const files = changedFiles.map(normalizePath);',
      '  const broad = defaultCommand(scripts);',
      '  return {',
      "    id: 'baseline',",
      "    label: 'Target-project verification',",
      "    reason: 'The slim release uses only verification commands declared by the target project.',",
      '    changedFiles: files,',
      '    primaryCommand: broad,',
      '    commands: [broad],',
      '    notes: [],',
      '  };',
      '}',
      '',
      'function selectVerificationProfile',
    ].join('\n')
  ));

  project('scripts/dashboard.js', (source) => source.replace(
    '    lines.push(`  WARNING: ${routineQuota.runsLast24h} of ${routineQuota.cap} routine runs used in the last 24h. Hitting the cap pauses every routine on the account. See docs/ROUTINE-QUOTA.md.`);',
    '    lines.push(`  WARNING: ${routineQuota.runsLast24h} of ${routineQuota.cap} routine runs used in the last 24h. Hitting the account-wide cap pauses every routine.`);',
  ));

  if (!shippedSkills.has('telemetry')) {
    project('scripts/dashboard.js', (source) => source
      .replace(
        /  if \(actionableProblems > 0\) \{[\s\S]*?\r?\n  \}\r?\n\r?\n  return repairs;/,
        [
          '  if (actionableProblems > 0) {',
          '    repairs.push(action({',
          "      label: 'Inspect recent hook problems',",
          "      command: 'node scripts/dashboard.js --json',",
          "      why: `${actionableProblems} actionable hook problem(s) are recorded. Inspect the categorized local evidence before deciding what to change.`,",
          "      confidence: 'medium',",
          '      repairAvailable: false,',
          '      runbook: null,',
          '    }));',
          '  }',
          '',
          '  return repairs;',
        ].join('\n')
      )
      .replace(/  lines\.push\('  \/telemetry        - cost and hook breakdown'\);\r?\n/, "  lines.push('  node scripts/dashboard.js --json - inspect categorized hook evidence');\n"));
    project('scripts/next-action.js', (source) => source
      .replace(/  if \(command === '\/telemetry'\) return 'telemetry-review';\r?\n/, '')
      .replace(/  if \(command === '\/telemetry'\) return 'low';\r?\n/, '')
      .replace(/  if \(command === '\/telemetry'\) \{[\s\S]*?\r?\n  \}\r?\n/, ''));
  }
  if (!shippedSkills.has('pr-watch')) {
    project('scripts/dashboard.js', (source) => source.replace(/  lines\.push\('  \/pr-watch         - watch PR CI'\);\r?\n/, ''));
  }
  if (!shippedSkills.has('learn')) {
    project('scripts/dashboard.js', (source) => source.replace(/  lines\.push\('  \/learn            - extract patterns from completed campaigns'\);\r?\n/, ''));
    project('hooks_src/intake-scanner.js', (source) => source.replace(
      '    lines.push(`    → Run /learn --compile to integrate into .planning/wiki/`);',
      '    lines.push(`    → Review staged findings in .planning/wiki/_staging/; compilation requires a full source checkout.`);'
    ));
  }
  if (!shippedSkills.has('triage')) {
    project('hooks_src/issue-monitor.js', (source) => source.replace(
      "      lines.push('Run /triage to investigate.');",
      "      lines.push('Review the new or untriaged issues directly before changing code.');"
    ));
    project('core/codex/native-integrations.js', (source) => source.replace(
      "    command: decision === 'local-review' ? `/triage pr ${prNumber}` : '@codex review',",
      "    command: '@codex review',"
    ));
  }
  if (!shippedSkills.has('daemon')) {
    project('hooks_src/init-project.js', (source) => source.replace(
      '        `  Run /do continue to resume, or /daemon stop to cancel.\\n`',
      '        `  Run /do continue to resume; the slim release has no resident daemon control.\\n`'
    ));
  }

  return entries;
}

function assertVersions(entries, ref) {
  const pkg = jsonFromEntries(entries, 'package.json');
  const claude = jsonFromEntries(entries, '.claude-plugin/plugin.json');
  const marketplace = jsonFromEntries(entries, '.claude-plugin/marketplace.json');
  const codex = jsonFromEntries(entries, '.codex-plugin/plugin.json');
  const versions = [pkg.version, claude.version, marketplace.plugins?.[0]?.version, codex.version];
  if (versions.some((version) => version !== pkg.version)) {
    throw new Error(`Release version drift: ${versions.join(', ')}`);
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(pkg.version)) {
    throw new Error(`Release version is not supported SemVer: ${pkg.version}`);
  }
  if (ref && ref !== `v${pkg.version}`) {
    throw new Error(`Tag ${ref} does not match manifest version ${pkg.version}`);
  }
  return { version: pkg.version, nodeRange: pkg.engines?.node || '>=22' };
}

function assertRefMatchesCheckout(sourceDir, ref) {
  if (!ref) return;
  const pkg = JSON.parse(fs.readFileSync(path.join(sourceDir, 'package.json'), 'utf8'));
  if (ref !== `v${pkg.version}`) {
    throw new Error(`Tag ${ref} does not match manifest version ${pkg.version}`);
  }
}

function writeOctal(buffer, offset, length, value) {
  const encoded = Math.max(0, value).toString(8).padStart(length - 1, '0').slice(-(length - 1));
  buffer.write(encoded, offset, length - 1, 'ascii');
  buffer[offset + length - 1] = 0;
}

function splitTarPath(name) {
  if (Buffer.byteLength(name) <= 100) return { name, prefix: '' };
  for (let index = name.lastIndexOf('/'); index > 0; index = name.lastIndexOf('/', index - 1)) {
    const prefix = name.slice(0, index);
    const leaf = name.slice(index + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(leaf) <= 100) return { name: leaf, prefix };
  }
  throw new Error(`Release path exceeds ustar limits: ${name}`);
}

function tarHeader(name, size, mode, mtime) {
  const header = Buffer.alloc(512, 0);
  const parts = splitTarPath(name);
  header.write(parts.name, 0, 100, 'utf8');
  writeOctal(header, 100, 8, mode);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, mtime);
  header.fill(0x20, 148, 156);
  header[156] = '0'.charCodeAt(0);
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  if (parts.prefix) header.write(parts.prefix, 345, 155, 'utf8');
  let checksum = 0;
  for (const byte of header) checksum += byte;
  const encoded = checksum.toString(8).padStart(6, '0').slice(-6);
  header.write(encoded, 148, 6, 'ascii');
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function makeTar(entries, prefix, mtime) {
  const chunks = [];
  for (const entry of entries) {
    const name = `${prefix}/${entry.name}`;
    chunks.push(tarHeader(name, entry.data.length, entry.mode, mtime), entry.data);
    const remainder = entry.data.length % 512;
    if (remainder) chunks.push(Buffer.alloc(512 - remainder));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function makeCanonicalGzip(data) {
  const archive = zlib.gzipSync(data, { level: 9, mtime: 0 });
  // RFC 1952 byte 9 is an informational source-OS marker. Node writes the host
  // OS here even when the compressed payload is identical, so normalize it to
  // "unknown" to keep release bytes identical across supported builders.
  archive[9] = 0xff;
  return archive;
}

function buildRelease(options = {}) {
  const sourceDir = path.resolve(options.sourceDir || ROOT);
  const ref = options.ref || null;
  assertRefMatchesCheckout(sourceDir, ref);
  const sourceEntries = ref ? refEntries(sourceDir, ref) : worktreeEntries(sourceDir);
  const knownSkillNames = new Set(sourceEntries
    .map((entry) => /^skills\/([^/]+)\/SKILL\.md$/.exec(entry.name)?.[1])
    .filter(Boolean));
  const entries = sanitizeReleaseRuntimeInstructions(sanitizeReleaseInstructions(sanitizeReleaseSkillCounts(sanitizeReleaseMetadata(
    sanitizeReleaseRouting(sanitizeReleaseBundleCatalog(sanitizeReleaseMcp(sanitizeReleaseCli(sanitizeReleasePackage(normalizeReleaseTextEntries(applyReleasePolicy(sourceEntries)))))))
  )), knownSkillNames));
  const identity = assertVersions(entries, ref);
  const commit = gitValue(['rev-parse', ref ? `${ref}^{commit}` : 'HEAD'], sourceDir, 'unknown');
  const epoch = Number(gitValue(['log', '-1', '--format=%ct', ref || 'HEAD'], sourceDir, '0')) || 0;
  const sourceRef = ref || `worktree@${commit}`;
  const prefix = `citadel-${identity.version}`;
  const internalManifest = {
    schema: 1,
    version: identity.version,
    ref: sourceRef,
    commit,
    createdAt: new Date(epoch * 1000).toISOString(),
    nodeRange: identity.nodeRange,
    runtimeMatrix: MATRIX,
    files: entries.map((entry) => ({ path: entry.name, bytes: entry.data.length, sha256: sha256(entry.data) })),
    rollbackCommand: 'node scripts/update.js --rollback <backup-path> --target <citadel-install> --apply',
  };
  const manifestData = Buffer.from(`${JSON.stringify(internalManifest, null, 2)}\n`);
  const archiveEntries = [...entries, { name: MANIFEST_NAME, data: manifestData, mode: 0o644 }]
    .sort(compareNames);
  const archive = makeCanonicalGzip(makeTar(archiveEntries, prefix, epoch));
  const refLabel = ref ? path.basename(ref) : `v${identity.version}`;
  const archiveName = `citadel-${refLabel.replace(/[^A-Za-z0-9._-]/g, '-')}.tar.gz`;
  const archiveHash = sha256(archive);
  const externalManifest = {
    ...internalManifest,
    artifact: { file: archiveName, bytes: archive.length, sha256: archiveHash },
  };
  const outputDir = path.resolve(options.outputDir || path.join(sourceDir, 'dist', 'release'));
  fs.mkdirSync(outputDir, { recursive: true });
  const archivePath = path.join(outputDir, archiveName);
  const manifestPath = `${archivePath}.manifest.json`;
  const checksumPath = `${archivePath}.sha256`;
  fs.writeFileSync(archivePath, archive);
  fs.writeFileSync(manifestPath, `${JSON.stringify(externalManifest, null, 2)}\n`);
  fs.writeFileSync(checksumPath, `${archiveHash}  ${archiveName}\n`);
  return { archivePath, manifestPath, checksumPath, sha256: archiveHash, manifest: externalManifest };
}

function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('Usage: node scripts/release-package.js [--ref v1.1.0] [--output-dir PATH] [--dry-run] [--verify-reproducible]');
    return;
  }
  const dryRun = process.argv.includes('--dry-run');
  const reproducible = process.argv.includes('--verify-reproducible');
  const sourceDir = path.resolve(arg('--source-dir', ROOT));
  const requestedOutput = path.resolve(arg('--output-dir', path.join(sourceDir, 'dist', 'release')));
  const temporary = dryRun || reproducible ? fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-release-')) : null;
  try {
    const first = buildRelease({ sourceDir, ref: arg('--ref'), outputDir: temporary ? path.join(temporary, 'one') : requestedOutput });
    if (reproducible) {
      const second = buildRelease({ sourceDir, ref: arg('--ref'), outputDir: path.join(temporary, 'two') });
      if (first.sha256 !== second.sha256 || fs.readFileSync(first.manifestPath, 'utf8') !== fs.readFileSync(second.manifestPath, 'utf8')) {
        throw new Error('Consecutive release builds were not byte-for-byte reproducible');
      }
    }
    if (!dryRun && temporary) {
      fs.mkdirSync(requestedOutput, { recursive: true });
      for (const file of [first.archivePath, first.manifestPath, first.checksumPath]) {
        fs.copyFileSync(file, path.join(requestedOutput, path.basename(file)));
      }
    }
    console.log(JSON.stringify({ version: first.manifest.version, ref: first.manifest.ref, sha256: first.sha256, reproducible, dryRun, output: dryRun ? null : requestedOutput }, null, 2));
  } finally {
    if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
  }
}

module.exports = {
  MANIFEST_NAME,
  RELEASE_FILES_NAME,
  applyReleasePolicy,
  buildRelease,
  projectReleaseReadme,
  sanitizeReleaseInstructions,
  sha256,
};
if (require.main === module) main();

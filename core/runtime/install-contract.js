'use strict';

const fs = require('fs');
const path = require('path');

// Runtime installers write two kinds of material into a target project. Shared
// material is a project decision and may be committed. Machine-local material
// contains checkout paths, generated runtime adapters, or process state and is
// kept out of the repository through the local Git exclude file. Keeping this
// contract in one module lets Claude, Codex, and the forthcoming OpenCode
// installer agree without sharing their runtime-specific file formats.
const INSTALL_CONTRACT_VERSION = 1;
const GUIDANCE_OWNER = 'citadel:project-guidance';
const GUIDANCE_OWNER_MARKER = `<!-- ${GUIDANCE_OWNER} -->`;
const LOCAL_EXCLUDE_BEGIN = '# BEGIN CITADEL MACHINE-LOCAL OUTPUTS';
const LOCAL_EXCLUDE_END = '# END CITADEL MACHINE-LOCAL OUTPUTS';

const MACHINE_LOCAL_PATTERNS = Object.freeze([
  '.citadel/*',
  '!.citadel/project.md',
  '!.citadel/project.template.md',
  '.claude/settings.json',
  '.claude/settings.local.json',
  '.claude/agent-context/',
  '.codex/',
  '.agents/',
  '.opencode/',
  '.planning/coordination/',
  '.planning/telemetry/',
  '.planning/acquisition/',
  '.planning/doc-sync/',
  '.planning/pr-readiness/',
  '.planning/next-actions/',
  '.planning/approval-capsules/',
  '.planning/operator-console/',
  '.planning/stack-readiness/',
  '.planning/usefulness-trial/',
  '.planning/operating-proof/',
  '.planning/loops/',
  '.planning/operation-forks/',
  '.planning/product-proof/',
  '.planning/screenshots/',
  '.planning/verification/',
  '.planning/map/',
  '.planning/app-server/',
  '.planning/artifacts/',
  '.planning/benchmark-results/',
  '.planning/handoffs/',
  '.planning/live-proof/',
  '.planning/noop-audit/',
  '.planning/daemon.json',
  '.planning/daemon-runs.log',
  '.planning/watch-state.json',
]);

const SHARED_PATHS = Object.freeze([
  'AGENTS.md',
  'CLAUDE.md',
  '.citadel/project.md',
  '.citadel/project.template.md',
  '.claude/harness.json',
  '.mcp.json',
]);

function normalizeRelative(relativePath) {
  return String(relativePath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/');
}

function isAbsoluteReference(value) {
  const text = String(value || '').trim();
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/|file:\/\/)/.test(text);
}

function absoluteReferences(value, location = '$') {
  const found = [];
  if (typeof value === 'string') {
    if (isAbsoluteReference(value)) found.push({ location, value });
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => found.push(...absoluteReferences(item, `${location}[${index}]`)));
    return found;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      found.push(...absoluteReferences(item, `${location}.${key}`));
    }
  }
  return found;
}

function classifyOutput(relativePath, options = {}) {
  const normalized = normalizeRelative(relativePath);
  const explicit = options.ownership;
  if (explicit === 'shared' || explicit === 'machine-local') return explicit;
  if (SHARED_PATHS.includes(normalized)) return 'shared';
  if (normalized === 'AGENTS.md' || normalized === 'CLAUDE.md') return 'shared';
  if (normalized.startsWith('.planning/campaigns/') || normalized.startsWith('.planning/intake/')) {
    return 'shared';
  }
  return 'machine-local';
}

function classifyOutputs(outputs, options = {}) {
  return (outputs || []).map((output) => {
    const relativePath = normalizeRelative(output.path || output.relativePath);
    const ownership = classifyOutput(relativePath, output);
    const references = Array.isArray(output.absoluteReferences)
      ? output.absoluteReferences
      : absoluteReferences(output.content, '$');
    return Object.freeze({
      runtime: output.runtime || options.runtime || 'unknown',
      path: relativePath,
      ownership,
      reason: output.reason || (ownership === 'shared'
        ? 'Project policy or guidance is intentionally shared.'
        : 'Contains machine-local runtime state, generated adapters, or checkout paths.'),
      portable: typeof output.portable === 'boolean'
        ? output.portable
        : ownership === 'machine-local' || references.length === 0,
      absoluteReferences: references,
    });
  });
}

function assertPortableSharedOutputs(outputs) {
  const classified = classifyOutputs(outputs);
  const violations = classified.filter((item) => item.ownership === 'shared' && item.absoluteReferences.length > 0);
  if (violations.length === 0) return classified;
  const details = violations.map((item) => {
    const refs = item.absoluteReferences.map((entry) => `${entry.location}=${entry.value}`).join(', ');
    return `${item.path}: ${refs}`;
  });
  const error = new Error(
    `Shared Citadel output contains workstation-specific absolute paths. `
    + `Move the path to machine-local state or make it relative: ${details.join('; ')}`,
  );
  error.code = 'CITADEL_SHARED_PATH_NOT_PORTABLE';
  error.violations = violations;
  throw error;
}

function localExcludeText() {
  return [
    LOCAL_EXCLUDE_BEGIN,
    '# Generated by Citadel installers. This file is local to one checkout.',
    ...MACHINE_LOCAL_PATTERNS,
    LOCAL_EXCLUDE_END,
    '',
  ].join('\n');
}

function gitExcludePath(projectRoot, fileSystem = fs) {
  const gitPath = path.join(path.resolve(projectRoot), '.git');
  if (!fileSystem.existsSync(gitPath)) return null;
  let gitDirectory = gitPath;
  try {
    if (fileSystem.statSync(gitPath).isFile()) {
      const pointer = fileSystem.readFileSync(gitPath, 'utf8').trim();
      const match = pointer.match(/^gitdir:\s*(.+)$/i);
      if (!match) return null;
      gitDirectory = path.resolve(path.dirname(gitPath), match[1]);
      const commonDirFile = path.join(gitDirectory, 'commondir');
      if (fileSystem.existsSync(commonDirFile)) {
        const commonDir = fileSystem.readFileSync(commonDirFile, 'utf8').trim();
        if (commonDir) gitDirectory = path.resolve(gitDirectory, commonDir);
      } else if (path.basename(path.dirname(gitDirectory)).toLowerCase() === 'worktrees') {
        // Older or synthetic linked-worktree gitdirs may omit `commondir`, but
        // still follow Git's conventional .git/worktrees/<name> layout.
        gitDirectory = path.resolve(gitDirectory, '..', '..');
      }
    }
  } catch {
    return null;
  }
  return path.join(gitDirectory, 'info', 'exclude');
}

function ensureMachineLocalExcludes(projectRoot, options = {}) {
  const fileSystem = options.fileSystem || fs;
  const excludePath = gitExcludePath(projectRoot, fileSystem);
  const plan = {
    contractVersion: INSTALL_CONTRACT_VERSION,
    path: excludePath,
    ownership: 'machine-local',
    patterns: [...MACHINE_LOCAL_PATTERNS],
    written: false,
    skipped: false,
    reason: null,
  };
  if (!excludePath) {
    plan.skipped = true;
    plan.reason = 'target is not a Git checkout';
    return plan;
  }

  const existing = fileSystem.existsSync(excludePath)
    ? fileSystem.readFileSync(excludePath, 'utf8')
    : '';
  if (existing.includes(LOCAL_EXCLUDE_BEGIN)) {
    plan.skipped = true;
    plan.reason = 'Citadel machine-local block already present';
    return plan;
  }
  if (options.dryRun) {
    plan.skipped = true;
    plan.reason = 'dry-run';
    return plan;
  }

  fileSystem.mkdirSync(path.dirname(excludePath), { recursive: true });
  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  fileSystem.writeFileSync(excludePath, `${existing}${prefix}${localExcludeText()}`, 'utf8');
  plan.written = true;
  return plan;
}

function guidanceOwner(content) {
  const text = String(content || '');
  if (text.includes(GUIDANCE_OWNER_MARKER)) return GUIDANCE_OWNER;
  if (/Codex-facing|Codex Project Guidance|Codex-specific guidance/i.test(text)) return 'codex';
  if (/Claude Harness|Claude Code guidance/i.test(text)) return 'claude-code';
  if (/OpenCode|opencode-facing|opencode project guidance/i.test(text)) return 'opencode';
  return 'user';
}

function withGuidanceOwner(content) {
  const text = String(content || '');
  if (text.includes(GUIDANCE_OWNER_MARKER)) return text;
  const firstNewline = text.indexOf('\n');
  if (firstNewline < 0) return `${text}\n${GUIDANCE_OWNER_MARKER}\n`;
  return `${text.slice(0, firstNewline + 1)}${GUIDANCE_OWNER_MARKER}\n${text.slice(firstNewline + 1)}`;
}

function projectDelegateContent(scriptName) {
  if (!/^[a-zA-Z0-9_.-]+\.(?:js|cjs)$/.test(String(scriptName || ''))) {
    throw new Error(`Invalid Citadel delegate script name: ${scriptName}`);
  }
  return [
    '#!/usr/bin/env node',
    "'use strict';",
    '// Generated by Citadel runtime installer. Do not edit manually.',
    "const { spawnSync } = require('child_process');",
    "const fs = require('fs');",
    "const path = require('path');",
    "const pluginRoot = fs.readFileSync(path.join(__dirname, '..', 'plugin-root.txt'), 'utf8').trim();",
    `const real = path.join(pluginRoot, 'scripts', ${JSON.stringify(scriptName)});`,
    "const result = spawnSync(process.execPath, [real, ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });",
    'process.exit(result.error ? 1 : (result.status ?? 0));',
    '',
  ].join('\n');
}

function ensureProjectDelegate(projectRoot, citadelRoot, scriptName, options = {}) {
  const fileSystem = options.fileSystem || fs;
  const root = path.resolve(projectRoot || process.cwd());
  const pluginRoot = path.resolve(citadelRoot || root);
  const delegatePath = path.join(root, '.citadel', 'scripts', scriptName);
  const pointerPath = path.join(root, '.citadel', 'plugin-root.txt');
  const packagePath = path.join(root, '.citadel', 'scripts', 'package.json');
  const delegate = projectDelegateContent(scriptName);
  const plan = {
    contractVersion: INSTALL_CONTRACT_VERSION,
    pluginRoot,
    delegatePath,
    pointerPath,
    packagePath,
    written: false,
    skipped: false,
    reason: null,
    writes: [],
  };

  const existingDelegate = fileSystem.existsSync(delegatePath)
    ? fileSystem.readFileSync(delegatePath, 'utf8')
    : null;
  if (existingDelegate
      && !existingDelegate.includes('Generated by Citadel runtime installer.')
      && !existingDelegate.includes("path.join(__dirname, '..', 'plugin-root.txt')")) {
    const error = new Error(
      `${delegatePath} is owned by another tool. Remove it or run the Citadel installer after reviewing the file.`,
    );
    error.code = 'CITADEL_DELEGATE_OWNERSHIP_CONFLICT';
    throw error;
  }

  const desiredPointer = `${pluginRoot}\n`;
  const desiredPackage = `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`;
  const writes = [
    [pointerPath, desiredPointer],
    [packagePath, desiredPackage],
    [delegatePath, delegate],
  ];
  plan.writes = writes
    .filter(([filePath, content]) => !fileSystem.existsSync(filePath)
      || fileSystem.readFileSync(filePath, 'utf8') !== content)
    .map(([filePath]) => ({ path: filePath, action: fileSystem.existsSync(filePath) ? 'update' : 'create' }));
  if (plan.writes.length === 0) {
    plan.skipped = true;
    plan.reason = 'delegate already up to date';
    return plan;
  }
  if (options.dryRun) {
    plan.skipped = true;
    plan.reason = 'dry-run';
    return plan;
  }

  fileSystem.mkdirSync(path.dirname(delegatePath), { recursive: true });
  for (const [filePath, content] of writes) fileSystem.writeFileSync(filePath, content, 'utf8');
  plan.written = true;
  return plan;
}

function parseCitadelRoot(command) {
  const text = String(command || '');
  if (/\$\{PLUGIN_ROOT\}|process\.env\.PLUGIN_ROOT/i.test(text)) return '${PLUGIN_ROOT}';
  const marker = text.search(/[\\/]hooks_src[\\/]/i);
  if (marker < 0) return null;
  let root = text.slice(0, marker);
  root = root.replace(/^.*?\bnode\s+/, '').trim();
  root = root.replace(/^['"]|['"]$/g, '').replace(/[\\/]$/, '');
  return root || null;
}

function walkStrings(value, visit, location = '$') {
  if (typeof value === 'string') {
    visit(value, location);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkStrings(item, visit, `${location}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) walkStrings(item, visit, `${location}.${key}`);
  }
}

function readJson(filePath, fileSystem) {
  if (!fileSystem.existsSync(filePath)) return null;
  try {
    return JSON.parse(fileSystem.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function inspectInstallInventory(projectRoot, options = {}) {
  const fileSystem = options.fileSystem || fs;
  const root = path.resolve(projectRoot || process.cwd());
  const registrations = [];
  const generatedFiles = [];
  const addRegistration = (entry) => {
    registrations.push(Object.freeze({
      runtime: entry.runtime,
      surface: entry.surface,
      path: normalizeRelative(entry.path),
      root: entry.root || null,
      owner: entry.owner || 'citadel',
      source: entry.source || null,
    }));
  };
  const addGenerated = (relativePath, runtime, owner, content) => {
    generatedFiles.push(Object.freeze({
      path: normalizeRelative(relativePath),
      runtime,
      owner: owner || 'citadel',
      guidanceOwner: relativePath === 'AGENTS.md' || relativePath === 'CLAUDE.md'
        ? guidanceOwner(content)
        : null,
    }));
  };

  const claudeSettings = readJson(path.join(root, '.claude', 'settings.json'), fileSystem);
  if (claudeSettings) {
    walkStrings(claudeSettings.hooks || {}, (value, location) => {
      if (!/hooks_src[\\/]/i.test(value)) return;
      addRegistration({
        runtime: 'claude-code',
        surface: 'hooks',
        path: '.claude/settings.json',
        root: parseCitadelRoot(value),
        source: location,
      });
    });
    addGenerated('.claude/settings.json', 'claude-code', 'citadel:claude-hooks', claudeSettings);
  }

  const codexHooks = readJson(path.join(root, '.codex', 'hooks.json'), fileSystem);
  if (codexHooks) {
    walkStrings(codexHooks.hooks || {}, (value, location) => {
      if (!/codex-adapter|hooks_src[\\/]/i.test(value)) return;
      addRegistration({
        runtime: 'codex',
        surface: 'hooks',
        path: '.codex/hooks.json',
        root: parseCitadelRoot(value) || value.match(/(?:PLUGIN_ROOT|CITADEL_ROOT)[^\s"']*/i)?.[0] || null,
        source: location,
      });
    });
    addGenerated('.codex/hooks.json', 'codex', 'citadel:codex-hooks', codexHooks);
  }

  const opencodeStubPath = path.join(root, '.opencode', 'plugin', 'citadel.js');
  if (fileSystem.existsSync(opencodeStubPath)) {
    const stub = fileSystem.readFileSync(opencodeStubPath, 'utf8');
    const match = stub.match(/(?:file:\/\/|CITADEL_ROOT[^\n]*?)[^\n]*?(?:runtimes[\\/]opencode[\\/]plugin[\\/]index\.mjs|citadelRoot)/i);
    addRegistration({
      runtime: 'opencode',
      surface: 'plugin',
      path: '.opencode/plugin/citadel.js',
      root: match ? match[0] : null,
      source: 'plugin-stub',
    });
    addGenerated('.opencode/plugin/citadel.js', 'opencode', 'citadel:opencode-plugin', stub);
  }

  const opencodeConfig = readJson(path.join(root, 'opencode.json'), fileSystem);
  if (opencodeConfig?.mcp?.['citadel-state'] || opencodeConfig?.skills?.paths?.some((item) => /citadel|\.opencode/i.test(String(item)))) {
    addRegistration({
      runtime: 'opencode',
      surface: 'config',
      path: 'opencode.json',
      root: opencodeConfig.mcp?.['citadel-state']?.environment?.CITADEL_ROOT
        || opencodeConfig.skills?.paths?.find((item) => /citadel|\.opencode/i.test(String(item)))
        || null,
      source: 'opencode.json',
    });
    addGenerated('opencode.json', 'opencode', 'citadel:opencode-config', opencodeConfig);
  }

  const pointerPath = path.join(root, '.citadel', 'plugin-root.txt');
  if (fileSystem.existsSync(pointerPath)) {
    addRegistration({
      runtime: options.runtime || 'unknown',
      surface: 'delegates',
      path: '.citadel/plugin-root.txt',
      root: fileSystem.readFileSync(pointerPath, 'utf8').trim() || null,
      source: 'plugin-root.txt',
    });
    addGenerated('.citadel/plugin-root.txt', options.runtime || 'unknown', 'citadel:delegates',
      fileSystem.readFileSync(pointerPath, 'utf8'));
  }

  for (const [relativePath, runtime, owner] of [
    ['AGENTS.md', 'shared', GUIDANCE_OWNER],
    ['CLAUDE.md', 'shared', GUIDANCE_OWNER],
    ['.claude/harness.json', 'shared', 'citadel:harness-config'],
    ['.codex/config.toml', 'codex', 'citadel:codex-config'],
    ['.agents/plugins/marketplace.json', 'codex', 'citadel:codex-marketplace'],
  ]) {
    const target = path.join(root, ...relativePath.split('/'));
    if (fileSystem.existsSync(target)) {
      const content = fileSystem.readFileSync(target, 'utf8');
      addGenerated(relativePath, runtime, owner, content);
    }
  }

  const bySurface = new Map();
  for (const registration of registrations) {
    const key = `${registration.runtime}:${registration.surface}:${registration.path}`;
    if (!bySurface.has(key)) bySurface.set(key, []);
    bySurface.get(key).push(registration);
  }
  const diagnostics = [];
  for (const [key, entries] of bySurface) {
    const roots = [...new Set(entries.map((entry) => entry.root).filter(Boolean))];
    if (roots.length <= 1) continue;
    const [runtime, surface, registrationPath] = key.split(':');
    diagnostics.push({
      code: 'DUPLICATE_CITADEL_REGISTRATION',
      severity: 'warning',
      runtime,
      surface,
      path: registrationPath,
      roots,
      message: `Multiple Citadel installations own ${runtime} ${surface} at ${registrationPath}: ${roots.join(', ')}. Re-run the installer from the intended checkout to reconcile Citadel-owned entries, or remove the stale runtime registration before continuing.`,
    });
  }

  const guidance = generatedFiles
    .filter((entry) => entry.guidanceOwner)
    .map((entry) => ({ path: entry.path, owner: entry.guidanceOwner }));
  return Object.freeze({
    contractVersion: INSTALL_CONTRACT_VERSION,
    projectRoot: root,
    registrations: Object.freeze(registrations),
    generatedFiles: Object.freeze(generatedFiles),
    guidance: Object.freeze(guidance),
    diagnostics: Object.freeze(diagnostics),
    duplicate: diagnostics.some((diagnostic) => diagnostic.code === 'DUPLICATE_CITADEL_REGISTRATION'),
  });
}

module.exports = Object.freeze({
  GUIDANCE_OWNER,
  GUIDANCE_OWNER_MARKER,
  INSTALL_CONTRACT_VERSION,
  LOCAL_EXCLUDE_BEGIN,
  LOCAL_EXCLUDE_END,
  MACHINE_LOCAL_PATTERNS,
  SHARED_PATHS,
  absoluteReferences,
  assertPortableSharedOutputs,
  classifyOutput,
  classifyOutputs,
  ensureMachineLocalExcludes,
  guidanceOwner,
  gitExcludePath,
  inspectInstallInventory,
  localExcludeText,
  normalizeRelative,
  withGuidanceOwner,
  ensureProjectDelegate,
  projectDelegateContent,
});

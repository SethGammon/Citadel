'use strict';

const { BUNDLE_IDS, SUPPORT_LEVELS, deepFreeze, plain } = require('./contract');

const BUNDLE_CATALOG = deepFreeze({
  core: {
    id: 'core',
    dependencies: [],
    stage: 'stable',
    default: true,
    autoSafe: true,
    reversibleActivation: true,
    since: '2.0.0',
    deprecatedSince: null,
    removedIn: null,
    owns: {
      skills: [
        'architect', 'ascii-diagram', 'create-app', 'create-skill', 'design', 'do',
        'doc-gen', 'grill', 'houseclean', 'infra-audit', 'live-preview', 'map',
        'organize', 'prd', 'qa', 'refactor', 'research', 'review', 'scaffold',
        'setup', 'systematic-debugging', 'test-gen', 'unharness',
        'verify',
      ],
      hooks: [
        'protect-files', 'external-action-gate', 'governance', 'post-edit',
        'organize-enforce', 'complexity-check', 'circuit-breaker', 'quality-gate',
        'permission-request', 'instructions-loaded', 'config-change',
      ],
      state: [],
    },
    runtimeRequirements: [],
    degradationAdapters: {},
  },
  persistence: {
    id: 'persistence',
    dependencies: ['core'],
    stage: 'stable',
    default: true,
    autoSafe: true,
    reversibleActivation: true,
    since: '2.0.0',
    deprecatedSince: null,
    removedIn: null,
    owns: {
      skills: [
        'cost', 'dashboard', 'decision-map', 'learn', 'postmortem',
        'session-handoff', 'telemetry', 'wiki',
      ],
      hooks: [
        'cost-tracker', 'post-tool-batch', 'pre-compact', 'post-compact',
        'init-project', 'user-prompt-submit', 'user-prompt-expansion',
        'restore-compact', 'intake-scanner', 'session-end', 'file-changed',
        'cwd-changed',
      ],
      state: ['.planning/campaigns', '.planning/fleet', '.planning/telemetry'],
    },
    runtimeRequirements: ['workspace'],
    degradationAdapters: {},
  },
  parallel: {
    id: 'parallel',
    dependencies: ['persistence'],
    stage: 'stable',
    default: false,
    autoSafe: false,
    reversibleActivation: true,
    since: '2.0.0',
    deprecatedSince: null,
    removedIn: null,
    owns: {
      skills: ['fleet', 'merge-review', 'workspace'],
      hooks: [
        'subagent-start', 'subagent-stop', 'teammate-idle', 'task-events',
        'worktree-setup', 'worktree-remove',
      ],
      state: ['.planning/coordination'],
    },
    runtimeRequirements: ['workspace', 'agents', 'worktrees', 'approvals'],
    degradationAdapters: {
      codex: 'citadel-managed-worktrees-and-approvals',
      'claude-code': 'citadel-managed-approval-policy',
    },
  },
  operations: {
    id: 'operations',
    dependencies: ['persistence'],
    stage: 'stable',
    default: false,
    autoSafe: false,
    reversibleActivation: true,
    since: '2.0.0',
    deprecatedSince: null,
    removedIn: null,
    owns: {
      skills: [
        'archon', 'autopilot', 'daemon', 'evolve', 'experiment', 'improve', 'loop',
        'marshal', 'schedule', 'watch',
      ],
      hooks: ['stop-failure', 'elicitation', 'notification'],
      state: ['.planning/intake', '.planning/operations'],
    },
    runtimeRequirements: ['workspace', 'history', 'approvals'],
    degradationAdapters: {
      codex: 'citadel-operation-state-and-approval-adapter',
      'claude-code': 'citadel-operation-state-and-approval-adapter',
    },
  },
  delivery: {
    id: 'delivery',
    dependencies: ['operations'],
    stage: 'stable',
    default: false,
    autoSafe: false,
    reversibleActivation: false,
    since: '2.0.0',
    deprecatedSince: null,
    removedIn: null,
    owns: {
      skills: ['deploy-steward', 'pr-watch', 'triage'],
      hooks: [],
      state: ['.planning/deploy', '.planning/pr-watch'],
    },
    runtimeRequirements: ['workspace', 'approvals', 'surfaces'],
    degradationAdapters: {
      codex: 'citadel-delivery-handoff-adapter',
      'claude-code': 'citadel-delivery-approval-adapter',
    },
  },
});

function ownershipMap(property) {
  const ownership = {};
  for (const bundle of Object.values(BUNDLE_CATALOG)) {
    for (const id of bundle.owns[property]) {
      if (ownership[id]) throw new Error(`${property} ${id} has multiple bundle owners`);
      ownership[id] = bundle.id;
    }
  }
  return deepFreeze(ownership);
}

const SKILL_BUNDLE_OWNERSHIP = ownershipMap('skills');
const HOOK_BUNDLE_OWNERSHIP = ownershipMap('hooks');

function normalizeOwnerId(id) {
  if (typeof id !== 'string') return '';
  return id.trim().replace(/^\/+/, '').replace(/\.js$/, '');
}

function bundleForSkill(id) {
  return SKILL_BUNDLE_OWNERSHIP[normalizeOwnerId(id)] || null;
}

function bundleForHook(id) {
  return HOOK_BUNDLE_OWNERSHIP[normalizeOwnerId(id)] || null;
}

function bundleForRoute(id) {
  return bundleForSkill(id);
}

function bundleForTarget(kind, id) {
  if (kind === 'skill') return bundleForSkill(id);
  if (kind === 'route') return bundleForRoute(id);
  if (kind === 'hook') return bundleForHook(id);
  throw new TypeError(`Unknown activation target kind: ${String(kind)}`);
}

function assertBundleId(id) {
  if (!BUNDLE_IDS.includes(id)) throw new TypeError(`Unknown product bundle: ${String(id)}`);
  return id;
}

function dependencyClosure(requested) {
  if (!Array.isArray(requested)) throw new TypeError('Requested bundles must be an array');
  const selected = new Set(['core']);
  function add(id, visiting = new Set()) {
    assertBundleId(id);
    if (visiting.has(id)) throw new Error(`Product bundle dependency cycle at ${id}`);
    if (selected.has(id)) return;
    visiting.add(id);
    for (const dependency of BUNDLE_CATALOG[id].dependencies) add(dependency, visiting);
    visiting.delete(id);
    selected.add(id);
  }
  for (const id of requested) add(id);
  return BUNDLE_IDS.filter((id) => selected.has(id));
}

function supportLevel(runtime, capability) {
  const entry = runtime && plain(runtime.capabilities) ? runtime.capabilities[capability] : null;
  const support = typeof entry === 'string' ? entry : entry && entry.support;
  return SUPPORT_LEVELS.includes(support) ? support : 'none';
}

function unavailableEntry(id, reasonCode, details = {}) {
  return deepFreeze({ id, status: 'unavailable', reasonCode, ...details });
}

function negotiateBundles(requested, runtime, options = {}) {
  const closed = dependencyClosure(requested);
  const allowDegraded = options.allowDegradedRuntime === true;
  const effective = [];
  const degraded = [];
  const unavailable = [];
  const statuses = new Map();
  const runtimeId = runtime && typeof runtime.id === 'string' ? runtime.id : 'unknown';

  for (const id of closed) {
    const bundle = BUNDLE_CATALOG[id];
    const blockedDependency = bundle.dependencies.find((dependency) => statuses.get(dependency) === 'unavailable');
    if (blockedDependency) {
      statuses.set(id, 'unavailable');
      unavailable.push(unavailableEntry(id, 'BUNDLE_DEPENDENCY_UNAVAILABLE', {
        dependency: blockedDependency,
      }));
      continue;
    }

    const levels = bundle.runtimeRequirements.map((capability) => ({
      capability,
      support: supportLevel(runtime, capability),
    }));
    const missing = levels.filter((entry) => entry.support === 'none');
    const partial = levels.filter((entry) => entry.support === 'partial');
    if (missing.length) {
      statuses.set(id, 'unavailable');
      unavailable.push(unavailableEntry(id, 'RUNTIME_CAPABILITY_UNAVAILABLE', {
        capabilities: missing.map((entry) => entry.capability),
      }));
      continue;
    }
    if (partial.length) {
      const adapter = bundle.degradationAdapters[runtimeId] || null;
      if (!adapter) {
        statuses.set(id, 'unavailable');
        unavailable.push(unavailableEntry(id, 'DEGRADATION_ADAPTER_UNAVAILABLE', {
          capabilities: partial.map((entry) => entry.capability),
        }));
        continue;
      }
      if (!allowDegraded) {
        statuses.set(id, 'unavailable');
        unavailable.push(unavailableEntry(id, 'DEGRADED_RUNTIME_REQUIRES_OPT_IN', {
          capabilities: partial.map((entry) => entry.capability),
          adapter,
        }));
        continue;
      }
      statuses.set(id, 'degraded');
      effective.push(id);
      degraded.push(deepFreeze({
        id,
        status: 'degraded',
        reasonCode: 'RUNTIME_CAPABILITY_PARTIAL',
        capabilities: partial.map((entry) => entry.capability),
        adapter,
      }));
      continue;
    }
    statuses.set(id, 'available');
    effective.push(id);
  }

  return deepFreeze({
    requested: [...requested],
    dependencyClosed: closed,
    effective,
    degraded,
    unavailable,
  });
}

function dependentsOf(id) {
  assertBundleId(id);
  const dependents = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const bundle of Object.values(BUNDLE_CATALOG)) {
      if (bundle.dependencies.some((dependency) => dependents.has(dependency))
        && !dependents.has(bundle.id)) {
        dependents.add(bundle.id);
        changed = true;
      }
    }
  }
  return BUNDLE_IDS.filter((bundleId) => dependents.has(bundleId));
}

module.exports = Object.freeze({
  BUNDLE_CATALOG,
  HOOK_BUNDLE_OWNERSHIP,
  SKILL_BUNDLE_OWNERSHIP,
  assertBundleId,
  bundleForHook,
  bundleForRoute,
  bundleForSkill,
  bundleForTarget,
  dependencyClosure,
  dependentsOf,
  negotiateBundles,
  supportLevel,
});

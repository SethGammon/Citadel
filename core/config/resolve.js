'use strict';

const { sha256Digest } = require('../operations/canonical');
const {
  CHECKPOINT_LEVELS,
  OPERATING_POLICY_VERSION,
  POLICY_FIELDS,
  createDefaultConfig,
  deepFreeze,
  plain,
} = require('./contract');
const { negotiateBundles } = require('./bundle-catalog');
const { configKind } = require('./migrate');
const { getProfile } = require('./profiles');
const { validateConfigV2, validateConstraints } = require('./validate');
const {
  installationGeneration,
  runtimeContractDigest,
} = require('./identity');
const packageMetadata = require('../../package.json');

const NUMERIC_CEILINGS = new Set([
  'maxParallelAgents',
  'maxBudgetUnits',
  'verifierRetryLimit',
]);
const ALLOW_FIELDS = new Set([
  'allowIndependentOnUnknown',
  'allowAutoWorktreeIntegration',
  'allowConsentGatedExternalMerge',
]);

function normalizeRuntime(runtime) {
  const input = plain(runtime) ? runtime : {};
  const capabilities = {};
  if (plain(input.capabilities)) {
    for (const key of Object.keys(input.capabilities).sort()) {
      const entry = input.capabilities[key];
      capabilities[key] = {
        support: typeof entry === 'string' ? entry : entry?.support || 'none',
        notes: typeof entry === 'object' && typeof entry.notes === 'string' ? entry.notes : '',
      };
    }
  }
  const id = typeof input.id === 'string' && input.id ? input.id : 'unknown';
  const degradations = Array.isArray(input.degradations)
    ? input.degradations.filter((value) => typeof value === 'string').sort()
    : [];
  return {
    id,
    capabilities,
    degradations,
    contractDigest: runtimeContractDigest({ id, capabilities, degradations }),
  };
}

function constraintLayers(config, options) {
  const layers = [];
  if (plain(options.externalConstraints)) {
    layers.push({ source: 'external-policy', value: options.externalConstraints });
  }
  if (plain(config?.policy?.operating)) {
    layers.push({ source: 'repository-policy', value: config.policy.operating });
  }
  if (plain(options.sessionConstraints)) {
    layers.push({ source: 'session-policy', value: options.sessionConstraints });
  }
  return layers;
}

function policyDecision(current, field, candidate) {
  if (NUMERIC_CEILINGS.has(field)) {
    return candidate < current
      ? { value: candidate, applied: true, reasonCode: 'LOWER_CEILING' }
      : { value: current, applied: false, reasonCode: 'CANNOT_RAISE_CEILING' };
  }
  if (ALLOW_FIELDS.has(field)) {
    return current && !candidate
      ? { value: false, applied: true, reasonCode: 'PERMISSION_REMOVED' }
      : { value: current, applied: false, reasonCode: 'CANNOT_ADD_PERMISSION' };
  }
  if (field === 'requireArchitectureApproval') {
    return !current && candidate
      ? { value: true, applied: true, reasonCode: 'REQUIREMENT_ADDED' }
      : { value: current, applied: false, reasonCode: 'CANNOT_REMOVE_REQUIREMENT' };
  }
  if (field === 'checkpointMinimum') {
    const currentRank = CHECKPOINT_LEVELS.indexOf(current);
    const candidateRank = CHECKPOINT_LEVELS.indexOf(candidate);
    return candidateRank > currentRank
      ? { value: candidate, applied: true, reasonCode: 'CHECKPOINT_TIGHTENED' }
      : { value: current, applied: false, reasonCode: 'CANNOT_LOWER_CHECKPOINT' };
  }
  throw new TypeError(`Unsupported operating policy field: ${field}`);
}

function resolvePolicy(profile, layers = []) {
  const values = { ...profile.policy };
  const provenance = {};
  for (const field of POLICY_FIELDS) {
    provenance[field] = {
      value: values[field],
      source: `profile:${profile.id}@${profile.version}`,
      reasonCode: 'PROFILE_DEFAULT',
      enforcement: 'hard',
      layers: [],
    };
  }

  for (const layer of layers) {
    const errors = validateConstraints(layer.value, layer.source);
    if (errors.length) throw new TypeError(errors.join('; '));
    for (const field of Object.keys(layer.value).sort()) {
      const candidate = layer.value[field];
      const decision = policyDecision(values[field], field, candidate);
      values[field] = decision.value;
      const trace = {
        source: layer.source,
        candidate,
        applied: decision.applied,
        reasonCode: decision.reasonCode,
      };
      provenance[field].layers.push(trace);
      if (decision.applied) {
        provenance[field].source = layer.source;
        provenance[field].reasonCode = decision.reasonCode;
      }
      provenance[field].value = values[field];
    }
  }

  return deepFreeze({
    contractVersion: OPERATING_POLICY_VERSION,
    values,
    provenance,
    digest: sha256Digest({ contractVersion: OPERATING_POLICY_VERSION, values, provenance }),
  });
}

function failClosedBundles(raw, reasonCode) {
  const requested = Array.isArray(raw?.activation?.bundles)
    ? raw.activation.bundles.filter((value) => typeof value === 'string')
    : ['core'];
  const nonCore = requested.filter((id) => id !== 'core').sort();
  return {
    requested,
    dependencyClosed: ['core'],
    effective: ['core'],
    degraded: [],
    unavailable: nonCore.map((id) => ({
      id,
      status: 'unavailable',
      reasonCode,
    })),
  };
}

function activationSettings(input, authorityValid) {
  if (!authorityValid) {
    return {
      onDemand: 'deny',
      allowDegradedRuntime: false,
    };
  }
  if (input.kind === 'legacy') {
    return {
      onDemand: 'prompt',
      allowDegradedRuntime: true,
    };
  }
  return {
    onDemand: input.config.activation.onDemand,
    allowDegradedRuntime: input.config.activation.allowDegradedRuntime,
  };
}

function profileIdentity(profile, input, authorityValid) {
  if (!authorityValid) {
    return {
      id: profile.id,
      version: profile.version,
      digest: profile.digest,
      source: 'fail-closed',
      base: null,
    };
  }
  const operating = input.kind === 'v2'
    && plain(input.config?.policy)
    && plain(input.config.policy.operating)
    && Object.keys(input.config.policy.operating).length
    ? input.config.policy.operating
    : null;
  if (!operating) {
    return {
      id: profile.id,
      version: profile.version,
      digest: profile.digest,
      source: input.kind === 'legacy' ? 'legacy-compatibility' : 'harness-config',
      base: null,
    };
  }
  const digest = sha256Digest({
    contractVersion: OPERATING_POLICY_VERSION,
    baseProfile: {
      id: profile.id,
      version: profile.version,
      digest: profile.digest,
    },
    operating,
  });
  return {
    id: `custom:${digest}`,
    version: profile.version,
    digest,
    source: 'repository-policy',
    base: {
      id: profile.id,
      version: profile.version,
      digest: profile.digest,
    },
  };
}

function resolvedInput(raw, options) {
  const kind = configKind(raw);
  if (options.parseError) {
    return { kind: 'invalid', config: null, errors: [`Invalid JSON: ${options.parseError}`] };
  }
  if (kind === 'new') {
    return { kind, config: createDefaultConfig(), errors: [] };
  }
  if (kind === 'legacy') {
    return {
      kind,
      config: raw,
      errors: [],
      profile: getProfile('legacy@1.0.0', { allowLegacy: true }),
      requested: ['core', 'persistence', 'parallel', 'operations', 'delivery'],
      allowDegradedRuntime: true,
    };
  }
  if (kind === 'v2') {
    return { kind, config: raw, errors: validateConfigV2(raw) };
  }
  if (kind === 'future') {
    return {
      kind,
      config: raw,
      errors: [`Unsupported future schemaVersion: ${raw.schemaVersion}`],
    };
  }
  return { kind, config: raw, errors: [`Unsupported harness config kind: ${kind}`] };
}

function resolveConfig(raw, options = {}) {
  const input = resolvedInput(raw, options);
  const runtime = normalizeRuntime(options.runtime);
  const installation = options.installationGeneration || installationGeneration({
    installationRoot: options.installationRoot,
  });
  const sourceValue = raw === undefined ? null : raw;
  const sourceDigest = typeof options.sourceDigest === 'string'
    ? options.sourceDigest
    : sha256Digest(sourceValue);
  const reconciledAt = options.reconciledAt || null;
  const blockedConfig = input.errors.length > 0;
  let authorityValid = !blockedConfig;
  let authorityReasonCode = blockedConfig ? 'CONFIG_FAIL_CLOSED' : 'CONFIG_VALID';
  let profile;
  let bundles;
  let policy;
  const errors = [...input.errors];

  if (blockedConfig) {
    profile = getProfile('strict-supervised@1.0.0');
    bundles = failClosedBundles(raw, 'CONFIG_FAIL_CLOSED');
    policy = resolvePolicy(profile);
  } else {
    profile = input.profile || getProfile(input.config.execution.profile);
    const requested = input.requested || input.config.activation.bundles;
    bundles = negotiateBundles(requested, runtime, {
      allowDegradedRuntime: input.allowDegradedRuntime
        ?? input.config.activation.allowDegradedRuntime,
    });
    try {
      policy = resolvePolicy(profile, constraintLayers(input.config, options));
    } catch (error) {
      errors.push(error.message);
      authorityValid = false;
      authorityReasonCode = 'POLICY_FAIL_CLOSED';
      profile = getProfile('strict-supervised@1.0.0');
      policy = resolvePolicy(profile);
      bundles = failClosedBundles(raw, 'POLICY_FAIL_CLOSED');
    }
  }

  for (const entry of bundles.unavailable) {
    errors.push(`${entry.id}:${entry.reasonCode}`);
  }
  const status = errors.length ? 'blocked' : bundles.degraded.length ? 'degraded' : 'ready';
  const body = {
    contractVersion: 1,
    receiptKind: 'citadel.effective-config',
    package: {
      name: packageMetadata.name,
      version: packageMetadata.version,
    },
    status,
    configKind: input.kind,
    schemaVersion: input.kind === 'legacy' ? null : input.config?.schemaVersion ?? null,
    sourceDigest,
    installationGeneration: installation,
    authority: {
      valid: authorityValid,
      reasonCode: authorityReasonCode,
    },
    activation: activationSettings(input, authorityValid),
    profile: profileIdentity(profile, input, authorityValid),
    bundles,
    runtime,
    policy,
    invariants: profile.invariants,
    errors: [...new Set(errors)].sort(),
    reconciledAt,
  };
  return deepFreeze({ ...body, receiptDigest: sha256Digest(body) });
}

module.exports = Object.freeze({
  normalizeRuntime,
  resolveConfig,
  resolvePolicy,
});

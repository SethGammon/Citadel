'use strict';

const fs = require('fs');
const path = require('path');
const { sha256Digest } = require('../operations/canonical');
const {
  BUNDLE_IDS,
  ON_DEMAND_MODES,
  deepFreeze,
  plain,
} = require('./contract');
const { dependencyClosure } = require('./bundle-catalog');
const { getProfile } = require('./profiles');
const { resolveConfig } = require('./resolve');
const { readConfigFile } = require('./source');
const {
  installationGeneration,
  runtimeIdentity,
} = require('./identity');
const { detectRuntimeContract } = require('./runtime');

const EFFECTIVE_RECEIPT_VERSION = 1;
const EFFECTIVE_RECEIPT_KIND = 'citadel.effective-config';
const EFFECTIVE_FIELDS = Object.freeze([
  'contractVersion',
  'receiptKind',
  'package',
  'status',
  'configKind',
  'schemaVersion',
  'sourceDigest',
  'installationGeneration',
  'authority',
  'activation',
  'profile',
  'bundles',
  'runtime',
  'policy',
  'invariants',
  'errors',
  'reconciledAt',
  'receiptDigest',
]);

const EFFECTIVE_RECEIPT_REASONS = Object.freeze({
  CURRENT: 'EFFECTIVE_CONFIG_CURRENT',
  MISSING: 'EFFECTIVE_CONFIG_MISSING',
  MALFORMED: 'EFFECTIVE_CONFIG_MALFORMED',
  FUTURE: 'EFFECTIVE_CONFIG_FUTURE',
  STALE: 'EFFECTIVE_CONFIG_STALE',
});

function digest(value) {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

function validateBundleArray(value, label, errors, allowUnknown = false) {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`);
    return;
  }
  if (value.some((id) => typeof id !== 'string')) {
    errors.push(`${label} must contain strings`);
  }
  if (!allowUnknown && value.some((id) => !BUNDLE_IDS.includes(id))) {
    errors.push(`${label} contains an unknown bundle`);
  }
  if (new Set(value).size !== value.length) errors.push(`${label} must be unique`);
}

function validateProfile(profile, authorityValid, errors) {
  if (!plain(profile) || typeof profile.id !== 'string'
    || typeof profile.version !== 'string' || !digest(profile.digest)
    || typeof profile.source !== 'string'
    || (profile.base !== null && !plain(profile.base))) {
    errors.push('profile is invalid');
    return;
  }
  if (!authorityValid && profile.id !== 'strict-supervised') {
    errors.push('fail-closed authority must use strict-supervised');
  }
  if (profile.id.startsWith('custom:')) {
    if (profile.id !== `custom:${profile.digest}` || !plain(profile.base)
      || typeof profile.base.id !== 'string' || typeof profile.base.version !== 'string'
      || !digest(profile.base.digest)) {
      errors.push('custom profile identity is invalid');
    } else {
      try {
        const baseProfile = getProfile(
          { id: profile.base.id, version: profile.base.version },
          { allowLegacy: true },
        );
        if (baseProfile.digest !== profile.base.digest) {
          errors.push('custom profile base digest does not match the released catalog');
        }
      } catch (error) {
        errors.push(error.message);
      }
    }
    return;
  }
  try {
    const catalogProfile = getProfile(
      { id: profile.id, version: profile.version },
      { allowLegacy: true },
    );
    if (catalogProfile.digest !== profile.digest) {
      errors.push('profile digest does not match the released catalog');
    }
  } catch (error) {
    errors.push(error.message);
  }
}

function validateBundleResolution(bundles, authorityValid, errors) {
  const initialErrorCount = errors.length;
  if (!plain(bundles)) {
    errors.push('bundles is invalid');
    return;
  }
  validateBundleArray(
    bundles.requested,
    'bundles.requested',
    errors,
    !authorityValid,
  );
  validateBundleArray(bundles.dependencyClosed, 'bundles.dependencyClosed', errors);
  validateBundleArray(bundles.effective, 'bundles.effective', errors);
  if (!Array.isArray(bundles.degraded)) errors.push('bundles.degraded must be an array');
  if (!Array.isArray(bundles.unavailable)) {
    errors.push('bundles.unavailable must be an array');
  }
  if (errors.length > initialErrorCount) return;
  if (authorityValid) {
    const expectedClosure = dependencyClosure(bundles.requested);
    if (JSON.stringify(expectedClosure) !== JSON.stringify(bundles.dependencyClosed)) {
      errors.push('bundles.dependencyClosed does not match requested dependencies');
    }
  } else if (JSON.stringify(bundles.effective) !== JSON.stringify(['core'])
    || JSON.stringify(bundles.dependencyClosed) !== JSON.stringify(['core'])) {
    errors.push('fail-closed bundles must keep only core effective');
  }
  const closed = new Set(bundles.dependencyClosed);
  const effective = new Set(bundles.effective);
  if (!effective.has('core')) errors.push('bundles.effective must include core');
  if ([...effective].some((id) => !closed.has(id))) {
    errors.push('bundles.effective must be a subset of dependencyClosed');
  }
  for (const entry of bundles.degraded) {
    if (!plain(entry) || typeof entry.id !== 'string'
      || typeof entry.reasonCode !== 'string' || !effective.has(entry.id)) {
      errors.push('bundles.degraded entry is invalid');
    }
  }
  for (const entry of bundles.unavailable) {
    if (!plain(entry) || typeof entry.id !== 'string'
      || typeof entry.reasonCode !== 'string' || effective.has(entry.id)) {
      errors.push('bundles.unavailable entry is invalid');
    }
  }
}

function validPolicyDigest(policy) {
  if (!digest(policy.digest)) return false;
  try {
    return sha256Digest({
      contractVersion: policy.contractVersion,
      values: policy.values,
      provenance: policy.provenance,
    }) === policy.digest;
  } catch {
    return false;
  }
}

function isoTimestamp(value) {
  if (typeof value !== 'string') return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function validateEffectiveReceipt(value) {
  const errors = [];
  if (!plain(value)) {
    return {
      valid: false,
      reasonCode: EFFECTIVE_RECEIPT_REASONS.MALFORMED,
      errors: ['effective config must be a plain object'],
    };
  }
  if (Number.isInteger(value.contractVersion)
    && value.contractVersion > EFFECTIVE_RECEIPT_VERSION) {
    return {
      valid: false,
      reasonCode: EFFECTIVE_RECEIPT_REASONS.FUTURE,
      errors: [`unsupported effective config contractVersion: ${value.contractVersion}`],
    };
  }
  const unknown = Object.keys(value).filter((field) => !EFFECTIVE_FIELDS.includes(field));
  const missing = EFFECTIVE_FIELDS.filter((field) => !(field in value));
  if (unknown.length) errors.push(`effective config has unknown fields: ${unknown.join(', ')}`);
  if (missing.length) errors.push(`effective config is missing fields: ${missing.join(', ')}`);
  if (value.contractVersion !== EFFECTIVE_RECEIPT_VERSION) {
    errors.push(`contractVersion must be ${EFFECTIVE_RECEIPT_VERSION}`);
  }
  if (value.receiptKind !== EFFECTIVE_RECEIPT_KIND) {
    errors.push(`receiptKind must be ${EFFECTIVE_RECEIPT_KIND}`);
  }
  if (!['ready', 'degraded', 'blocked'].includes(value.status)) {
    errors.push('status is invalid');
  }
  if (!digest(value.sourceDigest)) errors.push('sourceDigest is invalid');
  if (!digest(value.receiptDigest)) errors.push('receiptDigest is invalid');
  const authorityValid = plain(value.authority) && value.authority.valid === true;
  if (!plain(value.authority) || typeof value.authority.valid !== 'boolean'
    || typeof value.authority.reasonCode !== 'string') {
    errors.push('authority is invalid');
  }
  if (!plain(value.activation)
    || !ON_DEMAND_MODES.includes(value.activation.onDemand)
    || typeof value.activation.allowDegradedRuntime !== 'boolean') {
    errors.push('activation is invalid');
  }
  validateProfile(value.profile, authorityValid, errors);
  validateBundleResolution(value.bundles, authorityValid, errors);
  if (!plain(value.installationGeneration)
    || !digest(value.installationGeneration.id)
    || typeof value.installationGeneration.version !== 'string'
    || !digest(value.installationGeneration.sourceDigest)) {
    errors.push('installationGeneration is invalid');
  }
  if (!plain(value.runtime) || typeof value.runtime.id !== 'string'
    || !digest(value.runtime.contractDigest)) {
    errors.push('runtime is invalid');
  }
  if (!plain(value.package) || typeof value.package.name !== 'string'
    || typeof value.package.version !== 'string') {
    errors.push('package is invalid');
  }
  if (!plain(value.policy) || !plain(value.invariants)) {
    errors.push('policy and invariants must be plain objects');
  } else if (!validPolicyDigest(value.policy)) {
    errors.push('policy digest is invalid');
  }
  if (!Array.isArray(value.errors)
    || value.errors.some((entry) => typeof entry !== 'string')) {
    errors.push('errors must be an array of strings');
  }
  if (value.reconciledAt !== null && !isoTimestamp(value.reconciledAt)) {
    errors.push('reconciledAt must be a string or null');
  }
  if (digest(value.receiptDigest)) {
    const { receiptDigest, ...body } = value;
    try {
      if (sha256Digest(body) !== receiptDigest) {
        errors.push('receiptDigest does not match the effective config body');
      }
    } catch (error) {
      errors.push(`effective config is not canonical JSON: ${error.message}`);
    }
  }
  return {
    valid: errors.length === 0,
    reasonCode: errors.length
      ? EFFECTIVE_RECEIPT_REASONS.MALFORMED
      : EFFECTIVE_RECEIPT_REASONS.CURRENT,
    errors,
  };
}

function effectiveConfigPath(projectRoot, options = {}) {
  const root = path.resolve(projectRoot || process.cwd());
  return options.effectiveConfigPath
    ? path.resolve(root, options.effectiveConfigPath)
    : path.join(root, '.citadel', 'effective-config.json');
}

function regenerationCommand(options = {}, fallbackRuntime = null) {
  const candidate = options.runtime?.id || options.runtimeId || fallbackRuntime;
  const runtime = typeof candidate === 'string' && /^[a-z0-9-]+$/i.test(candidate)
    ? ' --runtime ' + candidate
    : '';
  return 'node .citadel/scripts/citadel-config.js reconcile --apply'
    + runtime + ' --json';
}

function rejectedRead(source, receiptPath, status, reasonCode, errors, options = {}, fallbackRuntime = null) {
  return deepFreeze({
    status,
    usable: false,
    reasonCode,
    errors,
    sourceDigest: source.sourceDigest,
    receiptPath,
    repairCommand: regenerationCommand(options, fallbackRuntime),
    receipt: null,
  });
}

function readEffectiveConfig(projectRoot, options = {}) {
  const source = readConfigFile(projectRoot, options);
  const activeRuntime = options.runtime && typeof options.runtime === 'object'
    ? options.runtime
    : detectRuntimeContract(source.projectRoot, options);
  const receiptPath = effectiveConfigPath(source.projectRoot, options);
  if (!fs.existsSync(receiptPath)) {
    return rejectedRead(
      source,
      receiptPath,
      'missing',
      EFFECTIVE_RECEIPT_REASONS.MISSING,
      ['effective config has not been reconciled'],
      options,
    );
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  } catch (error) {
    return rejectedRead(
      source,
      receiptPath,
      'malformed',
      EFFECTIVE_RECEIPT_REASONS.MALFORMED,
      [error.message],
      options,
    );
  }
  const validation = validateEffectiveReceipt(raw);
  if (!validation.valid) {
    const status = validation.reasonCode === EFFECTIVE_RECEIPT_REASONS.FUTURE
      ? 'future'
      : 'malformed';
    return rejectedRead(
      source,
      receiptPath,
      status,
      validation.reasonCode,
      validation.errors,
      options,
      raw?.runtime?.id,
    );
  }
  if (raw.sourceDigest !== source.sourceDigest) {
    return rejectedRead(
      source,
      receiptPath,
      'stale',
      EFFECTIVE_RECEIPT_REASONS.STALE,
      [
        'effective config sourceDigest does not match the current harness config',
        'Regenerate with: ' + regenerationCommand(options, raw.runtime?.id),
      ],
      options,
      raw.runtime?.id,
    );
  }
  const expectedInstallation = installationGeneration({
    installationRoot: options.installationRoot,
  });
  if (raw.installationGeneration.id !== expectedInstallation.id
    || raw.installationGeneration.sourceDigest !== expectedInstallation.sourceDigest) {
    return rejectedRead(
      source,
      receiptPath,
      'stale',
      EFFECTIVE_RECEIPT_REASONS.STALE,
      [
        'effective config installationGeneration does not match the current Citadel installation',
        'Regenerate with: ' + regenerationCommand(options, raw.runtime?.id),
      ],
      options,
      raw.runtime?.id,
    );
  }
  const activeRuntimeIdentity = runtimeIdentity(activeRuntime);
  if (raw.runtime.id !== activeRuntimeIdentity.id
    || raw.runtime.contractDigest !== activeRuntimeIdentity.contractDigest) {
    return rejectedRead(
      source,
      receiptPath,
      'stale',
      EFFECTIVE_RECEIPT_REASONS.STALE,
      [
        'effective config runtime ' + raw.runtime.id
          + ' does not match active runtime ' + activeRuntimeIdentity.id,
        'Regenerate with: ' + regenerationCommand(options, activeRuntimeIdentity.id),
      ],
      options,
      activeRuntimeIdentity.id,
    );
  }
  return deepFreeze({
    status: 'current',
    usable: true,
    reasonCode: EFFECTIVE_RECEIPT_REASONS.CURRENT,
    errors: [],
    sourceDigest: source.sourceDigest,
    receiptPath,
    repairCommand: null,
    receipt: raw,
  });
}

function atomicWriteEffectiveConfig(receiptPath, receipt) {
  const directory = path.dirname(receiptPath);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `.${path.basename(receiptPath)}.${process.pid}.${Date.now()}.tmp`,
  );
  fs.writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  try {
    fs.renameSync(temporary, receiptPath);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch { /* best effort */ }
    throw error;
  }
}

function reconcileEffectiveConfig(projectRoot, options = {}) {
  const source = readConfigFile(projectRoot, options);
  const receiptPath = effectiveConfigPath(source.projectRoot, options);
  const runtime = options.runtime || require('./runtime').detectRuntimeContract(
    source.projectRoot,
    options,
  );
  const receipt = resolveConfig(source.raw, {
    ...options,
    runtime,
    parseError: source.parseError,
    sourceDigest: source.sourceDigest,
    reconciledAt: options.reconciledAt === undefined
      ? new Date().toISOString()
      : options.reconciledAt,
  });
  const validation = validateEffectiveReceipt(receipt);
  if (!validation.valid) {
    throw new Error(`Refusing to write invalid effective config: ${validation.errors.join('; ')}`);
  }
  atomicWriteEffectiveConfig(receiptPath, receipt);
  const observed = readEffectiveConfig(source.projectRoot, { ...options, runtime });
  if (!observed.usable || observed.receipt.receiptDigest !== receipt.receiptDigest) {
    throw new Error(
      `Effective config reconciliation failed: ${observed.reasonCode}`,
    );
  }
  return observed;
}

module.exports = Object.freeze({
  EFFECTIVE_RECEIPT_KIND,
  EFFECTIVE_RECEIPT_REASONS,
  EFFECTIVE_RECEIPT_VERSION,
  atomicWriteEffectiveConfig,
  effectiveConfigPath,
  readEffectiveConfig,
  reconcileEffectiveConfig,
  validateEffectiveReceipt,
});

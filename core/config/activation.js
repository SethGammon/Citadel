'use strict';

const {
  BUNDLE_CATALOG,
  bundleForTarget,
  dependencyClosure,
  negotiateBundles,
} = require('./bundle-catalog');
const { deepFreeze, plain } = require('./contract');
const {
  EFFECTIVE_RECEIPT_REASONS,
  validateEffectiveReceipt,
} = require('./receipt');

const ACTIVATION_STATUSES = Object.freeze([
  'enabled',
  'degraded',
  'disabled',
  'unavailable',
  'blocked',
]);

const ACTIVATION_REASON_CODES = Object.freeze({
  ENABLED: 'ACTIVATION_BUNDLE_ENABLED',
  DEGRADED: 'ACTIVATION_BUNDLE_DEGRADED',
  PROMPT_REQUIRED: 'ACTIVATION_PROMPT_REQUIRED',
  DENIED: 'ACTIVATION_ON_DEMAND_DENIED',
  AUTO_SAFE_PLAN_REQUIRED: 'ACTIVATION_AUTO_SAFE_PLAN_REQUIRED',
  AUTO_SAFE_NOT_ELIGIBLE: 'ACTIVATION_AUTO_SAFE_NOT_ELIGIBLE',
  UNAVAILABLE: 'ACTIVATION_BUNDLE_UNAVAILABLE',
  AUTHORITY_BLOCKED: 'ACTIVATION_AUTHORITY_BLOCKED',
  CORE_SAFETY_FAIL_CLOSED: 'ACTIVATION_CORE_SAFETY_FAIL_CLOSED',
  OWNERSHIP_UNKNOWN: 'ACTIVATION_OWNERSHIP_UNKNOWN',
});

function receiptInput(value) {
  if (plain(value) && typeof value.usable === 'boolean') {
    if (!value.usable) {
      return {
        usable: false,
        reasonCode: value.reasonCode || EFFECTIVE_RECEIPT_REASONS.MALFORMED,
        errors: Array.isArray(value.errors) ? value.errors : [],
        receipt: null,
      };
    }
    return { usable: true, receipt: value.receipt, errors: [] };
  }
  const validation = validateEffectiveReceipt(value);
  if (!validation.valid) {
    return {
      usable: false,
      reasonCode: validation.reasonCode,
      errors: validation.errors,
      receipt: null,
    };
  }
  return { usable: true, receipt: value, errors: [] };
}

function resourceChanges(bundleIds) {
  return bundleIds.map((bundleId) => {
    const bundle = BUNDLE_CATALOG[bundleId];
    return {
      bundleId,
      skills: [...bundle.owns.skills],
      hooks: [...bundle.owns.hooks],
      state: [...bundle.owns.state],
    };
  });
}

function createActivationPlan(receipt, bundleId) {
  const closure = dependencyClosure([bundleId]);
  const requested = new Set(receipt.bundles.requested);
  const addedBundles = closure.filter((id) => !requested.has(id));
  const autoSafeEligible = addedBundles.length > 0
    && addedBundles.every((id) => {
      const bundle = BUNDLE_CATALOG[id];
      return bundle.stage === 'stable'
        && bundle.autoSafe === true
        && bundle.reversibleActivation === true;
    });
  const configuredAllowDegraded = receipt.activation.allowDegradedRuntime === true;
  let prospective = negotiateBundles(closure, receipt.runtime, {
    allowDegradedRuntime: configuredAllowDegraded,
  });
  let degradedRuntimeOptInRequired = false;
  if (!configuredAllowDegraded
    && prospective.unavailable.some((entry) => (
      entry.reasonCode === 'DEGRADED_RUNTIME_REQUIRES_OPT_IN'
    ))) {
    const adapterAware = negotiateBundles(closure, receipt.runtime, {
      allowDegradedRuntime: true,
    });
    if (adapterAware.effective.includes(bundleId)) {
      prospective = adapterAware;
      degradedRuntimeOptInRequired = true;
    }
  }
  const runtimeId = receipt.runtime && /^[a-z0-9-]+$/i.test(receipt.runtime.id)
    ? receipt.runtime.id
    : 'unknown';
  const commandOptions = `--runtime ${runtimeId}`
    + (degradedRuntimeOptInRequired ? ' --allow-degraded-runtime' : '');
  const configCommand = 'node .citadel/scripts/citadel-config.js';
  return deepFreeze({
    contractVersion: 1,
    action: 'enable-bundle',
    bundleId,
    dependencyClosure: closure,
    addedBundles,
    resources: resourceChanges(addedBundles),
    onDemand: receipt.activation.onDemand,
    autoSafeEligible,
    degradedRuntimeOptInRequired,
    requiresExplicitApply: true,
    mutatesConfig: false,
    previewCommand: `${configCommand} enable ${bundleId} ${commandOptions} --json`,
    applyCommand: `${configCommand} enable ${bundleId} ${commandOptions} --apply --json`,
    prospective,
  });
}

function blockedDecision(target, bundleId, reasonCode, errors, plan = null) {
  return deepFreeze({
    contractVersion: 1,
    target,
    bundleId,
    status: 'blocked',
    reasonCode,
    causeReasonCode: null,
    errors,
    plan,
  });
}

function activationDecision(effective, target) {
  if (!plain(target) || !['skill', 'route', 'hook'].includes(target.kind)
    || typeof target.id !== 'string' || !target.id.trim()) {
    throw new TypeError('Activation target requires kind skill|route|hook and a non-empty id');
  }
  const normalizedTarget = { kind: target.kind, id: target.id.trim() };
  const bundleId = bundleForTarget(normalizedTarget.kind, normalizedTarget.id);
  if (!bundleId) {
    return blockedDecision(
      normalizedTarget,
      null,
      ACTIVATION_REASON_CODES.OWNERSHIP_UNKNOWN,
      [`No bundle owns ${normalizedTarget.kind}:${normalizedTarget.id}`],
    );
  }
  const input = receiptInput(effective);
  if (!input.usable) {
    return blockedDecision(
      normalizedTarget,
      bundleId,
      input.reasonCode,
      input.errors,
      deepFreeze({
        contractVersion: 1,
        action: 'reconcile-effective-config',
        requiresExplicitApply: true,
        mutatesConfig: false,
        applyCommand: 'node .citadel/scripts/citadel-config.js reconcile --apply --json',
      }),
    );
  }
  const receipt = input.receipt;
  if (receipt.authority.valid === false) {
    if (normalizedTarget.kind === 'hook'
      && bundleId === 'core'
      && receipt.bundles.effective.includes('core')) {
      return deepFreeze({
        contractVersion: 1,
        target: normalizedTarget,
        bundleId,
        status: 'enabled',
        reasonCode: ACTIVATION_REASON_CODES.CORE_SAFETY_FAIL_CLOSED,
        causeReasonCode: receipt.authority.reasonCode,
        errors: [...receipt.errors],
        plan: null,
      });
    }
    return blockedDecision(
      normalizedTarget,
      bundleId,
      ACTIVATION_REASON_CODES.AUTHORITY_BLOCKED,
      [...receipt.errors],
      deepFreeze({
        contractVersion: 1,
        action: 'repair-harness-config',
        reasonCode: receipt.authority.reasonCode,
        requiresExplicitApply: true,
        mutatesConfig: false,
      }),
    );
  }

  const degraded = receipt.bundles.degraded.find((entry) => entry.id === bundleId);
  if (degraded && receipt.bundles.effective.includes(bundleId)) {
    return deepFreeze({
      contractVersion: 1,
      target: normalizedTarget,
      bundleId,
      status: 'degraded',
      reasonCode: ACTIVATION_REASON_CODES.DEGRADED,
      causeReasonCode: degraded.reasonCode,
      errors: [],
      plan: null,
      degradation: degraded,
    });
  }
  if (receipt.bundles.effective.includes(bundleId)) {
    return deepFreeze({
      contractVersion: 1,
      target: normalizedTarget,
      bundleId,
      status: 'enabled',
      reasonCode: ACTIVATION_REASON_CODES.ENABLED,
      causeReasonCode: null,
      errors: [],
      plan: null,
    });
  }

  const plan = createActivationPlan(receipt, bundleId);
  const unavailable = receipt.bundles.unavailable.find((entry) => entry.id === bundleId)
    || plan.prospective.unavailable.find((entry) => entry.id === bundleId);
  if (unavailable) {
    return deepFreeze({
      contractVersion: 1,
      target: normalizedTarget,
      bundleId,
      status: 'unavailable',
      reasonCode: ACTIVATION_REASON_CODES.UNAVAILABLE,
      causeReasonCode: unavailable.reasonCode,
      errors: [],
      plan,
      unavailable,
    });
  }

  if (receipt.activation.onDemand === 'deny') {
    return deepFreeze({
      contractVersion: 1,
      target: normalizedTarget,
      bundleId,
      status: 'disabled',
      reasonCode: ACTIVATION_REASON_CODES.DENIED,
      causeReasonCode: null,
      errors: [],
      plan,
    });
  }
  if (receipt.activation.onDemand === 'auto-safe') {
    if (!plan.autoSafeEligible) {
      return blockedDecision(
        normalizedTarget,
        bundleId,
        ACTIVATION_REASON_CODES.AUTO_SAFE_NOT_ELIGIBLE,
        [`${bundleId} is not declared safe for automatic activation planning`],
        plan,
      );
    }
    return deepFreeze({
      contractVersion: 1,
      target: normalizedTarget,
      bundleId,
      status: 'disabled',
      reasonCode: ACTIVATION_REASON_CODES.AUTO_SAFE_PLAN_REQUIRED,
      causeReasonCode: null,
      errors: [],
      plan,
    });
  }
  return deepFreeze({
    contractVersion: 1,
    target: normalizedTarget,
    bundleId,
    status: 'disabled',
    reasonCode: ACTIVATION_REASON_CODES.PROMPT_REQUIRED,
    causeReasonCode: null,
    errors: [],
    plan,
  });
}

function preflightSkill(effective, skillId) {
  return activationDecision(effective, { kind: 'skill', id: skillId });
}

function preflightRoute(effective, skillId) {
  return activationDecision(effective, { kind: 'route', id: skillId });
}

function preflightHook(effective, hookId) {
  return activationDecision(effective, { kind: 'hook', id: hookId });
}

module.exports = Object.freeze({
  ACTIVATION_REASON_CODES,
  ACTIVATION_STATUSES,
  activationDecision,
  createActivationPlan,
  preflightHook,
  preflightRoute,
  preflightSkill,
});

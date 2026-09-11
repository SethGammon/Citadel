'use strict';

const contract = require('./contract');
const profiles = require('./profiles');
const bundles = require('./bundle-catalog');
const migrate = require('./migrate');
const validation = require('./validate');
const resolution = require('./resolve');
const source = require('./source');
const receipts = require('./receipt');
const activation = require('./activation');
const runtimes = require('./runtime');

function loadResolvedConfig(projectRoot, options = {}) {
  const runtime = options.runtime || runtimes.detectRuntimeContract(projectRoot, options);
  const loaded = source.readConfigFile(projectRoot, options);
  return Object.freeze({
    loaded,
    receipt: resolution.resolveConfig(loaded.raw, {
      ...options,
      runtime,
      parseError: loaded.parseError,
      sourceDigest: loaded.sourceDigest,
    }),
  });
}

function loadActivationContext(projectRoot, options = {}) {
  const runtime = options.runtime || runtimes.detectRuntimeContract(projectRoot, options);
  const effective = receipts.readEffectiveConfig(projectRoot, { ...options, runtime });
  if (effective.usable || effective.reasonCode !== receipts.EFFECTIVE_RECEIPT_REASONS.MISSING
    || options.allowBootstrap === false) {
    return effective;
  }
  const resolved = loadResolvedConfig(projectRoot, { ...options, runtime });
  return Object.freeze({
    status: 'bootstrap',
    usable: true,
    reasonCode: 'EFFECTIVE_CONFIG_BOOTSTRAP',
    errors: [],
    sourceDigest: resolved.loaded.sourceDigest,
    receiptPath: receipts.effectiveConfigPath(projectRoot, options),
    receipt: resolved.receipt,
    persisted: false,
  });
}

module.exports = Object.freeze({
  ...contract,
  ...profiles,
  ...bundles,
  ...migrate,
  ...validation,
  ...resolution,
  ...source,
  ...receipts,
  ...activation,
  ...runtimes,
  loadActivationContext,
  loadResolvedConfig,
});

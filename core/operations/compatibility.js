'use strict';

const { PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } = require('./constants');
const { canonicalSerialize } = require('./canonical');
const { assertValidOperationContract } = require('./validation');

function assertSupportedProtocolVersion(version) {
  if (!SUPPORTED_PROTOCOL_VERSIONS.includes(version)) {
    throw new RangeError(`Unsupported operations protocol version: ${version || '(missing)'}`);
  }
  return version;
}

function migrateOperationContract(value, targetVersion = PROTOCOL_VERSION) {
  assertSupportedProtocolVersion(targetVersion);
  assertSupportedProtocolVersion(value?.protocol_version);
  if (value.protocol_version !== targetVersion) {
    throw new RangeError(`No explicit operation migration exists from ${value.protocol_version} to ${targetVersion}`);
  }
  assertValidOperationContract(value);
  return JSON.parse(canonicalSerialize(value));
}

module.exports = Object.freeze({ assertSupportedProtocolVersion, migrateOperationContract });

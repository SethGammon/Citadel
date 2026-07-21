'use strict';

module.exports = Object.freeze({
  ...require('../../core/contracts'),
  app: require('./app'),
  operations: require('../../core/operations'),
  schemaVersion: require('../../core/telemetry/schema').SCHEMA_VERSION,
});

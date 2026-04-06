'use strict';

const telemetrySchema = require('../../core/telemetry/schema');
const normalizeEvent = require('../../core/hooks/normalize-event');

function createLocalSink(send) {
  if (typeof send !== 'function') {
    throw new TypeError('createLocalSink requires a send function');
  }

  return Object.freeze({
    send(event) {
      return send(event);
    },
  });
}

function createCloudSink(send) {
  if (typeof send !== 'function') {
    throw new TypeError('createCloudSink requires a send function');
  }

  return Object.freeze({
    send(event) {
      return send(event);
    },
  });
}

module.exports = Object.freeze({
  telemetrySchema,
  normalizeEvent,
  createLocalSink,
  createCloudSink,
});

'use strict';

const {
  STALE_INSTANCE_MS,
  isProcessAlive,
  removeFileIfExists,
} = require('./io');
const { listInstances } = require('./instances');
const { releaseClaim } = require('./claims');

function sweepStaleInstances(options = {}) {
  const nowMs = options.nowMs || Date.now();
  const swept = [];

  for (const instance of listInstances(options)) {
    const lastSeenMs = new Date(instance.data.lastSeen).getTime();
    const stale = Number.isFinite(lastSeenMs) && (nowMs - lastSeenMs) > STALE_INSTANCE_MS;
    const dead = instance.data.pid && !isProcessAlive(instance.data.pid);

    if (!stale && !dead) continue;

    // Preserve the instance on CLAIM_BUSY so the next sweep can retry.
    releaseClaim(instance.data.instanceId, options);
    removeFileIfExists(instance.path);

    swept.push({
      instanceId: instance.data.instanceId,
      reason: dead ? 'dead process' : 'stale',
    });
  }

  return {
    cleaned: swept.length,
    swept,
  };
}

module.exports = {
  sweepStaleInstances,
};

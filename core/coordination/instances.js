'use strict';

const path = require('path');
const {
  ensureDir,
  getCoordinationPaths,
  listJsonFiles,
  readJson,
  removeFileIfExists,
  writeJsonAtomic,
} = require('./io');
const { releaseClaim } = require('./claims');

function getInstanceFile(id, options = {}) {
  const paths = getCoordinationPaths(options.projectRoot);
  return path.join(paths.instancesDir, `${id}.json`);
}

function createInstanceRecord(id, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  return {
    instanceId: id,
    startedAt: now.toISOString(),
    lastSeen: now.toISOString(),
    status: 'active',
    pid: options.pid || process.ppid || process.pid,
    campaignSlug: options.campaignSlug || null,
  };
}

function registerInstance(id, options = {}) {
  const paths = getCoordinationPaths(options.projectRoot);
  ensureDir(paths.instancesDir);
  const data = createInstanceRecord(id, options);
  writeJsonAtomic(getInstanceFile(id, options), data);
  return data;
}

function unregisterInstance(id, options = {}) {
  // Never remove an instance's claim outside the cross-process transaction.
  // On CLAIM_BUSY, keep the instance record for a later retry.
  releaseClaim(id, options);
  removeFileIfExists(getInstanceFile(id, options));
}

function heartbeatInstance(id, options = {}) {
  const file = getInstanceFile(id, options);
  const data = readJson(file);

  if (!data) {
    const error = new Error(`Instance not found: ${id}`);
    error.code = 'INSTANCE_NOT_FOUND';
    throw error;
  }

  const now = options.now ? new Date(options.now) : new Date();
  data.lastSeen = now.toISOString();
  writeJsonAtomic(file, data);
  return data;
}

function listInstances(options = {}) {
  const paths = getCoordinationPaths(options.projectRoot);
  return listJsonFiles(paths.instancesDir);
}

function getCoordinationStatus(options = {}) {
  return {
    instances: listInstances(options).map(entry => entry.data),
  };
}

module.exports = {
  createInstanceRecord,
  getCoordinationStatus,
  heartbeatInstance,
  listInstances,
  registerInstance,
  unregisterInstance,
};

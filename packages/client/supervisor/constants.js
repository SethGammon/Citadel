'use strict';

const SUPERVISOR_API_VERSION = 1;
const SUPPORTED_SUPERVISOR_API_VERSIONS = Object.freeze([SUPERVISOR_API_VERSION]);
const MAX_SUPERVISOR_PAYLOAD_BYTES = 64 * 1024;
const MAX_SUPERVISOR_PAYLOAD_DEPTH = 8;
const REQUEST_KINDS = Object.freeze({ QUERY: 'query', COMMAND: 'command' });

const QUERY_METHODS = Object.freeze([
  'system.handshake', 'workspaces.list', 'workspaces.get', 'profiles.list',
  'profiles.get', 'teams.list', 'teams.get', 'operations.list',
  'operations.get', 'instances.list', 'instances.get', 'handoffs.list',
  'handoffs.get', 'events.replay',
]);

const COMMAND_METHODS = Object.freeze([
  'workspaces.choose', 'workspaces.openRecent', 'profiles.create',
  'profiles.update', 'profiles.archive', 'teams.create', 'teams.update',
  'teams.archive', 'operations.create', 'operations.update',
  'operations.launch', 'instances.pause', 'instances.resume',
  'instances.cancel', 'handoffs.create', 'handoffs.accept',
  'handoffs.reject', 'handoffs.block', 'system.shutdown',
]);

const FORBIDDEN_PAYLOAD_KEYS = Object.freeze(new Set([
  'path', 'filepath', 'workspacepath', 'directory', 'cwd', 'root', 'command',
  'shell', 'env', 'environment', 'secret', 'token', 'apikey', 'password',
]));

module.exports = Object.freeze({
  COMMAND_METHODS,
  FORBIDDEN_PAYLOAD_KEYS,
  MAX_SUPERVISOR_PAYLOAD_BYTES,
  MAX_SUPERVISOR_PAYLOAD_DEPTH,
  QUERY_METHODS,
  REQUEST_KINDS,
  SUPERVISOR_API_VERSION,
  SUPPORTED_SUPERVISOR_API_VERSIONS,
});

'use strict';

const HANDSHAKE_PROTOCOL_VERSIONS = Object.freeze([
  '2024-11-05',
  '2025-03-26',
  '2025-06-18',
  '2025-11-25',
]);
const LEGACY_PROTOCOL_VERSION = HANDSHAKE_PROTOCOL_VERSIONS[0];
const LATEST_HANDSHAKE_PROTOCOL_VERSION = HANDSHAKE_PROTOCOL_VERSIONS.at(-1);
const HANDSHAKE_PROTOCOL_VERSION_SET = new Set(HANDSHAKE_PROTOCOL_VERSIONS);
const MODERN_PROTOCOL_VERSION = '2026-07-28';
const MODERN_PROTOCOL_VERSIONS = Object.freeze([MODERN_PROTOCOL_VERSION]);

const PROTOCOL_VERSION_META_KEY = 'io.modelcontextprotocol/protocolVersion';
const CLIENT_CAPABILITIES_META_KEY = 'io.modelcontextprotocol/clientCapabilities';
const CLIENT_INFO_META_KEY = 'io.modelcontextprotocol/clientInfo';
const SERVER_INFO_META_KEY = 'io.modelcontextprotocol/serverInfo';

const INVALID_REQUEST = Object.freeze({ code: -32600, message: 'Invalid Request' });
const INVALID_PARAMS = Object.freeze({ code: -32602, message: 'Invalid params' });
const METHOD_NOT_FOUND = Object.freeze({ code: -32601, message: 'Method not found' });
const UNSUPPORTED_PROTOCOL_VERSION = Object.freeze({ code: -32022, message: 'Unsupported protocol version' });

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function negotiateHandshakeVersion(params) {
  if (!params || !hasOwn(params, 'protocolVersion')) return LEGACY_PROTOCOL_VERSION;
  return HANDSHAKE_PROTOCOL_VERSION_SET.has(params.protocolVersion)
    ? params.protocolVersion
    : LATEST_HANDSHAKE_PROTOCOL_VERSION;
}

/** Validate a JSON-RPC request envelope without dispatching it. */
function validateJsonRpcRequest(value) {
  if (!isPlainObject(value)) {
    return { ok: false, id: null, notification: false, error: INVALID_REQUEST };
  }

  const hasId = hasOwn(value, 'id');
  // MCP RequestId is string | integer in every supported pinned schema.
  // JSON-RPC reserves null for error responses when a request ID cannot be
  // detected; it is not a valid request ID for application dispatch.
  const validId = !hasId || typeof value.id === 'string'
    || (typeof value.id === 'number' && Number.isInteger(value.id));
  const validParams = !hasOwn(value, 'params') || Array.isArray(value.params) || isPlainObject(value.params);
  if (value.jsonrpc !== '2.0' || typeof value.method !== 'string' || !validId || !validParams) {
    return {
      ok: false,
      id: hasId && validId ? value.id : null,
      notification: !hasId,
      error: INVALID_REQUEST,
    };
  }

  return { ok: true, id: value.id, notification: !hasId, request: value };
}

function validateClientInfo(clientInfo) {
  if (!isPlainObject(clientInfo)) return false;
  if (typeof clientInfo.name !== 'string' || typeof clientInfo.version !== 'string') return false;
  return !hasOwn(clientInfo, 'title') || typeof clientInfo.title === 'string';
}

/** Return a JSON-RPC error description, or null for a valid modern envelope. */
function validateModernEnvelope(request) {
  if (!isPlainObject(request.params) || !isPlainObject(request.params._meta)) return INVALID_PARAMS;
  const meta = request.params._meta;
  const requested = meta[PROTOCOL_VERSION_META_KEY];
  if (typeof requested !== 'string' || !isPlainObject(meta[CLIENT_CAPABILITIES_META_KEY])) {
    return INVALID_PARAMS;
  }
  if (hasOwn(meta, CLIENT_INFO_META_KEY) && !validateClientInfo(meta[CLIENT_INFO_META_KEY])) {
    return INVALID_PARAMS;
  }
  if (requested !== MODERN_PROTOCOL_VERSION) {
    return {
      ...UNSUPPORTED_PROTOCOL_VERSION,
      data: { supported: [...MODERN_PROTOCOL_VERSIONS], requested },
    };
  }
  return null;
}

function normalizeServerDescription(initializeResult) {
  const description = initializeResult();
  if (!isPlainObject(description) || !isPlainObject(description.capabilities)
      || !isPlainObject(description.serverInfo)) {
    throw new TypeError('MCP initializeResult must return capabilities and serverInfo objects');
  }
  return description;
}

function decorateModernResult(result, serverInfo, { cacheable = false } = {}) {
  if (!isPlainObject(result) || !isPlainObject(serverInfo)) {
    throw new TypeError('Modern MCP results and serverInfo must be objects');
  }
  return {
    ...result,
    resultType: 'complete',
    ...(cacheable ? { ttlMs: 0, cacheScope: 'private' } : {}),
    _meta: {
      ...(isPlainObject(result._meta) ? result._meta : {}),
      [SERVER_INFO_META_KEY]: { ...serverInfo },
    },
  };
}

function createDiscoveryResult(initializeResult) {
  const description = normalizeServerDescription(initializeResult);
  return decorateModernResult({
    supportedVersions: [...MODERN_PROTOCOL_VERSIONS],
    capabilities: description.capabilities,
    ...(description.instructions === undefined ? {} : { instructions: description.instructions }),
  }, description.serverInfo, { cacheable: true });
}

function hasModernMetadata(request) {
  return isPlainObject(request.params)
    && isPlainObject(request.params._meta)
    && hasOwn(request.params._meta, PROTOCOL_VERSION_META_KEY);
}

/** Select the era suggested by one message without retaining connection state. */
function selectProtocolEra(request) {
  if (hasModernMetadata(request) || request.method === 'server/discover') return 'modern';
  if (request.method === 'initialize') return 'handshake';
  if (request.method === 'notifications/initialized') return null;
  return 'handshake';
}

function emitError(respondError, request, error) {
  if (request.id === undefined) return;
  respondError(request.id, error.code, error.message, error.data);
}

function createHandshakeAdapter({ respond, initializeResult }) {
  if (typeof respond !== 'function' || typeof initializeResult !== 'function') {
    throw new TypeError('MCP handshake adapter requires respond and initializeResult functions');
  }

  return function handleHandshakeRequest(request) {
    if (request.method === 'initialize') {
      if (request.id !== undefined) {
        respond(request.id, {
          ...normalizeServerDescription(initializeResult),
          protocolVersion: negotiateHandshakeVersion(request.params),
        });
      }
      return true;
    }

    if (request.method === 'notifications/initialized') return true;

    if (request.method === 'ping') {
      if (request.id !== undefined) respond(request.id, {});
      return true;
    }

    return false;
  };
}

/** Stateful lifecycle seam for one stdio connection. */
function createProtocolAdapter({ respond, respondError, initializeResult }) {
  if (typeof respondError !== 'function') {
    throw new TypeError('MCP protocol adapter requires a respondError function');
  }
  const handleHandshake = createHandshakeAdapter({ respond, initializeResult });
  let era = null;

  function accept(request) {
    // Pin on the first era-defining exchange. Validation intentionally follows
    // pinning: a malformed modern opener must not unlock legacy behavior on the
    // same stdio connection.
    const suggestedEra = selectProtocolEra(request);
    if (era === null && suggestedEra !== null) era = suggestedEra;

    // A handshake connection keeps its legacy application compatibility but
    // rejects every later attempt to introduce per-request modern metadata.
    if (era === 'handshake') {
      if (suggestedEra === 'modern') {
        emitError(respondError, request, {
          ...UNSUPPORTED_PROTOCOL_VERSION,
          data: {
            supported: [...HANDSHAKE_PROTOCOL_VERSIONS],
            requested: isPlainObject(request.params?._meta)
              ? request.params._meta[PROTOCOL_VERSION_META_KEY]
              : MODERN_PROTOCOL_VERSION,
          },
        });
        return { handled: true, era, modern: false };
      }
      return { handled: handleHandshake(request), era, modern: false };
    }

    // Modern metadata is independent on every request. Lifecycle method
    // rejection comes afterward so only a structurally valid modern initialize
    // reaches Method not found.
    const envelopeError = validateModernEnvelope(request);
    if (envelopeError) {
      emitError(respondError, request, envelopeError);
      return { handled: true, era, modern: true };
    }

    if (request.method === 'initialize') {
      emitError(respondError, request, METHOD_NOT_FOUND);
      return { handled: true, era, modern: true };
    }

    if (request.method === 'server/discover') {
      if (request.id !== undefined) respond(request.id, createDiscoveryResult(initializeResult));
      return { handled: true, era, modern: true };
    }

    if (request.method === 'ping') {
      if (request.id !== undefined) {
        const serverInfo = normalizeServerDescription(initializeResult).serverInfo;
        respond(request.id, decorateModernResult({}, serverInfo));
      }
      return { handled: true, era, modern: true };
    }

    if (request.method === 'notifications/initialized') {
      return { handled: true, era, modern: true };
    }

    return { handled: false, era, modern: true };
  }

  return {
    accept,
    decorateResult(result, options) {
      return decorateModernResult(result, normalizeServerDescription(initializeResult).serverInfo, options);
    },
    normalizeParams(params) {
      if (era !== 'modern' || !isPlainObject(params)) return params;
      const { _meta: _protocolMetadata, ...applicationParams } = params;
      return applicationParams;
    },
    getEra() { return era; },
  };
}

module.exports = {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  HANDSHAKE_PROTOCOL_VERSIONS,
  LATEST_HANDSHAKE_PROTOCOL_VERSION,
  LEGACY_PROTOCOL_VERSION,
  MODERN_PROTOCOL_VERSION,
  MODERN_PROTOCOL_VERSIONS,
  PROTOCOL_VERSION_META_KEY,
  SERVER_INFO_META_KEY,
  createDiscoveryResult,
  createHandshakeAdapter,
  createProtocolAdapter,
  decorateModernResult,
  negotiateHandshakeVersion,
  selectProtocolEra,
  validateJsonRpcRequest,
  validateModernEnvelope,
};

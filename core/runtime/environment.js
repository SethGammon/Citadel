'use strict';

const BASE_ENVIRONMENT = Object.freeze([
  'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'ComSpec', 'WINDIR',
  'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP',
  'LANG', 'LC_ALL', 'TERM',
]);

function safeEnvironment(allowlist, source = process.env) {
  const output = {};
  for (const key of [...BASE_ENVIRONMENT, ...allowlist]) {
    if (Object.prototype.hasOwnProperty.call(source, key)) output[key] = source[key];
  }
  return output;
}

module.exports = Object.freeze({ safeEnvironment });

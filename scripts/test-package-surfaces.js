#!/usr/bin/env node

'use strict';

const path = require('path');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function main() {
  const contracts = require(path.join(__dirname, '..', 'packages', 'contracts'));
  const client = require(path.join(__dirname, '..', 'packages', 'client'));
  const claudeRuntime = require(path.join(__dirname, '..', 'packages', 'runtime-claude-code'));

  if (!contracts.events || !contracts.runtime || !contracts.capabilities || !contracts.provider) {
    fail('packages/contracts is missing required exports');
  }

  if (typeof contracts.schemaVersion !== 'number') {
    fail('packages/contracts must expose numeric schemaVersion');
  }

  if (typeof client.createLocalSink !== 'function' || typeof client.createCloudSink !== 'function') {
    fail('packages/client must expose sink factories');
  }

  const sink = client.createLocalSink((event) => event);
  if (!sink || typeof sink.send !== 'function') {
    fail('packages/client createLocalSink must return an object with send()');
  }

  if (!client.normalizeEvent || typeof client.normalizeEvent.createEnvelope !== 'function') {
    fail('packages/client must expose event normalization helpers');
  }

  if (!claudeRuntime.runtime || claudeRuntime.runtime.id !== 'claude-code') {
    fail('packages/runtime-claude-code must expose the Claude runtime surface');
  }

  if (typeof claudeRuntime.installClaudeHooks !== 'function') {
    fail('packages/runtime-claude-code must expose installClaudeHooks');
  }

  console.log('package surface tests passed');
}

main();

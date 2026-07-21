#!/usr/bin/env node

'use strict';

module.exports = Object.freeze({
  events: require('./events'),
  capabilities: require('./capabilities'),
  projectSpec: require('./project-spec'),
  skillManifest: require('./skill-manifest'),
  agentRole: require('./agent-role'),
  runtime: require('./runtime'),
  provider: require('./provider'),
});

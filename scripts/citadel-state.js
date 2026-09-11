#!/usr/bin/env node

'use strict';

// Portable project delegate for the citadel-state MCP server. The generated
// .citadel/scripts/citadel-state.js wrapper resolves this file through the
// machine-local plugin-root pointer, so shared .mcp.json never embeds a
// workstation path.
require('../mcp-servers/citadel-state/index.js');

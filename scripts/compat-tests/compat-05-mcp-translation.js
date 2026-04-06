/**
 * COMPAT-05: MCP config translation
 * Validates that .mcp.json entries translate correctly to config.toml [mcp_servers].
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { execSync } = require('child_process');

async function run() {
  const errors = [];
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-mcp-test-'));

  try {
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });

    // Create a test .mcp.json with active servers
    const mcpConfig = {
      mcpServers: {
        github: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' },
        },
        filesystem: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
        },
        _disabled: {
          command: 'should-not-appear',
        },
      },
    };
    fs.writeFileSync(path.join(tmpDir, '.mcp.json'), JSON.stringify(mcpConfig));

    // Run codex-compat.js
    const script = path.join(__dirname, '..', 'codex-compat.js');
    execSync(`node "${script}" "${tmpDir}"`, {
      encoding: 'utf8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Read generated config.toml
    const configPath = path.join(tmpDir, '.codex', 'config.toml');
    if (!fs.existsSync(configPath)) {
      errors.push('config.toml was not generated');
    } else {
      const content = fs.readFileSync(configPath, 'utf8');

      // Active servers should be present
      if (!content.includes('[mcp_servers.github]')) {
        errors.push('Missing: [mcp_servers.github]');
      }
      if (!content.includes('[mcp_servers.filesystem]')) {
        errors.push('Missing: [mcp_servers.filesystem]');
      }
      // Disabled servers (prefixed with _) should NOT be present
      if (content.includes('[mcp_servers._disabled]') || content.includes('should-not-appear')) {
        errors.push('Disabled server (_disabled) should not appear in output');
      }
      // Check server details
      if (!content.includes('command = "npx"')) {
        errors.push('Missing: command = "npx"');
      }
      if (!content.includes('@modelcontextprotocol/server-github')) {
        errors.push('Missing: server-github in args');
      }
      // Token env var should be mapped
      if (!content.includes('GITHUB_TOKEN')) {
        errors.push('Missing: GITHUB_TOKEN reference');
      }
    }

  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  if (errors.length > 0) {
    return { pass: false, message: errors.join('; ') };
  }
  return { pass: true, message: 'MCP servers correctly translated to config.toml' };
}

module.exports = { run };

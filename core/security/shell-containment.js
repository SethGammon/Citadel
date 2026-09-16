'use strict';

function claudeShellContainmentReadiness(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const isWsl = Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP);

  if (platform === 'win32' && !isWsl) {
    return Object.freeze({
      status: 'unsupported-host',
      message: 'Direct Read/Edit/Write paths are protected. Arbitrary Bash or PowerShell writes are not contained by Citadel, and Claude Code shell sandboxing is not supported on native Windows. Use WSL2 or another OS-level containment boundary for that guarantee.',
    });
  }

  return Object.freeze({
    status: 'runtime-unverified',
    message: 'Direct Read/Edit/Write paths are protected. Arbitrary shell writes require the coding runtime or OS sandbox; Citadel does not verify that sandbox is enabled.',
  });
}

module.exports = Object.freeze({ claudeShellContainmentReadiness });

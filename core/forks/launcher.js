'use strict';

const fs = require('fs');
const path = require('path');

// Windows cannot CreateProcess a .cmd/.bat shim directly, and Citadel never sets
// shell: true. When a vendor CLI is only present as a shim we launch the shim
// through the command interpreter ourselves, with verbatim arguments we quote,
// and only after every argument has been proven free of interpreter syntax.
const DIRECT_EXTENSIONS = Object.freeze(['.exe', '.com']);
const SHIM_EXTENSIONS = Object.freeze(['.cmd', '.bat']);
const SAFE_WINDOWS_ARGUMENT = /^[A-Za-z0-9._:@/\\-]+$/;
// The shim path is quoted, so spaces and parentheses are safe. Anything cmd can
// still interpret inside quotes (notably % expansion) is not.
const SAFE_WINDOWS_PATH = /^[A-Za-z0-9 ._:@/\\()+-]+$/;

function pathEntries(env) {
  return String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
}

function findOnPath(command, env) {
  if (command.includes('/') || command.includes('\\') || path.isAbsolute(command)) {
    return fs.existsSync(command) ? command : null;
  }
  const extensions = [...DIRECT_EXTENSIONS, ...SHIM_EXTENSIONS];
  for (const directory of pathEntries(env)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch (_error) { /* keep looking */ }
    }
  }
  return null;
}

function quote(value) {
  return `"${value}"`;
}

/**
 * Resolve a canonical invocation into something spawnable with shell: false.
 * Non-Windows platforms are returned untouched. Windows prefers a real
 * executable image and only falls back to the interpreter for a .cmd/.bat shim.
 */
function platformInvocation(invocation, options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  if (platform !== 'win32') return { ...invocation, windowsVerbatimArguments: false };
  const resolved = (options.resolve || findOnPath)(invocation.command, env);
  if (!resolved) return { ...invocation, windowsVerbatimArguments: false };
  const extension = path.extname(resolved).toLowerCase();
  if (!SHIM_EXTENSIONS.includes(extension)) {
    return { command: resolved, args: [...invocation.args], windowsVerbatimArguments: false };
  }
  const unsafe = invocation.args.find((argument) => !SAFE_WINDOWS_ARGUMENT.test(argument));
  if (unsafe !== undefined || !SAFE_WINDOWS_PATH.test(resolved)) {
    throw Object.assign(new Error('Executor argument is not safe for the Windows command interpreter'), {
      code: 'FORK_EXECUTOR_ARGUMENT_UNSAFE',
    });
  }
  const line = [quote(resolved), ...invocation.args.map(quote)].join(' ');
  // Verbatim mode joins argv literally, so the interpreter path itself must not
  // need quoting. The stock ComSpec never does; anything else falls back.
  const interpreter = env.ComSpec || env.COMSPEC || 'cmd.exe';
  return {
    command: /\s/.test(interpreter) ? 'cmd.exe' : interpreter,
    // /d skips AutoRun commands, /s keeps our outer quotes verbatim, /c runs once.
    args: ['/d', '/s', '/c', `"${line}"`],
    windowsVerbatimArguments: true,
  };
}

module.exports = Object.freeze({
  SAFE_WINDOWS_ARGUMENT, SAFE_WINDOWS_PATH, findOnPath, platformInvocation,
});

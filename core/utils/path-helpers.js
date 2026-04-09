'use strict';

/**
 * path-helpers.js — Cross-platform path normalization utilities.
 *
 * Two concerns live here:
 *   1. Converting paths to forward-slash form for storage, logging, and comparison.
 *   2. Detecting the shell environment (Git Bash vs native Windows vs Unix).
 *
 * IMPORTANT: toUniversal() is for storage/comparison ONLY.
 * Do NOT pass its output to Node fs APIs — Node handles backslashes natively on
 * Windows, and feeding it a forward-slash path from toUniversal can break in
 * edge cases (UNC paths, drive-letter paths in POSIX mode).
 */

const path = require('path');

/**
 * Normalize a path to forward-slash form.
 * Use when storing paths in JSON, JSONL, markdown tables, or log lines,
 * and when comparing two paths as strings.
 *
 * @param {string} filePath
 * @returns {string}
 */
function toUniversal(filePath) {
  return String(filePath || '').split(path.sep).join('/');
}

/**
 * Normalize a path to the OS-native separator.
 * Use when constructing paths for shell subprocesses or legacy tools that
 * do not accept forward slashes on Windows.
 *
 * @param {string} filePath
 * @returns {string}
 */
function toNative(filePath) {
  return String(filePath || '').split(/[/\\]/).join(path.sep);
}

/**
 * Detect whether the current process is running inside Git Bash / MSYS2.
 * Git Bash sets MSYSTEM to 'MINGW64', 'MINGW32', or 'MSYS'.
 * Native Windows (cmd.exe, PowerShell) and WSL do not set it.
 *
 * @returns {boolean}
 */
function isGitBash() {
  const msystem = process.env.MSYSTEM || '';
  return msystem.startsWith('MINGW') || msystem === 'MSYS';
}

/**
 * Resolve the GitHub CLI executable path.
 * Checks native Windows install locations first, then falls back to PATH lookup.
 * Works correctly in Git Bash, native Windows, WSL, and Unix.
 *
 * @returns {string} Absolute path or 'gh' (relies on PATH)
 */
function resolveGhPath() {
  if (process.platform === 'win32') {
    const fs = require('fs');
    const candidates = [
      'C:\\Program Files\\GitHub CLI\\gh.exe',
      'C:\\Program Files (x86)\\GitHub CLI\\gh.exe',
    ];
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch {
        // Non-critical — fall through to PATH
      }
    }
  }
  // Unix, WSL, Git Bash, or gh not in standard locations — rely on PATH
  return 'gh';
}

module.exports = {
  toUniversal,
  toNative,
  isGitBash,
  resolveGhPath,
};

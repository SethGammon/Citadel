'use strict';

const { execFileSync } = require('child_process');

const SAFE_EVENTS = Object.freeze([
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PreCompact',
  'Stop',
  'SessionStart',
  'SessionEnd',
  'SubagentStop',
]);

function parseClaudeVersion(raw) {
  if (typeof raw !== 'string') return null;
  const match = raw.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

function compareVersions(left, right) {
  const a = String(left).split('.').map((part) => Number(part) || 0);
  const b = String(right).split('.').map((part) => Number(part) || 0);
  const length = Math.max(a.length, b.length);

  for (let index = 0; index < length; index++) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }

  return 0;
}

function detectClaudeVersion(claudeBin = 'claude') {
  try {
    const output = execFileSync(claudeBin, ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 5000,
    });
    return {
      version: parseClaudeVersion(output),
      source: 'cli',
      raw: String(output || '').trim(),
    };
  } catch {
    return {
      version: null,
      source: 'unavailable',
      raw: '',
    };
  }
}

function getSupportedEventsForVersion(version, templateEvents) {
  const supported = new Set(SAFE_EVENTS.filter((event) => templateEvents.includes(event)));

  if (!version) {
    return supported;
  }

  if (compareVersions(version, '2.1.76') >= 0) {
    supported.add('PostCompact');
  }

  if (compareVersions(version, '2.1.78') >= 0) {
    supported.add('StopFailure');
  }

  if (compareVersions(version, '2.1.83') >= 0) {
    supported.add('TaskCompleted');
  }

  if (compareVersions(version, '2.1.84') >= 0) {
    supported.add('TaskCreated');
    supported.add('WorktreeCreate');
    supported.add('WorktreeRemove');
  }

  return supported;
}

function selectSupportedClaudeHookEvents(options = {}) {
  const templateEvents = Array.from(options.templateEvents || []);
  const requestedProfile = (options.hookProfile || 'auto').toLowerCase();

  if (requestedProfile === 'latest' || requestedProfile === 'full' || requestedProfile === 'all') {
    return {
      hookProfile: 'latest',
      claudeVersion: options.claudeVersion || null,
      versionSource: options.claudeVersion ? 'explicit' : 'ignored',
      supportedEvents: templateEvents,
      skippedEvents: [],
      reason: 'forced latest profile',
    };
  }

  if (requestedProfile === 'legacy' || requestedProfile === 'safe') {
    const supportedEvents = templateEvents.filter((event) => SAFE_EVENTS.includes(event));
    return {
      hookProfile: 'safe',
      claudeVersion: options.claudeVersion || null,
      versionSource: options.claudeVersion ? 'explicit' : 'profile',
      supportedEvents,
      skippedEvents: templateEvents.filter((event) => !supportedEvents.includes(event)),
      reason: 'forced safe profile',
    };
  }

  const detected = options.claudeVersion
    ? { version: options.claudeVersion, source: 'explicit', raw: options.claudeVersion }
    : detectClaudeVersion(options.claudeBin);
  const supported = getSupportedEventsForVersion(detected.version, templateEvents);
  const supportedEvents = templateEvents.filter((event) => supported.has(event));

  return {
    hookProfile: detected.version ? 'auto' : 'safe',
    claudeVersion: detected.version,
    versionSource: detected.source,
    supportedEvents,
    skippedEvents: templateEvents.filter((event) => !supportedEvents.includes(event)),
    reason: detected.version
      ? `auto-detected Claude Code ${detected.version}`
      : 'Claude version unavailable; falling back to safe profile',
  };
}

module.exports = {
  SAFE_EVENTS,
  compareVersions,
  detectClaudeVersion,
  parseClaudeVersion,
  selectSupportedClaudeHookEvents,
};
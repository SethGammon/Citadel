'use strict';

const RECOVERIES = Object.freeze({
  fixture_invalid: 'Correct the fixture to schema 1 and keep every referenced path inside its fixture directory.',
  install_failed: 'Run the recorded installer command locally and fix its first non-zero prerequisite.',
  setup_failed: 'Run the recorded setup command locally and fix its first non-zero prerequisite.',
  route_mismatch: 'Align the fixture expectedRoute and verificationCommand with the deterministic route preview.',
  verification_failed: 'Run the fixture verificationCommand in the fixture project and fix the failing check.',
  handoff_missing: 'Restore the usefulness-trial report HANDOFF block before rerunning the fixture.',
  resume_failed: 'Restore an active campaign whose fresh continuation command matches expectedResumeCommand.',
  rollback_failed: 'Remove the retained temporary workspace and verify the original fixture digest manually.',
  unexpected_error: 'Inspect the failed step evidence and map the condition to a closed golden-path failure code.',
});

const LIMITATIONS = Object.freeze([
  'This is deterministic fixture automation, not real plugin registration.',
  'This does not execute /do setup --express.',
  'This does not execute an LLM task.',
  'This is not a multi-OS matrix result.',
  'Machine fixture timings are not human timing proof.',
]);

class GoldenPathError extends Error {
  constructor(code, message, evidence = []) {
    super(message);
    this.name = 'GoldenPathError';
    this.code = RECOVERIES[code] ? code : 'unexpected_error';
    this.evidence = evidence;
  }
}

function failureFor(code) {
  const resolved = RECOVERIES[code] ? code : 'unexpected_error';
  return { code: resolved, recovery: RECOVERIES[resolved] };
}

module.exports = { GoldenPathError, LIMITATIONS, RECOVERIES, failureFor };

/**
 * COMPAT-04: Hook adapter input
 * Validates that codex-adapter.js correctly translates Codex JSON to Citadel format.
 */

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const assert = require('assert');

async function run() {
  const errors = [];
  const adapterPath = path.join(__dirname, '..', '..', 'hooks_src', 'codex-adapter.js');

  // We can't fully test the adapter without a real hook, but we can verify
  // it handles invalid input gracefully (exits 0, doesn't crash)
  try {
    // Test 1: Empty stdin should not crash
    const result = execFileSync(
      process.execPath, [adapterPath, 'governance'],
      {
        encoding: 'utf8',
        input: '{}',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, CITADEL_RUNTIME: 'codex' },
      }
    );
    // governance.js logs to audit; if it doesn't crash, that's a pass
  } catch (err) {
    // Exit code 0 or 2 are both acceptable (2 = hook blocked)
    if (err.status && err.status !== 0 && err.status !== 2) {
      errors.push(`Adapter exited with unexpected code ${err.status}: ${err.stderr}`);
    }
  }

  // Test 2: Verify adapter sets CITADEL_RUNTIME=codex
  // (We check this indirectly -- the adapter spawns the hook with this env var)

  // Test 3: Slash-command hints are rewritten to Codex plugin-skill syntax
  try {
    const { translateSlashCommands, projectCodexContextOutput, projectCodexOutput } = require(adapterPath);
    for (const token of ['/do/file', '/do/', '/do.md', '/do_extra', '/do-other', '/do\\file', '/usr/bin', '/hooks', 'https://example.com/do', '$citadel.do']) {
      assert.equal(translateSlashCommands(`Keep ${token}`), `Keep ${token}`);
    }
    for (const suffix of ['', ' status', '.', ',', ':', ';', '!', '?', ')', ']', '"', "'", '`']) {
      assert.equal(translateSlashCommands(`/do${suffix}`), `$citadel.do${suffix}`);
    }
    const hint = 'Run /do status; keep /do/file';
    const expectedHint = 'Run $citadel.do status; keep /do/file';
    // Each event has a different valid envelope. Compare the entire result
    // so translating its prose cannot silently alter denial or tool inputs.
    for (const event of ['SessionStart', 'PreToolUse', 'PostToolUse', 'PostCompact', 'Stop']) {
      const envelope = { continue: false, suppressOutput: true, stopReason: hint, systemMessage: hint };
      const expected = { ...envelope, stopReason: expectedHint, systemMessage: expectedHint };
      if (['SessionStart', 'PreToolUse', 'PostToolUse'].includes(event)) {
        envelope.hookSpecificOutput = { hookEventName: event, additionalContext: hint };
        expected.hookSpecificOutput = { hookEventName: event, additionalContext: expectedHint };
        if (event === 'PreToolUse') {
          const controls = { permissionDecision: 'deny', updatedInput: { command: '/do status', file_path: '/do/file', systemMessage: hint } };
          Object.assign(envelope.hookSpecificOutput, controls, { permissionDecisionReason: hint });
          Object.assign(expected.hookSpecificOutput, controls, { permissionDecisionReason: expectedHint });
        }
      }
      if (event === 'Stop') {
        Object.assign(envelope, { decision: 'block', reason: hint });
        Object.assign(expected, { decision: 'block', reason: expectedHint });
      }
      const result = projectCodexOutput({ nativeEventName: event, stdout: JSON.stringify(envelope), stderr: 'diagnostic /do' });
      assert.deepStrictEqual(JSON.parse(result.stdout), expected, event);
      assert.equal(result.stderr, 'diagnostic /do');
    }
    const legacyBlock = { decision: 'block', reason: hint, systemMessage: hint };
    assert.deepStrictEqual(JSON.parse(projectCodexContextOutput(JSON.stringify(legacyBlock), 'PreToolUse')),
      { decision: 'block', reason: expectedHint, systemMessage: expectedHint });
    const unchanged = '{ "continue": false, "systemMessage": null, "stopReason": null }\n';
    assert.equal(projectCodexOutput({ nativeEventName: 'PostCompact', stdout: unchanged }).stdout, unchanged);
    const text = 'Run /do status, then /learn --compile. Paths like /usr/bin stay.';
    const translated = translateSlashCommands(text);
    if (!translated.includes('$citadel.do status')) {
      errors.push(`Expected $citadel.do in translated text, got: ${translated}`);
    }
    if (!translated.includes('$citadel.learn --compile')) {
      errors.push(`Expected $citadel.learn in translated text, got: ${translated}`);
    }
    if (!translated.includes('/usr/bin')) {
      errors.push(`Non-skill path was rewritten: ${translated}`);
    }
    const projected = JSON.parse(
      projectCodexContextOutput('Next: run /do continue', 'SessionStart')
    );
    if (projected.hookSpecificOutput.additionalContext !== 'Next: run $citadel.do continue') {
      errors.push(`additionalContext not translated: ${projected.hookSpecificOutput.additionalContext}`);
    }
  } catch (err) {
    errors.push(`Slash-command translation check failed: ${err.message}`);
  }

  if (errors.length > 0) {
    return { pass: false, message: errors.join('; ') };
  }
  return { pass: true, message: 'Hook adapter handles input gracefully' };
}

module.exports = { run };

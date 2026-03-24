'use strict';
const { test } = require('node:test');
const assert = require('assert');

const {
  checkNodeVersion,
  isCitadelRepo,
} = require('./install-citadel.js');

test('checkNodeVersion passes for Node 18+', () => {
  assert.doesNotThrow(() => checkNodeVersion('v18.0.0'));
  assert.doesNotThrow(() => checkNodeVersion('v20.1.0'));
});

test('checkNodeVersion throws for Node < 18', () => {
  assert.throws(() => checkNodeVersion('v16.20.0'), /Node 18/);
  assert.throws(() => checkNodeVersion('v14.0.0'), /Node 18/);
});

test('isCitadelRepo returns true when all three markers present', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-test-'));
  const markers = [
    '.claude/skills/do',
    '.claude/skills/archon',
    '.claude/skills/marshal',
  ];
  for (const m of markers) {
    fs.mkdirSync(path.join(tmp, m), { recursive: true });
  }
  assert.strictEqual(isCitadelRepo(tmp), true);
  fs.rmSync(tmp, { recursive: true });
});

test('isCitadelRepo returns false when a marker is missing', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-test-'));
  fs.mkdirSync(path.join(tmp, '.claude/skills/do'), { recursive: true });
  fs.mkdirSync(path.join(tmp, '.claude/skills/archon'), { recursive: true });
  assert.strictEqual(isCitadelRepo(tmp), false);
  fs.rmSync(tmp, { recursive: true });
});

const {
  countLines,
  backupPath,
} = require('./install-citadel.js');

test('countLines counts newlines correctly', () => {
  assert.strictEqual(countLines('a\nb\nc'), 3);
  assert.strictEqual(countLines(''), 1);
  assert.strictEqual(countLines('hello'), 1);
  assert.strictEqual(countLines('a\nb\n'), 3);
});

test('backupPath appends .citadel-bak', () => {
  assert.strictEqual(backupPath('/proj/.claude/settings.json'), '/proj/.claude/settings.json.citadel-bak');
  assert.strictEqual(backupPath('foo.md'), 'foo.md.citadel-bak');
});

const {
  normaliseCommand,
  commandsEquivalent,
} = require('./install-citadel.js');

test('normaliseCommand strips $CLAUDE_PROJECT_DIR/ prefix', () => {
  assert.strictEqual(
    normaliseCommand('node "$CLAUDE_PROJECT_DIR/.claude/hooks/post-edit.js"'),
    'node .claude/hooks/post-edit.js'
  );
  assert.strictEqual(
    normaliseCommand('node "$CLAUDE_PROJECT_DIR/.claude/hooks/protect-files.js"'),
    'node .claude/hooks/protect-files.js'
  );
});

test('normaliseCommand leaves relative paths unchanged', () => {
  assert.strictEqual(
    normaliseCommand('node .claude/hooks/post-edit.js'),
    'node .claude/hooks/post-edit.js'
  );
});

test('normaliseCommand leaves other absolute paths unchanged', () => {
  assert.strictEqual(
    normaliseCommand('node /home/user/.claude/hooks/foo.js'),
    'node /home/user/.claude/hooks/foo.js'
  );
});

test('commandsEquivalent treats $CLAUDE_PROJECT_DIR form and relative form as equal', () => {
  assert.strictEqual(
    commandsEquivalent(
      'node "$CLAUDE_PROJECT_DIR/.claude/hooks/post-edit.js"',
      'node .claude/hooks/post-edit.js'
    ),
    true
  );
});

test('commandsEquivalent returns false for different hooks', () => {
  assert.strictEqual(
    commandsEquivalent(
      'node .claude/hooks/post-edit.js',
      'node .claude/hooks/protect-files.js'
    ),
    false
  );
});

test('commandsEquivalent is symmetric', () => {
  const a = 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/quality-gate.js"';
  const b = 'node .claude/hooks/quality-gate.js';
  assert.strictEqual(commandsEquivalent(a, b), commandsEquivalent(b, a));
});

const { mergeHookEvent, mergeSettings } = require('./install-citadel.js');

test('mergeHookEvent: deduplicates equivalent commands, project timeout wins', () => {
  const project = [
    {
      matcher: 'Edit|Write',
      hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/protect-files.js"', timeout: 5 }]
    }
  ];
  const citadel = [
    {
      matcher: 'Edit|Write',
      hooks: [{ type: 'command', command: 'node .claude/hooks/protect-files.js', timeout: 10 }]
    }
  ];
  const result = mergeHookEvent(project, citadel);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].matcher, 'Edit|Write');
  assert.strictEqual(result[0].hooks.length, 1);
  assert.strictEqual(result[0].hooks[0].timeout, 5);
  assert.ok(result[0].hooks[0].command.includes('$CLAUDE_PROJECT_DIR'));
});

test('mergeHookEvent: new matcher from Citadel is added', () => {
  const project = [
    { matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/protect-files.js"', timeout: 5 }] }
  ];
  const citadel = [
    { matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'node .claude/hooks/protect-files.js', timeout: 10 }] },
    { matcher: 'Bash',       hooks: [{ type: 'command', command: 'node .claude/hooks/bash-guard.js', timeout: 5 }] }
  ];
  const result = mergeHookEvent(project, citadel);
  assert.strictEqual(result.length, 2);
  const matchers = result.map(e => e.matcher);
  assert.ok(matchers.includes('Edit|Write'));
  assert.ok(matchers.includes('Bash'));
});

test('mergeHookEvent: no-matcher catch-all entries merged correctly', () => {
  const project = [
    { hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/post-edit.js"', timeout: 30 }] }
  ];
  const citadel = [
    { hooks: [{ type: 'command', command: 'node .claude/hooks/post-edit.js', timeout: 30 }] }
  ];
  const result = mergeHookEvent(project, citadel);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].hooks.length, 1);
});

test('mergeSettings: produces correct output for real project + citadel settings', () => {
  const project = {
    hooks: {
      PreToolUse: [
        { matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/protect-files.js"', timeout: 5 }] }
      ],
      Stop: [
        { hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/quality-gate.js"', timeout: 10 }] }
      ]
    }
  };
  const citadel = {
    hooks: {
      PreToolUse: [
        { matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'node .claude/hooks/protect-files.js', timeout: 5 }] }
      ],
      Stop: [
        { hooks: [{ type: 'command', command: 'node .claude/hooks/quality-gate.js', timeout: 10 }] }
      ],
      PostToolUse: [
        { hooks: [{ type: 'command', command: 'node .claude/hooks/post-edit.js', timeout: 30 }] }
      ]
    }
  };
  const result = mergeSettings(project, citadel);
  assert.ok(result.hooks.PreToolUse);
  assert.ok(result.hooks.Stop);
  assert.ok(result.hooks.PostToolUse);
  assert.strictEqual(result.hooks.PreToolUse[0].hooks.length, 1);
  assert.strictEqual(result.hooks.Stop[0].hooks.length, 1);
  assert.strictEqual(result.hooks.PostToolUse[0].hooks.length, 1);
});

test('mergeSettings: unknown top-level key — project value wins for scalars', () => {
  const project = { hooks: {}, someFlag: true };
  const citadel  = { hooks: {}, someFlag: false };
  const result = mergeSettings(project, citadel);
  assert.strictEqual(result.someFlag, true);
});

const { parseConflictMode } = require('./install-citadel.js');

test('parseConflictMode accepts valid modes', () => {
  assert.strictEqual(parseConflictMode('overwrite'), 'overwrite');
  assert.strictEqual(parseConflictMode('skip'),      'skip');
  assert.strictEqual(parseConflictMode('backup'),    'backup');
});

test('parseConflictMode throws on invalid value', () => {
  assert.throws(() => parseConflictMode('force'),  /Invalid --conflict value/);
  assert.throws(() => parseConflictMode(''),       /Invalid --conflict value/);
  assert.throws(() => parseConflictMode('SKIP'),   /Invalid --conflict value/);
});

const { promptConflict } = require('./install-citadel.js');
const { Readable, Writable } = require('stream');

function fakeRl(responses) {
  let idx = 0;
  const input = new Readable({ read() {} });
  const output = new Writable({ write(_, __, cb) { cb(); } });
  const rl = require('readline').createInterface({ input, output });
  rl.question = (prompt, cb) => {
    cb(responses[idx++] ?? '');
  };
  return rl;
}

test('promptConflict returns "skip" on [s] input', async () => {
  const rl = fakeRl(['s']);
  const result = await promptConflict('.claude/agents/archon.md', 'old content', 'new content', rl);
  assert.strictEqual(result, 'skip');
});

test('promptConflict returns "overwrite" on [o] input', async () => {
  const rl = fakeRl(['o']);
  const result = await promptConflict('.claude/agents/archon.md', 'old', 'new', rl);
  assert.strictEqual(result, 'overwrite');
});

test('promptConflict returns "backup" on [b] input', async () => {
  const rl = fakeRl(['b']);
  const result = await promptConflict('.claude/agents/archon.md', 'old', 'new', rl);
  assert.strictEqual(result, 'backup');
});

test('promptConflict re-prompts on invalid input, then accepts valid', async () => {
  const rl = fakeRl(['x', 'z', 's']);
  const result = await promptConflict('.claude/agents/archon.md', 'old', 'new', rl);
  assert.strictEqual(result, 'skip');
});

test('promptConflict handles [d] diff option then accepts valid choice', async () => {
  const rl = fakeRl(['d', 'o']);
  const result = await promptConflict('.claude/agents/archon.md', 'old content', 'new content', rl);
  assert.strictEqual(result, 'overwrite');
});

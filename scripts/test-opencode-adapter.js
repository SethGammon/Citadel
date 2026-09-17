#!/usr/bin/env node

'use strict';

// Exercises the opencode plugin's hook runner against the real hooks_src
// processes. Runs under plain Node: no Bun and no opencode install required.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const runner = require(path.join(__dirname, '..', 'runtimes', 'opencode', 'plugin', 'hook-runner'));
const notices = require(path.join(__dirname, '..', 'runtimes', 'opencode', 'plugin', 'pending-notices'));
const reprompt = require(path.join(__dirname, '..', 'runtimes', 'opencode', 'plugin', 'reprompt'));

// The identity fields opencode's Part schema requires, and the id shapes it
// actually produces. Copied from a live 1.18.30 chat.message payload rather than
// invented: a fixture without these passes a test that the real runtime 500s.
const LIVE_SESSION = 'ses_f7397bd98ffeLPGvOZyadXx1vK';
const LIVE_MESSAGE = 'msg_08c6a73ed001hbO4Sj5TbAB6aV';
let livePartSeq = 0;

function livePart(text) {
  livePartSeq += 1;
  return {
    id: `prt_08c6a73ef001A3rbOphpakjt${String(livePartSeq).padStart(2, '0')}`,
    sessionID: LIVE_SESSION,
    messageID: LIVE_MESSAGE,
    type: 'text',
    text,
  };
}

function assertValidPart(part) {
  assert.match(part.id || '', /^prt/, 'a pushed part needs an id matching ^prt');
  assert.equal(typeof part.sessionID, 'string', 'a pushed part needs a sessionID');
  assert.equal(typeof part.messageID, 'string', 'a pushed part needs a messageID');
  assert.equal(part.sessionID, LIVE_SESSION, 'sessionID must come from the live message');
  assert.equal(part.messageID, LIVE_MESSAGE, 'messageID must come from the live message');
  assert.equal(part.type, 'text');
}

function tempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-opencode-'));
  fs.mkdirSync(path.join(root, '.opencode'), { recursive: true });
  return root;
}

function preTool(tool, args, extra = {}) {
  return { tool, args, directory: extra.directory, sessionID: 'ses_test', callID: 'call_test', ...extra };
}

async function testSecurityBlock(root) {
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=1\n');
  fs.writeFileSync(path.join(root, 'README.md'), '# ok\n');

  const blocked = await runner.runHooksForEvent(
    'tool.execute.before',
    preTool('read', { filePath: path.join(root, '.env') }, { directory: root }),
    { projectRoot: root },
  );
  assert.equal(blocked.blocked, true, 'reading .env must be blocked');
  assert.match(blocked.reason, /\.env/, 'the block reason must come from the hook, not a generic message');
  assert(blocked.results.some((r) => r.hook === 'protect-files'), 'protect-files should have run');

  const allowed = await runner.runHooksForEvent(
    'tool.execute.before',
    preTool('read', { filePath: path.join(root, 'README.md') }, { directory: root }),
    { projectRoot: root },
  );
  assert.equal(allowed.blocked, false, 'reading README.md must not be blocked');

  const forcePush = await runner.runHooksForEvent(
    'tool.execute.before',
    preTool('bash', { command: 'git push --force origin main' }, { directory: root }),
    { projectRoot: root },
  );
  assert.equal(forcePush.blocked, true, 'a force-push must be blocked');
  assert.match(forcePush.reason, /P-001|invariant/i);

  const plainPush = await runner.runHooksForEvent(
    'tool.execute.before',
    preTool('bash', { command: 'git status' }, { directory: root }),
    { projectRoot: root },
  );
  assert.equal(plainPush.blocked, false, 'git status must not be blocked');
}

// A non-blocking event must never report blocked, even when a hook exits 2.
async function testPostToolNeverBlocks(root) {
  const outcome = await runner.runHooksForEvent(
    'tool.execute.after',
    preTool('write', { filePath: path.join(root, 'README.md') }, { directory: root }),
    { projectRoot: root },
  );
  assert.equal(outcome.blocked, false, 'tool.execute.after must never block a tool that already ran');
  assert.equal(outcome.templateEvent, 'PostToolUse');
}

// A security hook that cannot give a verdict has to fail closed on a blocking
// event, and stay silent on a non-blocking one.
async function testFailClosed(root) {
  const emptyHooksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-nohooks-'));

  const blocking = await runner.runHooksForEvent(
    'tool.execute.before',
    preTool('read', { filePath: path.join(root, '.env') }, { directory: root }),
    { projectRoot: root, hooksDir: emptyHooksDir },
  );
  assert.equal(blocking.blocked, true, 'a missing security hook must fail closed');
  assert.match(blocking.reason, /missing/);

  const observing = await runner.runHooksForEvent(
    'tool.execute.after',
    preTool('write', { filePath: path.join(root, 'README.md') }, { directory: root }),
    { projectRoot: root, hooksDir: emptyHooksDir },
  );
  assert.equal(observing.blocked, false, 'a missing observer must not block');
}

// Timeouts are enforced by the adapter, because opencode applies none of its own.
async function testTimeoutEnforced(root) {
  const slowDir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-slow-'));
  // A hook that never exits. The adapter must kill it and, for a security hook
  // on a blocking event, refuse the action.
  fs.writeFileSync(
    path.join(slowDir, 'protect-files.js'),
    'setInterval(() => {}, 1000);\n',
  );

  const template = {
    hooks: {
      PreToolUse: [{
        matcher: 'Read',
        hooks: [{ type: 'command', command: 'node hooks_src/protect-files.js', timeout: 1 }],
      }],
    },
  };

  const started = Date.now();
  const outcome = await runner.runHooksForEvent(
    'tool.execute.before',
    preTool('read', { filePath: path.join(root, 'README.md') }, { directory: root }),
    { projectRoot: root, hooksDir: slowDir, template },
  );
  const elapsed = Date.now() - started;

  assert.equal(outcome.blocked, true, 'a timed-out security hook must fail closed');
  assert.match(outcome.reason, /timed out/);
  assert(outcome.results.some((r) => r.timedOut), 'the timeout must be recorded on the result');
  assert(elapsed < 10000, `the adapter must enforce its own timeout, took ${elapsed}ms`);
}

// apply_patch carries several targets in one call, so it must fan out into
// per-target Edit/Write payloads and be gated on each one.
function testApplyPatchProjection() {
  const operations = runner.parseApplyPatchOperations([
    '*** Begin Patch',
    '*** Update File: src/a.ts',
    '*** Add File: src/b.ts',
    '*** End Patch',
  ].join('\n'));
  assert.deepStrictEqual(operations, [
    { filePath: 'src/a.ts', toolName: 'Edit' },
    { filePath: 'src/b.ts', toolName: 'Write' },
  ]);

  assert.throws(() => runner.parseApplyPatchOperations('not a patch'), /boundaries/);
  assert.throws(() => runner.parseApplyPatchOperations(''), /non-empty/);

  // Without the alias, apply_patch matches none of the template's Edit|Write
  // matchers and would be gated by nothing at all.
  const { selected } = runner.selectHooks('PreToolUse', 'apply_patch');
  const names = selected.map((hook) => hook.name);
  assert(names.includes('protect-files'), 'apply_patch must still reach protect-files');
  assert(names.includes('governance'), 'apply_patch must still reach governance');
  assert(!names.includes('external-action-gate'), 'apply_patch must not reach the Bash-only gate');
}

async function testApplyPatchIsGated(root) {
  const patchOf = (...lines) => ['*** Begin Patch', ...lines, '*** End Patch'].join('\n');
  const gate = (args) => runner.runHooksForEvent(
    'tool.execute.before',
    preTool('apply_patch', args, { directory: root }),
    { projectRoot: root },
  );

  // opencode 1.18.30's apply_patch tool supplies `patchText`, not `command`
  // (packages/opencode/src/tool/apply_patch.ts). Fixtures that used `command`
  // tested a shape opencode never sends, and hid that a real patch was refused
  // before any hook ran: the splitter could not find the body and failed closed.
  const harmless = await gate({ patchText: patchOf('*** Update File: src/app.js', '@@', '-a', '+b') });
  assert.equal(harmless.blocked, false, 'a valid opencode patch must not be blocked');

  const added = await gate({ patchText: patchOf('*** Add File: src/new.js', '+hello') });
  assert.equal(added.blocked, false, 'adding a file by patch must not be blocked');

  // Both spellings must behave identically, so the Codex path keeps working.
  const viaCommand = await gate({ command: patchOf('*** Update File: src/app.js', '@@', '-a', '+b') });
  assert.equal(viaCommand.blocked, false, 'the command spelling must behave the same');

  const outcome = await gate({ patchText: patchOf('*** Update File: .env') });
  assert.equal(outcome.blocked, true, 'an apply_patch touching .env must be blocked');
  assert.match(outcome.reason, /protect-files/, 'the block must come from the gate, not a parse failure');

  // A move is a write to the destination, so the destination is what gets gated.
  const moved = await gate({ patchText: patchOf('*** Update File: src/a.js', '*** Move to: .env') });
  assert.equal(moved.blocked, true, 'a patch moving a file onto a protected path must be blocked');
  assert.match(moved.reason, /protect-files/);

  // A patch body the adapter cannot parse must not slip through ungated.
  const unparseable = await gate({ patchText: 'garbage' });
  assert.equal(unparseable.blocked, true, 'an unparseable apply_patch must fail closed');
  assert.match(unparseable.reason, /apply_patch/);

  // Neither spelling present is still a parse failure, not a pass.
  const empty = await gate({});
  assert.equal(empty.blocked, true, 'an apply_patch with no patch body must fail closed');
}

// Citadel agents restrict tools the Claude Code way. opencode has no such field,
// so a projection that drops them does not fall back to "restricted" -- it falls
// back to opencode's defaults, which allow edits and shell.
function testAgentToolRestrictionsProject() {
  const agents = require(path.join(__dirname, '..', 'runtimes', 'opencode', 'generators', 'project-agents'));
  const { opencodePermissionsFor, renderOpencodeAgent, CITADEL_STATE_TOOL_PATTERN: STATE_MCP } = agents;

  // The canonical read-only reviewer: an allow-list of read tools plus an
  // explicit deny-list.
  assert.deepStrictEqual(
    opencodePermissionsFor({
      tools: ['Read', 'Grep', 'Glob'],
      disallowedTools: ['Edit', 'Write', 'Bash', 'NotebookEdit'],
    }),
    { edit: 'deny', bash: 'deny', webfetch: 'deny', task: 'deny', skill: 'deny', [STATE_MCP]: 'deny' },
    'a read-only reviewer must deny everything its allow-list does not grant',
  );

  // An allow-list is exhaustive on its own: anything unnamed is not granted.
  assert.deepStrictEqual(
    opencodePermissionsFor({ tools: ['Read', 'Grep', 'Glob'] }),
    { edit: 'deny', bash: 'deny', webfetch: 'deny', task: 'deny', skill: 'deny', [STATE_MCP]: 'deny' },
    'an allow-list alone must still withhold what it does not name',
  );

  // ...but it must not over-deny what it does grant.
  assert.deepStrictEqual(
    opencodePermissionsFor({ tools: ['Read', 'Glob', 'Grep', 'Bash'] }),
    { edit: 'deny', webfetch: 'deny', task: 'deny', skill: 'deny', [STATE_MCP]: 'deny' },
    'a tool the allow-list grants must not be denied',
  );

  // A deny-list alone is honoured.
  assert.deepStrictEqual(
    opencodePermissionsFor({ disallowedTools: ['Bash'] }),
    { bash: 'deny', [STATE_MCP]: 'deny' },
    'a deny-list alone must be honoured',
  );

  // An unrestricted agent must not gain a permission block it never had.
  assert.deepStrictEqual(opencodePermissionsFor({}), {}, 'no restrictions means no permission block');
  assert.deepStrictEqual(
    opencodePermissionsFor({ tools: ['Read', 'Grep', 'Glob', 'Write', 'Edit', 'Bash', 'WebFetch', 'Agent', 'Skill'] }),
    {},
    'an agent granted everything gets no permission block',
  );

  // Write is covered by opencode's `edit` permission -- it has no write key, so a
  // Write-only restriction must still land somewhere.
  assert.deepStrictEqual(
    opencodePermissionsFor({ disallowedTools: ['Write'] }),
    { edit: 'deny', [STATE_MCP]: 'deny' },
    'Write must map onto opencode edit, which is what actually gates it',
  );

  // Delegation is the escape hatch. Proven live before this was added: a
  // read-only arch-reviewer denied edit and bash used `task` to ask archon to
  // write a file, and the file appeared on disk.
  assert.equal(
    opencodePermissionsFor({ disallowedTools: ['Agent'] }).task,
    'deny',
    'an agent forbidden to delegate must not keep opencode task',
  );
  assert.equal(
    opencodePermissionsFor({ tools: ['Read'] }).task,
    'deny',
    'an allow-list that does not grant delegation must withhold it',
  );
  assert.equal(
    opencodePermissionsFor({ tools: ['Read', 'Agent'] }).task,
    undefined,
    'an agent granted delegation must keep it',
  );

  // The allow-list is exhaustive over every tool Citadel can name, not just the
  // dangerous-looking ones. A skill is instructions rather than a capability, but
  // an agent that was not granted one does not get one.
  assert.equal(
    opencodePermissionsFor({ tools: ['Read'] }).skill,
    'deny',
    'an allow-list that does not grant Skill must withhold it',
  );
  assert.equal(
    opencodePermissionsFor({ tools: ['Read', 'Skill'] }).skill,
    undefined,
    'an agent granted Skill must keep it',
  );
  assert.equal(
    opencodePermissionsFor({ disallowedTools: ['Skill'] }).skill,
    'deny',
    'an explicit Skill deny must be honoured',
  );

  // Granted read tools must survive an otherwise restrictive allow-list.
  const readOnly = opencodePermissionsFor({ tools: ['Read', 'Grep', 'Glob'] });
  for (const kept of ['read', 'grep', 'glob']) {
    assert.equal(readOnly[kept], undefined, `a granted ${kept} must not be denied`);
  }
  // ...and an allow-list that withholds them denies them.
  assert.equal(opencodePermissionsFor({ tools: ['Read'] }).grep, 'deny', 'an ungranted grep is denied');
  assert.equal(opencodePermissionsFor({ tools: ['Grep'] }).read, 'deny', 'an ungranted read is denied');

  // opencode compiles any key at all -- `invalidkey: deny` became a real rule
  // that gates nothing -- so a typo here would look like a working restriction.
  // Every key the map can emit must be one opencode actually recognizes.
  const { OPENCODE_PERMISSION_BY_TOOL, KNOWN_OPENCODE_PERMISSIONS } = agents;
  for (const key of Object.keys(OPENCODE_PERMISSION_BY_TOOL)) {
    assert(
      KNOWN_OPENCODE_PERMISSIONS.includes(key),
      `"${key}" is not a permission opencode was observed to honour; a typo here fails silently`,
    );
  }

  // And it has to survive into the rendered frontmatter, which is the thing
  // opencode reads.
  const rendered = renderOpencodeAgent({
    name: 'arch-reviewer',
    frontmatter: {
      name: 'arch-reviewer',
      description: 'Read-only reviewer.',
      tools: ['Read', 'Grep', 'Glob'],
      disallowedTools: ['Edit', 'Write', 'Bash', 'NotebookEdit'],
    },
    body: 'body',
  });
  assert.match(rendered, /^permission:$/m, 'the projection must emit a permission block');
  assert.match(rendered, /^ {2}edit: deny$/m);
  assert.match(rendered, /^ {2}bash: deny$/m);
  assert.match(rendered, /^ {2}webfetch: deny$/m);
  assert.match(rendered, /^ {2}task: deny$/m);
  assert.match(rendered, /^ {2}skill: deny$/m);
  assert.match(rendered, /^ {2}"citadel-state_\*": deny$/m, 'the MCP key must be emitted quoted');
  // The block belongs to the frontmatter, not the body.
  const frontmatterOf = rendered.split('---')[1] || '';
  assert.match(frontmatterOf, /permission:/, 'the permission block must be inside the frontmatter');

  const open = renderOpencodeAgent({
    name: 'archon',
    frontmatter: { name: 'archon', description: 'Orchestrator.' },
    body: 'body',
  });
  assert(!/permission:/.test(open), 'an unrestricted agent must not gain a permission block');

  // The shipped read-only agents must actually be restricted, so a future edit to
  // one of them cannot quietly hand it write access on opencode.
  const parse = require(path.join(__dirname, '..', 'core', 'agents', 'parse-agent'));
  const agentsDir = path.join(__dirname, '..', 'agents');
  for (const name of ['arch-reviewer', 'policy-enforcer', 'phase-validator', 'knowledge-extractor']) {
    const frontmatter = parse.parseAgentFrontmatter(fs.readFileSync(path.join(agentsDir, `${name}.md`), 'utf8'));
    const permissions = opencodePermissionsFor(frontmatter);
    assert.equal(permissions.edit, 'deny', `${name} must not be able to edit on opencode`);
    assert.equal(permissions.bash, 'deny', `${name} must not be able to run shell on opencode`);
    // Without this every other deny is decorative: a subagent runs with its own
    // permissions, so delegation hands the work to something unrestricted.
    assert.equal(permissions.task, 'deny', `${name} must not be able to delegate around its own limits on opencode`);
    assert.equal(permissions.skill, 'deny', `${name} must not keep a skill tool its allow-list never granted`);
    // Read-only means read-only, not read-nothing: what the allow-list DOES grant
    // has to survive, or the restriction breaks the agent instead of bounding it.
    assert.equal(permissions.read, undefined, `${name} must keep the read access it was granted`);
    assert.equal(permissions.grep, undefined, `${name} must keep grep`);
    assert.equal(permissions.glob, undefined, `${name} must keep glob`);
  }
}

// The server does not know which agent is calling it, so the only thing keeping a
// reviewer from submitting a control intent is that the tool is withheld. This
// runs the real server so the pattern is checked against the names opencode will
// actually see, not a list copied into the test.
async function testRestrictedAgentsCannotReachCitadelState() {
  const agents = require(path.join(__dirname, '..', 'runtimes', 'opencode', 'generators', 'project-agents'));
  const { MCP_SERVER_NAME } = require(path.join(__dirname, '..', 'runtimes', 'opencode', 'generators', 'install-plugin'));
  const { opencodePermissionsFor, renderOpencodeAgent, CITADEL_STATE_TOOL_PATTERN } = agents;
  const parse = require(path.join(__dirname, '..', 'core', 'agents', 'parse-agent'));
  const { spawn } = require('child_process');

  const listed = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'mcp-servers', 'citadel-state', 'index.js')], {
      env: { ...process.env, CITADEL_PROJECT_ROOT: fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-mcp-gate-')) },
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const timer = setTimeout(() => { child.kill(); reject(new Error('citadel-state tools/list timed out')); }, 15000);
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const line = stdout.split('\n').find((candidate) => candidate.includes('"id":1'));
      if (!line) return;
      clearTimeout(timer);
      child.kill();
      resolve(JSON.parse(line).result.tools.map((tool) => tool.name));
    });
    child.on('error', reject);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })}\n`);
  });

  // opencode's own naming and matching: `<server>_<tool>` with anything outside
  // [A-Za-z0-9_-] replaced, and a permission key where `*` matches any run.
  const sanitize = (name) => name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const opencodeIds = listed.map((name) => `${sanitize(MCP_SERVER_NAME)}_${sanitize(name)}`);
  const pattern = new RegExp(`^${CITADEL_STATE_TOOL_PATTERN.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);

  assert(opencodeIds.includes('citadel-state_citadel_intent_submit'), 'the intent tool must be among the listed tools');
  assert(opencodeIds.some((id) => id.startsWith('citadel-state_citadel_operation_')), 'the operation control tools must be listed');
  for (const id of opencodeIds) assert.match(id, pattern, `${id} escapes the citadel-state deny`);
  // A key that gates a built-in would break the agent rather than bound it.
  for (const builtIn of ['read', 'grep', 'glob', 'edit', 'bash', 'task', 'skill', 'webfetch', 'todowrite', 'apply_patch', 'list_mcp_resources']) {
    assert.doesNotMatch(builtIn, pattern, `the citadel-state deny must not reach built-in ${builtIn}`);
  }

  const agentsDir = path.join(__dirname, '..', 'agents');
  const permissionsOf = (name) => opencodePermissionsFor(
    parse.parseAgentFrontmatter(fs.readFileSync(path.join(agentsDir, `${name}.md`), 'utf8')),
  );

  for (const name of ['arch-reviewer', 'policy-enforcer', 'phase-validator', 'knowledge-extractor', 'arbiter']) {
    assert.equal(
      permissionsOf(name)[CITADEL_STATE_TOOL_PATTERN],
      'deny',
      `${name} must not be able to submit a control intent on opencode`,
    );
  }

  // The orchestrators keep the server: nothing they project may match its tools.
  for (const name of ['archon', 'fleet']) {
    const permissions = permissionsOf(name);
    assert.deepStrictEqual(permissions, {}, `${name} must project unrestricted`);
    const parsed = parse.parseAgentFrontmatter(fs.readFileSync(path.join(agentsDir, `${name}.md`), 'utf8'));
    const rendered = renderOpencodeAgent({ name, frontmatter: parsed, body: 'body' });
    assert(!rendered.includes(MCP_SERVER_NAME), `${name} must not have citadel-state gated`);
  }
}

function testEventCoverage() {
  // Every opencode event the runner claims to handle must resolve to a template
  // event that actually exists, or the mapping is a dead entry.
  const template = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks', 'hooks-template.json'), 'utf8'));
  for (const [opencodeEvent, templateEvent] of Object.entries(runner.TEMPLATE_EVENT_BY_OPENCODE_EVENT)) {
    assert(
      Object.prototype.hasOwnProperty.call(template.hooks, templateEvent),
      `${opencodeEvent} maps to ${templateEvent}, which is not in hooks-template.json`,
    );
  }

  // Only the pre-tool gate may abort a call.
  assert.deepStrictEqual([...runner.BLOCKING_OPENCODE_EVENTS], ['tool.execute.before']);

  // An unmapped event is a recorded skip, not a crash.
  return runner.runHooksForEvent('session.error', {}).then((outcome) => {
    assert.equal(outcome.blocked, false);
    assert.equal(outcome.templateEvent, null);
    assert(outcome.skipped.length > 0, 'an unmapped event must be recorded as skipped');
  });
}

function testNodeBinaryResolution() {
  assert.equal(runner.resolveNodeBinary({ nodeBinary: '/custom/node' }), '/custom/node');
  const resolved = runner.resolveNodeBinary();
  assert(typeof resolved === 'string' && resolved.length > 0, 'a node binary must always resolve');
}

// The ESM shim is what opencode actually loads. Stub the runner through the CJS
// cache (index.mjs reaches it via createRequire, so it shares that cache) to
// prove the shim translates outcomes into opencode's throw/mutate contract.
async function testPluginShim(root) {
  const runnerPath = require.resolve(path.join(__dirname, '..', 'runtimes', 'opencode', 'plugin', 'hook-runner'));
  const realEntry = require.cache[runnerPath];
  const calls = [];
  let nextOutcome = { blocked: false, reason: null, messages: [], results: [], skipped: [] };

  require.cache[runnerPath] = {
    ...realEntry,
    exports: {
      TEMPLATE_EVENT_BY_OPENCODE_EVENT: runner.TEMPLATE_EVENT_BY_OPENCODE_EVENT,
      async runHooksForEvent(event, payload, options) {
        calls.push({ event, payload, options });
        return { event, ...nextOutcome };
      },
    },
  };

  try {
    const { CitadelPlugin } = await import(
      `../runtimes/opencode/plugin/index.mjs?cache=${Date.now()}`
    );
    const plugin = await CitadelPlugin({ directory: root, worktree: path.parse(root).root });

    // Plugin init stands in for SessionStart.
    assert.equal(calls[0].event, 'plugin.init', 'plugin init must run the session-start hooks');

    const shellOutput = { env: { USER_VALUE: 'kept' } };
    await plugin['shell.env']({}, shellOutput);
    assert.equal(shellOutput.env.USER_VALUE, 'kept', 'shell.env must preserve unrelated environment');
    assert.equal(shellOutput.env.CITADEL_RUNTIME, 'opencode');
    assert.equal(shellOutput.env.CITADEL_PROJECT_ROOT, root);
    assert.equal(shellOutput.env.CLAUDE_PROJECT_DIR, root);

    // A blocked pre-tool outcome has to become a throw, carrying the hook's own
    // reason so the model sees why.
    nextOutcome = { blocked: true, reason: '[protect-files] Blocked: cannot read .env', messages: [], results: [], skipped: [] };
    const args = { filePath: path.join(root, '.env') };
    const output = { args };
    await assert.rejects(
      () => plugin['tool.execute.before']({ tool: 'read', sessionID: 's', callID: 'c' }, output),
      (error) => {
        assert.equal(error.name, 'CitadelBlockedError');
        assert.match(error.message, /cannot read \.env/);
        return true;
      },
      'a blocked pre-tool outcome must throw',
    );
    // The shim must hand opencode's own args object through, not a copy, and must
    // never replace it — assigning output.args is silently discarded by opencode.
    assert.strictEqual(output.args, args, 'output.args must not be replaced');
    const preToolCall = calls.find((call) => call.event === 'tool.execute.before');
    assert.strictEqual(preToolCall.payload.args, args, 'the live args object must reach the runner');

    nextOutcome = { blocked: false, reason: null, messages: [], results: [], skipped: [] };
    fs.mkdirSync(path.join(root, '.citadel', 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(root, '.citadel', 'scripts', 'dashboard.js'), '');
    const bashArgs = { command: 'node scripts/dashboard.js' };
    await plugin['tool.execute.before']({ tool: 'bash', sessionID: 's', callID: 'route' }, { args: bashArgs });
    assert.equal(bashArgs.command, 'node .citadel/scripts/dashboard.js', 'installed skill routes must use project delegates');
    assert.strictEqual(
      calls.find((call) => call.payload?.callID === 'route').payload.args,
      bashArgs,
      'command translation must retain the live args object',
    );
    const targetTestArgs = { command: 'node scripts/test-all.js' };
    await plugin['tool.execute.before']({ tool: 'bash', sessionID: 's', callID: 'target-test' }, { args: targetTestArgs });
    assert.equal(targetTestArgs.command, 'node scripts/test-all.js', 'target project test commands must not be redirected into Citadel');

    // A post-tool outcome must never throw, even when hooks reported findings.
    nextOutcome = { blocked: true, reason: 'ignored', messages: ['[complexity-check] file is long'], results: [], skipped: [] };
    const afterOutput = { title: 't', output: 'done', metadata: {} };
    await plugin['tool.execute.after']({ tool: 'write', sessionID: 's', callID: 'c', args: {} }, afterOutput);
    assert.match(afterOutput.output, /done/, 'the tool output must be preserved');
    assert.match(afterOutput.output, /complexity-check/, 'findings must be appended to the output');

    // chat.message injects by pushing onto the existing parts array; replacing
    // output.parts would be discarded by opencode. The parts opencode hands over
    // are materialized Parts carrying id/sessionID/messageID, and the pushed one
    // must carry them too -- a part without them fails the whole prompt request.
    nextOutcome = { blocked: false, reason: null, messages: ['[citadel] campaign note'], results: [], skipped: [] };
    const parts = [livePart('hello')];
    const chatOutput = { message: { id: LIVE_MESSAGE, sessionID: LIVE_SESSION, role: 'user' }, parts };
    await plugin['chat.message']({ sessionID: LIVE_SESSION, messageID: LIVE_MESSAGE }, chatOutput);
    assert.strictEqual(chatOutput.parts, parts, 'output.parts must not be replaced');
    assert.equal(parts.length, 2, 'context must be pushed onto the existing array');
    assert.match(parts[1].text, /campaign note/);
    assertValidPart(parts[1]);

    // Nothing to anchor an id to means the part cannot be built. Pushing a
    // partial one 500s the turn, so the hook must push nothing at all.
    const orphan = { message: {}, parts: [] };
    await plugin['chat.message']({}, orphan);
    assert.equal(orphan.parts.length, 0, 'no identity means no push');

    // A thrown runner must not break an observer path.
    require.cache[runnerPath].exports.runHooksForEvent = async () => { throw new Error('boom'); };
    await plugin['tool.execute.after']({ tool: 'write', sessionID: 's', callID: 'c', args: {} }, { output: 'ok' });
    await plugin.dispose();

    // The event hook ignores bus events Citadel has no hooks for.
    await plugin.event({ event: { type: 'lsp.updated', properties: {} } });
  } finally {
    if (realEntry) require.cache[runnerPath] = realEntry;
    else delete require.cache[runnerPath];
  }
}

// Citadel hooks answer on stdout with a JSON envelope, not plain text. Before this
// was unwrapped, the adapter put the raw `{"hookSpecificOutput":{...}}` blob in
// front of the model.
function testStdoutEnvelopeUnwrapping() {
  const gateNonBlocking = JSON.stringify({
    hookSpecificOutput: { hookEventName: 'Stop', additionalContext: '[Quality Gate] 2 issue(s)' },
  });
  assert.equal(runner.messageFromStdout(gateNonBlocking), '[Quality Gate] 2 issue(s)');

  const gateBlocking = JSON.stringify({ decision: 'block', reason: 'fix these first' });
  assert.equal(runner.messageFromStdout(gateBlocking), 'fix these first');

  const uiShape = JSON.stringify({ hook: 'protect-files', action: 'blocked', message: 'cannot read .env' });
  assert.equal(runner.messageFromStdout(uiShape), 'cannot read .env');

  // Plain text keeps working, and an envelope with no human text is dropped rather
  // than shown raw.
  assert.equal(runner.messageFromStdout('just a line\nand another'), 'just a line');
  assert.equal(runner.messageFromStdout('{"unrecognized":true}'), '');
  assert.equal(runner.messageFromStdout('{not json'), '{not json');
  assert.equal(runner.messageFromStdout(''), '');
  assert.equal(runner.messageFromStdout(undefined), '');
}

function testPendingNoticeStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-notices-'));
  const S = 'ses_one';
  try {
    assert.deepStrictEqual(notices.peek(root, S), [], 'an absent store reads as empty');
    assert.deepStrictEqual(notices.drain(root, S), [], 'draining nothing is not an error');

    const added = notices.record(root, 'session.idle', ['finding one'], { sessionID: S });
    assert.equal(added.length, 1);

    // session.idle fires repeatedly with the same verdict, so identical findings
    // must not stack: the model would otherwise see N copies.
    assert.deepStrictEqual(notices.record(root, 'session.idle', ['finding one'], { sessionID: S }), []);
    assert.equal(notices.peek(root, S).length, 1);

    notices.record(root, 'session.idle', ['finding two'], { sessionID: S });
    assert.equal(notices.peek(root, S).length, 2);

    // A long session must not accumulate an unbounded prompt injection.
    for (let i = 0; i < notices.MAX_NOTICES + 5; i += 1) {
      notices.record(root, 'session.idle', [`bulk ${i}`], { sessionID: S });
    }
    assert.equal(notices.peek(root, S).length, notices.MAX_NOTICES);
    // The newest survive: a stale finding is less useful than the current one.
    assert(notices.peek(root, S).some((item) => item.text.includes(`bulk ${notices.MAX_NOTICES + 4}`)));

    // Draining delivers once.
    const drained = notices.drain(root, S);
    assert.equal(drained.length, notices.MAX_NOTICES);
    assert.deepStrictEqual(notices.peek(root, S), []);

    // Oversized text is truncated rather than injected whole.
    notices.record(root, 'session.idle', ['x'.repeat(notices.MAX_TEXT_LENGTH + 500)], { sessionID: S });
    assert.equal(notices.peek(root, S)[0].text.length, notices.MAX_TEXT_LENGTH);

    // A corrupt store must not break a turn.
    fs.writeFileSync(notices.storePath(root), '{ not json');
    assert.deepStrictEqual(notices.peek(root, S), [], 'a corrupt store reads as empty');
    assert.equal(notices.record(root, 'session.idle', ['after corruption'], { sessionID: S }).length, 1);

    // Empty and non-string inputs are ignored.
    assert.deepStrictEqual(notices.record(root, 'session.idle', ['  ', null, undefined], { sessionID: S }), []);

    // The rendered text must say why it is arriving late.
    const rendered = notices.renderForPrompt([{ text: 'the finding' }]);
    assert(rendered.includes('the finding'));
    assert(/cannot block/i.test(rendered), 'the injection must explain why it is late');

    // A notice belongs to the session whose turn produced it. The store is per
    // project and opencode runs many sessions in one, so an unscoped store let a
    // prompt in session B consume session A's finding and leave A uninformed.
    fs.rmSync(notices.storePath(root), { force: true });
    notices.record(root, 'session.idle', ['finding for A'], { sessionID: 'ses_a' });
    notices.record(root, 'session.idle', ['finding for B'], { sessionID: 'ses_b' });
    assert.deepStrictEqual(notices.peek(root, 'ses_a').map((n) => n.text), ['finding for A']);
    assert.deepStrictEqual(notices.peek(root, 'ses_b').map((n) => n.text), ['finding for B']);
    assert.deepStrictEqual(notices.peek(root, 'ses_c'), [], 'an uninvolved session sees nothing');

    assert.deepStrictEqual(notices.drain(root, 'ses_a').map((n) => n.text), ['finding for A']);
    assert.deepStrictEqual(
      notices.peek(root, 'ses_b').map((n) => n.text),
      ['finding for B'],
      "draining one session must not consume another's",
    );

    // The same finding in two sessions is not a duplicate: each must hear it.
    fs.rmSync(notices.storePath(root), { force: true });
    assert.equal(notices.record(root, 'session.idle', ['same text'], { sessionID: 'ses_a' }).length, 1);
    assert.equal(notices.record(root, 'session.idle', ['same text'], { sessionID: 'ses_b' }).length, 1);
    assert.equal(notices.record(root, 'session.idle', ['same text'], { sessionID: 'ses_a' }).length, 0, 'still deduped within a session');
    assert.equal(notices.peek(root, 'ses_a').length, 1);
    assert.equal(notices.peek(root, 'ses_b').length, 1);

    // The cap is per session, so a noisy session cannot evict a quiet one's.
    fs.rmSync(notices.storePath(root), { force: true });
    notices.record(root, 'session.idle', ['quiet session finding'], { sessionID: 'ses_quiet' });
    for (let i = 0; i < notices.MAX_NOTICES + 10; i += 1) {
      notices.record(root, 'session.idle', [`noisy ${i}`], { sessionID: 'ses_noisy' });
    }
    assert.equal(notices.peek(root, 'ses_noisy').length, notices.MAX_NOTICES, 'the noisy session is capped');
    assert.deepStrictEqual(
      notices.peek(root, 'ses_quiet').map((n) => n.text),
      ['quiet session finding'],
      "one session's flood must not evict another's finding",
    );

    // A notice written before scoping existed has no sessionID. Deliver it to
    // whoever asks next rather than stranding it forever.
    fs.rmSync(notices.storePath(root), { force: true });
    fs.mkdirSync(path.dirname(notices.storePath(root)), { recursive: true });
    fs.writeFileSync(
      notices.storePath(root),
      JSON.stringify({ version: 1, notices: [{ id: 'legacy', event: 'session.idle', text: 'legacy finding', at: 'x' }] }),
    );
    assert.deepStrictEqual(notices.drain(root, 'ses_any').map((n) => n.text), ['legacy finding'], 'a legacy notice is still delivered');
    assert.deepStrictEqual(notices.peek(root, 'ses_any'), [], 'and consumed once');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// Phase 6's exit condition, end to end against the real quality-gate hook: a
// failing gate at the end of one turn reaches the model on the next.
async function testDeferredGateReachesNextTurn() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-deferred-'));
  try {
    // quality-gate only reports on files git sees as changed, and only for rules
    // the project enables — builtIn defaults to empty once normalized.
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'harness.json'), JSON.stringify({
      version: 1,
      qualityRules: { builtIn: ['no-confirm-alert'], custom: [], blocking: false },
    }));
    const git = (args) => require('child_process').execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    git(['init', '-q']);
    fs.writeFileSync(path.join(root, 'ui.js'), 'function save() { confirm("sure?"); }\n');
    git(['add', '-A']);
    git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init']);
    fs.appendFileSync(path.join(root, 'ui.js'), 'function more() { alert("hi"); }\n');

    // The gate must actually have something to say, or the test proves nothing.
    const idle = await runner.runHooksForEvent('session.idle', { directory: root }, { projectRoot: root });
    assert.equal(idle.blocked, false, 'session.idle can never block on opencode');
    assert(idle.messages.length > 0, 'the gate must report a finding for this fixture');
    assert(idle.messages[0].includes('[Quality Gate]'), `unexpected finding: ${idle.messages[0]}`);
    assert(!idle.messages[0].startsWith('{'), 'the finding must be human text, not a JSON envelope');

    const { CitadelPlugin } = await import(
      `../runtimes/opencode/plugin/index.mjs?deferred=${Date.now()}`
    );
    const plugin = await CitadelPlugin({ directory: root, worktree: root });

    // Turn one ends. opencode fires session.idle several times.
    const sessionID = 'ses_deferred';
    await plugin.event({ event: { type: 'session.idle', properties: { sessionID } } });
    await plugin.event({ event: { type: 'session.idle', properties: { sessionID } } });
    assert.equal(notices.peek(root, sessionID).length, 1, 'repeated idle events must record one notice');
    assert.equal(notices.peek(root, 'ses_other').length, 0, 'the finding belongs to its own session');

    // A turn the finding cannot be injected into must keep it, not eat it.
    const undeliverable = { message: {}, parts: [] };
    await plugin['chat.message']({ sessionID }, undeliverable);
    assert.equal(undeliverable.parts.length, 0, 'no identity means no push');
    assert.equal(notices.peek(root, sessionID).length, 1, 'an undeliverable finding must survive the turn');

    // Another session's turn must not collect this session's finding.
    const otherSession = { message: { id: LIVE_MESSAGE, sessionID: LIVE_SESSION, role: 'user' }, parts: [livePart('unrelated prompt')] };
    await plugin['chat.message']({ sessionID: 'ses_other', messageID: LIVE_MESSAGE }, otherSession);
    assert.equal(otherSession.parts.length, 1, "another session's turn must not be given this finding");
    assert.equal(notices.peek(root, sessionID).length, 1, 'and must not consume it');

    // Turn two begins: the finding is handed to the model.
    const parts = [livePart('the next prompt')];
    const output = { message: { id: LIVE_MESSAGE, sessionID: LIVE_SESSION, role: 'user' }, parts };
    await plugin['chat.message']({ sessionID, messageID: LIVE_MESSAGE }, output);

    assert.strictEqual(output.parts, parts, 'output.parts must not be replaced');
    assert.equal(parts.length, 2, 'the finding must be pushed onto the existing array');
    assert(parts[1].text.includes('[Quality Gate]'), 'the gate finding must reach the next turn');
    assert(/cannot block/i.test(parts[1].text), 'the injection must explain the delay');
    assertValidPart(parts[1]);

    // Delivered once: a second turn must not repeat it.
    assert.deepStrictEqual(notices.peek(root, sessionID), [], 'the store must be drained');
    const parts2 = [livePart('turn three')];
    await plugin['chat.message']({ sessionID, messageID: LIVE_MESSAGE }, { message: {}, parts: parts2 });
    assert.equal(parts2.length, 1, 'a delivered finding must not be repeated');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// Re-prompting drives real model turns without a human asking, so the policy is
// off by default and the loop guard is the part that has to be right. These
// exercise the decision half directly -- no opencode needed to prove a cycle
// cannot happen.
function testRepromptPolicy() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-reprompt-'));
  try {
    const writeConfig = (value) => {
      fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(root, '.claude', 'harness.json'), value);
    };

    // Every path to "not explicitly enabled" must read as off.
    assert.equal(reprompt.readConfig(root).enabled, false, 'absent config is off');
    writeConfig('{}');
    assert.equal(reprompt.readConfig(root).enabled, false, 'empty config is off');
    writeConfig('{"opencode":{}}');
    assert.equal(reprompt.readConfig(root).enabled, false, 'an opencode block alone is off');
    writeConfig('{"opencode":{"repromptOnStopFindings":"yes"}}');
    assert.equal(reprompt.readConfig(root).enabled, false, 'only a literal true enables it');
    writeConfig('{ not json');
    assert.equal(reprompt.readConfig(root).enabled, false, 'corrupt config is off, never on');

    writeConfig('{"opencode":{"repromptOnStopFindings":true}}');
    const enabled = reprompt.readConfig(root);
    assert.equal(enabled.enabled, true);
    assert.equal(enabled.maxPerSession, reprompt.DEFAULT_MAX_PER_SESSION);

    // The cap bounds autonomous spending, so config must not be able to lift it.
    const tooBig = reprompt.HARD_MAX_PER_SESSION + 50;
    writeConfig('{"opencode":{"repromptOnStopFindings":true,"maxRepromptsPerSession":' + tooBig + '}}');
    assert.equal(reprompt.readConfig(root).maxPerSession, reprompt.HARD_MAX_PER_SESSION, 'the hard ceiling holds');
    writeConfig('{"opencode":{"repromptOnStopFindings":true,"maxRepromptsPerSession":0}}');
    assert.equal(reprompt.readConfig(root).maxPerSession, reprompt.DEFAULT_MAX_PER_SESSION, 'a nonsense cap falls back');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  // Disabled means never, regardless of how many findings arrive.
  const off = reprompt.createGuard({ enabled: false, maxPerSession: 5 });
  for (let i = 0; i < 5; i += 1) {
    assert.equal(off.consider('ses_a', true).send, false, 'a disabled policy never sends');
  }

  // An idle with nothing to say is not a reason to start a turn.
  const quiet = reprompt.createGuard({ enabled: true, maxPerSession: 2 });
  assert.equal(quiet.consider('ses_a', false).reason, 'no-finding');
  assert.equal(quiet.stats('ses_a').sent, 0, 'a quiet idle spends nothing');

  // The core loop guard: our own re-prompt's idle must never be answered.
  const guard = reprompt.createGuard({ enabled: true, maxPerSession: 2 });
  const first = guard.consider('ses_a', true);
  assert.equal(first.send, true, 'the first finding re-prompts');
  const second = guard.consider('ses_a', true);
  assert.equal(second.send, false);
  assert.equal(second.reason, 'idle-follows-reprompt', 'the idle our turn produced must be skipped');

  // A later human turn may re-prompt again, up to the cap, and then never.
  assert.equal(guard.consider('ses_a', true).send, true, 'a fresh idle may re-prompt within the cap');
  assert.equal(guard.consider('ses_a', true).reason, 'idle-follows-reprompt');
  assert.equal(guard.consider('ses_a', true).reason, 'cap-reached', 'the cap ends it');
  assert.equal(guard.consider('ses_a', true).reason, 'cap-reached', 'and stays ended');
  assert.equal(guard.stats('ses_a').sent, 2, 'exactly the cap was spent');

  // Even alternating with another session cannot lift either session's cap.
  assert.equal(guard.consider('ses_b', true).send, true, 'a different session has its own budget');
  assert.equal(guard.consider('ses_a', true).reason, 'cap-reached', 'and does not refresh the first');

  // Observed live: a re-prompt that works ends with the model having fixed the
  // finding, so the idle it produces is SILENT. That silent idle still has to
  // consume the loop mark, or the mark survives and eats the next legitimate
  // re-prompt instead.
  const fixed = reprompt.createGuard({ enabled: true, maxPerSession: 2 });
  assert.equal(fixed.consider('ses_c', true).send, true);
  assert.equal(fixed.consider('ses_c', false).reason, 'idle-follows-reprompt', 'a quiet idle consumes the mark');
  assert.equal(fixed.consider('ses_c', true).send, true, 'the next real finding is not swallowed');

  // No session id means no target, and must not spend budget.
  const strict = reprompt.createGuard({ enabled: true, maxPerSession: 2 });
  assert.equal(strict.consider(undefined, true).reason, 'no-session-id');
  assert.equal(strict.stats('ses_a').sent, 0, 'a missing id spends nothing');

  // An unbounded run must converge on silence rather than a cycle.
  const bounded = reprompt.createGuard({ enabled: true, maxPerSession: 3 });
  let sends = 0;
  for (let i = 0; i < 500; i += 1) if (bounded.consider('ses_loop', true).send) sends += 1;
  assert.equal(sends, 3, '500 findings must still yield exactly the cap');

  // The same, alternating quiet and loud idles the way a real session does.
  const realistic = reprompt.createGuard({ enabled: true, maxPerSession: 3 });
  let realSends = 0;
  for (let i = 0; i < 500; i += 1) if (realistic.consider('ses_mix', i % 2 === 0).send) realSends += 1;
  assert.equal(realSends, 3, 'mixed quiet and loud idles must still yield exactly the cap');
}

// The plugin must not re-prompt unless the project asked, must target the idle
// session with the shape opencode's SDK actually takes, and must hand the guard
// every idle -- including the silent one a successful re-prompt produces.
async function testRepromptWiring() {
  const root = tempProject();
  const runnerPath = require.resolve(path.join(__dirname, '..', 'runtimes', 'opencode', 'plugin', 'hook-runner'));
  const realEntry = require.cache[runnerPath];
  try {
    const calls = [];
    const client = {
      app: { log: async () => {} },
      session: { promptAsync: async (arg) => { calls.push(arg); return { data: {}, error: null }; } },
    };

    // The stub's verdict is switchable, so one plugin instance can see a finding,
    // then a clean turn, then a finding again -- the real sequence.
    let messages = ['[Quality Gate] something'];
    require.cache[runnerPath] = {
      ...realEntry,
      exports: {
        TEMPLATE_EVENT_BY_OPENCODE_EVENT: runner.TEMPLATE_EVENT_BY_OPENCODE_EVENT,
        runHooksForEvent: async () => ({ blocked: false, reason: null, messages, results: [], skipped: [] }),
      },
    };

    const idle = { event: { type: 'session.idle', properties: { sessionID: 'ses_live' } } };
    const load = async (tag) => {
      const mod = await import('../runtimes/opencode/plugin/index.mjs?rp=' + Date.now() + tag);
      return mod.CitadelPlugin({ directory: root, worktree: root, client });
    };

    // Default install: no opencode block in harness.json, so nothing is sent.
    const quiet = await load('a');
    await quiet.event(idle);
    assert.equal(calls.length, 0, 'a default install must never re-prompt');

    // Opted in, cap of two.
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.claude', 'harness.json'),
      '{"opencode":{"repromptOnStopFindings":true,"maxRepromptsPerSession":2}}',
    );
    const loud = await load('b');

    await loud.event(idle);
    assert.equal(calls.length, 1, 'an opted-in project re-prompts on a finding');
    assert.deepStrictEqual(calls[0].path, { id: 'ses_live' }, 'the re-prompt must target the idle session');
    assert.equal(calls[0].body.parts[0].type, 'text');
    assert.match(calls[0].body.parts[0].text, /Citadel/);
    // The finding rides in through chat.message, so the re-prompt must not
    // restate it -- that would double it in the new turn.
    assert(!calls[0].body.parts[0].text.includes('[Quality Gate]'), 'the re-prompt must not restate the finding');

    // Our own turn's idle. It must not be answered, whether or not it is silent.
    await loud.event(idle);
    assert.equal(calls.length, 1, 'the plugin must never answer its own re-prompt');

    // A silent idle with no re-prompt behind it must not spend budget or start a
    // turn. This is the case that separates "forwarded the real verdict" from
    // "forwarded a hardcoded true".
    const calm = await load('d');
    messages = [];
    await calm.event(idle);
    assert.equal(calls.length, 1, 'a silent idle on a fresh session must not re-prompt');

    // The realistic shape: the re-prompt worked, so the next idle carries no
    // finding. That silent idle has to reach the guard and consume the loop
    // mark, or the mark survives and eats the next real finding instead.
    const fresh = await load('c');
    messages = ['[Quality Gate] something'];
    await fresh.event(idle);
    assert.equal(calls.length, 2, 'a fresh instance re-prompts on its first finding');
    messages = [];
    await fresh.event(idle);
    assert.equal(calls.length, 2, 'a silent idle must never start a turn');
    messages = ['[Quality Gate] something else'];
    await fresh.event(idle);
    assert.equal(calls.length, 3, 'the silent idle must have consumed the loop mark');

    // And the cap still ends it.
    messages = [];
    await fresh.event(idle);
    messages = ['[Quality Gate] a third thing'];
    await fresh.event(idle);
    assert.equal(calls.length, 3, 'the cap holds through the plugin');
  } finally {
    if (realEntry) require.cache[runnerPath] = realEntry;
    else delete require.cache[runnerPath];
    fs.rmSync(root, { recursive: true, force: true });
  }
}


async function main() {
  const root = tempProject();
  try {
    testNodeBinaryResolution();
    testStdoutEnvelopeUnwrapping();
    testPendingNoticeStore();
    testApplyPatchProjection();
    await testEventCoverage();
    await testSecurityBlock(root);
    await testPostToolNeverBlocks(root);
    await testFailClosed(root);
    await testTimeoutEnforced(root);
    await testApplyPatchIsGated(root);
    testAgentToolRestrictionsProject();
    await testRestrictedAgentsCannotReachCitadelState();
    await testPluginShim(root);
    await testDeferredGateReachesNextTurn();
    testRepromptPolicy();
    await testRepromptWiring();
    console.log('opencode adapter tests pass.');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

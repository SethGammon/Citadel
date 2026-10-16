'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const cli = path.join(ROOT, 'bin/citadel.js');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function args(dir) {
  return ['--request', path.join(dir, 'request.json'), '--catalog', path.join(dir, 'catalog.json'), '--workspace', path.join(dir, 'workspace'), '--checkpoint', path.join(dir, 'checkpoint'), '--reconcile', path.join(dir, 'reconcile.json'), '--json'];
}
function call(dir, command, extra = []) {
  const result = spawnSync(process.execPath, [cli, 'operation', command, ...args(dir), ...extra], { encoding: 'utf8', windowsHide: true });
  return { ...result, json: result.stdout.trim() ? JSON.parse(result.stdout) : null };
}
function durableAppend(file, bytes) {
  const fd = fs.openSync(file, 'a');
  try { fs.writeSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

if (process.argv[2] === '--adapter') {
  let input = '';
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    const dir = process.argv[3], mode = process.argv[4];
    const request = JSON.parse(input).operation;
    const bytes = JSON.stringify({ operation_id: request.operation_id, value: 'verified task effect' }) + '\n';
    durableAppend(path.join(dir, 'launches'), 'launch\n');
    const artifact = path.join(process.cwd(), 'effects.jsonl');
    if (mode !== 'absent') durableAppend(artifact, mode === 'partial' ? bytes.slice(0, 12) : mode === 'wrong' ? 'wrong\n' : bytes.repeat(mode === 'duplicate' ? 2 : 1));
    // Probe refusal while the actual owner is alive, then kill only this
    // fixture adapter's direct parent (operation.js) after fsync, before reply.
    if (mode === 'good') {
      const live = call(dir, 'continue');
      assert.equal(live.json.code, 'RECONCILIATION_BLOCKED');
      assert.match(live.json.message, /still live/);
      fs.writeFileSync(path.join(dir, 'live-refusal.json'), JSON.stringify(live.json));
    }
    process.kill(process.ppid, 'SIGKILL');
    process.exit(0);
  });
} else {
  const temp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-reconcile-')));
  try {
    // Positive recovery is paired with pre-admission, evidence and verifier
    // failures. Every case independently checks that the adapter ran once only.
    for (const mode of ['good', 'absent', 'partial', 'wrong', 'duplicate', 'drift', 'intent', 'locked', 'verifier-fails', 'verifier-mutates', 'preexisting']) {
      const dir = path.join(temp, mode), workspace = path.join(dir, 'workspace');
      fs.mkdirSync(workspace, { recursive: true });
      const verifyCounter = path.join(dir, 'verifiers');
      fs.writeFileSync(path.join(workspace, 'verify.js'), `const f=require('fs'),a=require('assert');f.appendFileSync(${JSON.stringify(verifyCounter)},'verify\\n');a.equal(f.readFileSync('effects.jsonl','utf8').trim().split('\\n').length,1);`);
      if (mode === 'verifier-fails') fs.appendFileSync(path.join(workspace, 'verify.js'), 'process.exitCode=1;');
      if (mode === 'verifier-mutates') fs.appendFileSync(path.join(workspace, 'verify.js'), "f.writeFileSync('unexpected.txt','mutation');");
      const git = (...argv) => {
        const result = spawnSync('git', argv, { cwd: workspace, encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
      };
      git('init'); git('add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture');
      const example = path.join(ROOT, 'examples/operation-control');
      const request = JSON.parse(fs.readFileSync(path.join(example, 'request.json')));
      const catalog = JSON.parse(fs.readFileSync(path.join(example, 'catalog.json')));
      request.operation_id = `append-${mode}`;
      request.verifier.args = ['verify.js']; request.verifier.required_changed_paths = ['effects.jsonl'];
      catalog.adapters['local-check-adapter'].args = [__filename, '--adapter', dir, mode];
      catalog.plans[0].max_retries = 0; catalog.plans[0].retry_on = [];
      const expected = JSON.stringify({ operation_id: request.operation_id, value: 'verified task effect' }) + '\n';
      const spec = { schema: 1, kind: 'workspace-postconditions', files: [{ path: 'effects.jsonl', sha256: hash(expected) }] };
      for (const [name, data] of Object.entries({ 'request.json': request, 'catalog.json': catalog, 'reconcile.json': spec })) fs.writeFileSync(path.join(dir, name), JSON.stringify(data));
      if (mode === 'preexisting') {
        fs.writeFileSync(path.join(workspace, 'effects.jsonl'), expected);
        assert.equal(call(dir, 'run').json.code, 'RECONCILIATION_BLOCKED');
        assert.equal(fs.existsSync(path.join(dir, 'launches')), false);
        continue;
      }
      const interrupted = call(dir, 'run'); assert.notEqual(interrupted.status, 0);
      const journal = require('../core/operations').readJournal(path.join(dir, 'checkpoint/journal'));
      assert.deepEqual(journal.entries.map(e => e.state), ['pending']);
      if (mode === 'drift') fs.appendFileSync(path.join(workspace, 'verify.js'), '\n// drift');
      if (mode === 'intent') { spec.files[0].sha256 = '0'.repeat(64); fs.writeFileSync(path.join(dir, 'reconcile.json'), JSON.stringify(spec)); }
      if (mode === 'locked') fs.mkdirSync(path.join(dir, 'checkpoint/reconciliation.lock'));
      const resumed = call(dir, 'continue');
      if (mode === 'good') {
        assert.equal(resumed.status, 0, resumed.stdout);
        assert.equal(resumed.json.kind, 'citadel_operation_recovery_report');
        assert.equal(resumed.json.costs.actual_cash.status, 'unknown');
        assert.deepEqual(resumed.json.attempts, []);
        assert.equal(require('../core/operation-controller').verifyReport(resumed.json).status, 'verified');
        const forged = structuredClone(resumed.json); forged.recovery.adapter_reexecuted = true;
        delete forged.report_digest;
        forged.report_digest = require('../core/operation-controller').digest(forged);
        assert.equal(require('../core/operation-controller').verifyReport(forged).status, 'invalid');
        assert.equal(call(dir, 'continue').status, 0);
        assert.equal(fs.readFileSync(verifyCounter, 'utf8'), 'verify\n');
        assert.equal(fs.readFileSync(path.join(workspace, 'effects.jsonl'), 'utf8'), expected);
      } else {
        assert.notEqual(resumed.status, 0, `${mode} must refuse`);
        assert.equal(fs.existsSync(verifyCounter), mode.startsWith('verifier-'), 'bad effect evidence must block before verifier');
      }
      assert.equal(fs.readFileSync(path.join(dir, 'launches'), 'utf8'), 'launch\n', 'recovery must not repeat adapter');
    }
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  console.log('Operation reconciliation tests passed: killed-owner recovery, no duplicate effect, live-owner refusal, missing/partial/wrong/duplicate effects, verifier/input drift, honest receipts and repeated continuation.');
}

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const { digest, verifyReport } = require('../core/operation-controller');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

if (process.argv[2] === '--adapter') {
  const dir = process.argv[3], mode = process.argv[4];
  process.stdin.resume();
  process.stdin.on('end', () => {
    fs.appendFileSync(path.join(dir, 'launches'), 'launch\n');
    const fd = fs.openSync('effect.txt', 'a');
    fs.writeSync(fd, 'operation-specific-effect\n'); fs.fsyncSync(fd); fs.closeSync(fd);
    if (mode === 'orphan') {
      fs.writeFileSync(path.join(dir, 'orphan.pid'), String(process.pid));
      process.kill(process.ppid, 'SIGKILL');
      // Close inherited pipes so the CLI can exit while this exact child lives.
      process.stdout.destroy(); process.stderr.destroy(); process.stdin.destroy();
      setInterval(() => {}, 1000);
    } else { process.kill(process.ppid, 'SIGKILL'); process.exit(0); }
  });
} else if (process.argv[2] === '--fault-continue') {
  const dir = process.argv[3], phase = process.argv[4];
  const original = fs.fsyncSync;
  // Crash after durable receipt or journal publication, without production hooks.
  if (phase === 'receipt') {
    const write = fs.writeFileSync; let acceptedFd;
    fs.writeFileSync = function(file, data, ...rest) {
      if (typeof file === 'number' && String(data).includes('"payload_digest"') && String(data).includes('"report"')) acceptedFd = file;
      return write.call(this, file, data, ...rest);
    };
    fs.fsyncSync = function(fd) { original(fd); if (fd === acceptedFd) process.exit(91); };
  } else if (phase === 'journal') {
    const rename = fs.renameSync;
    fs.renameSync = function(from, to) { const result = rename(from, to); if (String(to).endsWith('00000002.json')) process.exit(92); return result; };
  } else if (phase === 'stale-concurrent') {
    const mkdir = fs.mkdirSync; let injected = false;
    fs.mkdirSync = function(file, ...args) {
      if (!injected && String(file).endsWith('reconciliation.lock')) {
        injected = true;
        assert.equal(call(dir).status, 0, 'competing continuation completed before lock claim');
      }
      return mkdir.call(this, file, ...args);
    };
  }
  const options = load(dir);
  require('./operation-continuation').continueOperation(options);
} else {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}

function load(dir) {
  const read = name => JSON.parse(fs.readFileSync(path.join(dir, name + '.json')));
  return { request: read('request'), catalog: read('catalog'), reconciliation: read('reconcile'), workspaceRoot: path.join(dir, 'workspace'), checkpoint: path.join(dir, 'checkpoint') };
}
function argv(dir, command = 'continue') {
  return [path.join(ROOT, 'bin/citadel.js'), 'operation', command, '--request', path.join(dir, 'request.json'), '--catalog', path.join(dir, 'catalog.json'), '--workspace', path.join(dir, 'workspace'), '--checkpoint', path.join(dir, 'checkpoint'), '--reconcile', path.join(dir, 'reconcile.json'), '--json'];
}
function call(dir, command = 'continue') {
  if (path.basename(dir) === 'orphan' && command === 'run') {
    // Launch the public command implementation with file-backed output: keeping
    // an orphan's inherited pipe open must not make the test kill its parent CLI
    // on timeout and accidentally clean up the very orphan being measured.
    const fd = fs.openSync(path.join(dir, 'run-output'), 'w');
    try { return spawnSync(process.execPath, [path.join(ROOT, 'scripts/operation.js'), ...argv(dir, command).slice(2)], { stdio: ['ignore', fd, fd], windowsHide: true, timeout: 30000 }); }
    finally { fs.closeSync(fd); }
  }
  const r = spawnSync(process.execPath, argv(dir, command), { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  return { ...r, json: r.stdout?.trim() ? JSON.parse(r.stdout) : null };
}
function git(dir, ...args) {
  const r = spawnSync('git', args, { cwd: path.join(dir, 'workspace'), encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
}
function fixture(temp, mode) {
  const dir = path.join(temp, mode), workspace = path.join(dir, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  const verifier = `const fs=require('fs'); fs.appendFileSync(${JSON.stringify(path.join(dir, 'verifiers'))},'verify\\n'); require('assert').equal(fs.readFileSync('effect.txt','utf8'),'operation-specific-effect\\n');`;
  let extra = '';
  if (mode === 'head-during-verification') extra = `require('child_process').execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid','commit','--allow-empty','-m','drift']);`;
  if (mode === 'verification-crash') extra = `if(!fs.existsSync(${JSON.stringify(path.join(dir, 'crashed'))})){fs.writeFileSync(${JSON.stringify(path.join(dir, 'crashed'))},'1');process.kill(process.ppid,'SIGKILL');}`;
  if (mode === 'concurrent') extra = `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,600);`;
  fs.writeFileSync(path.join(workspace, 'verify.js'), verifier + extra);
  fs.writeFileSync(path.join(workspace, 'input.txt'), 'original');
  git(dir, 'init'); git(dir, 'add', '.'); git(dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture');
  const example = path.join(ROOT, 'examples/operation-control');
  const request = JSON.parse(fs.readFileSync(path.join(example, 'request.json')));
  const catalog = JSON.parse(fs.readFileSync(path.join(example, 'catalog.json')));
  request.operation_id = 'boundary-' + mode;
  request.verifier.args = ['verify.js']; request.verifier.required_changed_paths = ['effect.txt'];
  catalog.adapters['local-check-adapter'].args = [__filename, '--adapter', dir, mode];
  catalog.plans[0].max_retries = 0; catalog.plans[0].retry_on = [];
  const reconcile = { schema: 1, kind: 'workspace-postconditions', files: [{ path: 'effect.txt', sha256: hash('operation-specific-effect\n') }] };
  for (const [name, obj] of Object.entries({ request, catalog, reconcile })) fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(obj));
  assert.notEqual(call(dir, 'run').status, 0);
  return dir;
}
async function main() {
  const temp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-boundaries-')));
  const results = [];
  async function test(name, body) {
    try { const detail = await body(); results.push({ name, status: 'passed', ...(detail ? { detail } : {}) }); }
    catch (e) { results.push({ name, status: 'failed', error: e.message }); }
  }
  try {
    // Independent boundary modes share a fixture, but each has a distinct oracle:
    // completed recovery, stale bindings, live ownership, or durable crash state.
    for (const mode of ['positive', 'head', 'input', 'unrelated', 'request', 'verifier', 'head-during-verification', 'orphan', 'registration-live', 'registration-missing', 'registration-invalid', 'verification-crash', 'receipt', 'journal', 'concurrent', 'stale-concurrent'].filter(mode => process.argv[2] !== '--case' || mode === process.argv[3])) {
      await test(mode, async () => {
        const dir = fixture(temp, mode), workspace = path.join(dir, 'workspace');
        try {
          if (mode === 'head') git(dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'changed');
          if (mode === 'input') fs.writeFileSync(path.join(workspace, 'input.txt'), 'changed');
          if (mode === 'unrelated') fs.writeFileSync(path.join(workspace, 'notes.txt'), 'unrelated but in whole-workspace contract');
          if (mode === 'request') { const p = path.join(dir, 'request.json'), r = JSON.parse(fs.readFileSync(p)); r.objective += ' different'; fs.writeFileSync(p, JSON.stringify(r)); }
          if (mode === 'verifier') fs.writeFileSync(path.join(workspace, 'verify.js'), 'process.exit(0)');
          if (mode.startsWith('registration-')) {
            const file = path.join(dir, 'checkpoint/adapter.json');
            if (mode === 'registration-missing') fs.unlinkSync(file);
            else {
              const record = JSON.parse(fs.readFileSync(file));
              if (mode === 'registration-live') record.pid = process.pid;
              else record.payload_digest = 'sha256:' + '0'.repeat(64);
              fs.writeFileSync(file, JSON.stringify(record));
            }
          }
          if (mode === 'concurrent') {
            const launch = () => new Promise(resolve => {
              const child = spawn(process.execPath, argv(dir), { windowsHide: true }); let stdout = '';
              child.stdout.on('data', data => { stdout += data; }); child.on('close', status => resolve({ status, stdout }));
            });
            const pair = await Promise.all([launch(), launch()]);
            assert(pair.some(r => r.status === 0), JSON.stringify(pair));
            assert.equal(fs.readFileSync(path.join(dir, 'verifiers'), 'utf8'), 'verify\n');
          } else if (mode === 'stale-concurrent') {
            const r = spawnSync(process.execPath, [__filename, '--fault-continue', dir, mode], { encoding: 'utf8', windowsHide: true });
            assert.notEqual(r.status, 0, 'stale reader must retry from current journal');
            assert.equal(fs.readFileSync(path.join(dir, 'verifiers'), 'utf8'), 'verify\n', 'stale lock claimant must not repeat verification');
            assert.equal(call(dir).status, 0);
          } else if (['receipt', 'journal'].includes(mode)) {
            const crash = spawnSync(process.execPath, [__filename, '--fault-continue', dir, mode], { encoding: 'utf8', windowsHide: true });
            assert.equal(crash.status, mode === 'receipt' ? 91 : 92, crash.stderr);
            const resumed = call(dir);
            // Completed journal is recoverable. An uncommitted receipt stays blocked.
            assert.equal(resumed.status === 0, mode === 'journal', resumed.stdout);
          } else if (mode === 'verification-crash') {
            assert.notEqual(call(dir).status, 0);
            assert.notEqual(call(dir).status, 0, 'uncertain interrupted verifier must remain blocked');
          } else {
            let orphanAlive = mode === 'orphan';
            if (mode === 'orphan') {
              try { process.kill(Number(fs.readFileSync(path.join(dir, 'orphan.pid'))), 0); }
              catch (error) { if (error.code !== 'ESRCH') throw error; orphanAlive = false; }
            }
            const r = call(dir);
            assert.equal(r.status === 0, mode === 'positive' || (mode === 'orphan' && !orphanAlive), r.stdout);
            if (mode === 'orphan') {
              assert.equal(fs.readFileSync(path.join(dir, 'launches'), 'utf8'), 'launch\n');
              assert.equal(fs.readFileSync(path.join(workspace, 'effect.txt'), 'utf8'), 'operation-specific-effect\n');
              return orphanAlive ? 'Surviving original adapter blocked.' : 'OS reaped original adapter; recovery passed. Live-orphan guard not exercised on this host.';
            }
            if (mode === 'positive') {
              assert.equal(call(dir).status, 0);
              for (const [label, mutate] of [
                ['missing request binding', r => { delete r.request_digest; }],
                ['invalid effect hash', r => { r.recovery.files[0].sha256 = 'bad'; }],
                ['missing operation identity', r => { delete r.operation_id; }],
              ]) {
                const forged = structuredClone(r.json); mutate(forged); delete forged.report_digest; forged.report_digest = digest(forged);
                assert.equal(verifyReport(forged).status, 'invalid', label);
              }
              const acceptedPath = path.join(dir, 'checkpoint/accepted.json');
              const saved = fs.readFileSync(acceptedPath);
              for (const field of ['operation_id', 'request_digest']) {
                const accepted = JSON.parse(saved);
                accepted.report[field] = field === 'operation_id' ? 'another-operation' : 'sha256:' + '0'.repeat(64);
                delete accepted.report.report_digest; accepted.report.report_digest = digest(accepted.report);
                fs.writeFileSync(acceptedPath, JSON.stringify(accepted));
                assert.notEqual(call(dir).status, 0, `wrong ${field} must not authorize continuation`);
              }
              fs.writeFileSync(acceptedPath, saved);
              fs.writeFileSync(path.join(workspace, 'effect.txt'), 'stale result');
              assert.notEqual(call(dir).status, 0, 'old valid receipt must not accept changed effect');
              fs.writeFileSync(path.join(workspace, 'effect.txt'), 'operation-specific-effect\n');
              assert.equal(call(dir).status, 0);
            }
          }
          assert.equal(fs.readFileSync(path.join(dir, 'launches'), 'utf8'), 'launch\n');
          assert.equal(fs.readFileSync(path.join(workspace, 'effect.txt'), 'utf8'), 'operation-specific-effect\n');
        } finally {
          const pidFile = path.join(dir, 'orphan.pid');
          if (fs.existsSync(pidFile)) { const pid = Number(fs.readFileSync(pidFile)); try { process.kill(pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') throw e; } await pause(100); }
        }
      });
    }
    console.log(JSON.stringify({ results }, null, 2));
    if (results.some(r => r.status === 'failed')) process.exitCode = 1;
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

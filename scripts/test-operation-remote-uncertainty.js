'use strict';

// Real loopback HTTP transport with a durable server ledger, not a mocked reply.
// This verifies safe refusal, not supported remote reconciliation.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');

if (process.argv[2] === '--server') {
  const dir = process.argv[3];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', data => { body += data; });
    req.on('end', () => {
      const fd = fs.openSync(path.join(dir, 'remote-ledger.jsonl'), 'a');
      fs.writeSync(fd, body + '\n'); fs.fsyncSync(fd); fs.closeSync(fd);
      // Commit is durable; deliberately lose the response.
      res.destroy();
    });
  });
  server.listen(0, '127.0.0.1', () => fs.writeFileSync(path.join(dir, 'port'), String(server.address().port)));
} else if (process.argv[2] === '--adapter') {
  const dir = process.argv[3]; let input = '';
  process.stdin.on('data', data => { input += data; });
  process.stdin.on('end', () => {
    fs.appendFileSync(path.join(dir, 'launches'), 'launch\n');
    const req = http.request({ hostname: '127.0.0.1', port: Number(fs.readFileSync(path.join(dir, 'port'))), method: 'POST', path: '/objects' });
    req.on('error', error => {
      fs.writeFileSync(path.join(dir, 'lost-response'), error.code);
      process.kill(process.ppid, 'SIGKILL'); process.exit(0);
    });
    req.end(JSON.stringify({ operation_id: JSON.parse(input).operation.operation_id, value: 'remote-effect' }));
  });
} else main().catch(error => { console.error(error); process.exitCode = 1; });

async function main() {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-remote-')));
  const server = spawn(process.execPath, [__filename, '--server', dir], { stdio: 'ignore', windowsHide: true });
  const closed = new Promise(resolve => server.on('close', resolve));
  try {
    const deadline = Date.now() + 10000;
    while (!fs.existsSync(path.join(dir, 'port'))) {
      assert(Date.now() < deadline, 'fixture HTTP server must start');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const workspace = path.join(dir, 'workspace'); fs.mkdirSync(workspace);
    fs.writeFileSync(path.join(workspace, 'verify.js'), 'process.exit(0);');
    for (const args of [['init'], ['add', '.'], ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture']]) {
      const result = spawnSync('git', args, { cwd: workspace, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
    }
    const example = path.join(ROOT, 'examples/operation-control');
    const request = JSON.parse(fs.readFileSync(path.join(example, 'request.json')));
    const catalog = JSON.parse(fs.readFileSync(path.join(example, 'catalog.json')));
    request.operation_id = 'lost-remote-response'; request.verifier.args = ['verify.js']; request.verifier.required_changed_paths = [];
    catalog.adapters['local-check-adapter'].args = [__filename, '--adapter', dir];
    catalog.plans[0].max_retries = 0; catalog.plans[0].retry_on = [];
    for (const [name, data] of Object.entries({ request, catalog })) fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(data));
    const call = (command, extra = []) => spawnSync(process.execPath, [path.join(ROOT, 'bin/citadel.js'), 'operation', command,
      '--request', path.join(dir, 'request.json'), '--catalog', path.join(dir, 'catalog.json'), '--workspace', workspace,
      '--checkpoint', path.join(dir, 'checkpoint'), '--json', ...extra], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
    assert.notEqual(call('run').status, 0);
    assert.equal(fs.readFileSync(path.join(dir, 'lost-response'), 'utf8'), 'ECONNRESET');
    for (let n = 0; n < 3; n++) {
      const result = call('continue'); assert.notEqual(result.status, 0);
      assert.equal(JSON.parse(result.stdout).code, 'CONTINUATION_BLOCKED', result.stdout);
    }
    const records = fs.readFileSync(path.join(dir, 'remote-ledger.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(records, [{ operation_id: 'lost-remote-response', value: 'remote-effect' }]);
    assert.equal(fs.readFileSync(path.join(dir, 'launches'), 'utf8'), 'launch\n');
    fs.writeFileSync(path.join(dir, 'remote-manifest.json'), JSON.stringify({ schema: 1, kind: 'remote-postconditions', files: [] }));
    const unsupported = call('continue', ['--reconcile', path.join(dir, 'remote-manifest.json')]);
    assert.equal(JSON.parse(unsupported.stdout).code, 'RECONCILIATION_BLOCKED');
    console.log('Remote uncertainty passed: HTTP committed then dropped response; three continuations blocked, one server effect, one adapter launch; unsupported remote manifest rejected.');
  } finally {
    server.kill('SIGKILL'); await closed;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
// macOS exposes its temp root through /var -> /private/var. Use its canonical
// location so the deliberate symlink guard is tested only on fixture links.
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-continuation-')));
const workspace = path.join(temp, 'workspace');
fs.mkdirSync(workspace);
function git(...args) {
  const result = spawnSync('git', args, { cwd: workspace, encoding: 'utf8', shell: false });
  assert.equal(result.status, 0, result.stderr);
}
function cli(command, extra = []) {
  const result = spawnSync(process.execPath, [path.join(root, 'bin/citadel.js'), 'operation', command,
    '--request', path.join(temp, 'request.json'), '--catalog', path.join(temp, 'catalog.json'),
    '--workspace', workspace, '--checkpoint', path.join(temp, 'checkpoint'), '--json', ...extra], { encoding: 'utf8', shell: false });
  return { ...result, json: JSON.parse(result.stdout) };
}
try {
  const example = path.join(root, 'examples/operation-control');
  for (const file of fs.readdirSync(example)) if (fs.statSync(path.join(example, file)).isFile()) fs.copyFileSync(path.join(example, file), path.join(workspace, file));
  fs.copyFileSync(path.join(example, 'request.json'), path.join(temp, 'request.json'));
  fs.copyFileSync(path.join(example, 'catalog.json'), path.join(temp, 'catalog.json'));
  const adapter = path.join(workspace, 'adapter.js');
  fs.appendFileSync(adapter, `\nrequire('fs').appendFileSync(${JSON.stringify(path.join(temp, 'launches'))}, 'launch\\n');\n`);
  git('init'); git('add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture');
  const interrupted = cli('run', ['--out', path.join(temp, 'missing', 'report.json')]);
  assert.equal(interrupted.status, 1);
  assert.equal(interrupted.json.code, 'ENOENT');
  const resumed = cli('continue', ['--out', path.join(temp, 'report.json'), '--history-out', path.join(temp, 'history.jsonl')]);
  assert.equal(resumed.status, 0, resumed.stdout);
  assert.equal(resumed.json.status, 'passed');
  assert.equal(cli('continue').status, 0);
  assert.equal(cli('run').json.code, 'CHECKPOINT_EXISTS');
  assert.equal(fs.readFileSync(path.join(temp, 'launches'), 'utf8'), 'launch\n');
  const input = path.join(temp, 'request.json'); const originalInput = fs.readFileSync(input);
  const request = JSON.parse(originalInput); request.objective += ' changed'; fs.writeFileSync(input, JSON.stringify(request));
  assert.equal(cli('continue').json.code, 'CONTINUATION_INPUT_CHANGED'); fs.writeFileSync(input, originalInput);
  const catalogFile = path.join(temp, 'catalog.json'); const catalogBytes = fs.readFileSync(catalogFile);
  const catalog = JSON.parse(catalogBytes); catalog.plans[0].label += ' changed'; fs.writeFileSync(catalogFile, JSON.stringify(catalog));
  assert.equal(cli('continue').json.code, 'CONTINUATION_INPUT_CHANGED'); fs.writeFileSync(catalogFile, catalogBytes);
  const original = fs.readFileSync(adapter); fs.appendFileSync(adapter, '\n// changed');
  assert.equal(cli('continue').json.code, 'CONTINUATION_ARTIFACT_CHANGED'); fs.writeFileSync(adapter, original);
  fs.writeFileSync(path.join(workspace, 'new.txt'), 'new');
  assert.equal(cli('continue').json.code, 'CONTINUATION_ARTIFACT_CHANGED'); fs.unlinkSync(path.join(workspace, 'new.txt'));
  fs.unlinkSync(adapter); assert.equal(cli('continue').json.code, 'CONTINUATION_ARTIFACT_CHANGED'); fs.writeFileSync(adapter, original);
  const accepted = path.join(temp, 'checkpoint/accepted.json'); const bytes = fs.readFileSync(accepted);
  const evidence = JSON.parse(bytes); evidence.report.status = 'failed'; fs.writeFileSync(accepted, JSON.stringify(evidence));
  assert.equal(cli('continue').json.code, 'CONTINUATION_EVIDENCE_INVALID'); fs.writeFileSync(accepted, bytes);
  assert.equal(cli('continue', ['--out', accepted]).json.code, 'CHECKPOINT_UNSAFE_PATH');
  assert.equal(cli('continue', ['--out', path.join(workspace, 'report.json')]).json.code, 'CHECKPOINT_UNSAFE_PATH');
  const completed = path.join(temp, 'checkpoint/journal/00000002.json'); const completedBytes = fs.readFileSync(completed);
  fs.unlinkSync(completed); assert.equal(cli('continue').json.code, 'CONTINUATION_BLOCKED'); fs.writeFileSync(completed, completedBytes);
  fs.writeFileSync(completed, '{}'); assert.notEqual(cli('continue').status, 0); fs.writeFileSync(completed, completedBytes);
  const journal = path.join(temp, 'checkpoint/journal'); const moved = path.join(temp, 'saved-journal');
  fs.renameSync(journal, moved); fs.symlinkSync(moved, journal, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(cli('continue').json.code, 'CHECKPOINT_UNSAFE_PATH'); fs.unlinkSync(journal); fs.renameSync(moved, journal);
  assert.equal(cli('continue').status, 0);
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'changed HEAD');
  assert.equal(cli('continue').json.code, 'CONTINUATION_INPUT_CHANGED');
  assert.equal(fs.readFileSync(path.join(temp, 'launches'), 'utf8'), 'launch\n', 'No guard or continuation may relaunch the adapter');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
console.log('Operation continuation tests passed: interrupted delivery, single launch, exports, input/artifact/evidence drift, journal corruption and symlink guards.');

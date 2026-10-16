'use strict';

const fs = require('fs');
const path = require('path');
const { digest, verifyAttempt } = require('../core/operation-controller');
const { recoveryReport } = require('../core/operation-controller/recovery-report');
const { appendJournalEntry } = require('../core/operations');

function reject(message) { throw Object.assign(new Error(message), { code: 'RECONCILIATION_BLOCKED' }); }

function validateSpec(options) {
  const spec = options.reconciliation;
  if (!spec || spec.schema !== 1 || spec.kind !== 'workspace-postconditions'
    || Object.keys(spec).sort().join(',') !== 'files,kind,schema'
    || !Array.isArray(spec.files) || spec.files.length < 1 || spec.files.length > 64) reject('Invalid reconciliation manifest.');
  const paths = new Set();
  for (const file of spec.files) {
    if (!file || Object.keys(file).sort().join(',') !== 'path,sha256' || typeof file.path !== 'string'
      || !file.path || path.isAbsolute(file.path) || file.path.includes('\\') || file.path.includes(':')
      || file.path.split('/').some(part => !part || part === '.' || part === '..')
      || !/^[a-f0-9]{64}$/.test(file.sha256) || paths.has(file.path.toLowerCase())) reject('Invalid or duplicate reconciliation artifact.');
    paths.add(file.path.toLowerCase());
  }
  // Recovery covers all declared output files, not just a convenient subset.
  const required = options.request.verifier.required_changed_paths;
  if (options.request.verifier.kind !== 'command' || digest([...required].sort()) !== digest(spec.files.map(f => f.path).sort())) reject('Reconciliation files must exactly match required_changed_paths.');
  if (options.catalog.plans.some(p => p.topology !== 'tool' || p.model !== null || p.max_retries !== 0 || p.fallback_plan_ids.length)) reject('Reconciliation currently requires deterministic tool plans without retries or fallbacks.');
  return spec;
}

function outsideEffects(files, spec) {
  const effects = new Set(spec.files.map(f => f.path));
  return files.filter(f => !effects.has(f.path));
}

function prepare(options, ctx, helpers) {
  const spec = validateSpec(options);
  // Keep the verifier implementation in the frozen workspace. It is a trusted,
  // read-only Node verifier; remote state and arbitrary external effects are not
  // covered by this reconciliation contract.
  const verifier = options.request.verifier;
  const cwd = helpers.safePath(path.resolve(ctx.root, verifier.cwd));
  const entry = helpers.safePath(path.resolve(cwd, verifier.args[0] || ''));
  const relative = path.relative(ctx.root, entry);
  if (!['node', process.execPath].includes(verifier.executable) || !relative || relative.startsWith('..') || path.isAbsolute(relative)
    || !fs.statSync(entry).isFile() || spec.files.some(f => path.resolve(ctx.root, f.path) === entry)) reject('Use a read-only Node verifier stored outside effect paths in the workspace.');
  const baseline = helpers.snapshot(ctx.root, [...spec.files.map(f => f.path), relative.replaceAll('\\', '/')]);
  for (const file of spec.files) if (baseline.find(f => f.path === file.path)?.sha256 === file.sha256) reject('An expected effect already exists before this operation.');
  return { schema: 1, binding: ctx.payload, owner_pid: process.pid, spec, baseline, verifier_path: relative.replaceAll('\\', '/') };
}

function validateCurrent(options, ctx, intent, helpers) {
  const current = helpers.snapshot(ctx.root, [...intent.spec.files.map(f => f.path), intent.verifier_path]);
  if (digest(outsideEffects(current, intent.spec)) !== digest(outsideEffects(intent.baseline, intent.spec))) reject('Workspace or verifier changed outside the declared effects.');
  for (const file of intent.spec.files) if (current.find(f => f.path === file.path)?.sha256 !== file.sha256) reject('Effect is missing, partial, duplicated or different from its frozen postcondition.');
  return current;
}

function reconcile(options, ctx, intent, entries, helpers) {
  const started = Date.now();
  // A live or inaccessible original owner is ambiguous. PID reuse can cause a
  // conservative refusal; a missing PID alone never proves effect completion.
  try { process.kill(intent.owner_pid, 0); reject('Original operation owner is still live.'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  const lock = helpers.safePath(path.join(ctx.checkpoint, 'reconciliation.lock'));
  try { fs.mkdirSync(lock); } catch (error) { if (error.code === 'EEXIST') reject('Another or interrupted reconciliation owns this checkpoint.'); throw error; }
  try {
    validateCurrent(options, ctx, intent, helpers);
    // The postcondition establishes the effect, not a synthetic adapter success.
    // verifyAttempt is used only to execute the existing independent verifier.
    const verification = verifyAttempt({ request: options.request, adapterResult: { status: 'completed', output: 'frozen postconditions observed' }, workspaceRoot: ctx.root });
    if (verification.status !== 'passed') reject(`Independent verification did not pass: ${verification.failure_code}`);
    const files = validateCurrent(options, ctx, intent, helpers);
    const report = recoveryReport(options.request, intent.spec.files, verification.evidence, Date.now() - started);
    const accepted = { schema: 1, payload_digest: ctx.payload, report, files };
    helpers.writeNew(path.join(ctx.checkpoint, 'accepted.json'), accepted);
    const first = entries[0];
    appendJournalEntry(path.join(ctx.checkpoint, 'journal'), {
      run_id: first.run_id, attempt_id: first.attempt_id, idempotency_key: first.idempotency_key,
      effect_class: first.effect_class, state: 'completed', payload_digest: ctx.payload, evidence_digest: digest(accepted),
    });
    return report;
  } finally { fs.rmdirSync(lock); }
}

module.exports = { prepare, reconcile, validateSpec, validateCurrent };

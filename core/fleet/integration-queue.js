'use strict';

// A read-only projection, never a merge authority. Fleet's existing durable
// decision remains necessary; the extra binding prevents reusing task-only
// evidence after either side of the proposed integration changes.
const { scopesOverlap } = require('../coordination/claims');
const { evaluateMergeCandidates, taskGovernanceAuthority } = require('./session');
const {
  authorizeDecision,
  deepFreeze,
  evaluateGate,
  governanceStorePaths,
  readDecisionReceipt,
  readJournalFile,
  sameSubject,
  sha256Digest,
  verifyReceiptLink,
} = require('../governance');

const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const validOid = (value) => typeof value === 'string'
  && [40, 64].includes(value.length) && OID.test(value);
const TASK_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const plain = (value) => value && typeof value === 'object'
  && Object.getPrototypeOf(value) === Object.prototype;
const text = (value, max = 2048) => typeof value === 'string'
  && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function validateTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.length > 2000) {
    throw new TypeError('tasks must be an array of at most 2000 work queue entries');
  }
  const ids = new Set();
  const authorities = new Set();
  for (const task of tasks) {
    if (!plain(task) || !text(task.id, 128) || !TASK_ID.test(task.id)
      || !text(task.status) || !task.status
      || !Array.isArray(task.deps) || task.deps.length > 2000
      || task.deps.some((dep) => !text(dep, 128) || !TASK_ID.test(dep))
      || new Set(task.deps).size !== task.deps.length
      || !Array.isArray(task.scope) || task.scope.length > 256
      || task.scope.some((scope) => !text(scope) || !scope.trim())
      || ![null, undefined].includes(task.wave) && (!Number.isSafeInteger(task.wave) || task.wave < 0)
      || ['campaign', 'branch', 'agent', 'evidence'].some((key) => task[key] !== undefined && !text(task[key]))) {
      throw new TypeError('invalid integration work queue entry');
    }
    const authority = taskGovernanceAuthority(task).id;
    if (ids.has(task.id) || authorities.has(authority)) {
      throw new TypeError('duplicate or ambiguous work queue task identity');
    }
    ids.add(task.id);
    authorities.add(authority);
  }
}

function identity(value) {
  return plain(value) && text(value.ref) && value.ref.trim()
    && validOid(value.oid) ? { ref: value.ref, oid: value.oid } : null;
}

/** Digest to include in the existing required observations' artifact_digests.
 * This is an evidence identifier, not a passing result or a new gate policy.
 */
function integrationEvidenceDigest(task, options = {}) {
  if (!validOid(options.baseOid) || !validOid(options.candidateOid)) {
    throw new TypeError('integration evidence requires full base and candidate commit OIDs');
  }
  const authority = taskGovernanceAuthority(task, options);
  return sha256Digest({
    contract: 'fleet-integration-evidence-v1',
    authority,
    base_oid: options.baseOid,
    candidate_oid: options.candidateOid,
  });
}

function orderedTasks(tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const remaining = new Map(tasks.map((task) => [task.id, new Set(task.deps.filter((id) => byId.has(id)))]));
  const order = [];
  const rank = (a, b) => (a.wave ?? Infinity) - (b.wave ?? Infinity) || compare(a.id, b.id);
  while (remaining.size) {
    const ready = [...remaining].filter(([, deps]) => deps.size === 0)
      .map(([id]) => byId.get(id)).sort(rank);
    if (!ready.length) break;
    // Pick one at a time: newly released dependencies have the same stable rank.
    const next = ready[0];
    remaining.delete(next.id);
    order.push(next);
    for (const deps of remaining.values()) deps.delete(next.id);
  }
  return { tasks: [...order, ...[...remaining.keys()].map((id) => byId.get(id)).sort(rank)], cyclic: new Set(remaining.keys()) };
}

function conflictScope(scope) {
  // Validate integration scope separately, then use the same normalized path
  // comparison as live claims and same-wave scheduling. Keep glob spelling so
  // the shared comparator can distinguish directory and partial-name prefixes.
  return scope.map((entry) => {
    const value = entry.trim().replace(/\(read-only\)$/, '').trim().replace(/\\/g, '/');
    const parts = value.split('/');
    if (value.startsWith('/') || /^[a-z]:/i.test(value) || parts.includes('..')) return null;
    return entry;
  });
}

function checkEvidence(projectRoot, assessment, digest, now) {
  if (!digest) return { ok: false, code: 'INTEGRATION_IDENTITY_REQUIRED', observations: [] };
  if (!projectRoot) return { ok: false, code: 'INTEGRATION_EVIDENCE_REQUIRED', observations: [] };
  try {
    const receipt = readDecisionReceipt(projectRoot, { kind: assessment.authority.kind, id: assessment.authority.id });
    const entries = readJournalFile(governanceStorePaths(projectRoot).journal);
    if (!receipt || receipt.receipt_digest !== assessment.governance?.receipt_digest
      || verifyReceiptLink(entries, receipt)) {
      return { ok: false, code: 'INTEGRATION_RECEIPT_CHANGED', observations: [] };
    }
    const decision = receipt.decision;
    const policy = entries.find((entry) => entry.record_type === 'policy'
      && entry.payload.policy_digest === decision.policy_digest)?.payload;
    const observations = entries.slice(0, receipt.journal_sequence - 1)
      .filter((entry) => entry.record_type === 'observation'
        && decision.observation_digests.includes(entry.payload.observation_digest)
        && sameSubject(entry.payload.subject, receipt.subject))
      .map((entry) => entry.payload);
    if (!policy) return { ok: false, code: 'INTEGRATION_POLICY_MISSING', observations: [] };
    // Replay with the existing evaluator, rather than inventing an acceptance
    // policy or trusting an isolated artifact/receipt supplied by the caller.
    const replay = evaluateGate({
      policy, observations, subject: receipt.subject,
      subjectDigest: receipt.subject_digest, subjectGeneration: receipt.subject_generation,
      requestedDisposition: 'merge', decidedAt: decision.decided_at,
    });
    if (replay.decision_digest !== decision.decision_digest) {
      return { ok: false, code: 'INTEGRATION_DECISION_MISMATCH', observations: [] };
    }
    // Decisions reference historical attempts too. Match the evaluator's latest
    // current observation for EACH requirement; an old or unrelated pass must
    // not carry a newer decision's exact-revision proof.
    const selected = policy.required_observations.map((required) => observations
      .filter((entry) => entry.producer.id === required.observation_id
        && entry.producer.kind === required.producer_kind
        && entry.producer_contract_digest === required.producer_contract_digest
        && entry.subject_digest === receipt.subject_digest
        && entry.subject_generation === receipt.subject_generation
        && (entry.expires_at === null || Date.parse(entry.expires_at) > Date.parse(decision.decided_at)))
      .sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at)
        || a.observation_id.localeCompare(b.observation_id)).at(-1));
    if (selected.some((entry) => !entry || entry.truth_status !== 'passed'
      || !entry.artifact_digests.includes(digest))) {
      return { ok: false, code: 'INTEGRATION_PROOF_MISSING_OR_STALE', observations: [] };
    }
    if (selected.some((entry) => entry.expires_at !== null && Date.parse(entry.expires_at) <= now)) {
      return { ok: false, code: 'INTEGRATION_PROOF_EXPIRED', observations: [] };
    }
    return { ok: true, code: 'INTEGRATION_PROOF_CURRENT', observations: selected.map((entry) => entry.observation_digest).sort() };
  } catch {
    return { ok: false, code: 'INTEGRATION_EVIDENCE_INVALID', observations: [] };
  }
}

/** Build a deterministic snapshot. No receipt, queue, ref or branch is written.
 * Recompute after every integration: all entries refer to the SAME base OID,
 * not a speculative chain of merges. `next` is the first eligible candidate.
 */
function buildIntegrationPlan(tasks, options = {}) {
  validateTasks(tasks);
  if (!plain(options) || !text(options.sessionId, 256) || !options.sessionId.trim()
    || options.projectRoot !== undefined && (!text(options.projectRoot, 32768) || !options.projectRoot.trim())
    || options.subjectGeneration !== undefined && (!Number.isSafeInteger(options.subjectGeneration) || options.subjectGeneration < 1)) {
    throw new TypeError('integration plan requires a sessionId and an optional projectRoot path');
  }
  const now = options.now === undefined ? Date.now() : Date.parse(options.now);
  if (!Number.isFinite(now)) throw new TypeError('integration plan now must be a timestamp');
  if (options.candidates !== undefined && !Array.isArray(options.candidates)) {
    throw new TypeError('candidates must be an array of taskId, ref, oid identities');
  }
  const candidates = new Map();
  for (const item of options.candidates || []) {
    if (!plain(item) || !text(item.taskId, 128) || !TASK_ID.test(item.taskId)
      || candidates.has(item.taskId) || !tasks.some((task) => task.id === item.taskId)) {
      throw new TypeError('invalid, duplicate or unknown candidate identity');
    }
    candidates.set(item.taskId, identity(item));
  }
  const base = identity(options.base);
  const sorted = orderedTasks(tasks);
  const assessments = evaluateMergeCandidates(sorted.tasks, {
    sessionId: options.sessionId,
    subjectGeneration: options.subjectGeneration,
    authorize: options.projectRoot
      ? (_task, authority, disposition) => authorizeDecision(options.projectRoot, authority, disposition)
      : undefined,
  });
  const scopes = new Map(assessments.map(({ task }) => [task.id, conflictScope(task.scope)]));
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const ancestors = new Map();
  const dependsOn = (id, target) => {
    if (ancestors.has(id)) return ancestors.get(id).has(target);
    const pending = [...byId.get(id).deps];
    const visited = new Set();
    while (pending.length) {
      const dep = pending.pop();
      if (visited.has(dep)) continue;
      visited.add(dep);
      pending.push(...(byId.get(dep)?.deps || []));
    }
    ancestors.set(id, visited);
    return visited.has(target);
  };
  const conflicts = [];
  for (let i = 0; i < assessments.length; i++) {
    for (let j = i + 1; j < assessments.length; j++) {
      const left = assessments[i].task.id;
      const right = assessments[j].task.id;
      const leftScope = scopes.get(left);
      const rightScope = scopes.get(right);
      if (!leftScope.includes(null) && !rightScope.includes(null) && scopesOverlap(leftScope, rightScope)) {
        // Dependencies already serialize overlapping work. Do not deadlock a
        // prerequisite on a dependent that Fleet cannot yet admit anyway.
        const ordered = !sorted.cyclic.has(left) && !sorted.cyclic.has(right)
          && (dependsOn(left, right) || dependsOn(right, left));
        conflicts.push({ left, right, ordered });
      }
    }
  }
  const entries = assessments.map((assessment) => {
    const { task, authority, governance, merge } = assessment;
    const candidate = candidates.get(task.id) || null;
    const blockers = [];
    const add = (code, details = {}) => blockers.push({ code, ...details });
    if (!base) add('BASE_IDENTITY_REQUIRED');
    if (!candidate) add('CANDIDATE_IDENTITY_REQUIRED');
    else if (candidate.ref !== task.branch) add('CANDIDATE_BRANCH_MISMATCH');
    if (base && candidate && base.oid.length !== candidate.oid.length) add('OBJECT_FORMAT_MISMATCH');
    if (base && candidate && base.oid === candidate.oid) add('CANDIDATE_ALREADY_BASE');
    if (!task.scope.length || scopes.get(task.id).includes(null)) add('SCOPE_REQUIRED_OR_INVALID');
    for (const blocker of [...merge.blockers].sort((a, b) => compare(a.dep, b.dep))) {
      add('DEPENDENCY_NOT_MERGED', { taskId: blocker.dep, status: blocker.status });
    }
    if (sorted.cyclic.has(task.id)) add('DEPENDENCY_CYCLE');
    for (const conflict of conflicts) {
      if (!conflict.ordered && (conflict.left === task.id || conflict.right === task.id)) {
        add('SCOPE_CONFLICT', { taskId: conflict.left === task.id ? conflict.right : conflict.left });
      }
    }
    if (governance?.authorized !== true) {
      add(merge.ok ? governance?.authorization_code || 'GOVERNANCE_AUTHORITY_REQUIRED' : 'GOVERNANCE_NOT_EVALUATED');
    }
    const requiredEvidenceDigest = base && candidate
      ? integrationEvidenceDigest(task, { ...options, baseOid: base.oid, candidateOid: candidate.oid }) : null;
    const evidence = checkEvidence(options.projectRoot, assessment, requiredEvidenceDigest, now);
    if (!evidence.ok) add(evidence.code);
    return {
      taskId: task.id, campaign: task.campaign || '', candidate,
      deps: [...task.deps].sort(), scope: [...task.scope].sort(),
      authority, governance: governance || null,
      requiredEvidenceDigest, evidence,
      status: blockers.length ? 'blocked' : 'eligible', blockers,
    };
  });
  const plan = {
    schema: 1,
    kind: 'fleet-integration-plan',
    readOnly: true,
    sessionId: options.sessionId,
    base,
    order: entries.map((entry) => entry.taskId),
    next: entries.find((entry) => entry.status === 'eligible')?.taskId || null,
    entries,
    scopeConflicts: conflicts,
    revalidation: 'Recompute against current local refs and governance after every base or candidate change. This snapshot does not authorize or execute a merge.',
  };
  return deepFreeze({ ...plan, planDigest: sha256Digest(plan) });
}

module.exports = { buildIntegrationPlan, integrationEvidenceDigest };

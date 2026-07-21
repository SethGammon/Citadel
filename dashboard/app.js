/* Citadel Mission Control client.
   Fetches /api/* snapshots, re-renders the active panel on SSE invalidation.
   No framework, no build step: this file is the bundle. */

'use strict';

const OPERATION_ACTION_RULES = Object.freeze({
  pending: Object.freeze(['stop']),
  running: Object.freeze(['pause', 'stop']),
  blocked: Object.freeze(['resume', 'stop', 'retry']),
  failed: Object.freeze(['retry']),
  unknown: Object.freeze(['retry']),
});

const OPERATION_EFFECTS = Object.freeze({
  pause: 'Next effect: the executor pauses work at a safe checkpoint.',
  resume: 'Next effect: the executor rechecks policy, then resumes work.',
  stop: 'Next effect: the executor ends this run. In-flight external work may need review.',
  retry: 'Next effect: the executor creates a new attempt. External effects are rechecked first.',
});

function availableOperationActions(operation) {
  if (!operation || !Array.isArray(operation.capabilities)) return [];
  if (operation.pending_intent) return [];
  const valid = OPERATION_ACTION_RULES[operation.status] || [];
  return valid.filter((action) => operation.capabilities.includes(action));
}

function operationActionEffect(action) {
  return OPERATION_EFFECTS[action] || 'Next effect is unknown.';
}

function operationActionNeedsConfirmation(action) {
  return action === 'stop' || action === 'retry';
}

function operationFeedback(outcome) {
  const values = {
    pending: 'Sending intent to the local queue.',
    accepted: 'Intent accepted. Waiting for an authorized executor.',
    conflict: 'State changed. Refresh before trying again.',
    blocked: 'This operation did not grant that capability.',
    rejected: 'The request was rejected. Review the current state.',
    unknown: 'The outcome is unknown. No success is assumed.',
  };
  return values[outcome] || values.unknown;
}

function forkSelectionAllowed(fork, branchId) {
  if (!fork || !fork.comparison || !Array.isArray(fork.comparison.branches)) return false;
  if (fork.status === 'landed') return false;
  const branch = fork.comparison.branches.find((entry) => entry.branch_id === branchId);
  return Boolean(branch && branch.comparable);
}

function forkComparisonLabel(comparison) {
  if (!comparison || comparison.outcome === 'insufficient-evidence') return 'Insufficient evidence';
  if (comparison.outcome === 'tie') return 'Verified tie';
  if (comparison.outcome === 'recommended') return `Recommendation: ${comparison.recommendation}`;
  return 'Comparison unknown';
}

if (typeof module !== 'undefined') module.exports = {
  availableOperationActions,
  operationActionEffect,
  operationActionNeedsConfirmation,
  operationFeedback,
  forkComparisonLabel,
  forkSelectionAllowed,
};

if (typeof document !== 'undefined') (() => {
  const PANELS = {
    overview: { title: 'Needs You', endpoint: '/api/overview', render: renderOverview },
    campaigns: { title: 'Campaigns', endpoint: '/api/campaigns', render: renderCampaigns },
    fleet: { title: 'Fleet', endpoint: '/api/fleet', render: renderFleet },
    forks: { title: 'Operation Forks', endpoint: '/api/forks', render: renderForks },
    loops: { title: 'Loops', endpoint: '/api/loops', render: renderLoops },
    cost: { title: 'Cost', endpoint: '/api/cost', render: renderCost },
    hooks: { title: 'Hook Feed', endpoint: '/api/hooks/feed', render: renderHooks },
    handoffs: { title: 'Handoffs', endpoint: '/api/handoffs', render: renderHandoffs },
    activation: { title: 'Activation', endpoint: '/api/activation', render: renderActivation },
  };

  const content = document.getElementById('content');
  const titleEl = document.getElementById('panel-title');
  const metaEl = document.getElementById('panel-meta');

  let activePanel = 'overview';
  let selectedIndex = 0;
  let needsYouCount = 0;
  let controlSession = null;
  let activeConfirmation = null;

  // ── helpers ──

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function badge(text, kind) {
    return el('span', `badge badge-${kind}`, text);
  }

  function stat(value, label, kind, note) {
    const box = el('div', `stat${kind ? ` stat-${kind}` : ''}`);
    box.appendChild(el('div', 'stat-value', value));
    box.appendChild(el('div', 'stat-label', label));
    if (note) box.appendChild(el('div', 'stat-note', note));
    return box;
  }

  function emptyState(message, command) {
    const box = el('div', 'empty');
    box.appendChild(el('div', null, message));
    if (command) box.appendChild(el('code', null, command));
    return box;
  }

  function section(title) {
    const wrap = el('div', 'section');
    wrap.appendChild(el('h2', 'section-title', title));
    return wrap;
  }

  function usd(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) return null;
    return `$${value.toFixed(2)}`;
  }

  function estMark(parent) {
    parent.appendChild(el('span', 'est', 'est.'));
  }

  function known(value) {
    return value === null || value === undefined ? 'unknown' : value;
  }

  function sourceNotice(data) {
    const state = data && data.state;
    if (!state || typeof state !== 'object' || !['unknown', 'unreadable'].includes(state.status)) return null;
    const card = el('div', `card state-${state.status}`);
    card.appendChild(el('div', 'card-title', state.status === 'unreadable' ? 'Source unreadable' : 'Source unknown'));
    card.appendChild(el('div', 'card-sub', `${state.path}: ${state.detail}`));
    for (const pathname of state.unreadable || []) card.appendChild(el('div', 'evidence', pathname));
    return card;
  }

  async function fetchView(endpoint) {
    const response = await fetch(endpoint, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${endpoint} -> ${response.status}`);
    return response.json();
  }

  async function getControlSession() {
    if (controlSession) return controlSession;
    const response = await fetch('/api/control', { cache: 'no-store' });
    if (!response.ok) throw new Error(`control session -> ${response.status}`);
    controlSession = await response.json();
    return controlSession;
  }

  function idempotencyKey(action) {
    const random = globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().toLowerCase()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `dashboard-${action}-${random}`;
  }

  async function submitOperationIntent(operation, action, bar, trigger) {
    const feedback = bar.querySelector('.control-feedback');
    const buttons = bar.querySelectorAll('button');
    buttons.forEach((button) => { button.disabled = true; });
    feedback.className = 'control-feedback feedback-pending';
    feedback.textContent = operationFeedback('pending');
    feedback.setAttribute('aria-busy', 'true');
    const key = trigger.dataset.idempotency || idempotencyKey(action);
    trigger.dataset.idempotency = key;
    try {
      const session = await getControlSession();
      const response = await fetch('/api/intents', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-citadel-nonce': session.nonce },
        body: JSON.stringify({
          operation_id: operation.operation_id,
          expected_revision: operation.revision,
          idempotency_key: key,
          actor: 'actor-dashboard',
          reason: `${action} requested from Mission Control`,
          capability: action,
          action,
        }),
      });
      const result = await response.json();
      const outcome = result.outcome || 'unknown';
      feedback.className = `control-feedback feedback-${outcome}`;
      feedback.textContent = operationFeedback(outcome);
      if (result.reason_code) feedback.textContent += ` ${result.reason_code}.`;
      if (outcome !== 'accepted') buttons.forEach((button) => { button.disabled = false; });
    } catch (_error) {
      feedback.className = 'control-feedback feedback-unknown';
      feedback.textContent = operationFeedback('unknown');
      buttons.forEach((button) => { button.disabled = false; });
    } finally {
      feedback.removeAttribute('aria-busy');
    }
  }

  async function submitForkSelection(fork, branch, card, trigger) {
    const feedback = card.querySelector('.fork-feedback');
    card.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    feedback.className = 'fork-feedback feedback-pending';
    feedback.textContent = 'Recording selection. This does not land or merge code.';
    feedback.setAttribute('aria-busy', 'true');
    const key = trigger.dataset.idempotency || idempotencyKey('fork-select');
    trigger.dataset.idempotency = key;
    try {
      const session = await getControlSession();
      const response = await fetch('/api/fork-selections', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-citadel-nonce': session.nonce },
        body: JSON.stringify({
          fork_id: fork.fork_id,
          branch_id: branch.branch_id,
          expected_revision: fork.revision,
          idempotency_key: key,
          actor: 'actor-dashboard',
          reason: 'Selected from the verified Mission Control comparison',
        }),
      });
      const result = await response.json();
      const outcome = result.outcome || 'unknown';
      feedback.className = `fork-feedback feedback-${outcome}`;
      feedback.textContent = outcome === 'accepted'
        ? 'Selection recorded. No code was landed. Run the displayed landing plan when ready.'
        : operationFeedback(outcome);
      if (result.reason_code) feedback.textContent += ` ${result.reason_code}.`;
      if (outcome === 'accepted') setTimeout(loadPanel, 250);
      else card.querySelectorAll('button').forEach((button) => { button.disabled = false; });
    } catch (_error) {
      feedback.className = 'fork-feedback feedback-unknown';
      feedback.textContent = operationFeedback('unknown');
      card.querySelectorAll('button').forEach((button) => { button.disabled = false; });
    } finally {
      feedback.removeAttribute('aria-busy');
    }
  }

  function closeConfirmation(restoreFocus = true) {
    if (!activeConfirmation) return;
    const { capsule, trigger } = activeConfirmation;
    capsule.remove();
    activeConfirmation = null;
    if (restoreFocus) trigger.focus();
  }

  function showConfirmation(operation, action, bar, trigger) {
    closeConfirmation(false);
    const capsule = el('div', 'confirmation-capsule');
    capsule.setAttribute('role', 'alertdialog');
    capsule.setAttribute('aria-label', `Confirm ${action}`);
    capsule.appendChild(el('div', 'confirmation-title', action === 'stop' ? 'Stop this run?' : 'Create another attempt?'));
    capsule.appendChild(el('div', 'card-sub', operationActionEffect(action)));
    const actions = el('div', 'confirmation-actions');
    const confirm = el('button', 'control-button control-danger', `Confirm ${action}`);
    confirm.type = 'button';
    const cancel = el('button', 'control-button control-quiet', 'Cancel');
    cancel.type = 'button';
    confirm.addEventListener('click', () => {
      closeConfirmation(false);
      submitOperationIntent(operation, action, bar, trigger);
    });
    cancel.addEventListener('click', () => closeConfirmation());
    actions.append(confirm, cancel);
    capsule.appendChild(actions);
    bar.appendChild(capsule);
    activeConfirmation = { capsule, trigger };
    confirm.focus();
  }

  function operationControlBar(operation) {
    const bar = el('div', 'operation-control');
    bar.dataset.operationId = operation.operation_id;
    const state = el('div', 'control-state');
    state.appendChild(badge(operation.status || 'unknown', ['failed', 'unknown'].includes(operation.status) ? 'danger' : 'info'));
    state.appendChild(el('span', 'control-revision', `revision ${operation.revision ?? 'unknown'}`));
    if (operation.pending_intent) state.appendChild(badge(`${operation.pending_intent.action} pending`, 'warn'));
    bar.appendChild(state);
    const actions = availableOperationActions(operation);
    const actionRow = el('div', 'control-actions');
    for (const action of actions) {
      const button = el('button', `control-button${operationActionNeedsConfirmation(action) ? ' control-risk' : ''}`, action);
      button.type = 'button';
      button.dataset.action = action;
      button.setAttribute('aria-label', `${action} ${operation.title || operation.operation_id}`);
      button.addEventListener('click', () => {
        if (operationActionNeedsConfirmation(action)) showConfirmation(operation, action, bar, button);
        else submitOperationIntent(operation, action, bar, button);
      });
      actionRow.appendChild(button);
    }
    bar.appendChild(actionRow);
    bar.appendChild(el('div', 'control-effect', operation.pending_intent
      ? `Next effect: an authorized executor evaluates the ${operation.pending_intent.action} intent.`
      : actions.length ? operationActionEffect(actions[0]) : 'No control action is currently authorized.'));
    const feedback = el('div', 'control-feedback');
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    if (operation.pending_intent) {
      feedback.className = 'control-feedback feedback-pending';
      feedback.textContent = 'Intent pending. No state change is assumed yet.';
    }
    bar.appendChild(feedback);
    return bar;
  }

  // ── panels ──

  function renderOverview(data) {
    const frag = document.createDocumentFragment();

    if (data.collect_error) {
      const card = el('div', 'card');
      card.appendChild(el('div', 'card-title', 'State unreadable'));
      card.appendChild(el('div', 'card-sub', `collector error: ${data.collect_error}`));
      frag.appendChild(card);
    }

    const stats = el('div', 'stats');
    stats.appendChild(stat(data.needs_you.length, 'need you', data.needs_you.length ? 'archon' : 'ok'));
    stats.appendChild(stat(known(data.active.campaigns), 'active campaigns', 'archon'));
    stats.appendChild(stat(known(data.active.fleet_sessions), 'fleet sessions', 'fleet'));
    stats.appendChild(stat(known(data.active.loops), 'active loops', 'marshal'));
    if (data.cost) {
      const hasReal = typeof data.cost.real === 'number' && data.cost.real > 0;
      const value = hasReal ? data.cost.real : data.cost.estimated;
      if (typeof value === 'number') {
        const costStat = stat(usd(value) || 'unknown',
          hasReal ? 'recent tracked spend' : 'all-time spend',
          'skill',
          hasReal ? 'real telemetry · recent sessions' : 'estimated from tokens');
        if (!hasReal) estMark(costStat.querySelector('.stat-value'));
        stats.appendChild(costStat);
      }
    }
    frag.appendChild(stats);

    const queue = section('Waiting on you');
    if (!data.needs_you.length) {
      queue.appendChild(emptyState('Nothing needs you. The harness is either idle or running clean.', '/do next'));
    } else {
      data.needs_you.forEach((item, index) => {
        const row = el('div', `row${index === selectedIndex ? ' selected' : ''}`);
        row.dataset.index = String(index);
        row.tabIndex = index === selectedIndex ? 0 : -1;
        row.setAttribute('role', 'button');
        if (item.evidence) row.dataset.evidence = item.evidence;
        row.appendChild(badge(item.kind, item.severity === 'action' ? 'action' : 'info'));
        const main = el('div', 'row-main');
        main.appendChild(el('div', 'row-title', item.title));
        main.appendChild(el('div', 'row-detail', item.detail));
        if (item.evidence) main.appendChild(el('div', 'evidence', item.evidence));
        row.appendChild(main);
        row.appendChild(el('span', 'row-age', item.age));
        queue.appendChild(row);
      });
      const hint = el('div', 'kbd-hint');
      hint.append('navigate ');
      hint.appendChild(el('kbd', null, 'j'));
      hint.append(' ');
      hint.appendChild(el('kbd', null, 'k'));
      queue.appendChild(hint);
    }
    frag.appendChild(queue);

    if (data.next_action && data.next_action.command) {
      const next = section('Suggested next action');
      const card = el('div', 'card');
      const title = el('div', 'card-title');
      title.appendChild(el('span', null, data.next_action.label || 'Next'));
      if (data.next_action.confidence) title.appendChild(badge(data.next_action.confidence, 'skill'));
      card.appendChild(title);
      card.appendChild(el('div', 'card-sub', data.next_action.why || ''));
      card.appendChild(el('div', 'evidence', data.next_action.command));
      next.appendChild(card);
      frag.appendChild(next);
    }

    return frag;
  }

  function renderCampaigns(data) {
    const frag = document.createDocumentFragment();
    const active = section('Active');
    const operationsById = new Map((data.operations || []).map((operation) => [operation.operation_id, operation]));
    if (!data.active.length) {
      active.appendChild(emptyState('No active campaigns.', '/do plan a campaign to <goal>'));
    } else {
      for (const campaign of data.active) {
        const card = el('div', 'card');
        const title = el('div', 'card-title');
        title.appendChild(el('span', null, campaign.title || campaign.slug || 'Untitled campaign'));
        title.appendChild(badge(campaign.status || 'unknown', campaign.status === 'active' ? 'ok' : 'info'));
        card.appendChild(title);
        const phases = Array.isArray(campaign.phases) ? campaign.phases : [];
        const done = phases.filter((p) => p && p.complete).length;
        if (phases.length) {
          card.appendChild(el('div', 'card-sub', `phase ${Math.min(done + 1, phases.length)} of ${phases.length}`));
          const bar = el('div', 'bar');
          const fill = el('div', 'bar-fill');
          fill.style.width = `${Math.round((done / phases.length) * 100)}%`;
          bar.appendChild(fill);
          card.appendChild(bar);
        }
        if (campaign.path) card.appendChild(el('div', 'evidence', campaign.path));
        const linkedOperation = operationsById.get(campaign.operation_id)
          || operationsById.get(campaign.slug)
          || operationsById.get(`operation-${campaign.slug}`);
        if (linkedOperation) card.appendChild(operationControlBar(linkedOperation));
        active.appendChild(card);
      }
    }
    frag.appendChild(active);

    if (data.operations && data.operations.length) {
      const operations = section('Operations');
      for (const operation of data.operations) {
        const card = el('div', 'card operation-card');
        const heading = el('div', 'card-title');
        heading.appendChild(el('span', null, operation.title || operation.operation_id));
        heading.appendChild(el('span', 'mono dimmed', operation.operation_id));
        card.appendChild(heading);
        card.appendChild(operationControlBar(operation));
        operations.appendChild(card);
      }
      frag.appendChild(operations);
    }

    if (data.ledger.length) {
      const ledger = section('Completed');
      const table = el('table');
      const head = el('tr');
      ['Campaign', 'Outcome', 'Completed'].forEach((h) => head.appendChild(el('th', null, h)));
      table.appendChild(head);
      for (const entry of data.ledger.slice(0, 20)) {
        const tr = el('tr');
        tr.appendChild(el('td', null, entry.title || entry.slug));
        const outcomeTd = el('td');
        outcomeTd.appendChild(badge(entry.outcome || 'unknown', entry.outcome === 'archived-completion' ? 'ok' : 'info'));
        tr.appendChild(outcomeTd);
        tr.appendChild(el('td', 'mono dimmed', (entry.completedAt || '').slice(0, 10) || 'unknown'));
        table.appendChild(tr);
      }
      ledger.appendChild(table);
      frag.appendChild(ledger);
    }
    return frag;
  }

  function renderFleet(data) {
    const frag = document.createDocumentFragment();
    const sessions = section('Sessions');
    if (!data.sessions.length) {
      sessions.appendChild(emptyState('No fleet sessions. Fleet splits broad work across agents in isolated worktrees.', '/do overhaul <scope> with a fleet'));
    } else {
      for (const sessionRecord of data.sessions) {
        const card = el('div', 'card');
        card.appendChild(el('div', 'card-title', sessionRecord.title || sessionRecord.id || 'Fleet session'));
        card.appendChild(el('div', 'card-sub', JSON.stringify(sessionRecord).slice(0, 200)));
        sessions.appendChild(card);
      }
    }
    frag.appendChild(sessions);

    const trees = section('Worktrees');
    const table = el('table');
    const head = el('tr');
    ['Branch', 'Path'].forEach((h) => head.appendChild(el('th', null, h)));
    table.appendChild(head);
    for (const tree of data.worktrees) {
      const tr = el('tr');
      const branchTd = el('td');
      branchTd.appendChild(badge(tree.branch || 'detached', 'fleet'));
      tr.appendChild(branchTd);
      tr.appendChild(el('td', 'mono dimmed', tree.path));
      table.appendChild(tr);
    }
    trees.appendChild(table);
    frag.appendChild(trees);
    return frag;
  }

  function renderForks(data) {
    const frag = document.createDocumentFragment();
    const notice = sourceNotice(data);
    if (notice) frag.appendChild(notice);
    if (!data.forks || !data.forks.length) {
      frag.appendChild(emptyState('No Operation Forks yet. Run one objective through Claude Code and Codex under the same proof contract.',
        'citadel fork start "your objective" --workflow .citadel/workflow.json'));
      return frag;
    }
    for (const fork of data.forks) {
      const wrap = section(fork.fork_id);
      const card = el('article', 'card fork-card');
      const heading = el('div', 'fork-heading');
      const title = el('div', 'card-title');
      title.appendChild(el('span', null, 'One operation, replaceable executors'));
      title.appendChild(badge(fork.status || 'unknown', ['ready', 'selected', 'landed'].includes(fork.status) ? 'ok'
        : ['blocked', 'failed', 'unknown'].includes(fork.status) ? 'danger' : 'info'));
      heading.appendChild(title);
      heading.appendChild(el('div', 'mono dimmed', `revision ${known(fork.revision)}`));
      card.appendChild(heading);

      const comparison = fork.comparison || { outcome: 'insufficient-evidence', comparable_count: 0, branches: [] };
      const verdict = el('div', `fork-verdict verdict-${comparison.outcome || 'unknown'}`);
      verdict.appendChild(el('strong', null, forkComparisonLabel(comparison)));
      verdict.appendChild(el('span', 'card-sub', `${comparison.comparable_count || 0} comparable branches`));
      card.appendChild(verdict);

      if (fork.proof && fork.proof.summary) {
        const proof = el('section', 'fork-proof');
        proof.appendChild(el('strong', null, 'Proof report'));
        const summary = fork.proof.summary;
        const models = summary.model_proof_counts || { passed: 0, failed: 0, unknown: summary.branch_count || 0 };
        const facts = el('div', 'fork-metrics');
        facts.appendChild(stat(`${summary.verified_receipt_count}/${summary.branch_count}`, 'verified receipts'));
        facts.appendChild(stat(models.passed, 'model passed'));
        facts.appendChild(stat(models.failed, 'model failed'));
        facts.appendChild(stat(models.unknown, 'model unknown'));
        proof.appendChild(facts);
        proof.appendChild(el('div', 'mono dimmed', fork.proof.digest));
        card.appendChild(proof);
      }

      const branches = el('div', 'fork-branches');
      for (const branch of comparison.branches || []) {
        const branchCard = el('section', `fork-branch${fork.selection?.branch_id === branch.branch_id ? ' fork-selected' : ''}`);
        const branchTitle = el('div', 'card-title');
        branchTitle.appendChild(el('span', 'fork-runtime', branch.runtime === 'claude' ? 'Claude Code' : 'Codex'));
        branchTitle.appendChild(badge(branch.verified_outcome || branch.status || 'unknown',
          branch.comparable ? 'ok' : branch.status === 'failed' ? 'danger' : 'info'));
        if (comparison.recommendation === branch.branch_id) branchTitle.appendChild(badge('recommended', 'skill'));
        if (fork.selection?.branch_id === branch.branch_id) branchTitle.appendChild(badge('selected', 'fleet'));
        branchCard.appendChild(branchTitle);
        const executor = branch.executor || null;
        if (executor) {
          const identity = el('div', 'fork-executor');
          identity.appendChild(el('div', 'mono dimmed', executor.profile_id
            + (executor.local_provider ? ` via ${executor.local_provider}` : '')));
          const facts = el('div', 'fork-metrics');
          facts.appendChild(stat(executor.requested_model, 'requested'));
          facts.appendChild(stat(executor.observed_model === null ? 'unknown' : executor.observed_model, 'observed'));
          facts.appendChild(stat(executor.model_status, 'model proof'));
          facts.appendChild(stat(executor.receipt_status, 'receipt'));
          identity.appendChild(facts);
          branchCard.appendChild(identity);
        }
        const metrics = el('div', 'fork-metrics');
        metrics.appendChild(stat(branch.evidence ? `${branch.evidence.present}/${branch.evidence.required}` : 'unknown', 'evidence'));
        metrics.appendChild(stat(branch.diff ? branch.diff.files_changed : 'unknown', 'files'));
        metrics.appendChild(stat(branch.duration_ms === null ? 'unknown' : `${(branch.duration_ms / 1000).toFixed(1)}s`, 'duration'));
        metrics.appendChild(stat(branch.cost ? `${branch.cost.amount} ${branch.cost.unit}` : 'unknown', 'cost'));
        branchCard.appendChild(metrics);
        if (!branch.comparable) {
          const missing = el('div', 'fork-unknown');
          missing.appendChild(el('strong', null, 'Not comparable'));
          missing.appendChild(el('span', null, (branch.reasons || ['unknown']).join(', ')));
          branchCard.appendChild(missing);
        }
        const select = el('button', 'control-button', fork.selection?.branch_id === branch.branch_id ? 'Selected' : `Select ${branch.runtime}`);
        select.type = 'button';
        select.disabled = !forkSelectionAllowed(fork, branch.branch_id) || fork.selection?.branch_id === branch.branch_id;
        select.addEventListener('click', () => submitForkSelection(fork, branch, card, select));
        branchCard.appendChild(select);
        branches.appendChild(branchCard);
      }
      card.appendChild(branches);
      const feedback = el('div', 'fork-feedback');
      feedback.setAttribute('role', 'status');
      feedback.setAttribute('aria-live', 'polite');
      card.appendChild(feedback);
      if (fork.selection) {
        const landing = el('div', 'fork-landing');
        landing.appendChild(el('strong', null, 'Selection is recorded. Code is still untouched.'));
        landing.appendChild(el('div', 'card-sub', 'Landing rechecks the target revision and clean state, then requires an exact confirmation token.'));
        landing.appendChild(el('code', null, `citadel fork land plan ${fork.fork_id}`));
        card.appendChild(landing);
      }
      wrap.appendChild(card);
      frag.appendChild(wrap);
    }
    return frag;
  }

  function renderLoops(data) {
    const frag = document.createDocumentFragment();
    const loops = section('Loop contracts');
    if (!data.loops.length) {
      loops.appendChild(emptyState(
        'No loops registered. A Citadel loop has a budget, a verifier, and stop conditions: a loop you can leave running.',
        '/loop'));
    } else {
      for (const loop of data.loops) {
        const status = loop.status || (loop.state && loop.state.status) || 'unknown';
        const card = el('div', 'card');
        const title = el('div', 'card-title');
        title.appendChild(el('span', null, loop.id || 'loop'));
        title.appendChild(badge(loop.type || 'loop', 'fleet'));
        title.appendChild(badge(status, ['done', 'verifier-passed'].includes(status) ? 'ok'
          : ['blocked', 'needs-human-review', 'unsafe-to-continue', 'verifier-failed'].includes(status) ? 'danger'
            : 'info'));
        card.appendChild(title);
        if (loop.budget) {
          const total = Number(loop.budget.total || loop.budget.attempts || 0);
          const spent = Number(loop.budget.spent || loop.budget.used || 0);
          if (total > 0) {
            card.appendChild(el('div', 'card-sub', `budget ${spent} / ${total}`));
            const bar = el('div', 'bar');
            const fill = el('div', `bar-fill${spent / total > 0.8 ? ' bar-warn' : ''}`);
            fill.style.width = `${Math.min(100, Math.round((spent / total) * 100))}%`;
            bar.appendChild(fill);
            card.appendChild(bar);
          }
        }
        if (loop.verifier) card.appendChild(el('div', 'evidence', `verifier: ${typeof loop.verifier === 'string' ? loop.verifier : JSON.stringify(loop.verifier)}`));
        loops.appendChild(card);
      }
    }
    frag.appendChild(loops);

    if (data.daemon) {
      const daemon = section('Daemon');
      const card = el('div', 'card');
      card.appendChild(el('div', 'card-title', 'Legacy daemon state'));
      card.appendChild(el('div', 'card-sub', `running: ${String(data.daemon.running ?? 'unknown')}`));
      daemon.appendChild(card);
      frag.appendChild(daemon);
    }
    return frag;
  }

  function renderCost(data) {
    const frag = document.createDocumentFragment();
    if (data.mode === 'unavailable') {
      frag.appendChild(emptyState(data.note, 'telemetry: enabled at /do setup'));
      return frag;
    }
    // Two windows, two sources: real_total covers recent sessions with real
    // telemetry; by_campaign and estimated_total are all-time token estimates.
    // They are never summed or shown in the same unlabeled column.
    const stats = el('div', 'stats');
    if (typeof data.real_total === 'number' && data.real_total > 0) {
      stats.appendChild(stat(usd(data.real_total), 'recent tracked spend', 'ok',
        `real telemetry · ${data.real_sessions ?? data.session_count ?? 0} session${(data.real_sessions ?? 0) === 1 ? '' : 's'}`));
    }
    if (typeof data.estimated_total === 'number') {
      const allTime = stat(usd(data.estimated_total), 'all-time spend', 'skill', 'estimated from token math');
      estMark(allTime.querySelector('.stat-value'));
      stats.appendChild(allTime);
    }
    stats.appendChild(stat(data.total_messages ?? 0, 'messages', 'archon'));
    stats.appendChild(stat(data.total_subagents ?? 0, 'subagents spawned', 'fleet'));
    frag.appendChild(stats);

    const note = el('div', 'card');
    note.appendChild(el('div', 'card-sub',
      'Estimates are computed locally from token counts and can differ from your bill; the provider console is authoritative. Subscription (Pro/Max) users: usage is included in your plan, so treat these as plan-load indicators, not charges.'));
    frag.appendChild(note);

    const byCampaign = data.by_campaign || {};
    const keys = Object.keys(byCampaign);
    if (keys.length) {
      const breakdown = section('By campaign · all time · estimated');
      const table = el('table');
      const head = el('tr');
      ['Campaign', 'Sessions', 'Spend'].forEach((h) => head.appendChild(el('th', null, h)));
      table.appendChild(head);
      for (const key of keys.sort((a, b) => (byCampaign[b].total_cost || 0) - (byCampaign[a].total_cost || 0))) {
        const entry = byCampaign[key];
        const tr = el('tr');
        tr.appendChild(el('td', key === '_unattached' ? 'dimmed' : null, key === '_unattached' ? 'unattached sessions' : key));
        tr.appendChild(el('td', 'num dimmed', entry.sessions ?? ''));
        const costTd = el('td', 'num');
        costTd.textContent = usd(entry.total_cost ?? 0) || 'unknown';
        estMark(costTd);
        tr.appendChild(costTd);
        table.appendChild(tr);
      }
      breakdown.appendChild(table);
      frag.appendChild(breakdown);
    }
    return frag;
  }

  function renderHooks(data) {
    const frag = document.createDocumentFragment();

    if (data.value) {
      const stats = el('div', 'stats');
      stats.appendChild(stat(data.value.hookFiresToday ?? 0, 'hook fires today', 'skill'));
      stats.appendChild(stat(data.value.protectFileBlocks ?? 0, 'file protections', 'ok'));
      stats.appendChild(stat(data.value.circuitBreakerTrips ?? 0, 'circuit breaker trips', 'archon'));
      stats.appendChild(stat(data.value.qualityGateViolations ?? 0, 'quality gate catches', 'marshal'));
      frag.appendChild(stats);
    }

    if (data.blocks.length) {
      const blocks = section('Recent blocks');
      for (const block of data.blocks.slice(0, 10)) {
        const row = el('div', 'row');
        row.appendChild(badge('blocked', 'danger'));
        const main = el('div', 'row-main');
        main.appendChild(el('div', 'row-title', block.description));
        main.appendChild(el('div', 'row-detail', block.hook));
        row.appendChild(main);
        row.appendChild(el('span', 'row-age', block.relative));
        blocks.appendChild(row);
      }
      frag.appendChild(blocks);
    }

    const feed = section('Recent activity');
    if (!data.feed.length) {
      feed.appendChild(emptyState('No hook activity recorded yet.', 'hooks log here as you work'));
    } else {
      const table = el('table');
      const head = el('tr');
      ['Hook', 'Outcome', 'Duration', 'When'].forEach((h) => head.appendChild(el('th', null, h)));
      table.appendChild(head);
      for (const entry of data.feed) {
        const tr = el('tr');
        tr.appendChild(el('td', 'mono', entry.hook));
        const outcomeTd = el('td');
        outcomeTd.appendChild(badge(entry.outcome || 'pass', entry.outcome === 'pass' ? 'ok' : 'warn'));
        tr.appendChild(outcomeTd);
        tr.appendChild(el('td', 'num dimmed', `${entry.durationMs ?? 0} ms`));
        tr.appendChild(el('td', 'mono dimmed', entry.relative));
        table.appendChild(tr);
      }
      feed.appendChild(table);
    }
    frag.appendChild(feed);

    if (data.overhead.length) {
      const overhead = section('Overhead (per hook)');
      const table = el('table');
      const head = el('tr');
      ['Hook', 'Fires', 'p50', 'p95', 'Max'].forEach((h) => head.appendChild(el('th', null, h)));
      table.appendChild(head);
      for (const entry of data.overhead) {
        const tr = el('tr');
        tr.appendChild(el('td', 'mono', entry.hook));
        tr.appendChild(el('td', 'num', entry.count));
        tr.appendChild(el('td', 'num', `${entry.p50Ms} ms`));
        tr.appendChild(el('td', 'num', `${entry.p95Ms} ms`));
        tr.appendChild(el('td', 'num dimmed', `${entry.maxMs} ms`));
        table.appendChild(tr);
      }
      overhead.appendChild(table);
      frag.appendChild(overhead);
    }
    return frag;
  }

  function renderHandoffs(data) {
    const frag = document.createDocumentFragment();
    const files = section('Handoff files');
    if (!data.handoffs.length) {
      files.appendChild(emptyState('No handoffs written yet. Handoffs let the next session resume your work.', 'they appear in .planning/handoffs/'));
    } else {
      for (const handoff of data.handoffs) {
        const row = el('div', 'row');
        row.tabIndex = 0;
        row.setAttribute('role', 'link');
        row.dataset.evidence = handoff.path;
        row.appendChild(badge('handoff', 'skill'));
        const main = el('div', 'row-main');
        main.appendChild(el('div', 'row-title', handoff.name));
        main.appendChild(el('div', 'evidence', handoff.path));
        row.appendChild(main);
        row.appendChild(el('span', 'row-age', (handoff.modifiedAt || '').slice(0, 16).replace('T', ' ')));
        files.appendChild(row);
      }
    }
    frag.appendChild(files);

    if (data.recent_activity.length) {
      const activity = section('Recent harness activity');
      for (const entry of data.recent_activity.slice(0, 15)) {
        const row = el('div', 'row');
        const main = el('div', 'row-main');
        main.appendChild(el('div', 'row-title', entry.name));
        main.appendChild(el('div', 'row-detail', entry.description));
        row.appendChild(main);
        row.appendChild(el('span', 'row-age', entry.relative));
        activity.appendChild(row);
      }
      frag.appendChild(activity);
    }
    return frag;
  }

  function renderActivation(data) {
    const frag = document.createDocumentFragment();
    const cohort = data.cohort;
    if (cohort) {
      const shared = section('Shared activation cohort');
      const status = el('div', 'card');
      status.appendChild(el('div', 'card-title', cohort.milestone_status.replace(/_/g, ' ')));
      status.appendChild(el('div', 'card-sub', data.cohort_note));
      shared.appendChild(status);
      const sharedStats = el('div', 'stats');
      sharedStats.appendChild(stat(cohort.cohort.shared_installations, 'shared installs', 'fleet', `target ${cohort.targets.shared_installations}`));
      sharedStats.appendChild(stat(cohort.cohort.seven_day_eligible, '7-day eligible', 'marshal'));
      sharedStats.appendChild(stat(cohort.cohort.verified_handoff_rate === null ? '?' : `${Math.round(cohort.cohort.verified_handoff_rate * 100)}%`, 'verified handoff', 'ok'));
      sharedStats.appendChild(stat(cohort.cohort.seven_day_return_rate === null ? '?' : `${Math.round(cohort.cohort.seven_day_return_rate * 100)}%`, '7-day return', 'skill'));
      shared.appendChild(sharedStats);
      for (const [name, result] of Object.entries(cohort.gates || {})) {
        const row = el('div', 'row');
        row.appendChild(badge(result.state, result.state === 'passed' ? 'ok' : result.state === 'failed' ? 'danger' : 'warn'));
        row.appendChild(el('div', 'row-main', name.replace(/_/g, ' ')));
        const value = typeof result.value === 'number' && result.value <= 1 ? `${Math.round(result.value * 100)}%` : (result.value ?? '?');
        const target = typeof result.target === 'number' && result.target <= 1 ? `${Math.round(result.target * 100)}%` : result.target;
        const progress = result.state === 'waiting' && Number.isInteger(result.eligible_count)
          ? `${result.eligible_count} / ${result.required_eligible} eligible`
          : `${value} / ${result.direction === 'max' ? 'max' : 'target'} ${target}`;
        row.appendChild(el('span', 'row-age', progress));
        shared.appendChild(row);
      }
      frag.appendChild(shared);
    }
    if (data.report) {
      const report = data.report;
      const local = section('Local activation journey');
      const stats = el('div', 'stats');
      stats.appendChild(stat(report.total_events, 'events', 'skill', 'local · redacted'));
      stats.appendChild(stat(report.unique_installations, 'installations', 'marshal'));
      stats.appendChild(stat(report.invalid_events, 'invalid events', report.invalid_events ? 'archon' : 'ok'));
      stats.appendChild(stat(report.migrated_events, 'migrated events', 'fleet'));
      local.appendChild(stats);
      const note = el('div', 'card');
      note.appendChild(el('div', 'card-title', data.mode === 'empty' ? 'No activation events yet' : 'Activation evidence'));
      note.appendChild(el('div', 'card-sub', data.note));
      local.appendChild(note);
      frag.appendChild(local);
      for (const [title, values] of [['Stages', report.by_stage], ['Outcomes', report.by_status], ['Acquisition', report.by_acquisition_source]]) {
        const block = section(title);
        const entries = Object.entries(values || {});
        if (!entries.length) block.appendChild(emptyState(`No ${title.toLowerCase()} recorded.`, 'activation events populate this view'));
        for (const [label, value] of entries) {
          const row = el('div', 'row');
          row.appendChild(el('div', 'row-main', label));
          row.appendChild(el('span', 'row-age', value));
          block.appendChild(row);
        }
        frag.appendChild(block);
      }
    }
    if (!data.report && !cohort) frag.appendChild(emptyState(data.note || 'Activation evidence is unknown.', 'node scripts/activation-telemetry.js report'));
    return frag;
  }

  // ── chrome: health, counts, SSE ──

  function updateChrome(overview) {
    needsYouCount = overview.needs_you.length;
    document.title = needsYouCount ? `(${needsYouCount}) Citadel` : 'Citadel';

    const countEl = document.getElementById('count-needs');
    countEl.textContent = needsYouCount || '';
    countEl.classList.toggle('hot', needsYouCount > 0);
    document.getElementById('count-campaigns').textContent = overview.active.campaigns ?? '?';
    document.getElementById('count-fleet').textContent = overview.active.fleet_sessions ?? '?';
    document.getElementById('count-forks').textContent = overview.active.forks ?? '?';
    document.getElementById('count-loops').textContent = overview.active.loops ?? '?';

    const dot = document.getElementById('health-dot');
    const text = document.getElementById('health-text');
    const health = overview.health;
    if (!overview.planning_exists) {
      dot.className = 'dot dot-warn';
      text.textContent = 'no .planning yet';
    } else if (health && health.hooksInstalled > 0) {
      dot.className = overview.state === 'unreadable' ? 'dot dot-danger' : 'dot dot-ok';
      text.textContent = overview.state === 'unreadable'
        ? 'one or more sources unreadable'
        : `${health.hooksInstalled} hooks · trust: ${health.trustLevel || 'unknown'}`;
    } else {
      dot.className = 'dot dot-unknown';
      text.textContent = 'hooks not detected';
    }
  }

  async function renderPanel(name) {
    const panel = PANELS[name] || PANELS.overview;
    activePanel = name in PANELS ? name : 'overview';
    titleEl.textContent = panel.title;

    document.querySelectorAll('#nav a').forEach((a) => {
      a.classList.toggle('active', a.dataset.panel === activePanel);
    });

    try {
      const [body, overviewBody] = await Promise.all([
        fetchView(panel.endpoint),
        activePanel === 'overview' ? null : fetchView('/api/overview'),
      ]);
      const overview = activePanel === 'overview' ? body.data : overviewBody.data;
      updateChrome(overview);
      metaEl.textContent = `as of ${new Date(body.generated_at).toLocaleTimeString()}`;
      const rendered = panel.render(body.data);
      const notice = sourceNotice(body.data);
      content.replaceChildren(notice || rendered);
    } catch (error) {
      content.replaceChildren(emptyState(`Could not reach the dashboard server: ${error.message}`, 'node scripts/dashboard-server.js'));
    }
  }

  function currentPanelFromHash() {
    const match = window.location.hash.match(/^#\/(\w+)/);
    return match ? match[1] : 'overview';
  }

  window.addEventListener('hashchange', () => {
    selectedIndex = 0;
    renderPanel(currentPanelFromHash());
  });

  document.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === 'Escape' && activeConfirmation) {
      event.preventDefault();
      closeConfirmation();
      return;
    }
    if (event.key === '?') {
      event.preventDefault();
      const help = document.getElementById('keyboard-help');
      help.hidden = !help.hidden;
      return;
    }
    const rows = content.querySelectorAll('.row[data-index]');
    if (event.key === 'Enter') {
      const selected = rows[selectedIndex] || document.activeElement;
      if (selected && selected.dataset && selected.dataset.evidence) {
        event.preventDefault();
        window.open(`/evidence?path=${encodeURIComponent(selected.dataset.evidence)}`, '_blank', 'noopener');
      }
      return;
    }
    if (!rows.length) return;
    if (event.key === 'j' || event.key === 'k') {
      event.preventDefault();
      selectedIndex = event.key === 'j'
        ? Math.min(rows.length - 1, selectedIndex + 1)
        : Math.max(0, selectedIndex - 1);
      rows.forEach((row, index) => row.classList.toggle('selected', index === selectedIndex));
      rows.forEach((row, index) => { row.tabIndex = index === selectedIndex ? 0 : -1; });
      rows[selectedIndex].focus({ preventScroll: true });
      rows[selectedIndex].scrollIntoView({ block: 'nearest' });
    }
  });

  function connectSSE() {
    const sseDot = document.getElementById('sse-dot');
    const sseText = document.getElementById('sse-text');
    const eventSource = new EventSource('/api/events');
    eventSource.onopen = () => {
      sseDot.className = 'dot dot-ok';
      sseText.textContent = 'live updates';
    };
    eventSource.onmessage = () => renderPanel(activePanel);
    eventSource.onerror = () => {
      sseDot.className = 'dot dot-warn';
      sseText.textContent = 'reconnecting…';
    };
  }

  renderPanel(currentPanelFromHash());
  // ?nosse=1 keeps headless screenshot runs from holding the connection open.
  if (!window.location.search.includes('nosse=1')) connectSSE();
})();

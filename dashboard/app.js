/* Citadel dashboard v0.1 — read-only client.
   Fetches /api/* snapshots, re-renders the active panel on SSE invalidation.
   No framework, no build step: this file is the bundle. */

'use strict';

(() => {
  const PANELS = {
    overview: { title: 'Needs You', endpoint: '/api/overview', render: renderOverview },
    campaigns: { title: 'Campaigns', endpoint: '/api/campaigns', render: renderCampaigns },
    fleet: { title: 'Fleet', endpoint: '/api/fleet', render: renderFleet },
    loops: { title: 'Loops', endpoint: '/api/loops', render: renderLoops },
    cost: { title: 'Cost', endpoint: '/api/cost', render: renderCost },
    hooks: { title: 'Hook Feed', endpoint: '/api/hooks/feed', render: renderHooks },
    handoffs: { title: 'Handoffs', endpoint: '/api/handoffs', render: renderHandoffs },
  };

  const content = document.getElementById('content');
  const titleEl = document.getElementById('panel-title');
  const metaEl = document.getElementById('panel-meta');

  let activePanel = 'overview';
  let selectedIndex = 0;
  let needsYouCount = 0;

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

  async function fetchView(endpoint) {
    const response = await fetch(endpoint, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${endpoint} -> ${response.status}`);
    return response.json();
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
    stats.appendChild(stat(data.active.campaigns, 'active campaigns', 'archon'));
    stats.appendChild(stat(data.active.fleet_sessions, 'fleet sessions', 'fleet'));
    stats.appendChild(stat(data.active.loops, 'active loops', 'marshal'));
    if (data.cost) {
      const hasReal = typeof data.cost.real === 'number' && data.cost.real > 0;
      const value = hasReal ? data.cost.real : data.cost.estimated;
      if (typeof value === 'number') {
        const costStat = stat(usd(value) || '—',
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
        active.appendChild(card);
      }
    }
    frag.appendChild(active);

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
        costTd.textContent = usd(entry.total_cost ?? 0) || '—';
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

  // ── chrome: health, counts, SSE ──

  function updateChrome(overview) {
    needsYouCount = overview.needs_you.length;
    document.title = needsYouCount ? `(${needsYouCount}) Citadel` : 'Citadel';

    const countEl = document.getElementById('count-needs');
    countEl.textContent = needsYouCount || '';
    countEl.classList.toggle('hot', needsYouCount > 0);
    document.getElementById('count-campaigns').textContent = overview.active.campaigns || '';
    document.getElementById('count-fleet').textContent = overview.active.fleet_sessions || '';
    document.getElementById('count-loops').textContent = overview.active.loops || '';

    const dot = document.getElementById('health-dot');
    const text = document.getElementById('health-text');
    const health = overview.health;
    if (!overview.planning_exists) {
      dot.className = 'dot dot-warn';
      text.textContent = 'no .planning yet';
    } else if (health && health.hooksInstalled > 0) {
      dot.className = 'dot dot-ok';
      text.textContent = `${health.hooksInstalled} hooks · trust: ${health.trustLevel || 'unknown'}`;
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
      content.replaceChildren(panel.render(body.data));
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
    const rows = content.querySelectorAll('.row[data-index]');
    if (!rows.length) return;
    if (event.key === 'j' || event.key === 'k') {
      event.preventDefault();
      selectedIndex = event.key === 'j'
        ? Math.min(rows.length - 1, selectedIndex + 1)
        : Math.max(0, selectedIndex - 1);
      rows.forEach((row, index) => row.classList.toggle('selected', index === selectedIndex));
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

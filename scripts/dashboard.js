#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { parseCampaignContent } = require('../core/campaigns/parse-campaign');
const { isPhaseComplete } = require('../core/campaigns/update-campaign');
const { readJsonlDetailed } = require('../core/telemetry/io');
const { getCoordinationStatus } = require('../core/coordination/instances');
const { getClaimStatus } = require('../core/coordination/claims');
const { readCostDashboard } = require('./telemetry-stats');
const { listReadinessReports } = require('../core/worktree/readiness');

const DEFAULT_RECENT_LIMIT = 10;

function parseArgs(argv) {
  const options = {
    projectRoot: process.env.CLAUDE_PROJECT_DIR || process.cwd(),
    json: false,
    recentLimit: DEFAULT_RECENT_LIMIT,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--project-root') {
      options.projectRoot = path.resolve(argv[++index]);
    } else if (arg === '--recent') {
      const parsed = Number(argv[++index]);
      if (!Number.isNaN(parsed) && parsed > 0) options.recentLimit = parsed;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }

  return options;
}

function usage() {
  return [
    'Usage: node scripts/dashboard.js [--json] [--project-root <path>] [--recent <n>]',
    '',
    'Renders a read-only Citadel control-plane snapshot from .planning/, telemetry, git, and hooks.',
  ].join('\n');
}

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function readJson(filePath) {
  const raw = readText(filePath);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function listFiles(dir, predicate = () => true) {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((entry) => predicate(entry))
      .map((entry) => path.join(dir, entry));
  } catch {
    return [];
  }
}

function tailJsonl(filePath, limit) {
  const detail = readJsonlDetailed(filePath);
  if (!detail.exists) return [];
  return detail.entries.slice(Math.max(0, detail.entries.length - limit));
}

function countJsonlLines(filePath) {
  const raw = readText(filePath);
  if (!raw) return 0;
  return raw.split(/\r?\n/).filter(Boolean).length;
}

function truncate(value, max) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3))}...`;
}

function relativeTime(timestamp, now = new Date()) {
  if (!timestamp) return 'unknown';
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return String(timestamp);

  const diffMs = Math.max(0, now.getTime() - date.getTime());
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
}

function extractDirection(content) {
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(/^\s*(?:\*\*)?Direction:(?:\*\*)?\s*(.*)$/i);
    if (!match) continue;

    const parts = [];
    if (match[1]) parts.push(match[1].trim());

    for (let next = index + 1; next < lines.length; next++) {
      const line = lines[next];
      if (!line.trim()) break;
      if (/^#/.test(line) || /^[A-Z][A-Za-z ]+:/.test(line)) break;
      parts.push(line.trim());
    }

    return parts.join(' ').trim();
  }
  return '';
}

function normalizeStatus(campaign) {
  const status = String(
    campaign.frontmatter.status ||
    campaign.frontmatter.Status ||
    campaign.bodyStatus ||
    'unknown'
  ).toLowerCase();

  const phases = campaign.phases || [];
  const allPhasesComplete = phases.length > 0 && phases.every(isPhaseComplete);
  if ((status === 'active' || status === 'needs-continue') && allPhasesComplete) {
    return 'needs-completion';
  }

  return status;
}

function phaseSummary(campaign) {
  const phases = campaign.phases || [];
  if (phases.length > 0) {
    const incomplete = phases.find((phase) => !/^(complete|completed|done)$/i.test(phase.status));
    const current = incomplete ? incomplete.number : phases.length;
    return {
      current,
      total: phases.length,
      label: `Phase ${current}/${phases.length}`,
    };
  }

  const total = Number(campaign.frontmatter.phase_count || 0);
  const current = Number(campaign.frontmatter.current_phase || 0);
  if (total > 0 && current > 0) {
    return { current, total, label: `Phase ${current}/${total}` };
  }

  return { current: 0, total: 0, label: 'No phase table' };
}

function lastDecision(content) {
  const sectionMatch = content.match(/^##\s+Decision Log\s*\r?\n([\s\S]*?)(?=^##\s+|\s*$)/m);
  if (!sectionMatch) return null;
  const section = sectionMatch[1];
  const decisions = section.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '));
  return decisions.length > 0 ? decisions[decisions.length - 1].replace(/^- /, '') : null;
}

function readCampaigns(projectRoot) {
  const campaignDir = path.join(projectRoot, '.planning', 'campaigns');
  const files = listFiles(campaignDir, (entry) => entry.endsWith('.md'));
  const campaigns = [];
  const skipped = [];

  for (const filePath of files) {
    const content = readText(filePath);
    if (!content) continue;
    try {
      const slug = path.basename(filePath, '.md');
      const parsed = parseCampaignContent(content, { slug });
      const direction = extractDirection(content);
      let status = normalizeStatus(parsed);
      if (status === 'completed' && path.dirname(filePath) === campaignDir) {
        status = 'needs-archive';
      }
      campaigns.push({
        slug,
        filePath,
        status,
        direction,
        phase: phaseSummary(parsed),
        lastDecision: lastDecision(content),
        modifiedAt: fs.statSync(filePath).mtime.toISOString(),
      });
    } catch (error) {
      skipped.push({ filePath, reason: error.message });
    }
  }

  campaigns.sort((left, right) => {
    const rank = (status) => {
      if (status === 'active') return 0;
      if (status === 'needs-completion') return 1;
      if (status === 'needs-archive') return 1;
      if (status.includes('approval') || status.includes('pending') || status === 'needs-continue') return 1;
      if (status === 'parked' || status === 'paused') return 2;
      return 3;
    };
    return rank(left.status) - rank(right.status) ||
      new Date(right.modifiedAt).getTime() - new Date(left.modifiedAt).getTime();
  });

  return { campaigns, skipped };
}

function parseFrontmatterLike(content, key) {
  const pattern = new RegExp(`^${key}:\\s*(.+)$`, 'im');
  const match = content.match(pattern);
  return match ? match[1].trim() : null;
}

function readFleetSessions(projectRoot) {
  const fleetDir = path.join(projectRoot, '.planning', 'fleet');
  const files = listFiles(fleetDir, (entry) => /^session-.*\.md$/i.test(entry));

  return files.map((filePath) => {
    const content = readText(filePath) || '';
    const slug = path.basename(filePath, '.md').replace(/^session-/, '');
    const status = parseFrontmatterLike(content, 'status') ||
      parseFrontmatterLike(content, 'Status') ||
      'unknown';
    const wave = parseFrontmatterLike(content, 'wave') ||
      parseFrontmatterLike(content, 'current_wave') ||
      'n/a';
    const agents = parseFrontmatterLike(content, 'agents_total') ||
      parseFrontmatterLike(content, 'agents') ||
      countTableAgents(content);
    return {
      slug,
      filePath,
      status,
      wave,
      agents,
      modifiedAt: safeMtime(filePath),
    };
  }).sort((left, right) => new Date(right.modifiedAt).getTime() - new Date(left.modifiedAt).getTime());
}

function countTableAgents(content) {
  const rows = content.split(/\r?\n/).filter((line) => /^\|\s*\d+\s*\|/.test(line));
  return rows.length;
}

function safeMtime(filePath) {
  try {
    return fs.statSync(filePath).mtime.toISOString();
  } catch {
    return null;
  }
}

function describeTelemetry(entry) {
  return truncate(
    entry.description ||
    entry.message ||
    entry.detail ||
    entry.target ||
    entry.status ||
    entry.reason ||
    entry.file ||
    entry.command ||
    entry.session ||
    entry.agent ||
    'event recorded',
    80
  );
}

function eventTimestamp(entry) {
  return entry.timestamp || entry.ts || entry.time || null;
}

function eventName(entry) {
  return entry.hook || entry.event || entry.type || entry.metric || 'event';
}

function readRecentActivity(projectRoot, limit, now) {
  const telemetryDir = path.join(projectRoot, '.planning', 'telemetry');
  const entries = [
    ...tailJsonl(path.join(telemetryDir, 'hook-timing.jsonl'), 50),
    ...tailJsonl(path.join(telemetryDir, 'audit.jsonl'), 50),
    ...tailJsonl(path.join(telemetryDir, 'agent-runs.jsonl'), 50),
    ...tailJsonl(path.join(telemetryDir, 'task-events.jsonl'), 50),
  ];

  return entries
    .map((entry) => ({
      timestamp: eventTimestamp(entry),
      relative: relativeTime(eventTimestamp(entry), now),
      name: eventName(entry),
      description: describeTelemetry(entry),
      raw: entry,
    }))
    .sort((left, right) => new Date(right.timestamp || 0).getTime() - new Date(left.timestamp || 0).getTime())
    .slice(0, limit);
}

function readHookActivity(projectRoot, limit, now) {
  const telemetryDir = path.join(projectRoot, '.planning', 'telemetry');
  const errors = tailJsonl(path.join(telemetryDir, 'hook-errors.jsonl'), 200);
  const timings = tailJsonl(path.join(telemetryDir, 'hook-timing.jsonl'), 50);

  return timings
    .filter((entry) => entry.hook || entry.metric || entry.event)
    .map((entry) => {
      const timestamp = eventTimestamp(entry);
      const hook = entry.hook || entry.metric || entry.event || 'hook';
      const blocked = errors.some((error) => {
        if ((error.hook || '') !== hook) return false;
        const left = new Date(eventTimestamp(error) || 0).getTime();
        const right = new Date(timestamp || 0).getTime();
        return Math.abs(left - right) <= 1000;
      });
      return {
        timestamp,
        relative: relativeTime(timestamp, now),
        hook,
        durationMs: typeof entry.duration_ms === 'number' ? entry.duration_ms : null,
        outcome: blocked ? 'block' : (entry.outcome || entry.status || 'pass'),
      };
    })
    .sort((left, right) => new Date(right.timestamp || 0).getTime() - new Date(left.timestamp || 0).getTime())
    .slice(0, limit);
}

function readQueueCounts(projectRoot) {
  const planningDir = path.join(projectRoot, '.planning');
  const telemetryDir = path.join(planningDir, 'telemetry');
  const intakeDir = path.join(planningDir, 'intake');

  return {
    docSync: countJsonlLines(path.join(telemetryDir, 'doc-sync-queue.jsonl')),
    mergeReviews: countJsonlLines(path.join(telemetryDir, 'merge-check-queue.jsonl')),
    intakeItems: listFiles(intakeDir, (entry) => entry.endsWith('.md') && entry !== '_TEMPLATE.md').length,
  };
}

function readHookValue(projectRoot) {
  const telemetryDir = path.join(projectRoot, '.planning', 'telemetry');
  const today = new Date().toISOString().slice(0, 10);
  const errors = tailJsonl(path.join(telemetryDir, 'hook-errors.jsonl'), 200);
  const timings = tailJsonl(path.join(telemetryDir, 'hook-timing.jsonl'), 200);
  const audit = tailJsonl(path.join(telemetryDir, 'audit.jsonl'), 200);

  return {
    circuitBreakerTrips: timings.filter((entry) => entry.hook === 'circuit-breaker' && entry.metric === 'trips').length +
      audit.filter((entry) => /circuit[-_]breaker/i.test(String(entry.event || entry.hook || ''))).length,
    qualityGateViolations: errors.filter((entry) => entry.hook === 'quality-gate').length +
      timings.filter((entry) => entry.hook === 'quality-gate' && entry.metric === 'violations').length,
    protectFileBlocks: errors.filter((entry) => entry.hook === 'protect-files').length,
    externalGateActions: errors.filter((entry) => entry.hook === 'external-action-gate').length,
    hookFiresToday: timings.filter((entry) => String(eventTimestamp(entry) || '').startsWith(today)).length,
  };
}

function countHooksInConfig(config) {
  if (!config || typeof config !== 'object') return 0;
  if (Array.isArray(config.hooks)) return config.hooks.length;
  if (!config.hooks || typeof config.hooks !== 'object') return 0;

  let total = 0;
  for (const value of Object.values(config.hooks)) {
    if (!Array.isArray(value)) continue;
    for (const matcher of value) {
      total += Array.isArray(matcher.hooks) ? matcher.hooks.length : 1;
    }
  }
  return total;
}

function readHealth(projectRoot) {
  const today = new Date().toISOString().slice(0, 10);
  const auditPath = path.join(projectRoot, '.planning', 'telemetry', 'audit.jsonl');
  const audit = tailJsonl(auditPath, 500);
  const hookConfig = readJson(path.join(projectRoot, 'hooks', 'hooks.json')) ||
    readJson(path.join(projectRoot, '.claude', 'hooks.json')) ||
    readJson(path.join(projectRoot, '.claude', 'settings.json'));
  const harness = readJson(path.join(projectRoot, '.claude', 'harness.json')) ||
    readJson(path.join(projectRoot, '.Codex', 'harness.json')) ||
    {};
  const trust = harness.trust || {};
  const sessions = Number(trust.sessions_completed || 0);
  const campaigns = Number(trust.campaigns_completed || 0);

  let level = 'novice';
  if (sessions >= 20 && campaigns >= 2) level = 'trusted';
  else if (sessions >= 5) level = 'familiar';
  if (trust.override) level = `${trust.override} (override)`;

  return {
    auditEntriesToday: audit.filter((entry) => String(eventTimestamp(entry) || '').startsWith(today)).length,
    hooksInstalled: countHooksInConfig(hookConfig),
    trustLevel: level,
    trustSessions: sessions,
    trustCampaigns: campaigns,
  };
}

function readProblems(projectRoot) {
  const telemetryDir = path.join(projectRoot, '.planning', 'telemetry');
  const errors = tailJsonl(path.join(telemetryDir, 'hook-errors.jsonl'), 100);
  return errors.slice(-5).reverse().map((entry) => ({
    hook: entry.hook || 'hook',
    relative: relativeTime(eventTimestamp(entry)),
    description: truncate(
      entry.detail ||
      entry.reason ||
      entry.message ||
      entry.error ||
      entry.action ||
      'hook issue recorded',
      90
    ),
  }));
}

function readCoordination(projectRoot) {
  try {
    return {
      instances: getCoordinationStatus({ projectRoot }).instances,
      claims: getClaimStatus({ projectRoot }).claims,
    };
  } catch {
    return { instances: [], claims: [] };
  }
}

function readWorktrees(projectRoot) {
  try {
    const output = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const blocks = output.split(/\r?\n\r?\n/).map((block) => block.trim()).filter(Boolean);
    return blocks.map((block) => {
      const lines = block.split(/\r?\n/);
      const first = lines[0] || '';
      return {
        path: first.replace(/^worktree\s+/, ''),
        branch: (lines.find((line) => line.startsWith('branch ')) || '').replace(/^branch refs\/heads\//, '').replace(/^branch\s+/, '') || 'detached',
        bare: lines.includes('bare'),
      };
    });
  } catch {
    return [];
  }
}

function readWorktreeReadiness(projectRoot) {
  return listReadinessReports(projectRoot).slice(0, 8).map((report) => ({
    status: report.status || 'unknown',
    blockFleet: Boolean(report.blockFleet),
    worktreeName: report.worktreeName || path.basename(report.worktreePath || ''),
    branch: report.branch || null,
    timestamp: report.timestamp || null,
    failingChecks: (report.checks || []).filter((check) => check.status === 'fail').length,
    warningChecks: (report.checks || []).filter((check) => check.status === 'warn').length,
  }));
}

function safeCostDashboard() {
  try {
    return readCostDashboard();
  } catch {
    return {
      total_cost: 0,
      session_count: 0,
      by_campaign: {},
      data_source: 'unavailable',
      total_messages: null,
      total_subagents: null,
    };
  }
}

function collectDashboard(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const now = options.now ? new Date(options.now) : new Date();
  const recentLimit = options.recentLimit || DEFAULT_RECENT_LIMIT;
  const planningExists = fileExists(path.join(projectRoot, '.planning'));

  const campaigns = readCampaigns(projectRoot);
  const fleetSessions = readFleetSessions(projectRoot);
  const recentActivity = readRecentActivity(projectRoot, recentLimit, now);
  const hookActivity = readHookActivity(projectRoot, recentLimit, now);
  const hookValue = readHookValue(projectRoot);
  const health = readHealth(projectRoot);
  const cost = safeCostDashboard();
  const coordination = readCoordination(projectRoot);
  const worktrees = readWorktrees(projectRoot);
  const worktreeReadiness = readWorktreeReadiness(projectRoot);

  const mostRecentTimestamp = [
    ...recentActivity.map((entry) => entry.timestamp),
    ...hookActivity.map((entry) => entry.timestamp),
    ...campaigns.campaigns.map((campaign) => campaign.modifiedAt),
    ...fleetSessions.map((session) => session.modifiedAt),
  ].filter(Boolean).sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] || now.toISOString();

  return {
    projectRoot,
    generatedAt: now.toISOString(),
    asOf: relativeTime(mostRecentTimestamp, now),
    planningExists,
    campaigns: campaigns.campaigns,
    skippedCampaigns: campaigns.skipped,
    fleetSessions,
    cost,
    recentActivity,
    hookActivity,
    hookValue,
    pending: readQueueCounts(projectRoot),
    health: {
      ...health,
      circuitBreakerTripsThisSession: hookValue.circuitBreakerTrips,
    },
    coordination,
    worktrees,
    worktreeReadiness,
    problems: readProblems(projectRoot),
    nextAction: chooseNextAction({
      planningExists,
      campaigns: campaigns.campaigns,
      fleetSessions,
      problems: readProblems(projectRoot),
      pending: readQueueCounts(projectRoot),
    }),
  };
}

function chooseNextAction(snapshot) {
  if (!snapshot.planningExists) return 'Run /do setup to initialize Citadel state for this project.';
  const needsCompletion = snapshot.campaigns.find((campaign) => campaign.status === 'needs-completion');
  if (needsCompletion) return `Complete ${needsCompletion.slug}: node scripts/campaign.js complete ${needsCompletion.slug} --archive.`;
  const needsArchive = snapshot.campaigns.find((campaign) => campaign.status === 'needs-archive');
  if (needsArchive) return `Archive completed campaign ${needsArchive.slug}: node scripts/campaign.js complete ${needsArchive.slug} --archive.`;
  const active = snapshot.campaigns.find((campaign) => campaign.status === 'active' || campaign.status === 'needs-continue');
  if (active) return `Resume ${active.slug} with /do continue.`;
  const approval = snapshot.campaigns.find((campaign) => campaign.status.includes('approval') || campaign.status.includes('pending'));
  if (approval) return `Review ${approval.slug}; it is waiting on approval or a decision.`;
  if (snapshot.problems.length > 0) return 'Review recent hook problems before starting new work.';
  if (snapshot.pending.mergeReviews > 0) return 'Run /merge-review to inspect pending merge work.';
  return 'No urgent Citadel action detected.';
}

function money(value) {
  const number = typeof value === 'number' ? value : 0;
  return `$${number.toFixed(2)}`;
}

function renderDashboard(snapshot) {
  const lines = [];
  lines.push('=== Citadel Dashboard ===');
  lines.push(`As of: ${snapshot.asOf}`);
  lines.push(`Project: ${snapshot.projectRoot}`);
  lines.push('');
  lines.push('NEXT ACTION');
  lines.push(`  ${snapshot.nextAction}`);
  if (!snapshot.planningExists) {
    lines.push('  Run /do setup to initialize.');
  }

  lines.push('');
  lines.push('CAMPAIGNS');
  if (snapshot.campaigns.length === 0) {
    lines.push('  (none active)');
  } else {
    for (const campaign of snapshot.campaigns.slice(0, 8)) {
      const direction = truncate(campaign.direction || 'no direction recorded', 60);
      lines.push(`  ${campaign.slug}: ${campaign.phase.label} - ${campaign.status} - ${direction}`);
      if (campaign.lastDecision) lines.push(`    Last decision: ${truncate(campaign.lastDecision, 90)}`);
    }
  }
  if (snapshot.skippedCampaigns.length > 0) {
    lines.push(`  (${snapshot.skippedCampaigns.length} campaign file(s) skipped - malformed)`);
  }

  lines.push('');
  lines.push('CONTROL PLANE');
  lines.push(`  Worktrees:        ${snapshot.worktrees.length}`);
  for (const worktree of snapshot.worktrees.slice(0, 5)) {
    const marker = worktree.path === snapshot.projectRoot ? 'current' : worktree.branch;
    lines.push(`    ${truncate(path.basename(worktree.path) || worktree.path, 28)} - ${marker}`);
  }
  lines.push(`  Active instances: ${snapshot.coordination.instances.length}`);
  lines.push(`  Active claims:    ${snapshot.coordination.claims.length}`);

  lines.push('');
  lines.push('WORKTREE READINESS');
  if (snapshot.worktreeReadiness.length === 0) {
    lines.push('  (none recorded)');
  } else {
    for (const report of snapshot.worktreeReadiness.slice(0, 5)) {
      const branch = report.branch ? ` - ${report.branch}` : '';
      const blocks = report.blockFleet ? 'blocks Fleet' : 'does not block Fleet';
      lines.push(`  ${report.status} - ${truncate(report.worktreeName, 28)}${branch} - ${blocks}`);
      if (report.failingChecks || report.warningChecks) {
        lines.push(`    checks: ${report.failingChecks} fail, ${report.warningChecks} warn`);
      }
    }
  }

  lines.push('');
  lines.push('COSTS');
  lines.push(`  Total: ${money(snapshot.cost.total_cost)} across ${snapshot.cost.session_count || 0} sessions (${snapshot.cost.data_source || 'unknown'})`);
  if (snapshot.cost.total_messages !== null || snapshot.cost.total_subagents !== null) {
    lines.push(`  Messages: ${snapshot.cost.total_messages || 0} | Subagents: ${snapshot.cost.total_subagents || 0}`);
  }
  const campaignCosts = Object.entries(snapshot.cost.by_campaign || {}).slice(0, 5);
  if (campaignCosts.length > 0) {
    const label = snapshot.cost.data_source === 'real+estimated'
      ? '  By campaign (Citadel estimates only):'
      : '  By campaign:';
    lines.push(label);
    for (const [slug, entry] of campaignCosts) {
      lines.push(`    ${slug}: ${money(entry.total_cost)} across ${entry.sessions || 0} sessions`);
    }
  } else {
    lines.push('  (no cost data recorded yet)');
  }

  lines.push('');
  lines.push('HOOKS VALUE');
  lines.push(`  Circuit breaker: ${snapshot.hookValue.circuitBreakerTrips} trips`);
  lines.push(`  Quality gate:    ${snapshot.hookValue.qualityGateViolations} violations`);
  lines.push(`  Protect-files:   ${snapshot.hookValue.protectFileBlocks} blocks`);
  lines.push(`  External gate:   ${snapshot.hookValue.externalGateActions} actions gated`);
  lines.push(`  Total hook fires today: ${snapshot.hookValue.hookFiresToday}`);
  lines.push('  (raw facts only -- no inflated savings claims)');

  lines.push('');
  lines.push('FLEET SESSIONS');
  if (snapshot.fleetSessions.length === 0) {
    lines.push('  (none active)');
  } else {
    for (const session of snapshot.fleetSessions.slice(0, 6)) {
      lines.push(`  ${session.slug}: Wave ${session.wave} - ${session.agents} agents - ${session.status}`);
    }
  }

  lines.push('');
  lines.push('PROBLEMS');
  if (snapshot.problems.length === 0) {
    lines.push('  (none recorded)');
  } else {
    for (const problem of snapshot.problems) {
      lines.push(`  ${problem.relative} | ${problem.hook} | ${problem.description}`);
    }
  }

  lines.push('');
  lines.push('RECENT ACTIVITY');
  if (snapshot.recentActivity.length === 0) {
    lines.push('  (no telemetry recorded yet)');
  } else {
    for (const entry of snapshot.recentActivity) {
      lines.push(`  ${entry.relative} | ${entry.name} | ${entry.description}`);
    }
  }

  lines.push('');
  lines.push('HOOK ACTIVITY');
  if (snapshot.hookActivity.length === 0) {
    lines.push('  (no hook timing recorded yet - set CITADEL_DEBUG=true for verbose output)');
  } else {
    for (const entry of snapshot.hookActivity) {
      const duration = entry.durationMs === null ? 'n/a' : `${entry.durationMs}ms`;
      lines.push(`  ${entry.relative} | ${entry.hook} | ${duration} | ${entry.outcome}`);
    }
  }

  lines.push('');
  lines.push('PENDING');
  lines.push(`  Doc sync:      ${snapshot.pending.docSync} items queued`);
  lines.push(`  Merge reviews: ${snapshot.pending.mergeReviews} items queued`);
  lines.push(`  Intake items:  ${snapshot.pending.intakeItems} in .planning/intake/`);

  lines.push('');
  lines.push('HEALTH');
  lines.push(`  Circuit breaker trips this session: ${snapshot.health.circuitBreakerTripsThisSession}`);
  lines.push(`  Audit entries today:                ${snapshot.health.auditEntriesToday}`);
  lines.push(`  Hooks installed:                    ${snapshot.health.hooksInstalled}`);
  lines.push(`  Trust level:                        ${snapshot.health.trustLevel} (${snapshot.health.trustSessions} sessions, ${snapshot.health.trustCampaigns} campaigns)`);

  lines.push('');
  lines.push('QUICK COMMANDS');
  lines.push('  npm run dashboard - show this control plane');
  lines.push('  /do continue      - resume active campaign');
  lines.push('  /merge-review     - review completed fleet work');
  lines.push('  /telemetry        - cost and hook breakdown');
  lines.push('  /pr-watch         - watch PR CI');
  lines.push('  /learn            - extract patterns from completed campaigns');

  return `${lines.join('\n')}\n`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const snapshot = collectDashboard(options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
  } else {
    process.stdout.write(renderDashboard(snapshot));
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  collectDashboard,
  renderDashboard,
  relativeTime,
  parseArgs,
};

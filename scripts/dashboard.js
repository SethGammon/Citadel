#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { parseCampaignContent, parseFrontmatter } = require('../core/campaigns/parse-campaign');
const { isPhaseComplete } = require('../core/campaigns/update-campaign');
const { extractCompletionOutcome } = require('../core/campaigns/outcomes');
const { validateExitEvidence } = require('../core/evidence/contracts');
const { readJsonlDetailed } = require('../core/telemetry/io');
const { getCoordinationStatus } = require('../core/coordination/instances');
const { getClaimStatus } = require('../core/coordination/claims');
const { readCostDashboard } = require('./telemetry-stats');
const { listReadinessReports } = require('../core/worktree/readiness');

const DEFAULT_RECENT_LIMIT = 10;
const ROUTINE_QUOTA_CAP = 15;
const ROUTINE_QUOTA_WARN_ABOVE = 12;

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

function countActionableJsonl(filePath, actionableStatuses = ['needs-review', 'pending']) {
  const detail = readJsonlDetailed(filePath);
  if (!detail.exists) return 0;
  const statuses = new Set(actionableStatuses);
  return detail.entries.filter((entry) => statuses.has(entry.status)).length;
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

function completionRecordSummary(content) {
  const values = {};
  let inSection = false;
  for (const line of String(content || '').split(/\r?\n/)) {
    if (/^##\s+Completion Record\s*$/i.test(line.trim())) {
      inSection = true;
      continue;
    }
    if (inSection && /^##\s+/.test(line.trim())) break;
    if (!inSection) continue;
    const match = line.match(/^-\s+([^:]+):\s*(.+)$/);
    if (match) values[match[1].trim().toLowerCase()] = match[2].trim();
  }
  return {
    completedAt: values['completed at'] || null,
    outcome: values.outcome || extractCompletionOutcome(content),
    pr: values.pr || null,
    mergeSha: values['merge sha'] || null,
    verification: values.verification || null,
    note: values.note || null,
  };
}

function packagePhaseReadiness(parsed) {
  const phases = parsed.phases || [];
  const packagePhase = phases.find((phase) => {
    return String(phase.type || '').toLowerCase() === 'package' ||
      /package|review/i.test(String(phase.name || ''));
  });
  if (!packagePhase) return { hasPackagePhase: false, readyForPackage: false };

  const prior = phases.filter((phase) => phase.number < packagePhase.number);
  return {
    hasPackagePhase: true,
    phaseNumber: packagePhase.number,
    status: packagePhase.status,
    readyForPackage: !isPhaseComplete(packagePhase) && prior.every(isPhaseComplete),
  };
}

function reviewPackageEvidenceStatus(content, projectRoot) {
  const report = validateExitEvidence(content, {
    projectRoot,
    target: 'review-package',
  });
  if (report.missingDeclarations) return null;

  const failure = report.failures[0] || null;
  const item = report.items[0] || null;
  return {
    pass: report.pass && !report.missingDeclarations,
    item,
    failure,
    issues: failure ? failure.issues : [],
  };
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
      const packagePhase = packagePhaseReadiness(parsed);
      const reviewPackageEvidence = reviewPackageEvidenceStatus(content, projectRoot);
      if (
        reviewPackageEvidence &&
        !reviewPackageEvidence.pass &&
        (packagePhase.readyForPackage || status === 'needs-completion')
      ) {
        status = 'needs-review-package';
      }
      if (status === 'completed' && path.dirname(filePath) === campaignDir) {
        status = 'needs-archive';
      }
      campaigns.push({
        slug,
        filePath,
        status,
        direction,
        phase: phaseSummary(parsed),
        packagePhase,
        reviewPackageEvidence,
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
      if (status === 'needs-review-package') return 1;
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

function readOutcomeLedger(projectRoot) {
  const completedDir = path.join(projectRoot, '.planning', 'campaigns', 'completed');
  return listFiles(completedDir, (entry) => entry.endsWith('.md'))
    .map((filePath) => {
      const content = readText(filePath) || '';
      const parsed = parseCampaignContent(content, { slug: path.basename(filePath, '.md') });
      const record = completionRecordSummary(content);
      const outcome = record.outcome ||
        (record.mergeSha ? 'shipped-pr' : '') ||
        (record.pr ? 'review-package' : '') ||
        'archived-completion';
      return {
        slug: parsed.slug,
        title: parsed.title,
        path: relativeProjectPath(projectRoot, filePath),
        outcome,
        completedAt: record.completedAt,
        pr: record.pr,
        mergeSha: record.mergeSha,
        verification: record.verification,
        note: record.note,
        modifiedAt: safeMtime(filePath),
      };
    })
    .sort((left, right) => {
      const leftTime = new Date(left.completedAt || left.modifiedAt || 0).getTime();
      const rightTime = new Date(right.completedAt || right.modifiedAt || 0).getTime();
      return rightTime - leftTime;
    })
    .slice(0, 8);
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

function relativeProjectPath(projectRoot, filePath) {
  return path.relative(projectRoot, filePath).replace(/\\/g, '/');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractReportLines(content, label) {
  const pattern = new RegExp(`^(?:[-*]\\s*)?\\s*${escapeRegExp(label)}:\\s*(.+)$`, 'gim');
  return Array.from(content.matchAll(pattern)).map((match) => match[1].trim());
}

function extractReportLine(content, label) {
  const lines = extractReportLines(content, label);
  return lines.length > 0 ? lines[0] : null;
}

function extractLastReportLine(content, label) {
  const lines = extractReportLines(content, label);
  return lines.length > 0 ? lines[lines.length - 1] : null;
}

function extractBlockLine(content, heading) {
  const match = content.match(new RegExp(`^${escapeRegExp(heading)}\\s*\\r?\\n([^\\r\\n]+)`, 'im'));
  return match ? match[1].trim() : null;
}

function freshness(status, staleReasons) {
  return {
    stale: staleReasons.length > 0,
    freshness: staleReasons.length > 0 ? 'stale' : status,
    staleReasons,
  };
}

function readOperatorArtifacts(projectRoot) {
  const nextReportPath = path.join(projectRoot, '.planning', 'next-actions', 'latest.md');
  const approvalCapsulePath = path.join(projectRoot, '.planning', 'approval-capsules', 'latest.md');
  const nextContent = readText(nextReportPath);
  const approvalContent = readText(approvalCapsulePath);

  return {
    nextActionReport: nextContent ? {
      path: relativeProjectPath(projectRoot, nextReportPath),
      modifiedAt: safeMtime(nextReportPath),
      generatedAt: extractReportLine(nextContent, 'Generated'),
      mode: extractReportLine(nextContent, 'Mode'),
      outcome: extractReportLine(nextContent, 'Outcome'),
      finalCommand: extractLastReportLine(nextContent, 'Final command') ||
        extractLastReportLine(nextContent, 'Command') ||
        null,
    } : null,
    approvalCapsule: approvalContent ? {
      path: relativeProjectPath(projectRoot, approvalCapsulePath),
      modifiedAt: safeMtime(approvalCapsulePath),
      generatedAt: extractReportLine(approvalContent, 'Generated'),
      boundary: extractReportLine(approvalContent, 'Boundary'),
      risk: extractReportLine(approvalContent, 'Risk'),
      request: extractBlockLine(approvalContent, 'Request'),
      command: extractLastReportLine(approvalContent, 'Command'),
    } : null,
  };
}

function annotateOperatorArtifacts(snapshot) {
  const artifacts = snapshot.operatorArtifacts || {};
  const currentCommand = snapshot.nextAction?.command || '';
  const hasRepairs = (snapshot.repairs || []).length > 0;

  if (artifacts.nextActionReport) {
    const staleReasons = [];
    if (artifacts.nextActionReport.outcome === 'idle' && hasRepairs) {
      staleReasons.push('latest report says idle but dashboard has a queued action');
    }
    if (artifacts.nextActionReport.finalCommand && artifacts.nextActionReport.finalCommand !== currentCommand) {
      staleReasons.push(`latest report final command is ${artifacts.nextActionReport.finalCommand}, current command is ${currentCommand}`);
    }
    Object.assign(artifacts.nextActionReport, freshness('current', staleReasons));
  }

  if (artifacts.approvalCapsule) {
    const staleReasons = [];
    if (!hasRepairs) {
      staleReasons.push('no current repair or approval boundary is queued');
    } else if (artifacts.approvalCapsule.command && artifacts.approvalCapsule.command !== currentCommand) {
      staleReasons.push(`capsule command is ${artifacts.approvalCapsule.command}, current command is ${currentCommand}`);
    }
    Object.assign(artifacts.approvalCapsule, freshness('current', staleReasons));
  }

  return artifacts;
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

/**
 * Nearest-rank percentile on a pre-sorted ascending array.
 * Returns null for empty input.
 */
function percentile(sortedValues, p) {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) return null;
  const index = Math.ceil((p / 100) * sortedValues.length) - 1;
  return sortedValues[Math.min(sortedValues.length - 1, Math.max(0, index))];
}

function readHookOverhead(projectRoot) {
  const timingPath = path.join(projectRoot, '.planning', 'telemetry', 'hook-timing.jsonl');
  const detail = readJsonlDetailed(timingPath);
  if (!detail.exists || detail.entries.length === 0) return [];

  const durationsByHook = new Map();
  for (const entry of detail.entries) {
    if (typeof entry.duration_ms !== 'number' || !Number.isFinite(entry.duration_ms)) continue;
    const hook = entry.hook || 'unknown';
    if (!durationsByHook.has(hook)) durationsByHook.set(hook, []);
    durationsByHook.get(hook).push(entry.duration_ms);
  }

  return Array.from(durationsByHook.entries())
    .map(([hook, durations]) => {
      const sorted = durations.slice().sort((left, right) => left - right);
      return {
        hook,
        count: sorted.length,
        p50Ms: percentile(sorted, 50),
        p95Ms: percentile(sorted, 95),
        maxMs: sorted[sorted.length - 1],
      };
    })
    .sort((left, right) => right.p95Ms - left.p95Ms);
}

// Account-wide routine quota (CronCreate / RemoteTrigger / ScheduleWakeup runs).
// Reads .planning/telemetry/routine-runs.jsonl, one record per quota-consuming
// run: {ts, kind}. Nothing in the harness writes this file yet; remote-run
// logging populates it when a routine mechanism is actually used.
function readRoutineQuota(projectRoot, now = new Date()) {
  const filePath = path.join(projectRoot, '.planning', 'telemetry', 'routine-runs.jsonl');
  const detail = readJsonlDetailed(filePath);
  const windowStart = now.getTime() - 24 * 60 * 60 * 1000;

  let runsLast24h = 0;
  if (detail.exists) {
    for (const entry of detail.entries) {
      const ts = new Date(entry.ts || entry.timestamp || 0).getTime();
      if (Number.isFinite(ts) && ts >= windowStart) runsLast24h++;
    }
  }

  return {
    sourceExists: detail.exists,
    cap: ROUTINE_QUOTA_CAP,
    runsLast24h,
    warning: runsLast24h > ROUTINE_QUOTA_WARN_ABOVE,
  };
}

function readQueueCounts(projectRoot) {
  const planningDir = path.join(projectRoot, '.planning');
  const telemetryDir = path.join(planningDir, 'telemetry');
  const intakeDir = path.join(planningDir, 'intake');

  return {
    docSync: countActionableJsonl(path.join(telemetryDir, 'doc-sync-queue.jsonl')),
    mergeReviews: countJsonlLines(path.join(telemetryDir, 'merge-check-queue.jsonl')),
    intakeItems: countPendingIntakeItems(intakeDir),
  };
}

function countPendingIntakeItems(intakeDir) {
  return listFiles(intakeDir, (entry) => entry.endsWith('.md') && entry !== '_TEMPLATE.md')
    .filter((filePath) => {
      const content = readText(filePath);
      if (!content) return false;
      const frontmatter = parseFrontmatter(content);
      return String(frontmatter.status || 'pending').toLowerCase() === 'pending';
    }).length;
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

function extractBlockedCommand(detail) {
  const text = String(detail || '');
  const match = text.match(/^[^:]+:\s+(.+)$/);
  return (match ? match[1] : text).trim();
}

function normalizeCommandForMatch(command) {
  return String(command || '')
    .replace(/\s+/g, ' ')
    .replace(/^git push -u /, 'git push ')
    .trim();
}

function hasLaterMatchingToolCall(entry, auditEntries = []) {
  const detail = entry.detail || entry.reason || entry.message || entry.error || '';
  const command = normalizeCommandForMatch(extractBlockedCommand(detail));
  if (!command) return false;

  const blockedAt = new Date(eventTimestamp(entry) || 0).getTime();
  return auditEntries.some((auditEntry) => {
    if ((auditEntry.event || '') !== 'tool-call') return false;
    const target = normalizeCommandForMatch(auditEntry.target || auditEntry.command || '');
    if (!target || target !== command) return false;
    const calledAt = new Date(eventTimestamp(auditEntry) || 0).getTime();
    return calledAt + 5000 >= blockedAt;
  });
}

function classifyHookProblem(entry, now = new Date(), context = {}) {
  const hook = entry.hook || 'hook';
  const actionName = entry.action || entry.outcome || entry.status || 'recorded';
  const detail = entry.detail || entry.reason || entry.message || entry.error || entry.action || 'hook issue recorded';
  const timestamp = eventTimestamp(entry);
  const ageMs = timestamp ? now.getTime() - new Date(timestamp).getTime() : 0;
  const stale = timestamp ? ageMs > 24 * 60 * 60 * 1000 : false;
  const description = truncate(detail, 90);
  const text = `${hook} ${actionName} ${detail}`.toLowerCase();

  let category = 'attention';
  let severity = 'medium';
  let actionable = true;

  if (stale) {
    category = 'stale';
    severity = 'low';
    actionable = false;
  } else if (actionName === 'error' || actionName === 'parse-fail' || text.includes('unknown error')) {
    category = 'hook-failure';
    severity = 'high';
    actionable = true;
  } else if (actionName === 'blocked-restricted') {
    category = 'restricted-scope-block';
    severity = 'high';
    actionable = true;
  } else if (
    hook === 'external-action-gate' &&
    (actionName === 'first-encounter' || actionName === 'consent-block') &&
    hasLaterMatchingToolCall(entry, context.auditEntries || [])
  ) {
    category = 'resolved-approval';
    severity = 'info';
    actionable = false;
  } else if (
    hook === 'external-action-gate' &&
    (actionName === 'first-encounter' || actionName === 'consent-block') &&
    timestamp &&
    ageMs > 15 * 60 * 1000
  ) {
    category = 'stale-approval';
    severity = 'low';
    actionable = false;
  } else if (hook === 'external-action-gate' && (actionName === 'first-encounter' || actionName === 'consent-block')) {
    category = 'approval-needed';
    severity = 'medium';
    actionable = true;
  } else if (
    hook === 'protect-files' ||
    (hook === 'external-action-gate' && actionName === 'blocked')
  ) {
    category = 'safety-block';
    severity = 'info';
    actionable = false;
  }

  return {
    hook,
    action: actionName,
    category,
    severity,
    actionable,
    stale,
    relative: relativeTime(timestamp, now),
    description,
  };
}

function summarizeProblemTaxonomy(problems) {
  const summary = {
    total: problems.length,
    actionable: 0,
    safetyBlocks: 0,
    stale: 0,
    hookFailures: 0,
    approvalNeeded: 0,
    resolvedApprovals: 0,
  };

  for (const problem of problems) {
    if (problem.actionable) summary.actionable++;
    if (problem.category === 'safety-block') summary.safetyBlocks++;
    if (problem.category === 'stale' || problem.category === 'stale-approval') summary.stale++;
    if (problem.category === 'hook-failure') summary.hookFailures++;
    if (problem.category === 'approval-needed') summary.approvalNeeded++;
    if (problem.category === 'resolved-approval') summary.resolvedApprovals++;
  }

  return summary;
}

function readProblems(projectRoot, now = new Date()) {
  const telemetryDir = path.join(projectRoot, '.planning', 'telemetry');
  const errors = tailJsonl(path.join(telemetryDir, 'hook-errors.jsonl'), 100);
  const auditEntries = tailJsonl(path.join(telemetryDir, 'audit.jsonl'), 300);
  const problems = errors
    .map((entry) => classifyHookProblem(entry, now, { auditEntries }))
    .sort((left, right) => {
      const severityOrder = { high: 0, medium: 1, info: 2, low: 3 };
      if (left.actionable !== right.actionable) return left.actionable ? -1 : 1;
      return (severityOrder[left.severity] || 4) - (severityOrder[right.severity] || 4);
    });

  return {
    items: problems.slice(0, 8),
    summary: summarizeProblemTaxonomy(problems),
  };
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

function readGitStatus(projectRoot) {
  try {
    const output = execFileSync('git', ['status', '--short'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const lines = output.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
    return {
      available: true,
      dirty: lines.length > 0,
      changedFiles: lines.length,
      sample: lines.slice(0, 8),
    };
  } catch {
    return {
      available: false,
      dirty: false,
      changedFiles: 0,
      sample: [],
    };
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
  const outcomeLedger = readOutcomeLedger(projectRoot);
  const fleetSessions = readFleetSessions(projectRoot);
  const recentActivity = readRecentActivity(projectRoot, recentLimit, now);
  const hookActivity = readHookActivity(projectRoot, recentLimit, now);
  const hookOverhead = readHookOverhead(projectRoot);
  const hookValue = readHookValue(projectRoot);
  const health = readHealth(projectRoot);
  const cost = safeCostDashboard();
  const coordination = readCoordination(projectRoot);
  const worktrees = readWorktrees(projectRoot);
  const gitStatus = readGitStatus(projectRoot);
  const worktreeReadiness = readWorktreeReadiness(projectRoot);
  const operatorArtifacts = readOperatorArtifacts(projectRoot);
  const pending = readQueueCounts(projectRoot);
  const problems = readProblems(projectRoot, now);
  const routineQuota = readRoutineQuota(projectRoot, now);

  const mostRecentTimestamp = [
    ...recentActivity.map((entry) => entry.timestamp),
    ...hookActivity.map((entry) => entry.timestamp),
    ...campaigns.campaigns.map((campaign) => campaign.modifiedAt),
    ...fleetSessions.map((session) => session.modifiedAt),
  ].filter(Boolean).sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] || now.toISOString();

  const snapshot = {
    projectRoot,
    generatedAt: now.toISOString(),
    asOf: relativeTime(mostRecentTimestamp, now),
    planningExists,
    campaigns: campaigns.campaigns,
    skippedCampaigns: campaigns.skipped,
    outcomeLedger,
    fleetSessions,
    cost,
    recentActivity,
    hookActivity,
    hookOverhead,
    hookValue,
    pending,
    health: {
      ...health,
      circuitBreakerTripsThisSession: hookValue.circuitBreakerTrips,
    },
    coordination,
    worktrees,
    gitStatus,
    worktreeReadiness,
    operatorArtifacts,
    problems: problems.items,
    problemSummary: problems.summary,
    routineQuota,
  };

  snapshot.repairs = buildRepairItems(snapshot);
  snapshot.nextAction = chooseNextAction(snapshot);
  snapshot.operatorArtifacts = annotateOperatorArtifacts(snapshot);
  return snapshot;
}

function action({ label, command, why, confidence = 'medium', repairAvailable = false, runbook = null }) {
  return { label, command, why, confidence, repairAvailable, runbook };
}

function buildRepairItems(snapshot) {
  const repairs = [];

  if (!snapshot.planningExists) {
    repairs.push(action({
      label: 'Initialize Citadel state',
      command: '/do setup --express',
      why: '.planning/ is missing, so campaigns, intake, telemetry, and dashboard state cannot be trusted yet.',
      confidence: 'high',
      repairAvailable: true,
      runbook: 'skills/setup/SKILL.md',
    }));
    return repairs;
  }

  const needsCompletion = snapshot.campaigns.find((campaign) => campaign.status === 'needs-completion');
  const needsReviewPackage = snapshot.campaigns.find((campaign) => {
    if (!campaign.reviewPackageEvidence || campaign.reviewPackageEvidence.pass) return false;
    if (campaign.packagePhase && campaign.packagePhase.readyForPackage) return true;
    return campaign.status === 'needs-review-package' || campaign.status === 'needs-completion';
  });
  if (needsReviewPackage) {
    const issues = needsReviewPackage.reviewPackageEvidence.issues || [];
    repairs.push(action({
      label: `Package ${needsReviewPackage.slug} for review`,
      command: `node scripts/package-delivery.js ${needsReviewPackage.slug}`,
      why: issues.length > 0
        ? `The campaign review-package evidence is not ready: ${issues.join('; ')}.`
        : 'The campaign is ready for review packaging, but review-package evidence is still pending.',
      confidence: 'high',
      repairAvailable: true,
      runbook: 'docs/CAMPAIGNS.md#intake-items',
    }));
  }

  if (needsCompletion) {
    repairs.push(action({
      label: `Complete ${needsCompletion.slug}`,
      command: `node scripts/campaign.js complete ${needsCompletion.slug} --archive`,
      why: 'Every campaign phase is complete, but the campaign status still says active.',
      confidence: 'high',
      repairAvailable: true,
      runbook: 'docs/CAMPAIGNS.md#repair-states',
    }));
  }

  const needsArchive = snapshot.campaigns.find((campaign) => campaign.status === 'needs-archive');
  if (needsArchive) {
    repairs.push(action({
      label: `Archive completed campaign ${needsArchive.slug}`,
      command: `node scripts/campaign.js complete ${needsArchive.slug} --archive`,
      why: 'The campaign is completed but still lives in the active campaign directory.',
      confidence: 'high',
      repairAvailable: true,
      runbook: 'docs/CAMPAIGNS.md#repair-states',
    }));
  }

  const active = snapshot.campaigns.find((campaign) => campaign.status === 'active' || campaign.status === 'needs-continue');
  if (active) {
    repairs.push(action({
      label: `Resume ${active.slug}`,
      command: '/do continue',
      why: 'An active campaign is available and should be advanced or deliberately parked.',
      confidence: 'high',
      repairAvailable: true,
      runbook: 'docs/CAMPAIGNS.md#continuation-across-sessions',
    }));
  }

  const approval = snapshot.campaigns.find((campaign) => campaign.status.includes('approval') || campaign.status.includes('pending'));
  if (approval) {
    repairs.push(action({
      label: `Review ${approval.slug}`,
      command: '/do continue',
      why: 'A campaign is waiting on approval, pending work, or a decision.',
      confidence: 'medium',
      repairAvailable: true,
      runbook: 'docs/CAMPAIGNS.md',
    }));
  }

  if (snapshot.pending.mergeReviews > 0) {
    repairs.push(action({
      label: 'Review pending Fleet merges',
      command: '/merge-review',
      why: `${snapshot.pending.mergeReviews} merge review item(s) are queued.`,
      confidence: 'high',
      repairAvailable: true,
      runbook: 'skills/merge-review/SKILL.md',
    }));
  }

  if (snapshot.pending.docSync > 0) {
    repairs.push(action({
      label: 'Drain doc-sync queue',
      command: '/learn --doc-sync',
      why: `${snapshot.pending.docSync} doc-sync item(s) are queued; project guidance may be stale.`,
      confidence: snapshot.pending.docSync > 50 ? 'high' : 'medium',
      repairAvailable: true,
      runbook: 'skills/learn/SKILL.md',
    }));
  }

  if (snapshot.pending.intakeItems > 0) {
    repairs.push(action({
      label: 'Process intake queue',
      command: '/autopilot',
      why: `${snapshot.pending.intakeItems} real intake item(s) are waiting in .planning/intake/.`,
      confidence: 'medium',
      repairAvailable: true,
      runbook: 'skills/autopilot/SKILL.md',
    }));
  }

  if (snapshot.gitStatus && snapshot.gitStatus.dirty) {
    repairs.push(action({
      label: 'Review uncommitted worktree changes',
      command: 'git status --short',
      why: `${snapshot.gitStatus.changedFiles} uncommitted file(s) are present; package or clear them before starting unrelated work.`,
      confidence: 'high',
      repairAvailable: false,
      runbook: 'docs/CAMPAIGNS.md',
    }));
  }

  const actionableProblems = snapshot.problemSummary?.actionable || 0;
  if (actionableProblems > 0) {
    repairs.push(action({
      label: 'Review recent hook problems',
      command: '/telemetry',
      why: `${actionableProblems} actionable hook problem(s) are recorded. Safety blocks and stale entries are categorized separately.`,
      confidence: 'medium',
      repairAvailable: true,
      runbook: 'skills/telemetry/SKILL.md',
    }));
  }

  return repairs;
}

function chooseNextAction(snapshot) {
  if (!snapshot.repairs || snapshot.repairs.length === 0) {
    return action({
      label: 'No urgent Citadel action detected',
      command: 'npm run dashboard',
      why: 'Campaigns, queues, worktree status, and recent hook state do not show an immediate repair.',
      confidence: 'medium',
      repairAvailable: false,
      runbook: 'skills/dashboard/SKILL.md',
    });
  }

  return snapshot.repairs[0];
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
  lines.push(`  Command: ${snapshot.nextAction.command}`);
  lines.push(`  Why: ${snapshot.nextAction.why}`);
  lines.push(`  Confidence: ${snapshot.nextAction.confidence}`);
  lines.push(`  Repair available: ${snapshot.nextAction.repairAvailable ? 'yes' : 'no'}`);
  if (snapshot.nextAction.runbook) lines.push(`  Runbook: ${snapshot.nextAction.runbook}`);
  if (!snapshot.planningExists) {
    lines.push('  Run /do setup --express to initialize.');
  }

  lines.push('');
  lines.push('OPERATOR ARTIFACTS');
  const operatorArtifacts = snapshot.operatorArtifacts || {};
  if (!operatorArtifacts.nextActionReport && !operatorArtifacts.approvalCapsule) {
    lines.push('  (none recorded yet - run npm run next)');
  } else {
    if (operatorArtifacts.nextActionReport) {
      const report = operatorArtifacts.nextActionReport;
      lines.push(`  Next report: ${report.path}`);
      lines.push(`    outcome: ${report.outcome || 'unknown'} | mode: ${report.mode || 'unknown'} | freshness: ${report.freshness || 'unknown'}`);
      for (const reason of (report.staleReasons || []).slice(0, 2)) {
        lines.push(`    stale: ${truncate(reason, 110)}`);
      }
    }
    if (operatorArtifacts.approvalCapsule) {
      const capsule = operatorArtifacts.approvalCapsule;
      lines.push(`  Approval capsule: ${capsule.path}`);
      lines.push(`    boundary: ${capsule.boundary || 'unknown'} | risk: ${capsule.risk || 'unknown'} | freshness: ${capsule.freshness || 'unknown'}`);
      if (capsule.request) lines.push(`    request: ${truncate(capsule.request, 110)}`);
      for (const reason of (capsule.staleReasons || []).slice(0, 2)) {
        lines.push(`    stale: ${truncate(reason, 110)}`);
      }
    }
  }

  lines.push('');
  lines.push('REPAIR CONSOLE');
  if (!snapshot.repairs || snapshot.repairs.length === 0) {
    lines.push('  (no repairs queued)');
  } else {
    for (const repair of snapshot.repairs.slice(0, 6)) {
      const repairFlag = repair.repairAvailable ? 'repair' : 'review';
      lines.push(`  ${repairFlag} | ${repair.confidence} | ${repair.label}`);
      lines.push(`    command: ${repair.command}`);
      lines.push(`    why: ${truncate(repair.why, 110)}`);
      if (repair.runbook) lines.push(`    runbook: ${repair.runbook}`);
    }
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
  lines.push('OUTCOMES');
  if (!snapshot.outcomeLedger || snapshot.outcomeLedger.length === 0) {
    lines.push('  (no completed outcomes recorded yet)');
  } else {
    for (const outcome of snapshot.outcomeLedger.slice(0, 6)) {
      const target = outcome.pr || outcome.mergeSha || outcome.path;
      lines.push(`  ${outcome.slug}: ${outcome.outcome} - ${truncate(target, 80)}`);
      if (outcome.verification) lines.push(`    verification: ${truncate(outcome.verification, 90)}`);
    }
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
  if (snapshot.gitStatus && snapshot.gitStatus.available) {
    lines.push(`  Git changes:      ${snapshot.gitStatus.changedFiles}`);
    for (const line of snapshot.gitStatus.sample.slice(0, 3)) {
      lines.push(`    ${line}`);
    }
  } else {
    lines.push('  Git changes:      unavailable');
  }

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
  lines.push('ROUTINE QUOTA');
  const routineQuota = snapshot.routineQuota || { sourceExists: false, cap: ROUTINE_QUOTA_CAP, runsLast24h: 0, warning: false };
  lines.push(`  Runs (last 24h): ${routineQuota.runsLast24h}/${routineQuota.cap}`);
  if (routineQuota.warning) {
    lines.push(`  WARNING: ${routineQuota.runsLast24h} of ${routineQuota.cap} routine runs used in the last 24h. Hitting the cap pauses every routine on the account. See docs/ROUTINE-QUOTA.md.`);
  }
  if (!routineQuota.sourceExists || routineQuota.runsLast24h === 0) {
    lines.push('  (remote-run logging populates .planning/telemetry/routine-runs.jsonl - local runners do not consume quota)');
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
  if (snapshot.problemSummary) {
    lines.push(`  Actionable: ${snapshot.problemSummary.actionable} | Safety blocks: ${snapshot.problemSummary.safetyBlocks} | Resolved approvals: ${snapshot.problemSummary.resolvedApprovals} | Stale: ${snapshot.problemSummary.stale}`);
  }
  if (snapshot.problems.length === 0) {
    lines.push('  (none recorded)');
  } else {
    for (const problem of snapshot.problems) {
      lines.push(`  ${problem.relative} | ${problem.severity} | ${problem.category} | ${problem.hook} | ${problem.description}`);
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
  lines.push('HOOK OVERHEAD');
  const overhead = snapshot.hookOverhead || [];
  if (overhead.length === 0) {
    lines.push('  (no hook timing data recorded yet)');
  } else {
    const ms = (value) => `${value}ms`;
    lines.push(`  ${'hook'.padEnd(26)} ${'count'.padStart(6)} ${'p50'.padStart(8)} ${'p95'.padStart(8)} ${'max'.padStart(8)}`);
    for (const row of overhead.slice(0, 15)) {
      lines.push(`  ${truncate(row.hook, 26).padEnd(26)} ${String(row.count).padStart(6)} ${ms(row.p50Ms).padStart(8)} ${ms(row.p95Ms).padStart(8)} ${ms(row.maxMs).padStart(8)}`);
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
  classifyHookProblem,
  collectDashboard,
  renderDashboard,
  readHookOverhead,
  readOperatorArtifacts,
  readRoutineQuota,
  relativeTime,
  parseArgs,
  percentile,
  summarizeProblemTaxonomy,
};

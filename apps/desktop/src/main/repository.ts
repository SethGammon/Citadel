import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import matter from 'gray-matter';
import type {
  Campaign,
  CampaignDetail,
  CampaignSpan,
  FleetSession,
  FleetAnalyticsData,
  AggregateAnalyticsData,
  HealthStatus,
  Skill,
  TelemetryEvent,
} from '../shared/types.js';

export type {
  Campaign,
  CampaignDetail,
  FleetSession,
  HealthStatus,
  Skill,
  TelemetryEvent,
  FleetAnalyticsData,
  AggregateAnalyticsData,
};

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface CitadelRepository {
  getCampaigns(): Promise<Campaign[]>;
  getCampaignDetail(slug: string): Promise<CampaignDetail | null>;
  getCampaignTimeline(): Promise<CampaignSpan[]>;
  getFleetSessions(): Promise<FleetSession[]>;
  getFleetAnalytics(): Promise<FleetAnalyticsData>;
  getHealth(): Promise<HealthStatus>;
  getSkills(): Promise<Skill[]>;
  getTelemetryEvents(campaignSlug?: string): Promise<TelemetryEvent[]>;
  getAggregateAnalytics(): Promise<AggregateAnalyticsData>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function globFiles(baseDir: string, pattern: RegExp): string[] {
  const results: string[] = [];
  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (pattern.test(entry.name)) {
        results.push(full);
      }
    }
  }
  walk(baseDir);
  return results;
}

function safeStatModified(filePath: string): string {
  try {
    return fs.statSync(filePath).mtime.toISOString();
  } catch {
    return '';
  }
}

function str(val: unknown, fallback = ''): string {
  return typeof val === 'string' ? val : fallback;
}

function num(val: unknown, fallback = 0): number {
  return typeof val === 'number' ? val : fallback;
}

function extractSection(markdown: string, heading: string): string {
  const lines = markdown.split('\n');
  let inSection = false;
  const content: string[] = [];
  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (inSection) break;
      if (line.trim() === `## ${heading}`) {
        inSection = true;
        continue;
      }
    }
    if (inSection) {
      content.push(line);
    }
  }
  return content.join('\n').trim();
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class FileSystemRepository implements CitadelRepository {
  private readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  async getCampaigns(): Promise<Campaign[]> {
    const campaignsDir = path.join(this.projectRoot, '.planning', 'campaigns');
    const files = globFiles(campaignsDir, /\.md$/);

    return files.map((filePath): Campaign => {
      const slug = path.basename(filePath, '.md');
      let fm: Record<string, unknown> = {};
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        fm = matter(raw).data as Record<string, unknown>;
      } catch {
        // Return minimal stub if file is unreadable
      }
      return {
        slug,
        id: str(fm['id'], slug),
        version: str(fm['version'], '1'),
        status: str(fm['status'], 'unknown'),
        started: str(fm['started']),
        completedAt: str(fm['completed_at']),
        direction: str(fm['direction']),
        phaseCount: num(fm['phase_count']),
        currentPhase: num(fm['current_phase']),
        filePath,
        modifiedAt: safeStatModified(filePath),
        branch: fm['branch'] != null ? str(fm['branch']) || null : null,
        worktreeStatus: fm['worktree_status'] != null ? str(fm['worktree_status']) || null : null,
      };
    });
  }

  async getCampaignDetail(slug: string): Promise<CampaignDetail | null> {
    const campaignsDir = path.join(this.projectRoot, '.planning', 'campaigns');
    const files = globFiles(campaignsDir, /\.md$/);
    const filePath = files.find((f) => path.basename(f, '.md') === slug);
    if (!filePath) return null;

    let raw = '';
    let fm: Record<string, unknown> = {};
    try {
      raw = fs.readFileSync(filePath, 'utf-8');
      fm = matter(raw).data as Record<string, unknown>;
    } catch {
      return null;
    }

    // Strip YAML frontmatter before extracting sections
    const body = raw.replace(/^---[\s\S]*?---\n/, '');

    return {
      slug,
      id: str(fm['id'], slug),
      version: str(fm['version'], '1'),
      status: str(fm['status'], 'unknown'),
      started: str(fm['started']),
      completedAt: str(fm['completed_at']),
      direction: str(fm['direction']),
      phaseCount: num(fm['phase_count']),
      currentPhase: num(fm['current_phase']),
      filePath,
      modifiedAt: safeStatModified(filePath),
      branch: fm['branch'] != null ? str(fm['branch']) || null : null,
      worktreeStatus: fm['worktree_status'] != null ? str(fm['worktree_status']) || null : null,
      sections: {
        phases: extractSection(body, 'Phases'),
        claimedScope: extractSection(body, 'Claimed Scope'),
        activeContext: extractSection(body, 'Active Context'),
        continuationState: extractSection(body, 'Continuation State'),
        decisionLog: extractSection(body, 'Decision Log'),
        reviewQueue: extractSection(body, 'Review Queue'),
      },
    };
  }

  async getCampaignTimeline(): Promise<CampaignSpan[]> {
    const campaigns = await this.getCampaigns();
    return campaigns
      .filter((c) => c.started)
      .map((c): CampaignSpan => {
        let durationDays: number | null = null;
        if (c.started && c.completedAt) {
          const start = new Date(c.started).getTime();
          const end = new Date(c.completedAt).getTime();
          if (!isNaN(start) && !isNaN(end)) {
            durationDays = Math.max(0, Math.round((end - start) / 86400000));
          }
        }
        return {
          slug: c.slug,
          direction: c.direction,
          status: c.status,
          started: c.started,
          completedAt: c.completedAt,
          phaseCount: c.phaseCount,
          currentPhase: c.currentPhase,
          durationDays,
        };
      })
      .sort((a, b) => {
        const ta = a.started ? new Date(a.started).getTime() : 0;
        const tb = b.started ? new Date(b.started).getTime() : 0;
        return tb - ta; // newest first
      });
  }

  async getFleetSessions(): Promise<FleetSession[]> {
    const fleetDir = path.join(this.projectRoot, '.planning', 'fleet');
    const files = globFiles(fleetDir, /^session-.*\.md$/);

    return files.map((filePath): FleetSession => {
      const slug = path.basename(filePath, '.md');
      let fm: Record<string, unknown> = {};
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        fm = matter(raw).data as Record<string, unknown>;
      } catch {
        // Return minimal stub
      }
      return {
        slug,
        id: str(fm['id'], slug),
        status: str(fm['status'], 'unknown'),
        started: str(fm['started']),
        completedAt: str(fm['completed_at']),
        filePath,
        modifiedAt: safeStatModified(filePath),
      };
    });
  }

  async getFleetAnalytics(): Promise<FleetAnalyticsData> {
    const sessions = await this.getFleetSessions();
    const completedCount = sessions.filter((s) => s.status === 'completed').length;
    const activeCount = sessions.filter(
      (s) => s.status === 'active' || s.status === 'needs-continue'
    ).length;
    const failedCount = sessions.filter((s) => s.status === 'failed').length;
    const successRate =
      sessions.length > 0
        ? Math.round((completedCount / sessions.length) * 100)
        : null;

    const recentSessions = sessions
      .sort((a, b) => {
        const ta = a.started ? new Date(a.started).getTime() : 0;
        const tb = b.started ? new Date(b.started).getTime() : 0;
        return tb - ta;
      })
      .slice(0, 10);

    return {
      totalSessions: sessions.length,
      completedCount,
      activeCount,
      failedCount,
      successRate,
      recentSessions,
    };
  }

  async getHealth(): Promise<HealthStatus> {
    const healthScript = path.join(this.projectRoot, 'scripts', 'health.js');

    return new Promise((resolve) => {
      cp.execFile(
        process.execPath,
        [healthScript],
        { cwd: this.projectRoot, timeout: 10_000 },
        (err, stdout) => {
          if (err) {
            resolve({
              timestamp: new Date().toISOString(),
              error: err.message,
            });
            return;
          }
          try {
            resolve(JSON.parse(stdout) as HealthStatus);
          } catch {
            resolve({
              timestamp: new Date().toISOString(),
              error: 'Failed to parse health.js output',
              raw: stdout,
            });
          }
        }
      );
    });
  }

  async getSkills(): Promise<Skill[]> {
    const skillsDir = path.join(this.projectRoot, 'skills');
    const files = globFiles(skillsDir, /\.md$/).filter(
      (f) => !f.includes('__benchmarks__')
    );

    return files.map((filePath): Skill => {
      const slug = path.basename(filePath, '.md');
      let fm: Record<string, unknown> = {};
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        fm = matter(raw).data as Record<string, unknown>;
      } catch {
        // Return minimal stub
      }
      return {
        slug,
        name: str(fm['name'], slug),
        description: str(fm['description']),
        userInvocable: fm['user-invocable'] === true || fm['userInvocable'] === true,
        filePath,
        modifiedAt: safeStatModified(filePath),
      };
    });
  }

  async getTelemetryEvents(campaignSlug?: string): Promise<TelemetryEvent[]> {
    const logFile = path.join(
      this.projectRoot,
      '.planning',
      'telemetry',
      'agent-runs.jsonl'
    );
    let raw = '';
    try {
      raw = fs.readFileSync(logFile, 'utf-8');
    } catch {
      return [];
    }

    const events: TelemetryEvent[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const ev = JSON.parse(trimmed) as TelemetryEvent;
        if (!campaignSlug || ev.campaign_slug === campaignSlug || ev.session === campaignSlug) {
          events.push(ev);
        }
      } catch {
        // Skip malformed lines
      }
    }

    return events.sort((a, b) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return ta - tb; // oldest first for waterfall
    });
  }

  async getAggregateAnalytics(): Promise<AggregateAnalyticsData> {
    const campaigns = await this.getCampaigns();
    const statusBreakdown: Record<string, number> = {};
    let phaseCompletionSum = 0;
    let phaseCompletionCount = 0;

    for (const c of campaigns) {
      statusBreakdown[c.status] = (statusBreakdown[c.status] ?? 0) + 1;
      if (c.phaseCount > 0) {
        phaseCompletionSum += c.currentPhase / c.phaseCount;
        phaseCompletionCount++;
      }
    }

    return {
      totalCampaigns: campaigns.length,
      completedCount: campaigns.filter((c) => c.status === 'completed').length,
      activeCount: campaigns.filter((c) => c.status === 'active').length,
      failedCount: campaigns.filter((c) => c.status === 'failed').length,
      parkedCount: campaigns.filter((c) => c.status === 'parked').length,
      avgPhaseCompletion:
        phaseCompletionCount > 0
          ? Math.round((phaseCompletionSum / phaseCompletionCount) * 100)
          : null,
      statusBreakdown,
    };
  }
}

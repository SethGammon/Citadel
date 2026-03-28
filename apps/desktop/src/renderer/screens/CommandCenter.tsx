import { useState } from 'react';
import { useCampaigns, useFleetSessions } from '../hooks/useCitadel.js';
import { useEvents } from '../hooks/useEvents.js';
import type { Campaign, FleetSession } from '../hooks/useCitadel.js';
import type { AppView } from '../AppShell.js';

interface Props {
  projectPath: string;
  onNavigate: (view: AppView) => void;
  onCampaignSelect: (slug: string) => void;
}

const STATUS_COLOR: Record<string, string> = {
  active: '#3b82f6',
  'in-progress': '#3b82f6',
  completed: '#22c55e',
  failed: '#ef4444',
  parked: '#f59e0b',
  pending: '#555',
  unknown: '#444',
};

function statusColor(status: string): string {
  return STATUS_COLOR[status] ?? '#444';
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '—';
  }
}

const styles = {
  root: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    background: '#0a0a0a',
    overflow: 'hidden',
  },
  header: {
    padding: '12px 20px',
    borderBottom: '1px solid #1a1a1a',
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#e5e5e5',
  },
  headerSub: {
    fontSize: '11px',
    color: '#444',
    marginTop: '2px',
  },
  body: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column' as const,
  },
  topRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '1px',
    background: '#1a1a1a',
    height: '220px',
    flexShrink: 0,
  },
  panel: {
    background: '#0a0a0a',
    padding: '14px 16px',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column' as const,
  },
  panelLabel: {
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: '#444',
    marginBottom: '8px',
    flexShrink: 0,
  },
  panelScroll: {
    flex: 1,
    overflowY: 'auto' as const,
  },
  feedPanel: {
    flex: 1,
    background: '#0a0a0a',
    borderTop: '1px solid #1a1a1a',
    padding: '12px 16px',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    minHeight: 0,
  },
  feedHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginBottom: '8px',
    flexShrink: 0,
  },
  feedScroll: {
    flex: 1,
    overflowY: 'auto' as const,
    display: 'flex',
    flexDirection: 'column-reverse' as const,
  },
  skeletonRow: {
    height: '24px',
    background: '#111',
    borderRadius: '3px',
    marginBottom: '4px',
  },
  emptyState: {
    color: '#333',
    fontSize: '12px',
    paddingTop: '4px',
  },
  errorState: {
    color: '#ef4444',
    fontSize: '11px',
    paddingTop: '4px',
  },
  campaignBtn: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '3px',
    padding: '5px 6px',
    borderRadius: '4px',
    cursor: 'pointer',
    marginBottom: '2px',
    transition: 'background-color 150ms',
    border: 'none',
    background: 'none',
    width: '100%',
    textAlign: 'left' as const,
    color: 'inherit',
  },
  campaignRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    width: '100%',
  },
  statusDot: (status: string) => ({
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    background: statusColor(status),
    flexShrink: 0,
  }),
  campaignName: {
    fontSize: '12px',
    color: '#ccc',
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  phaseText: {
    fontSize: '10px',
    color: '#444',
    flexShrink: 0,
  },
  progressTrack: {
    height: '2px',
    background: '#1a1a1a',
    borderRadius: '1px',
    overflow: 'hidden',
    width: '100%',
    marginLeft: '12px',
  },
  sessionRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 0',
    borderBottom: '1px solid #0f0f0f',
  },
  sessionName: {
    fontSize: '12px',
    color: '#ccc',
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  sessionDate: {
    fontSize: '10px',
    color: '#444',
    flexShrink: 0,
  },
  eventRow: {
    display: 'flex',
    gap: '8px',
    padding: '3px 0',
    fontSize: '11px',
    lineHeight: '1.5',
    borderBottom: '1px solid #0f0f0f',
  },
  eventTime: {
    color: '#2a2a2a',
    flexShrink: 0,
    fontFamily: 'ui-monospace, monospace',
    fontSize: '10px',
  },
  eventText: {
    color: '#666',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  connDot: (on: boolean) => ({
    width: '5px',
    height: '5px',
    borderRadius: '50%',
    background: on ? '#22c55e' : '#2a2a2a',
    flexShrink: 0,
  }),
} as const;

let _stylesInjected = false;
function ensureAnimStyles() {
  if (_stylesInjected || typeof document === 'undefined') return;
  if (document.querySelector('[data-cc-anim]')) { _stylesInjected = true; return; }
  const s = document.createElement('style');
  s.setAttribute('data-cc-anim', '');
  s.textContent = '@keyframes ccPulse{0%,100%{opacity:1}50%{opacity:0.35}}';
  document.head.appendChild(s);
  _stylesInjected = true;
}

function SkeletonRows({ n = 3 }: { n?: number }) {
  ensureAnimStyles();
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <div
          key={i}
          style={{ ...styles.skeletonRow, animation: 'ccPulse 1.5s ease-in-out infinite', animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </>
  );
}

function formatEventTime(ev: Record<string, unknown>): string {
  const ts = ev['timestamp'];
  if (typeof ts !== 'string') return '';
  try {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
  } catch {
    return '';
  }
}

function formatEventLabel(ev: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof ev['event'] === 'string') parts.push(ev['event']);
  if (typeof ev['agent'] === 'string') parts.push(`[${ev['agent']}]`);
  if (typeof ev['session'] === 'string') parts.push(ev['session']);
  return parts.join(' ') || JSON.stringify(ev).slice(0, 80);
}

function CampaignPanel({ onCampaignSelect }: { onCampaignSelect: (slug: string) => void }) {
  const { campaigns, loading, error } = useCampaigns();
  const [hoveredSlug, setHoveredSlug] = useState('');

  const active = campaigns.filter((c) => c.status === 'active' || c.status === 'in-progress');
  const display = active.length > 0 ? active : campaigns.slice(0, 4);

  return (
    <>
      <div style={styles.panelLabel}>
        Campaigns{active.length > 0 ? ` · ${active.length} active` : ''}
      </div>
      <div style={styles.panelScroll}>
        {loading ? (
          <SkeletonRows />
        ) : error ? (
          <div style={styles.errorState}>{error}</div>
        ) : display.length === 0 ? (
          <div style={styles.emptyState}>No campaigns yet. Run /archon to start one.</div>
        ) : (
          display.map((c) => <CampaignItem key={c.slug} c={c} hovered={hoveredSlug === c.slug} onHover={setHoveredSlug} onClick={() => onCampaignSelect(c.slug)} />)
        )}
      </div>
    </>
  );
}

function CampaignItem({ c, hovered, onHover, onClick }: { c: Campaign; hovered: boolean; onHover: (s: string) => void; onClick: () => void }) {
  const pct = c.phaseCount > 0 ? Math.round((c.currentPhase / c.phaseCount) * 100) : 0;
  return (
    <button
      style={{ ...styles.campaignBtn, ...(hovered ? { background: '#111' } : {}) }}
      onMouseEnter={() => onHover(c.slug)}
      onMouseLeave={() => onHover('')}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
    >
      <div style={styles.campaignRow}>
        <div style={styles.statusDot(c.status)} />
        <span style={styles.campaignName}>{c.direction || c.slug}</span>
        <span style={styles.phaseText}>{c.currentPhase}/{c.phaseCount}</span>
      </div>
      {c.phaseCount > 0 && (
        <div style={styles.progressTrack}>
          <div style={{ height: '100%', width: `${pct}%`, background: statusColor(c.status), borderRadius: '1px' }} />
        </div>
      )}
    </button>
  );
}

function FleetPanel() {
  const { sessions, loading, error } = useFleetSessions();
  const active = sessions.filter((s) => s.status === 'active' || s.status === 'needs-continue' || s.status === 'in-progress');
  const display = active.length > 0 ? active : sessions.slice(0, 4);

  return (
    <>
      <div style={styles.panelLabel}>
        Fleet{active.length > 0 ? ` · ${active.length} active` : ''}
      </div>
      <div style={styles.panelScroll}>
        {loading ? (
          <SkeletonRows />
        ) : error ? (
          <div style={styles.errorState}>{error}</div>
        ) : display.length === 0 ? (
          <div style={styles.emptyState}>No fleet sessions. Run /fleet to start one.</div>
        ) : (
          display.map((s) => <SessionItem key={s.slug} s={s} />)
        )}
      </div>
    </>
  );
}

function SessionItem({ s }: { s: FleetSession }) {
  return (
    <div style={styles.sessionRow}>
      <div style={styles.statusDot(s.status)} />
      <span style={styles.sessionName}>{s.slug}</span>
      <span style={styles.sessionDate}>{formatDate(s.started)}</span>
    </div>
  );
}

function AgentFeed() {
  const { events, connected } = useEvents();
  return (
    <div style={styles.feedPanel}>
      <div style={styles.feedHeader}>
        <span style={styles.panelLabel as React.CSSProperties}>Agent Activity</span>
        <div style={styles.connDot(connected)} />
        <span style={{ fontSize: '10px', color: connected ? '#22c55e' : '#333' }}>
          {connected ? 'live' : 'waiting'}
        </span>
      </div>
      <div style={styles.feedScroll}>
        {events.length === 0 ? (
          <div style={{ color: '#2a2a2a', fontSize: '12px' }}>
            {connected ? 'Waiting for agent events…' : 'Connect a project to see live events'}
          </div>
        ) : (
          [...events].reverse().map((ev, i) => (
            <div key={i} style={styles.eventRow}>
              <span style={styles.eventTime}>{formatEventTime(ev as Record<string, unknown>)}</span>
              <span style={styles.eventText}>{formatEventLabel(ev as Record<string, unknown>)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function CommandCenter({ projectPath: _projectPath, onCampaignSelect }: Props) {
  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <div style={styles.headerTitle}>Command Center</div>
        <div style={styles.headerSub}>Live project state</div>
      </div>
      <div style={styles.body}>
        <div style={styles.topRow}>
          <div style={styles.panel}>
            <CampaignPanel onCampaignSelect={onCampaignSelect} />
          </div>
          <div style={styles.panel}>
            <FleetPanel />
          </div>
        </div>
        <AgentFeed />
      </div>
    </div>
  );
}

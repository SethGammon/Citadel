import { useCampaignTimeline } from '../../hooks/useCitadel.js';
import { ProGate } from '../../components/ProGate.js';
import type { CampaignSpan } from '../../hooks/useCitadel.js';

const STATUS_COLOR: Record<string, string> = {
  active: '#3b82f6',
  'in-progress': '#3b82f6',
  completed: '#22c55e',
  failed: '#ef4444',
  parked: '#f59e0b',
  pending: '#555',
  unknown: '#444',
};

function statusColor(s: string): string {
  return STATUS_COLOR[s] ?? '#444';
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return '—'; }
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
    overflowY: 'auto' as const,
    padding: '20px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '2px',
  },
  spanRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 120px 80px 80px',
    gap: '12px',
    alignItems: 'center',
    padding: '8px 12px',
    borderRadius: '4px',
    border: '1px solid transparent',
    transition: 'background-color 150ms, border-color 150ms',
  },
  spanRowHover: {
    background: '#0f0f0f',
    borderColor: '#1a1a1a',
  },
  directionText: {
    fontSize: '12px',
    color: '#ccc',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  statusBadge: (status: string) => ({
    display: 'inline-flex',
    padding: '2px 6px',
    borderRadius: '3px',
    background: `${statusColor(status)}18`,
    border: `1px solid ${statusColor(status)}40`,
    color: statusColor(status),
    fontSize: '10px',
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
  }),
  dateText: {
    fontSize: '11px',
    color: '#444',
    textAlign: 'right' as const,
  },
  durationText: {
    fontSize: '11px',
    color: '#333',
    textAlign: 'right' as const,
  },
  colHeader: {
    fontSize: '10px',
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: '#333',
    padding: '0 12px 8px',
    display: 'grid',
    gridTemplateColumns: '1fr 120px 80px 80px',
    gap: '12px',
    borderBottom: '1px solid #111',
    marginBottom: '4px',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    gap: '8px',
  },
  emptyTitle: { color: '#444', fontSize: '14px', fontWeight: 500 },
  emptyBody: { color: '#333', fontSize: '12px', textAlign: 'center' as const, maxWidth: '320px', lineHeight: '1.6' },
  errorState: {
    display: 'flex', flexDirection: 'column' as const,
    alignItems: 'center', justifyContent: 'center',
    height: '100%', gap: '8px', color: '#ef4444', fontSize: '13px',
  },
  skeleton: { height: '40px', background: '#0f0f0f', borderRadius: '4px' },
} as const;

let _injected = false;
function ensureStyles() {
  if (_injected || typeof document === 'undefined') return;
  if (document.querySelector('[data-ct-anim]')) { _injected = true; return; }
  const s = document.createElement('style');
  s.setAttribute('data-ct-anim', '');
  s.textContent = '@keyframes ctPulse{0%,100%{opacity:1}50%{opacity:0.3}}';
  document.head.appendChild(s);
  _injected = true;
}

import { useState } from 'react';

function SpanRow({ span }: { span: CampaignSpan }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{ ...styles.spanRow, ...(hovered ? styles.spanRowHover : {}) }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={styles.directionText}>{span.direction || span.slug}</span>
      <span style={styles.statusBadge(span.status)}>{span.status}</span>
      <span style={styles.dateText}>{formatDate(span.started)}</span>
      <span style={styles.durationText}>
        {span.durationDays !== null ? `${span.durationDays}d` : span.status === 'active' ? 'active' : '—'}
      </span>
    </div>
  );
}

export function CampaignTimeline() {
  const { timeline, loading, error, proRequired, refetch } = useCampaignTimeline();

  if (proRequired) return <ProGate featureName="Campaign Timeline" />;

  ensureStyles();

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <div style={styles.headerTitle}>Campaign Timeline</div>
        <div style={styles.headerSub}>Cross-session campaign history, newest first</div>
      </div>

      <div style={styles.body}>
        {loading ? (
          Array.from({ length: 5 }, (_, i) => (
            <div key={i} style={{ ...styles.skeleton, animation: 'ctPulse 1.5s ease-in-out infinite', animationDelay: `${i * 0.1}s` }} />
          ))
        ) : error ? (
          <div style={styles.errorState}>
            <span>{error}</span>
            <button style={{ color: '#555', fontSize: '12px', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }} onClick={refetch}>Retry</button>
          </div>
        ) : timeline.length === 0 ? (
          <div style={styles.emptyState}>
            <span style={styles.emptyTitle}>No campaigns yet</span>
            <span style={styles.emptyBody}>
              Campaign Timeline tracks every campaign across sessions. Start your first campaign with /archon — it will appear here.
            </span>
          </div>
        ) : (
          <>
            <div style={styles.colHeader}>
              <span>Campaign</span>
              <span>Status</span>
              <span style={{ textAlign: 'right' }}>Started</span>
              <span style={{ textAlign: 'right' }}>Duration</span>
            </div>
            {timeline.map((span) => (
              <SpanRow key={span.slug} span={span} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

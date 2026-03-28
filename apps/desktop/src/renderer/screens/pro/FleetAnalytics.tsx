import { useFleetAnalytics } from '../../hooks/useCitadel.js';
import { ProGate } from '../../components/ProGate.js';
import type { FleetSession } from '../../hooks/useCitadel.js';

const STATUS_COLOR: Record<string, string> = {
  active: '#3b82f6',
  'in-progress': '#3b82f6',
  'needs-continue': '#f59e0b',
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
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch { return '—'; }
}

const styles = {
  root: {
    display: 'flex', flexDirection: 'column' as const,
    height: '100%', background: '#0a0a0a', overflow: 'hidden',
  },
  header: {
    padding: '12px 20px', borderBottom: '1px solid #1a1a1a', flexShrink: 0,
  },
  headerTitle: { fontSize: '13px', fontWeight: 600, color: '#e5e5e5' },
  headerSub: { fontSize: '11px', color: '#444', marginTop: '2px' },
  body: {
    flex: 1, overflowY: 'auto' as const, padding: '20px',
    display: 'flex', flexDirection: 'column' as const, gap: '16px',
  },
  statGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '10px',
  },
  statCard: {
    background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: '6px',
    padding: '12px 14px', display: 'flex', flexDirection: 'column' as const, gap: '4px',
  },
  statLabel: {
    fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em',
    textTransform: 'uppercase' as const, color: '#444',
  },
  statValue: { fontSize: '20px', fontWeight: 600, color: '#e5e5e5', lineHeight: '1' },
  statSub: { fontSize: '11px', color: '#333' },
  sectionLabel: {
    fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em',
    textTransform: 'uppercase' as const, color: '#444',
    borderBottom: '1px solid #1a1a1a', paddingBottom: '6px', marginBottom: '8px',
  },
  sessionRow: {
    display: 'flex', alignItems: 'center', gap: '8px',
    padding: '7px 0', borderBottom: '1px solid #0f0f0f',
  },
  statusDot: (s: string) => ({
    width: '6px', height: '6px', borderRadius: '50%',
    background: statusColor(s), flexShrink: 0,
  }),
  sessionName: {
    fontSize: '12px', color: '#ccc', flex: 1,
    minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
  },
  sessionDate: { fontSize: '11px', color: '#333', flexShrink: 0 },
  statusBadge: (s: string) => ({
    fontSize: '10px', fontWeight: 600, color: statusColor(s),
    background: `${statusColor(s)}18`, border: `1px solid ${statusColor(s)}40`,
    borderRadius: '3px', padding: '1px 5px', flexShrink: 0,
  }),
  skeleton: { height: '60px', background: '#0f0f0f', borderRadius: '6px' },
  errorState: {
    display: 'flex', flexDirection: 'column' as const,
    alignItems: 'center', justifyContent: 'center',
    height: '100%', gap: '8px', color: '#ef4444', fontSize: '13px',
  },
  emptyState: {
    display: 'flex', flexDirection: 'column' as const,
    alignItems: 'center', justifyContent: 'center',
    height: '100%', gap: '8px',
  },
} as const;

let _injected = false;
function ensureStyles() {
  if (_injected || typeof document === 'undefined') return;
  if (document.querySelector('[data-fa-anim]')) { _injected = true; return; }
  const s = document.createElement('style');
  s.setAttribute('data-fa-anim', '');
  s.textContent = '@keyframes faPulse{0%,100%{opacity:1}50%{opacity:0.3}}';
  document.head.appendChild(s);
  _injected = true;
}

export function FleetAnalytics() {
  const { analytics, loading, error, proRequired, refetch } = useFleetAnalytics();

  if (proRequired) return <ProGate featureName="Fleet Analytics" />;

  ensureStyles();

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <div style={styles.headerTitle}>Fleet Analytics</div>
        <div style={styles.headerSub}>Aggregate patterns across fleet sessions</div>
      </div>

      <div style={styles.body}>
        {loading ? (
          <div style={styles.statGrid}>
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} style={{ ...styles.skeleton, animation: 'faPulse 1.5s ease-in-out infinite', animationDelay: `${i * 0.1}s` }} />
            ))}
          </div>
        ) : error ? (
          <div style={styles.errorState}>
            <span>{error}</span>
            <button style={{ color: '#555', fontSize: '12px', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }} onClick={refetch}>Retry</button>
          </div>
        ) : !analytics ? (
          <div style={styles.emptyState}>
            <span style={{ color: '#444', fontSize: '14px', fontWeight: 500 }}>No fleet data</span>
          </div>
        ) : (
          <>
            <div style={styles.statGrid}>
              <div style={styles.statCard}>
                <div style={styles.statLabel}>Total Sessions</div>
                <div style={styles.statValue}>{analytics.totalSessions}</div>
              </div>
              <div style={styles.statCard}>
                <div style={styles.statLabel}>Completed</div>
                <div style={{ ...styles.statValue, color: '#22c55e' }}>{analytics.completedCount}</div>
              </div>
              <div style={styles.statCard}>
                <div style={styles.statLabel}>Active</div>
                <div style={{ ...styles.statValue, color: '#3b82f6' }}>{analytics.activeCount}</div>
              </div>
              <div style={styles.statCard}>
                <div style={styles.statLabel}>Success Rate</div>
                <div style={styles.statValue}>
                  {analytics.successRate !== null ? `${analytics.successRate}%` : '—'}
                </div>
                {analytics.successRate !== null && (
                  <div style={styles.statSub}>of completed sessions</div>
                )}
              </div>
            </div>

            {analytics.recentSessions.length > 0 && (
              <div>
                <div style={styles.sectionLabel}>Recent Sessions</div>
                {analytics.recentSessions.map((s: FleetSession) => (
                  <div key={s.slug} style={styles.sessionRow}>
                    <div style={styles.statusDot(s.status)} />
                    <span style={styles.sessionName}>{s.slug}</span>
                    <span style={styles.statusBadge(s.status)}>{s.status}</span>
                    <span style={styles.sessionDate}>{formatDate(s.started)}</span>
                  </div>
                ))}
              </div>
            )}

            {analytics.totalSessions === 0 && (
              <div style={styles.emptyState}>
                <span style={{ color: '#444', fontSize: '14px', fontWeight: 500 }}>No sessions yet</span>
                <span style={{ color: '#333', fontSize: '12px', textAlign: 'center', maxWidth: '280px', lineHeight: '1.6' }}>
                  Fleet Analytics becomes useful from session 3+. Run /fleet to start coordinating parallel agents.
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

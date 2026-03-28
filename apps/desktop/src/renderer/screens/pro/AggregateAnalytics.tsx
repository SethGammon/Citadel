import { useAggregateAnalytics } from '../../hooks/useCitadel.js';
import { ProGate } from '../../components/ProGate.js';

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
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px',
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
  sectionLabel: {
    fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em',
    textTransform: 'uppercase' as const, color: '#444',
    borderBottom: '1px solid #1a1a1a', paddingBottom: '6px', marginBottom: '10px',
  },
  statusBreakdownRow: {
    display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px',
  },
  statusLabel: (s: string) => ({
    fontSize: '11px', color: statusColor(s), fontWeight: 500,
    width: '90px', flexShrink: 0,
  }),
  barTrack: {
    flex: 1, height: '8px', background: '#0f0f0f', borderRadius: '4px', overflow: 'hidden',
  },
  barFill: (s: string, pct: number) => ({
    height: '100%', width: `${pct}%`, background: statusColor(s),
    borderRadius: '4px', transition: 'width 300ms',
  }),
  barCount: {
    fontSize: '11px', color: '#444', width: '30px', textAlign: 'right' as const, flexShrink: 0,
  },
  skeleton: { height: '80px', background: '#0f0f0f', borderRadius: '6px' },
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
  if (document.querySelector('[data-aa-anim]')) { _injected = true; return; }
  const s = document.createElement('style');
  s.setAttribute('data-aa-anim', '');
  s.textContent = '@keyframes aaPulse{0%,100%{opacity:1}50%{opacity:0.3}}';
  document.head.appendChild(s);
  _injected = true;
}

export function AggregateAnalytics() {
  const { analytics, loading, error, proRequired, refetch } = useAggregateAnalytics();

  if (proRequired) return <ProGate featureName="Aggregate Analytics" />;

  ensureStyles();

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <div style={styles.headerTitle}>Aggregate Campaign Analytics</div>
        <div style={styles.headerSub}>Patterns across all campaigns — useful from campaign 3+</div>
      </div>

      <div style={styles.body}>
        {loading ? (
          <div style={styles.statGrid}>
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} style={{ ...styles.skeleton, animation: 'aaPulse 1.5s ease-in-out infinite', animationDelay: `${i * 0.1}s` }} />
            ))}
          </div>
        ) : error ? (
          <div style={styles.errorState}>
            <span>{error}</span>
            <button style={{ color: '#555', fontSize: '12px', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }} onClick={refetch}>Retry</button>
          </div>
        ) : !analytics ? (
          <div style={styles.emptyState}>
            <span style={{ color: '#444', fontSize: '14px', fontWeight: 500 }}>No data available</span>
          </div>
        ) : (
          <>
            {/* Summary stats */}
            <div style={styles.statGrid}>
              <div style={styles.statCard}>
                <div style={styles.statLabel}>Total Campaigns</div>
                <div style={styles.statValue}>{analytics.totalCampaigns}</div>
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
                <div style={styles.statLabel}>Avg Phase Progress</div>
                <div style={styles.statValue}>
                  {analytics.avgPhaseCompletion !== null ? `${analytics.avgPhaseCompletion}%` : '—'}
                </div>
              </div>
            </div>

            {/* Status breakdown */}
            {Object.keys(analytics.statusBreakdown).length > 0 && (
              <div>
                <div style={styles.sectionLabel}>Status Breakdown</div>
                {Object.entries(analytics.statusBreakdown)
                  .sort((a, b) => b[1] - a[1])
                  .map(([status, count]) => {
                    const pct = analytics.totalCampaigns > 0
                      ? Math.round((count / analytics.totalCampaigns) * 100)
                      : 0;
                    return (
                      <div key={status} style={styles.statusBreakdownRow}>
                        <span style={styles.statusLabel(status)}>{status}</span>
                        <div style={styles.barTrack}>
                          <div style={styles.barFill(status, pct)} />
                        </div>
                        <span style={styles.barCount}>{count}</span>
                      </div>
                    );
                  })}
              </div>
            )}

            {analytics.totalCampaigns < 3 && (
              <div style={{ padding: '12px', background: '#0f0f0f', borderRadius: '6px', border: '1px solid #1a1a1a' }}>
                <div style={{ fontSize: '12px', color: '#444', lineHeight: '1.6' }}>
                  Aggregate Analytics becomes more useful with 3+ campaigns. You have {analytics.totalCampaigns} so far. Patterns and trends will surface as your campaign history grows.
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

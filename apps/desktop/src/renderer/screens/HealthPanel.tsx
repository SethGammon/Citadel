import { useHealth } from '../hooks/useCitadel.js';

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
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#e5e5e5',
  },
  headerMeta: {
    fontSize: '11px',
    color: '#333',
  },
  body: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '20px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '12px',
  },
  retryBtn: {
    background: 'none',
    border: '1px solid #2a2a2a',
    borderRadius: '4px',
    color: '#555',
    fontSize: '11px',
    cursor: 'pointer',
    padding: '3px 8px',
    transition: 'border-color 150ms, color 150ms',
  },
  card: {
    background: '#0f0f0f',
    border: '1px solid #1a1a1a',
    borderRadius: '6px',
    padding: '12px 14px',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '8px',
  },
  cardTitle: {
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: '#555',
  },
  statusBadge: (ok: boolean) => ({
    fontSize: '10px',
    fontWeight: 600,
    color: ok ? '#22c55e' : '#ef4444',
    background: ok ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
    border: `1px solid ${ok ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
    borderRadius: '3px',
    padding: '1px 6px',
  }),
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '3px 0',
    borderBottom: '1px solid #0a0a0a',
    gap: '8px',
  },
  rowLabel: {
    fontSize: '12px',
    color: '#555',
    flexShrink: 0,
  },
  rowValue: {
    fontSize: '12px',
    color: '#888',
    textAlign: 'right' as const,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '12px',
  },
  errorState: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    gap: '8px',
    color: '#ef4444',
    fontSize: '13px',
  },
  skeletonCard: {
    height: '80px',
    background: '#0f0f0f',
    borderRadius: '6px',
    border: '1px solid #1a1a1a',
  },
} as const;

let _injected = false;
function ensureStyles() {
  if (_injected || typeof document === 'undefined') return;
  if (document.querySelector('[data-hp-anim]')) { _injected = true; return; }
  const s = document.createElement('style');
  s.setAttribute('data-hp-anim', '');
  s.textContent = '@keyframes hpPulse{0%,100%{opacity:1}50%{opacity:0.3}}';
  document.head.appendChild(s);
  _injected = true;
}

function SkeletonGrid() {
  ensureStyles();
  return (
    <div style={styles.grid}>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} style={{ ...styles.skeletonCard, animation: 'hpPulse 1.5s ease-in-out infinite', animationDelay: `${i * 0.1}s` }} />
      ))}
    </div>
  );
}

type Obj = Record<string, unknown>;

function numVal(v: unknown): string {
  if (typeof v === 'number') return v.toLocaleString();
  return '—';
}

function strVal(v: unknown): string {
  if (typeof v === 'string' && v) return v;
  return '—';
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.row}>
      <span style={styles.rowLabel}>{label}</span>
      <span style={styles.rowValue}>{value}</span>
    </div>
  );
}

export function HealthPanel() {
  const { health, loading, error, refetch } = useHealth();

  const hooksOk =
    health && typeof health.hooks === 'object' && health.hooks !== null
      ? (health.hooks as Obj)['installed'] === true
      : false;

  const campaigns = health?.campaigns as Obj | undefined;
  const fleet = health?.fleet as Obj | undefined;
  const hooks = health?.hooks as Obj | undefined;
  const telemetry = health?.telemetry as Obj | undefined;
  const coordination = health?.coordination as Obj | undefined;
  const tokenEcon = health?.token_economics as Obj | undefined;

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <span style={styles.headerTitle}>Health</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {health?.timestamp && (
            <span style={styles.headerMeta}>
              {new Date(health.timestamp as string).toLocaleTimeString()}
            </span>
          )}
          <button style={styles.retryBtn} onClick={refetch}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#444'; (e.currentTarget as HTMLButtonElement).style.color = '#888'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#2a2a2a'; (e.currentTarget as HTMLButtonElement).style.color = '#555'; }}
          >
            Refresh
          </button>
        </div>
      </div>

      <div style={styles.body}>
        {loading ? (
          <SkeletonGrid />
        ) : error ? (
          <div style={styles.errorState}>
            <span>{error}</span>
            <button style={{ color: '#555', fontSize: '12px', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }} onClick={refetch}>Retry</button>
          </div>
        ) : !health ? (
          <div style={styles.errorState}>No health data available. Ensure health.js exists in the project.</div>
        ) : (
          <div style={styles.grid}>
            {/* Campaigns */}
            <div style={styles.card}>
              <div style={styles.cardHeader}>
                <span style={styles.cardTitle}>Campaigns</span>
              </div>
              <DataRow label="Active" value={numVal(campaigns?.['active'] && Array.isArray(campaigns['active']) ? (campaigns['active'] as unknown[]).length : campaigns?.['active'])} />
              <DataRow label="Completed" value={numVal(campaigns?.['completed_count'])} />
            </div>

            {/* Fleet */}
            <div style={styles.card}>
              <div style={styles.cardHeader}>
                <span style={styles.cardTitle}>Fleet</span>
              </div>
              <DataRow label="Active sessions" value={numVal(fleet?.['active_sessions'] && Array.isArray(fleet['active_sessions']) ? (fleet['active_sessions'] as unknown[]).length : fleet?.['active_sessions'])} />
              <DataRow label="Latest" value={strVal(fleet?.['latest'])} />
            </div>

            {/* Hooks */}
            <div style={styles.card}>
              <div style={styles.cardHeader}>
                <span style={styles.cardTitle}>Hooks</span>
                <span style={styles.statusBadge(hooksOk)}>{hooksOk ? 'installed' : 'not found'}</span>
              </div>
              <DataRow label="Settings path" value={strVal(hooks?.['settings_path'])} />
            </div>

            {/* Telemetry */}
            <div style={styles.card}>
              <div style={styles.cardHeader}>
                <span style={styles.cardTitle}>Telemetry</span>
              </div>
              <DataRow label="Total events" value={numVal(telemetry?.['event_count'])} />
              <DataRow label="Hook fires today" value={numVal(telemetry?.['hook_fires_today'])} />
            </div>

            {/* Coordination */}
            <div style={styles.card}>
              <div style={styles.cardHeader}>
                <span style={styles.cardTitle}>Coordination</span>
              </div>
              <DataRow label="Active claims" value={numVal(coordination?.['active_claims'])} />
              <DataRow label="Active instances" value={numVal(coordination?.['active_instances'])} />
            </div>

            {/* Token Economics */}
            <div style={styles.card}>
              <div style={styles.cardHeader}>
                <span style={styles.cardTitle}>Token Economics</span>
              </div>
              <DataRow
                label="Circuit breaker saves"
                value={numVal((tokenEcon?.['circuit_breaker_saves'] as Obj | undefined)?.['total_trips'])}
              />
              <DataRow
                label="Quality gate saves"
                value={numVal((tokenEcon?.['quality_gate_saves'] as Obj | undefined)?.['violations_caught'])}
              />
              <DataRow
                label="Est. tokens saved"
                value={numVal(tokenEcon?.['total_estimated_savings'])}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import { useTokenEconomics } from '../../hooks/useCitadel.js';
import { ProGate } from '../../components/ProGate.js';

type Obj = Record<string, unknown>;

function numVal(v: unknown, fallback = 0): number {
  return typeof v === 'number' ? v : fallback;
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
  headerTitle: { fontSize: '13px', fontWeight: 600, color: '#e5e5e5' },
  headerSub: { fontSize: '11px', color: '#444', marginTop: '2px' },
  body: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '20px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px',
  },
  bigStatGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: '12px',
  },
  bigStat: {
    background: '#0f0f0f',
    border: '1px solid #1a1a1a',
    borderRadius: '6px',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
  },
  bigStatLabel: {
    fontSize: '10px',
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: '#444',
  },
  bigStatValue: {
    fontSize: '24px',
    fontWeight: 600,
    color: '#e5e5e5',
    lineHeight: '1',
  },
  bigStatSub: {
    fontSize: '11px',
    color: '#333',
    marginTop: '2px',
  },
  sectionLabel: {
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: '#444',
    borderBottom: '1px solid #1a1a1a',
    paddingBottom: '6px',
    marginBottom: '8px',
  },
  infoCard: {
    background: '#0f0f0f',
    border: '1px solid #1a1a1a',
    borderRadius: '6px',
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '3px 0',
    borderBottom: '1px solid #0a0a0a',
  },
  rowLabel: { fontSize: '12px', color: '#555' },
  rowValue: { fontSize: '12px', color: '#888', fontWeight: 500 },
  methodNote: {
    fontSize: '11px',
    color: '#2a2a2a',
    fontStyle: 'italic',
    marginTop: '4px',
    lineHeight: '1.5',
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
  if (document.querySelector('[data-te-anim]')) { _injected = true; return; }
  const s = document.createElement('style');
  s.setAttribute('data-te-anim', '');
  s.textContent = '@keyframes tePulse{0%,100%{opacity:1}50%{opacity:0.3}}';
  document.head.appendChild(s);
  _injected = true;
}

export function TokenEconomics() {
  const { health, loading, error, proRequired, refetch } = useTokenEconomics();

  if (proRequired) return <ProGate featureName="Token Economics" />;

  ensureStyles();

  const te = health?.token_economics as Obj | undefined;
  const cbSaves = te?.['circuit_breaker_saves'] as Obj | undefined;
  const qgSaves = te?.['quality_gate_saves'] as Obj | undefined;
  const totalSaved = numVal(te?.['total_estimated_savings']);
  const cbTrips = numVal(cbSaves?.['total_trips']);
  const cbTokens = numVal(cbSaves?.['tokens_saved_estimate']);
  const qgViolations = numVal(qgSaves?.['violations_caught']);
  const qgTokens = numVal(qgSaves?.['tokens_saved_estimate']);

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <div style={styles.headerTitle}>Token Economics</div>
        <div style={styles.headerSub}>Estimated spend and savings from orchestration intelligence</div>
      </div>

      <div style={styles.body}>
        {loading ? (
          <>
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} style={{ ...styles.skeleton, animation: 'tePulse 1.5s ease-in-out infinite', animationDelay: `${i * 0.15}s` }} />
            ))}
          </>
        ) : error ? (
          <div style={styles.errorState}>
            <span>{error}</span>
            <button style={{ color: '#555', fontSize: '12px', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }} onClick={refetch}>Retry</button>
          </div>
        ) : !health ? (
          <div style={styles.emptyState}>
            <span style={{ color: '#444', fontSize: '14px', fontWeight: 500 }}>No data available</span>
            <span style={{ color: '#333', fontSize: '12px' }}>Health data is required for token economics.</span>
          </div>
        ) : (
          <>
            {/* Big stats */}
            <div style={styles.bigStatGrid}>
              <div style={styles.bigStat}>
                <div style={styles.bigStatLabel}>Est. Tokens Saved</div>
                <div style={styles.bigStatValue}>{totalSaved.toLocaleString()}</div>
                <div style={styles.bigStatSub}>across all sessions</div>
              </div>
              <div style={styles.bigStat}>
                <div style={styles.bigStatLabel}>Circuit Breaker Trips</div>
                <div style={styles.bigStatValue}>{cbTrips}</div>
                <div style={styles.bigStatSub}>runaway sessions stopped</div>
              </div>
              <div style={styles.bigStat}>
                <div style={styles.bigStatLabel}>Quality Gate Catches</div>
                <div style={styles.bigStatValue}>{qgViolations}</div>
                <div style={styles.bigStatSub}>violations caught early</div>
              </div>
            </div>

            {/* Circuit Breaker detail */}
            <div>
              <div style={styles.sectionLabel}>Circuit Breaker Savings</div>
              <div style={styles.infoCard}>
                <div style={styles.row}>
                  <span style={styles.rowLabel}>Total trips</span>
                  <span style={styles.rowValue}>{cbTrips}</span>
                </div>
                <div style={styles.row}>
                  <span style={styles.rowLabel}>Tokens saved (estimate)</span>
                  <span style={styles.rowValue}>{cbTokens.toLocaleString()}</span>
                </div>
                <div style={styles.methodNote}>
                  {typeof cbSaves?.['methodology'] === 'string' ? cbSaves['methodology'] : 'trips × 15,000 tokens (avg spiral before intervention)'}
                </div>
              </div>
            </div>

            {/* Quality Gate detail */}
            <div>
              <div style={styles.sectionLabel}>Quality Gate Savings</div>
              <div style={styles.infoCard}>
                <div style={styles.row}>
                  <span style={styles.rowLabel}>Violations caught</span>
                  <span style={styles.rowValue}>{qgViolations}</span>
                </div>
                <div style={styles.row}>
                  <span style={styles.rowLabel}>Tokens saved (estimate)</span>
                  <span style={styles.rowValue}>{qgTokens.toLocaleString()}</span>
                </div>
                <div style={styles.methodNote}>
                  {typeof qgSaves?.['methodology'] === 'string' ? qgSaves['methodology'] : 'violations × 8,000 tokens (avg fix session avoided)'}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

import { useState, useMemo } from 'react';
import { useCampaigns, useTelemetryEvents } from '../../hooks/useCitadel.js';
import { ProGate } from '../../components/ProGate.js';
import type { TelemetryEvent } from '../../hooks/useCitadel.js';

const EVENT_COLOR: Record<string, string> = {
  'campaign-start': '#3b82f6',
  'campaign-complete': '#22c55e',
  'agent-start': '#6366f1',
  'agent-complete': '#22c55e',
  'agent-failed': '#ef4444',
  'circuit-breaker-trip': '#ef4444',
  'quality-gate-violation': '#f59e0b',
};

function eventColor(ev: string): string {
  return EVENT_COLOR[ev] ?? '#444';
}

function formatTime(ts: string | undefined): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
  } catch { return '—'; }
}

function formatDate(ts: string | undefined): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch { return '—'; }
}

const styles = {
  root: {
    display: 'flex', flexDirection: 'column' as const,
    height: '100%', background: '#0a0a0a', overflow: 'hidden',
  },
  header: {
    padding: '12px 20px', borderBottom: '1px solid #1a1a1a',
    flexShrink: 0, display: 'flex', alignItems: 'center', gap: '12px',
  },
  headerTitle: { fontSize: '13px', fontWeight: 600, color: '#e5e5e5' },
  campaignSelect: {
    background: '#0f0f0f', border: '1px solid #1e1e1e',
    borderRadius: '4px', color: '#ccc', fontSize: '12px',
    padding: '4px 8px', outline: 'none', cursor: 'pointer',
    transition: 'border-color 150ms',
  },
  body: {
    flex: 1, overflowY: 'auto' as const,
    padding: '16px 20px',
    display: 'flex', flexDirection: 'column' as const,
  },
  waterfallRow: {
    display: 'flex', gap: '12px', alignItems: 'flex-start',
    padding: '5px 0', borderBottom: '1px solid #0a0a0a',
  },
  timeCol: {
    width: '80px', flexShrink: 0,
    fontSize: '10px', color: '#2a2a2a',
    fontFamily: 'ui-monospace, monospace',
    paddingTop: '2px',
  },
  dotCol: {
    display: 'flex', flexDirection: 'column' as const,
    alignItems: 'center', width: '16px', flexShrink: 0,
  },
  dot: (ev: string) => ({
    width: '8px', height: '8px', borderRadius: '50%',
    background: eventColor(ev), marginTop: '3px', flexShrink: 0,
  }),
  lineConnector: {
    width: '1px', flex: 1, background: '#111', minHeight: '8px',
  },
  eventContent: { flex: 1, minWidth: 0 },
  eventType: (ev: string) => ({
    fontSize: '11px', fontWeight: 600,
    color: eventColor(ev), marginBottom: '1px',
  }),
  eventAgent: {
    fontSize: '11px', color: '#555',
  },
  eventSession: {
    fontSize: '10px', color: '#333', fontFamily: 'ui-monospace, monospace',
  },
  emptyState: {
    display: 'flex', flexDirection: 'column' as const,
    alignItems: 'center', justifyContent: 'center',
    height: '100%', gap: '8px',
  },
  errorState: {
    display: 'flex', flexDirection: 'column' as const,
    alignItems: 'center', justifyContent: 'center',
    height: '100%', gap: '8px', color: '#ef4444', fontSize: '13px',
  },
  skeleton: { height: '32px', background: '#0f0f0f', borderRadius: '3px', marginBottom: '4px' },
} as const;

let _injected = false;
function ensureStyles() {
  if (_injected || typeof document === 'undefined') return;
  if (document.querySelector('[data-pw-anim]')) { _injected = true; return; }
  const s = document.createElement('style');
  s.setAttribute('data-pw-anim', '');
  s.textContent = '@keyframes pwPulse{0%,100%{opacity:1}50%{opacity:0.3}}';
  document.head.appendChild(s);
  _injected = true;
}

function WaterfallEntry({ ev, isLast }: { ev: TelemetryEvent; isLast: boolean }) {
  const evName = typeof ev.event === 'string' ? ev.event : 'unknown';
  return (
    <div style={styles.waterfallRow}>
      <div style={styles.timeCol}>
        <div>{formatDate(ev.timestamp)}</div>
        <div style={{ color: '#1e1e1e' }}>{formatTime(ev.timestamp)}</div>
      </div>
      <div style={styles.dotCol}>
        <div style={styles.dot(evName)} />
        {!isLast && <div style={styles.lineConnector} />}
      </div>
      <div style={styles.eventContent}>
        <div style={styles.eventType(evName)}>{evName}</div>
        {ev.agent && <div style={styles.eventAgent}>{ev.agent}</div>}
        {ev.session && (
          <div style={styles.eventSession}>{ev.session}</div>
        )}
      </div>
    </div>
  );
}

// Inner component that handles events fetching — only rendered when slug is selected
function WaterfallView({ slug }: { slug: string }) {
  const { events, loading, error, proRequired, refetch } = useTelemetryEvents(slug);

  if (proRequired) return <ProGate featureName="Postmortem Waterfall" />;

  ensureStyles();

  if (loading) {
    return (
      <div style={{ padding: '16px 20px' }}>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} style={{ ...styles.skeleton, animation: 'pwPulse 1.5s ease-in-out infinite', animationDelay: `${i * 0.1}s` }} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.errorState}>
        <span>{error}</span>
        <button style={{ color: '#555', fontSize: '12px', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }} onClick={refetch}>Retry</button>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div style={styles.emptyState}>
        <span style={{ color: '#444', fontSize: '14px', fontWeight: 500 }}>No events recorded</span>
        <span style={{ color: '#333', fontSize: '12px' }}>
          No telemetry events found for this campaign. Events are recorded by hooks when CITADEL_UI=true.
        </span>
      </div>
    );
  }

  return (
    <div style={styles.body}>
      {events.map((ev, i) => (
        <WaterfallEntry key={i} ev={ev} isLast={i === events.length - 1} />
      ))}
    </div>
  );
}

// Top-level component handles campaign selector without needing pro check on its own
function CampaignSelector({
  selectedSlug,
  onSelect,
}: {
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
}) {
  const { campaigns } = useCampaigns();
  const completedAndActive = useMemo(
    () => campaigns.filter((c) => c.status === 'completed' || c.status === 'active' || c.status === 'in-progress'),
    [campaigns]
  );

  return (
    <select
      style={styles.campaignSelect}
      value={selectedSlug ?? ''}
      onChange={(e) => { if (e.target.value) onSelect(e.target.value); }}
      aria-label="Select campaign for postmortem"
    >
      <option value="">Select a campaign…</option>
      {completedAndActive.map((c) => (
        <option key={c.slug} value={c.slug}>
          {c.direction || c.slug} ({c.status})
        </option>
      ))}
      {campaigns.length > 0 && completedAndActive.length === 0 &&
        campaigns.map((c) => (
          <option key={c.slug} value={c.slug}>
            {c.direction || c.slug}
          </option>
        ))
      }
    </select>
  );
}

export function PostmortemWaterfall() {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  // Run a quick pro check at the top level using slug=null to trigger the IPC
  const { proRequired } = useTelemetryEvents(null);

  if (proRequired) return <ProGate featureName="Postmortem Waterfall" />;

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <span style={styles.headerTitle}>Postmortem Waterfall</span>
        <CampaignSelector selectedSlug={selectedSlug} onSelect={setSelectedSlug} />
      </div>

      {!selectedSlug ? (
        <div style={styles.emptyState}>
          <span style={{ color: '#444', fontSize: '14px', fontWeight: 500 }}>Select a campaign</span>
          <span style={{ color: '#333', fontSize: '12px', textAlign: 'center', maxWidth: '280px', lineHeight: '1.6' }}>
            Choose a campaign above to see its chronological event trace — agent starts, completions, circuit breaker trips, and quality gate violations.
          </span>
        </div>
      ) : (
        <WaterfallView key={selectedSlug} slug={selectedSlug} />
      )}
    </div>
  );
}

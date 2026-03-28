import { useState, useMemo } from 'react';
import { useCampaigns } from '../hooks/useCitadel.js';
import type { Campaign } from '../hooks/useCitadel.js';
import { statusColor, formatDate } from '../utils/ui.js';
import { fastTransition } from '../utils/motion.js';

interface Props {
  onCampaignSelect: (slug: string) => void;
}

type SortKey = 'status' | 'date' | 'name';

const STATUS_ORDER: Record<string, number> = {
  active: 0,
  'in-progress': 0,
  parked: 1,
  pending: 2,
  completed: 3,
  failed: 4,
  unknown: 5,
};


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
  sortBar: {
    display: 'flex',
    gap: '4px',
  },
  sortBtn: (active: boolean) => ({
    padding: '3px 8px',
    background: active ? '#1e1e1e' : 'none',
    border: `1px solid ${active ? '#333' : 'transparent'}`,
    borderRadius: '4px',
    color: active ? '#ccc' : '#555',
    fontSize: '11px',
    cursor: 'pointer',
    transition: fastTransition('background-color', 'border-color', 'color'),
  }),
  list: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '8px 0',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '9px 20px',
    cursor: 'pointer',
    border: 'none',
    background: 'none',
    width: '100%',
    textAlign: 'left' as const,
    color: 'inherit',
    transition: fastTransition('background-color', 'transform', 'box-shadow'),
    borderBottom: '1px solid #0f0f0f',
  },
  rowHover: {
    background: '#0f0f0f',
    transform: 'translateY(-1px)',
    boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
  },
  statusBadge: (status: string) => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '2px 6px',
    borderRadius: '3px',
    background: `${statusColor(status)}18`,
    border: `1px solid ${statusColor(status)}40`,
    color: statusColor(status),
    fontSize: '10px',
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
    flexShrink: 0,
    minWidth: '70px',
    justifyContent: 'center',
  }),
  direction: {
    fontSize: '13px',
    color: '#ccc',
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  phaseProgress: {
    fontSize: '11px',
    color: '#444',
    flexShrink: 0,
    minWidth: '50px',
    textAlign: 'right' as const,
  },
  dateText: {
    fontSize: '11px',
    color: '#333',
    flexShrink: 0,
    minWidth: '80px',
    textAlign: 'right' as const,
  },
  progressBar: {
    width: '48px',
    height: '3px',
    background: '#1a1a1a',
    borderRadius: '2px',
    overflow: 'hidden',
    flexShrink: 0,
  },
  skeleton: {
    height: '40px',
    background: '#0f0f0f',
    borderBottom: '1px solid #0a0a0a',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    gap: '8px',
  },
  emptyTitle: {
    color: '#444',
    fontSize: '14px',
    fontWeight: 500,
  },
  emptyBody: {
    color: '#333',
    fontSize: '12px',
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
} as const;

let _stylesInjected = false;
function ensureStyles() {
  if (_stylesInjected || typeof document === 'undefined') return;
  if (document.querySelector('[data-cl-anim]')) { _stylesInjected = true; return; }
  const s = document.createElement('style');
  s.setAttribute('data-cl-anim', '');
  s.textContent = '@keyframes clPulse{0%,100%{opacity:1}50%{opacity:0.3}}';
  document.head.appendChild(s);
  _stylesInjected = true;
}

function SkeletonRows() {
  ensureStyles();
  return (
    <>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} style={{ ...styles.skeleton, animation: 'clPulse 1.5s ease-in-out infinite', animationDelay: `${i * 0.1}s` }} />
      ))}
    </>
  );
}

export function CampaignList({ onCampaignSelect }: Props) {
  const { campaigns, loading, error, refetch } = useCampaigns();
  const [sortKey, setSortKey] = useState<SortKey>('status');
  const [hoveredSlug, setHoveredSlug] = useState('');

  const sorted = useMemo(() => {
    return [...campaigns].sort((a, b) => {
      if (sortKey === 'status') {
        const sa = STATUS_ORDER[a.status] ?? 5;
        const sb = STATUS_ORDER[b.status] ?? 5;
        if (sa !== sb) return sa - sb;
      }
      if (sortKey === 'date' || sortKey === 'status') {
        const ta = a.started ? new Date(a.started).getTime() : 0;
        const tb = b.started ? new Date(b.started).getTime() : 0;
        return tb - ta;
      }
      return (a.direction || a.slug).localeCompare(b.direction || b.slug);
    });
  }, [campaigns, sortKey]);

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <span style={styles.headerTitle}>
          Campaigns{campaigns.length > 0 ? ` (${campaigns.length})` : ''}
        </span>
        <div style={styles.sortBar} role="group" aria-label="Sort by">
          {(['status', 'date', 'name'] as SortKey[]).map((k) => (
            <button
              key={k}
              style={styles.sortBtn(sortKey === k)}
              onClick={() => setSortKey(k)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSortKey(k); } }}
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      <div style={styles.list} role="list">
        {loading ? (
          <SkeletonRows />
        ) : error ? (
          <div style={styles.errorState}>
            <span>{error}</span>
            <button
              style={{ color: '#555', fontSize: '12px', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
              onClick={refetch}
            >
              Retry
            </button>
          </div>
        ) : sorted.length === 0 ? (
          <div style={styles.emptyState}>
            <span style={styles.emptyTitle}>No campaigns yet</span>
            <span style={styles.emptyBody}>
              Run <code style={{ color: '#555' }}>/archon</code> to start a campaign. Each session is tracked here.
            </span>
          </div>
        ) : (
          sorted.map((c) => (
            <CampaignRow
              key={c.slug}
              campaign={c}
              hovered={hoveredSlug === c.slug}
              onHover={setHoveredSlug}
              onClick={() => onCampaignSelect(c.slug)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function CampaignRow({
  campaign: c,
  hovered,
  onHover,
  onClick,
}: {
  campaign: Campaign;
  hovered: boolean;
  onHover: (s: string) => void;
  onClick: () => void;
}) {
  const pct = c.phaseCount > 0 ? Math.round((c.currentPhase / c.phaseCount) * 100) : 0;

  return (
    <button
      role="listitem"
      style={{ ...styles.row, ...(hovered ? styles.rowHover : {}) }}
      onMouseEnter={() => onHover(c.slug)}
      onMouseLeave={() => onHover('')}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      aria-label={`${c.direction || c.slug}, ${c.status}`}
    >
      <span style={styles.statusBadge(c.status)}>{c.status}</span>
      <span style={styles.direction}>{c.direction || c.slug}</span>
      {c.phaseCount > 0 && (
        <div style={styles.progressBar}>
          <div style={{ height: '100%', width: `${pct}%`, background: statusColor(c.status), borderRadius: '2px' }} />
        </div>
      )}
      <span style={styles.phaseProgress}>
        {c.phaseCount > 0 ? `${c.currentPhase}/${c.phaseCount}` : '—'}
      </span>
      <span style={styles.dateText}>{formatDate(c.started)}</span>
    </button>
  );
}

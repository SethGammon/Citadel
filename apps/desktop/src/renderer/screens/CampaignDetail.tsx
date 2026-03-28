import { useState } from 'react';
import { useCampaignDetail } from '../hooks/useCitadel.js';
import { statusColor, worktreeStatusColor, formatDate } from '../utils/ui.js';
import { fastTransition } from '../utils/motion.js';

interface Props {
  slug: string;
  onBack: () => void;
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
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexShrink: 0,
  },
  backBtn: {
    background: 'none',
    border: 'none',
    color: '#555',
    cursor: 'pointer',
    padding: '2px 6px',
    fontSize: '13px',
    borderRadius: '4px',
    transition: fastTransition('color', 'background-color'),
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  headerInfo: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#e5e5e5',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  headerMeta: {
    fontSize: '11px',
    color: '#444',
    marginTop: '2px',
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap' as const,
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
  body: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '20px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '20px',
  },
  section: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
  },
  sectionLabel: {
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: '#555',
    borderBottom: '1px solid #1a1a1a',
    paddingBottom: '6px',
  },
  sectionContent: {
    fontSize: '12px',
    color: '#888',
    lineHeight: '1.7',
    whiteSpace: 'pre-wrap' as const,
    fontFamily: 'ui-monospace, "SF Mono", monospace',
  },
  sectionEmpty: {
    fontSize: '12px',
    color: '#333',
    fontStyle: 'italic',
  },
  metaGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: '8px',
  },
  metaCard: {
    background: '#0f0f0f',
    border: '1px solid #1a1a1a',
    borderRadius: '6px',
    padding: '10px 12px',
  },
  metaLabel: {
    fontSize: '10px',
    fontWeight: 600,
    color: '#444',
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    marginBottom: '4px',
  },
  metaValue: {
    fontSize: '13px',
    color: '#ccc',
    fontWeight: 500,
  },
  skeletonBlock: {
    height: '12px',
    background: '#0f0f0f',
    borderRadius: '3px',
    marginBottom: '6px',
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
  if (document.querySelector('[data-cd-anim]')) { _stylesInjected = true; return; }
  const s = document.createElement('style');
  s.setAttribute('data-cd-anim', '');
  s.textContent = '@keyframes cdPulse{0%,100%{opacity:1}50%{opacity:0.3}}';
  document.head.appendChild(s);
  _stylesInjected = true;
}

function SkeletonSection() {
  ensureStyles();
  return (
    <div style={styles.section}>
      <div style={{ ...styles.skeletonBlock, width: '120px', animation: 'cdPulse 1.5s ease-in-out infinite' }} />
      {[80, 100, 60, 90].map((w, i) => (
        <div key={i} style={{ ...styles.skeletonBlock, width: `${w}%`, animation: 'cdPulse 1.5s ease-in-out infinite', animationDelay: `${i * 0.1}s` }} />
      ))}
    </div>
  );
}

function Section({ label, content }: { label: string; content: string }) {
  return (
    <div style={styles.section}>
      <div style={styles.sectionLabel}>{label}</div>
      {content ? (
        <pre style={styles.sectionContent}>{content}</pre>
      ) : (
        <div style={styles.sectionEmpty}>No content</div>
      )}
    </div>
  );
}

export function CampaignDetail({ slug, onBack }: Props) {
  const { detail, loading, error, refetch } = useCampaignDetail(slug);
  const [backHovered, setBackHovered] = useState(false);

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <button
          style={{ ...styles.backBtn, ...(backHovered ? { color: '#aaa', background: '#111' } : {}) }}
          onMouseEnter={() => setBackHovered(true)}
          onMouseLeave={() => setBackHovered(false)}
          onClick={onBack}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onBack(); } }}
          aria-label="Back to campaign list"
        >
          ← Back
        </button>
        <div style={styles.headerInfo}>
          {detail ? (
            <>
              <div style={styles.headerTitle}>{detail.direction || detail.slug}</div>
              <div style={styles.headerMeta}>
                <span style={styles.statusBadge(detail.status)}>{detail.status}</span>
                <span>Started {formatDate(detail.started)}</span>
                {detail.completedAt && <span>Completed {formatDate(detail.completedAt)}</span>}
                {detail.phaseCount > 0 && (
                  <span>Phase {detail.currentPhase}/{detail.phaseCount}</span>
                )}
              </div>
            </>
          ) : (
            <div style={styles.headerTitle}>{slug}</div>
          )}
        </div>
      </div>

      <div style={styles.body}>
        {loading ? (
          <>
            <SkeletonSection />
            <SkeletonSection />
            <SkeletonSection />
          </>
        ) : error ? (
          <div style={styles.errorState}>
            <span>{error}</span>
            <button style={{ color: '#555', fontSize: '12px', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }} onClick={refetch}>
              Retry
            </button>
          </div>
        ) : !detail ? (
          <div style={styles.errorState}>Campaign not found: {slug}</div>
        ) : (
          <>
            {/* Meta cards */}
            <div style={styles.section}>
              <div style={styles.sectionLabel}>Overview</div>
              <div style={styles.metaGrid}>
                <div style={styles.metaCard}>
                  <div style={styles.metaLabel}>Status</div>
                  <div style={{ ...styles.metaValue, color: statusColor(detail.status) }}>{detail.status}</div>
                </div>
                <div style={styles.metaCard}>
                  <div style={styles.metaLabel}>Phase</div>
                  <div style={styles.metaValue}>{detail.phaseCount > 0 ? `${detail.currentPhase} / ${detail.phaseCount}` : '—'}</div>
                </div>
                <div style={styles.metaCard}>
                  <div style={styles.metaLabel}>Started</div>
                  <div style={styles.metaValue}>{formatDate(detail.started)}</div>
                </div>
                {detail.completedAt && (
                  <div style={styles.metaCard}>
                    <div style={styles.metaLabel}>Completed</div>
                    <div style={styles.metaValue}>{formatDate(detail.completedAt)}</div>
                  </div>
                )}
                {detail.branch && (
                  <div style={styles.metaCard}>
                    <div style={styles.metaLabel}>Branch</div>
                    <div style={{ ...styles.metaValue, fontSize: '11px', fontFamily: 'ui-monospace, "SF Mono", monospace', color: '#a78bfa' }}>{detail.branch}</div>
                  </div>
                )}
                {detail.worktreeStatus && (
                  <div style={styles.metaCard}>
                    <div style={styles.metaLabel}>Worktree</div>
                    <div style={{ ...styles.metaValue, color: worktreeStatusColor(detail.worktreeStatus) }}>{detail.worktreeStatus}</div>
                  </div>
                )}
              </div>
            </div>

            {detail.sections.claimedScope && (
              <Section label="Claimed Scope" content={detail.sections.claimedScope} />
            )}
            {detail.sections.phases && (
              <Section label="Phases" content={detail.sections.phases} />
            )}
            {detail.sections.activeContext && (
              <Section label="Active Context" content={detail.sections.activeContext} />
            )}
            {detail.sections.continuationState && (
              <Section label="Continuation State" content={detail.sections.continuationState} />
            )}
            {detail.sections.decisionLog && (
              <Section label="Decision Log" content={detail.sections.decisionLog} />
            )}
            {detail.sections.reviewQueue && (
              <Section label="Review Queue" content={detail.sections.reviewQueue} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

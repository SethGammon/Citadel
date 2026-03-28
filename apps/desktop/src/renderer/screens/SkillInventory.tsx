import { useState, useMemo } from 'react';
import { useSkills } from '../hooks/useCitadel.js';
import type { Skill } from '../hooks/useCitadel.js';

function formatDate(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
    });
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
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexShrink: 0,
    gap: '12px',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    minWidth: 0,
  },
  headerTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#e5e5e5',
    flexShrink: 0,
  },
  filterInput: {
    background: '#0f0f0f',
    border: '1px solid #1e1e1e',
    borderRadius: '4px',
    color: '#ccc',
    fontSize: '12px',
    padding: '4px 8px',
    outline: 'none',
    width: '180px',
    transition: 'border-color 150ms',
  },
  toggleBtn: (active: boolean) => ({
    padding: '3px 8px',
    background: active ? '#1e1e1e' : 'none',
    border: `1px solid ${active ? '#333' : 'transparent'}`,
    borderRadius: '4px',
    color: active ? '#ccc' : '#555',
    fontSize: '11px',
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'background-color 150ms, border-color 150ms, color 150ms',
  }),
  list: {
    flex: 1,
    overflowY: 'auto' as const,
  },
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    padding: '10px 20px',
    borderBottom: '1px solid #0f0f0f',
    transition: 'background-color 150ms',
  },
  rowHover: {
    background: '#0a0a0a',
  },
  nameCol: {
    flexShrink: 0,
    width: '160px',
  },
  skillName: {
    fontSize: '13px',
    fontWeight: 500,
    color: '#ccc',
  },
  skillSlug: {
    fontSize: '10px',
    color: '#333',
    fontFamily: 'ui-monospace, monospace',
    marginTop: '2px',
  },
  descCol: {
    flex: 1,
    minWidth: 0,
  },
  description: {
    fontSize: '12px',
    color: '#666',
    lineHeight: '1.5',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical' as const,
  },
  metaCol: {
    flexShrink: 0,
    width: '120px',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'flex-end',
    gap: '4px',
  },
  invocableBadge: {
    fontSize: '10px',
    fontWeight: 600,
    color: '#3b82f6',
    background: 'rgba(59,130,246,0.08)',
    border: '1px solid rgba(59,130,246,0.2)',
    borderRadius: '3px',
    padding: '1px 5px',
  },
  dateText: {
    fontSize: '10px',
    color: '#333',
  },
  skeleton: {
    height: '52px',
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

let _injected = false;
function ensureStyles() {
  if (_injected || typeof document === 'undefined') return;
  if (document.querySelector('[data-si-anim]')) { _injected = true; return; }
  const s = document.createElement('style');
  s.setAttribute('data-si-anim', '');
  s.textContent = '@keyframes siPulse{0%,100%{opacity:1}50%{opacity:0.3}}';
  document.head.appendChild(s);
  _injected = true;
}

function SkeletonRows() {
  ensureStyles();
  return (
    <>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} style={{ ...styles.skeleton, animation: 'siPulse 1.5s ease-in-out infinite', animationDelay: `${i * 0.08}s` }} />
      ))}
    </>
  );
}

function SkillRow({ skill, hovered, onHover }: { skill: Skill; hovered: boolean; onHover: (s: string) => void }) {
  return (
    <div
      style={{ ...styles.row, ...(hovered ? styles.rowHover : {}) }}
      onMouseEnter={() => onHover(skill.slug)}
      onMouseLeave={() => onHover('')}
    >
      <div style={styles.nameCol}>
        <div style={styles.skillName}>{skill.name || skill.slug}</div>
        <div style={styles.skillSlug}>/{skill.slug}</div>
      </div>
      <div style={styles.descCol}>
        <div style={styles.description}>
          {skill.description || 'No description available.'}
        </div>
      </div>
      <div style={styles.metaCol}>
        {skill.userInvocable && (
          <span style={styles.invocableBadge}>user-invocable</span>
        )}
        <span style={styles.dateText}>{formatDate(skill.modifiedAt)}</span>
      </div>
    </div>
  );
}

export function SkillInventory() {
  const { skills, loading, error, refetch } = useSkills();
  const [filter, setFilter] = useState('');
  const [invocableOnly, setInvocableOnly] = useState(false);
  const [hoveredSlug, setHoveredSlug] = useState('');
  const [inputFocused, setInputFocused] = useState(false);

  const filtered = useMemo(() => {
    let list = skills;
    if (invocableOnly) list = list.filter((s) => s.userInvocable);
    if (filter.trim()) {
      const q = filter.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.slug.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q)
      );
    }
    return list;
  }, [skills, filter, invocableOnly]);

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.headerTitle}>
            Skills{skills.length > 0 ? ` (${skills.length})` : ''}
          </span>
          <input
            type="search"
            placeholder="Filter skills…"
            value={filter}
            style={{
              ...styles.filterInput,
              ...(inputFocused ? { borderColor: '#333' } : {}),
            }}
            onChange={(e) => setFilter(e.target.value)}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            aria-label="Filter skills"
          />
        </div>
        <button
          style={styles.toggleBtn(invocableOnly)}
          onClick={() => setInvocableOnly((v) => !v)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setInvocableOnly((v) => !v); } }}
        >
          User-invocable only
        </button>
      </div>

      <div style={styles.list} role="list">
        {loading ? (
          <SkeletonRows />
        ) : error ? (
          <div style={styles.errorState}>
            <span>{error}</span>
            <button style={{ color: '#555', fontSize: '12px', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }} onClick={refetch}>Retry</button>
          </div>
        ) : filtered.length === 0 ? (
          <div style={styles.emptyState}>
            {skills.length === 0 ? (
              <>
                <span style={styles.emptyTitle}>No skills installed</span>
                <span style={styles.emptyBody}>Skills are markdown files in the project's skills/ directory.</span>
              </>
            ) : (
              <>
                <span style={styles.emptyTitle}>No matches</span>
                <span style={styles.emptyBody}>Try a different filter.</span>
              </>
            )}
          </div>
        ) : (
          filtered.map((skill) => (
            <SkillRow
              key={skill.slug}
              skill={skill}
              hovered={hoveredSlug === skill.slug}
              onHover={setHoveredSlug}
            />
          ))
        )}
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';

interface RecentProject {
  path: string;
  name: string;
  lastOpened: string;
}

const styles = {
  root: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    background: '#0a0a0a',
    color: '#e5e5e5',
    padding: '40px 24px',
  },
  wordmark: {
    fontSize: '32px',
    fontWeight: 700,
    letterSpacing: '0.12em',
    textTransform: 'uppercase' as const,
    marginBottom: '8px',
    background: 'linear-gradient(135deg, #f0f0f0 0%, rgba(167,139,250,0.9) 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
  },
  tagline: {
    fontSize: '13px',
    color: '#666',
    marginBottom: '48px',
    letterSpacing: '0.04em',
  },
  card: {
    width: '100%',
    maxWidth: '520px',
    background: '#141414',
    border: '1px solid #2a2a2a',
    borderRadius: '8px',
    padding: '24px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.02)',
  },
  sectionLabel: {
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: '#555',
    marginBottom: '12px',
  },
  emptyState: {
    color: '#555',
    fontSize: '13px',
    padding: '12px 0',
  },
  projectList: {
    listStyle: 'none',
    marginBottom: '20px',
  },
  projectItem: {
    display: 'flex',
    flexDirection: 'column' as const,
    padding: '10px 12px',
    borderRadius: '6px',
    cursor: 'pointer',
    border: '1px solid transparent',
    marginBottom: '4px',
    transition: 'background-color 120ms, border-color 120ms, transform 120ms, box-shadow 120ms',
  },
  projectItemHover: {
    background: '#1e1e1e',
    borderColor: '#333',
    transform: 'translateY(-1px)',
    boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
  },
  projectName: {
    fontSize: '14px',
    fontWeight: 500,
    color: '#e5e5e5',
    marginBottom: '2px',
  },
  projectPath: {
    fontSize: '11px',
    color: '#555',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  projectDate: {
    fontSize: '11px',
    color: '#444',
    marginTop: '2px',
  },
  divider: {
    height: '1px',
    background: '#222',
    margin: '20px 0',
  },
  openButton: {
    width: '100%',
    padding: '10px 16px',
    background: '#1a1a1a',
    border: '1px solid #333',
    borderRadius: '6px',
    color: '#e5e5e5',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'background-color 120ms, border-color 120ms, color 120ms',
    textAlign: 'center' as const,
  },
  error: {
    marginTop: '12px',
    padding: '10px 12px',
    background: '#1a0f0f',
    border: '1px solid #5a1f1f',
    borderRadius: '6px',
    color: '#e07070',
    fontSize: '13px',
    lineHeight: '1.5',
  },
} as const;

function formatDate(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

export function ProjectSelector() {
  const [recents, setRecents] = useState<RecentProject[]>([]);
  const [error, setError] = useState<string>('');
  const [hoveredPath, setHoveredPath] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void loadRecents();
  }, []);

  async function loadRecents() {
    const result = await window.citadel.getProjects();
    if (!Array.isArray(result)) return;
    setRecents(result as RecentProject[]);
  }

  async function openProject(projectPath: string) {
    setError('');
    setLoading(true);
    const result = await window.citadel.openProject(projectPath);
    setLoading(false);
    if (result && typeof result === 'object' && 'error' in result) {
      setError((result as { error: string }).error);
    }
  }

  async function handleOpenDialog() {
    setError('');
    const selected = await window.citadel.openDirectoryDialog();
    if (!selected || typeof selected !== 'string') return;
    await openProject(selected);
  }

  return (
    <div style={styles.root}>
      <div style={styles.wordmark}>Citadel</div>
      <div style={styles.tagline}>Agent orchestration for Claude Code</div>

      <div style={styles.card}>
        <div style={styles.sectionLabel}>Recent Projects</div>

        {recents.length === 0 ? (
          <p style={styles.emptyState}>Open a project to get started.</p>
        ) : (
          <ul style={styles.projectList}>
            {recents.map((project) => (
              <li
                key={project.path}
                style={{
                  ...styles.projectItem,
                  ...(hoveredPath === project.path
                    ? styles.projectItemHover
                    : {}),
                }}
                role="button"
                tabIndex={0}
                onMouseEnter={() => setHoveredPath(project.path)}
                onMouseLeave={() => setHoveredPath('')}
                onClick={() => void openProject(project.path)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    void openProject(project.path);
                  }
                }}
              >
                <span style={styles.projectName}>{project.name}</span>
                <span style={styles.projectPath}>{project.path}</span>
                <span style={styles.projectDate}>
                  Last opened: {formatDate(project.lastOpened)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div style={styles.divider} />

        <button
          style={styles.openButton}
          onClick={() => void handleOpenDialog()}
          disabled={loading}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = '#222';
            (e.currentTarget as HTMLButtonElement).style.borderColor = '#444';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = '#1a1a1a';
            (e.currentTarget as HTMLButtonElement).style.borderColor = '#333';
          }}
        >
          {loading ? 'Opening...' : 'Open Project\u2026'}
        </button>

        {error && <div style={styles.error}>{error}</div>}
      </div>
    </div>
  );
}

import { useState } from 'react';

interface ProGateProps {
  featureName: string;
}

function LockIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

const styles = {
  root: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    minHeight: '320px',
    background: '#0a0a0a',
  },
  card: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '12px',
    padding: '32px 40px',
    background: '#141414',
    border: '1px solid #2a2a2a',
    borderRadius: '6px',
    textAlign: 'center' as const,
    maxWidth: '320px',
    width: '100%',
  },
  icon: {
    color: '#a78bfa',
    marginBottom: '4px',
  },
  featureName: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#e5e5e5',
  },
  tagline: {
    fontSize: '13px',
    color: '#666',
    lineHeight: '1.5',
  },
  upgradeButton: {
    marginTop: '8px',
    padding: '8px 20px',
    background: '#a78bfa',
    border: '1px solid #a78bfa',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'background-color 150ms, border-color 150ms, opacity 150ms',
  },
  upgradeButtonHover: {
    background: '#9061f9',
    borderColor: '#9061f9',
  },
} as const;

export function ProGate({ featureName }: ProGateProps) {
  const [hovered, setHovered] = useState(false);

  function handleUpgrade() {
    void window.citadel.openExternal('https://citadel.dev/pro');
  }

  return (
    <div style={styles.root}>
      <div style={styles.card}>
        <div style={styles.icon}>
          <LockIcon />
        </div>
        <div style={styles.featureName}>{featureName}</div>
        <div style={styles.tagline}>Available with Citadel Pro</div>
        <button
          style={{
            ...styles.upgradeButton,
            ...(hovered ? styles.upgradeButtonHover : {}),
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onClick={handleUpgrade}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleUpgrade();
            }
          }}
        >
          Upgrade to Pro →
        </button>
      </div>
    </div>
  );
}

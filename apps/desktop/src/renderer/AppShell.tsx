import { useState } from 'react';
import { CommandCenter } from './screens/CommandCenter.js';
import { CampaignList } from './screens/CampaignList.js';
import { CampaignDetail } from './screens/CampaignDetail.js';
import { HealthPanel } from './screens/HealthPanel.js';
import { SkillInventory } from './screens/SkillInventory.js';
import { CampaignTimeline } from './screens/pro/CampaignTimeline.js';
import { TokenEconomics } from './screens/pro/TokenEconomics.js';
import { FleetAnalytics } from './screens/pro/FleetAnalytics.js';
import { PostmortemWaterfall } from './screens/pro/PostmortemWaterfall.js';
import { AggregateAnalytics } from './screens/pro/AggregateAnalytics.js';

export type AppView =
  | 'command-center'
  | 'campaigns'
  | 'health'
  | 'skills'
  | 'pro/timeline'
  | 'pro/token-economics'
  | 'pro/fleet-analytics'
  | 'pro/postmortem'
  | 'pro/aggregate-analytics';

interface Props {
  projectPath: string;
  onSwitchProject: () => void;
  onOpenSettings: () => void;
}

const FREE_NAV: { view: AppView; label: string }[] = [
  { view: 'command-center', label: 'Command Center' },
  { view: 'campaigns', label: 'Campaigns' },
  { view: 'health', label: 'Health' },
  { view: 'skills', label: 'Skills' },
];

const PRO_NAV: { view: AppView; label: string }[] = [
  { view: 'pro/timeline', label: 'Timeline' },
  { view: 'pro/token-economics', label: 'Token Economics' },
  { view: 'pro/fleet-analytics', label: 'Fleet Analytics' },
  { view: 'pro/postmortem', label: 'Postmortem' },
  { view: 'pro/aggregate-analytics', label: 'Aggregate' },
];

const styles = {
  shell: {
    display: 'flex',
    height: '100vh',
    background: '#0a0a0a',
    color: '#e5e5e5',
    overflow: 'hidden',
  },
  sidebar: {
    width: '180px',
    flexShrink: 0,
    background: '#0d0d0d',
    borderRight: '1px solid #1a1a1a',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    boxShadow: '2px 0 8px rgba(0,0,0,0.4)',
  },
  sidebarTop: {
    padding: '14px 12px 10px',
    borderBottom: '1px solid #1a1a1a',
  },
  wordmark: {
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.14em',
    textTransform: 'uppercase' as const,
    color: 'rgba(167,139,250,0.6)',
    marginBottom: '2px',
  },
  projectName: {
    fontSize: '13px',
    fontWeight: 500,
    color: '#ccc',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  navList: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '8px 0',
  },
  navSection: {
    padding: '8px 12px 4px',
    fontSize: '10px',
    fontWeight: 600,
    letterSpacing: '0.1em',
    textTransform: 'uppercase' as const,
    color: '#333',
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '5px 12px',
    fontSize: '13px',
    cursor: 'pointer',
    border: 'none',
    background: 'none',
    width: '100%',
    textAlign: 'left' as const,
    color: '#666',
    borderRadius: '0',
    transition: 'background-color 120ms, color 120ms, border-left-color 120ms',
  },
  navItemHover: {
    background: '#151515',
    color: '#ccc',
  },
  navItemActive: {
    background: '#1a1a1a',
    color: '#e5e5e5',
    borderLeft: '2px solid #a78bfa',
    paddingLeft: '10px',
  },
  proLabel: {
    fontSize: '9px',
    fontWeight: 600,
    letterSpacing: '0.08em',
    color: '#6d4fa8',
    background: 'rgba(167,139,250,0.08)',
    border: '1px solid rgba(167,139,250,0.15)',
    borderRadius: '3px',
    padding: '0 4px',
    lineHeight: '14px',
    marginLeft: 'auto',
    flexShrink: 0,
  },
  sidebarBottom: {
    borderTop: '1px solid #1a1a1a',
    padding: '8px 0',
  },
  bottomButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '5px 12px',
    fontSize: '12px',
    cursor: 'pointer',
    border: 'none',
    background: 'none',
    width: '100%',
    textAlign: 'left' as const,
    color: '#444',
    transition: 'color 150ms, background-color 150ms',
  },
  content: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column' as const,
  },
} as const;

function GearIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function AppShell({ projectPath, onSwitchProject, onOpenSettings }: Props) {
  const [activeView, setActiveView] = useState<AppView>('command-center');
  const [selectedCampaignSlug, setSelectedCampaignSlug] = useState<string | null>(null);
  const [hoveredView, setHoveredView] = useState<string>('');
  const [hoveredBottom, setHoveredBottom] = useState<string>('');

  const projectName =
    projectPath.split(/[\\/]/).filter(Boolean).at(-1) ?? projectPath;

  function navigate(view: AppView) {
    setActiveView(view);
    if (view !== 'campaigns') setSelectedCampaignSlug(null);
  }

  function handleCampaignSelect(slug: string) {
    setSelectedCampaignSlug(slug);
    setActiveView('campaigns');
  }

  function handleCampaignBack() {
    setSelectedCampaignSlug(null);
  }

  function renderContent() {
    switch (activeView) {
      case 'command-center':
        return (
          <CommandCenter
            projectPath={projectPath}
            onNavigate={navigate}
            onCampaignSelect={handleCampaignSelect}
          />
        );
      case 'campaigns':
        if (selectedCampaignSlug) {
          return (
            <CampaignDetail
              slug={selectedCampaignSlug}
              onBack={handleCampaignBack}
            />
          );
        }
        return (
          <CampaignList onCampaignSelect={handleCampaignSelect} />
        );
      case 'health':
        return <HealthPanel />;
      case 'skills':
        return <SkillInventory />;
      case 'pro/timeline':
        return <CampaignTimeline />;
      case 'pro/token-economics':
        return <TokenEconomics />;
      case 'pro/fleet-analytics':
        return <FleetAnalytics />;
      case 'pro/postmortem':
        return <PostmortemWaterfall />;
      case 'pro/aggregate-analytics':
        return <AggregateAnalytics />;
      default:
        return null;
    }
  }

  return (
    <div style={styles.shell}>
      {/* Sidebar */}
      <nav style={styles.sidebar} aria-label="Main navigation">
        <div style={styles.sidebarTop}>
          <div style={styles.wordmark}>Citadel</div>
          <div style={styles.projectName} title={projectPath}>
            {projectName}
          </div>
        </div>

        <div style={styles.navList} role="list">
          {FREE_NAV.map(({ view, label }) => (
            <button
              key={view}
              role="listitem"
              style={{
                ...styles.navItem,
                ...(activeView === view
                  ? styles.navItemActive
                  : hoveredView === view
                  ? styles.navItemHover
                  : {}),
              }}
              onMouseEnter={() => setHoveredView(view)}
              onMouseLeave={() => setHoveredView('')}
              onClick={() => navigate(view)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  navigate(view);
                }
              }}
              aria-current={activeView === view ? 'page' : undefined}
            >
              {label}
            </button>
          ))}

          <div style={styles.navSection}>Pro</div>

          {PRO_NAV.map(({ view, label }) => (
            <button
              key={view}
              role="listitem"
              style={{
                ...styles.navItem,
                ...(activeView === view
                  ? styles.navItemActive
                  : hoveredView === view
                  ? styles.navItemHover
                  : {}),
              }}
              onMouseEnter={() => setHoveredView(view)}
              onMouseLeave={() => setHoveredView('')}
              onClick={() => navigate(view)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  navigate(view);
                }
              }}
              aria-current={activeView === view ? 'page' : undefined}
            >
              {label}
              <span style={styles.proLabel}>PRO</span>
            </button>
          ))}
        </div>

        <div style={styles.sidebarBottom}>
          <button
            style={{
              ...styles.bottomButton,
              ...(hoveredBottom === 'settings'
                ? { color: '#888', background: '#151515' }
                : {}),
            }}
            onMouseEnter={() => setHoveredBottom('settings')}
            onMouseLeave={() => setHoveredBottom('')}
            onClick={onOpenSettings}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpenSettings();
              }
            }}
          >
            <GearIcon />
            Settings
          </button>
          <button
            style={{
              ...styles.bottomButton,
              ...(hoveredBottom === 'switch'
                ? { color: '#888', background: '#151515' }
                : {}),
            }}
            onMouseEnter={() => setHoveredBottom('switch')}
            onMouseLeave={() => setHoveredBottom('')}
            onClick={onSwitchProject}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSwitchProject();
              }
            }}
          >
            Switch Project
          </button>
        </div>
      </nav>

      {/* Content area */}
      <main style={styles.content}>{renderContent()}</main>
    </div>
  );
}

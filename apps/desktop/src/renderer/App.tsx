import { useState, useEffect } from 'react';
import { ProjectSelector } from './screens/ProjectSelector.js';
import { AppShell } from './AppShell.js';
import { SettingsPanel } from './chrome/SettingsPanel.js';

function GearIcon() {
  return (
    <svg
      width="14"
      height="14"
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

type AppScreen = 'project-selector' | 'app-shell';

export function App() {
  const [screen, setScreen] = useState<AppScreen>('project-selector');
  const [projectPath, setProjectPath] = useState<string>('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [gearHovered, setGearHovered] = useState(false);

  useEffect(() => {
    const cleanup = window.citadel.onProjectOpened((openedPath) => {
      setProjectPath(openedPath);
      setScreen('app-shell');
    });
    return cleanup;
  }, []);

  function handleSwitchProject() {
    setScreen('project-selector');
    setProjectPath('');
  }

  if (screen === 'app-shell') {
    return (
      <>
        <AppShell
          projectPath={projectPath}
          onSwitchProject={handleSwitchProject}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        {settingsOpen && (
          <SettingsPanel onClose={() => setSettingsOpen(false)} />
        )}
      </>
    );
  }

  return (
    <>
      {/* Gear icon visible on project selector screen */}
      <button
        aria-label="Open settings"
        style={{
          position: 'fixed',
          top: '10px',
          right: '12px',
          zIndex: 50,
          background: gearHovered ? '#1e1e1e' : 'none',
          border: 'none',
          color: gearHovered ? '#aaa' : '#444',
          cursor: 'pointer',
          padding: '6px',
          borderRadius: '4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'color 150ms, background-color 150ms',
        }}
        onMouseEnter={() => setGearHovered(true)}
        onMouseLeave={() => setGearHovered(false)}
        onClick={() => setSettingsOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setSettingsOpen(true);
          }
        }}
      >
        <GearIcon />
      </button>

      <ProjectSelector />

      {settingsOpen && (
        <SettingsPanel onClose={() => setSettingsOpen(false)} />
      )}
    </>
  );
}

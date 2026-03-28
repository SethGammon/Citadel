import { contextBridge, ipcRenderer } from 'electron';

// Explicit allowlist for IPC event channels. Only channels in this set can receive listeners.
export const ALLOWED_EVENT_CHANNELS = new Set([
  'citadel:event',
  'project:opened',
  'ws:port',
]);

contextBridge.exposeInMainWorld('citadel', {
  getProjects: () => ipcRenderer.invoke('projects:list'),

  openProject: (projectPath: string) =>
    ipcRenderer.invoke('projects:open', projectPath),

  openDirectoryDialog: () => ipcRenderer.invoke('dialog:openDir'),

  getCampaigns: () => ipcRenderer.invoke('campaigns:list'),

  getCampaignDetail: (slug: string) =>
    ipcRenderer.invoke('campaigns:detail', slug),

  getFleetSessions: () => ipcRenderer.invoke('fleet:list'),

  getHealth: () => ipcRenderer.invoke('health:get'),

  getSkills: () => ipcRenderer.invoke('skills:list'),

  getWsPort: () => ipcRenderer.invoke('ws:port'),

  onEvent: (callback: (event: object) => void) => {
    const listener = (_: Electron.IpcRendererEvent, event: object) =>
      callback(event);
    ipcRenderer.on('citadel:event', listener);
    return () => ipcRenderer.removeListener('citadel:event', listener);
  },

  onProjectOpened: (callback: (projectPath: string) => void) => {
    const listener = (_: Electron.IpcRendererEvent, projectPath: string) =>
      callback(projectPath);
    ipcRenderer.on('project:opened', listener);
    return () => ipcRenderer.removeListener('project:opened', listener);
  },

  onWsPort: (callback: (port: number) => void) => {
    const listener = (_: Electron.IpcRendererEvent, port: number) =>
      callback(port);
    ipcRenderer.on('ws:port', listener);
    return () => ipcRenderer.removeListener('ws:port', listener);
  },

  validateLicense: (key: string) => ipcRenderer.invoke('license:validate', key),
  getLicense: () => ipcRenderer.invoke('license:get'),
  isPro: () => ipcRenderer.invoke('license:isPro'),
  clearLicense: () => ipcRenderer.invoke('license:clear'),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),

  // Pro analytics (gated at IPC handler level)
  getCampaignTimeline: () => ipcRenderer.invoke('analytics:timeline'),
  getTokenEconomics: () => ipcRenderer.invoke('analytics:token-economics'),
  getFleetAnalytics: () => ipcRenderer.invoke('analytics:fleet'),
  getTelemetryEvents: (campaignSlug?: string) =>
    ipcRenderer.invoke('analytics:telemetry', campaignSlug),
  getAggregateAnalytics: () => ipcRenderer.invoke('analytics:aggregate'),
});

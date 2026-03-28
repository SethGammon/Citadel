// Type declarations for the contextBridge-exposed citadel API

interface Window {
  citadel: {
    getProjects: () => Promise<unknown>;
    openProject: (path: string) => Promise<unknown>;
    openDirectoryDialog: () => Promise<string | null>;
    getCampaigns: () => Promise<unknown>;
    getCampaignDetail: (slug: string) => Promise<unknown>;
    getFleetSessions: () => Promise<unknown>;
    getHealth: () => Promise<unknown>;
    getSkills: () => Promise<unknown>;
    getWsPort: () => Promise<unknown>;
    onEvent: (callback: (event: object) => void) => () => void;
    onProjectOpened: (callback: (projectPath: string) => void) => () => void;
    onWsPort: (callback: (port: number) => void) => () => void;
    validateLicense: (key: string) => Promise<unknown>;
    getLicense: () => Promise<unknown>;
    isPro: () => Promise<boolean>;
    clearLicense: () => Promise<unknown>;
    openExternal: (url: string) => Promise<unknown>;
    // Pro analytics
    getCampaignTimeline: () => Promise<unknown>;
    getTokenEconomics: () => Promise<unknown>;
    getFleetAnalytics: () => Promise<unknown>;
    getTelemetryEvents: (campaignSlug?: string) => Promise<unknown>;
    getAggregateAnalytics: () => Promise<unknown>;
  };
}

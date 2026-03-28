// Shared type definitions used by both main process and renderer.
// Keep this file free of Node.js-specific imports so it can be bundled
// for the renderer without issues.

export interface RecentProject {
  path: string;
  name: string;
  lastOpened: string;
}

export interface Campaign {
  slug: string;
  id: string;
  version: string;
  status: string;
  started: string;
  completedAt: string;
  direction: string;
  phaseCount: number;
  currentPhase: number;
  filePath: string;
  modifiedAt: string;
  branch: string | null;
  worktreeStatus: string | null;
}

export interface CampaignDetail extends Campaign {
  sections: {
    phases: string;
    claimedScope: string;
    activeContext: string;
    continuationState: string;
    decisionLog: string;
    reviewQueue: string;
  };
}

export interface FleetSession {
  slug: string;
  id: string;
  status: string;
  started: string;
  completedAt: string;
  filePath: string;
  modifiedAt: string;
}

export interface HealthStatus {
  timestamp: string;
  campaigns?: unknown;
  fleet?: unknown;
  hooks?: unknown;
  telemetry?: unknown;
  coordination?: unknown;
  token_economics?: unknown;
  error?: string;
  [key: string]: unknown;
}

export interface Skill {
  slug: string;
  name: string;
  description: string;
  userInvocable: boolean;
  filePath: string;
  modifiedAt: string;
}

export type LicenseTier = 'free' | 'pro';

export interface LicenseInfo {
  email: string;
  tier: LicenseTier;
  issuedAt: number;
  expiresAt: number;
  tokenId: string;
  daysUntilExpiry: number;
  isExpired: boolean;
  renewalWarning: boolean;
}

export type LicenseResult =
  | { valid: true; info: LicenseInfo }
  | { valid: false; reason: 'INVALID_SIGNATURE' | 'EXPIRED' | 'MALFORMED' | 'WRONG_TIER' | 'NO_KEY' };

// ---------------------------------------------------------------------------
// Pro analytics types
// ---------------------------------------------------------------------------

export interface CampaignSpan {
  slug: string;
  direction: string;
  status: string;
  started: string;
  completedAt: string;
  phaseCount: number;
  currentPhase: number;
  durationDays: number | null;
}

export interface TelemetryEvent {
  event: string;
  agent?: string;
  session?: string;
  campaign_slug?: string;
  timestamp?: string;
  status?: string;
  [key: string]: unknown;
}

export interface FleetAnalyticsData {
  totalSessions: number;
  completedCount: number;
  activeCount: number;
  failedCount: number;
  successRate: number | null;
  recentSessions: FleetSession[];
}

export interface AggregateAnalyticsData {
  totalCampaigns: number;
  completedCount: number;
  activeCount: number;
  failedCount: number;
  parkedCount: number;
  avgPhaseCompletion: number | null;
  statusBreakdown: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Result type for IPC operations
// ---------------------------------------------------------------------------

export type ResultCode =
  | 'VALIDATION_ERROR'
  | 'PERMISSION_DENIED'
  | 'RESOURCE_NOT_FOUND'
  | 'INTERNAL_ERROR'
  | 'IO_ERROR'
  | 'CANCELLED';

export type IpcSuccess<T> = { ok: true; value: T };
export type IpcFailure = { ok: false; code: ResultCode; message: string; details?: unknown };
export type IpcResult<T> = IpcSuccess<T> | IpcFailure;

export function ipcOk<T>(value: T): IpcSuccess<T> { return { ok: true, value }; }
export function ipcFail(code: ResultCode, message: string, details?: unknown): IpcFailure {
  return { ok: false, code, message, details };
}

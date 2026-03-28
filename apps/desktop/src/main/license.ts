import { jwtVerify, importSPKI } from 'jose';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Public key — bundled in binary, never fetched at runtime.
// Replace PLACEHOLDER_PUBLIC_KEY with the real RSA public key before launch.
// Key rotation = shipping a new binary via auto-updater.
// ---------------------------------------------------------------------------

const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC CERTIFICATE-----
PLACEHOLDER_PUBLIC_KEY
-----END PUBLIC CERTIFICATE-----`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LicenseTier = 'free' | 'pro';

export interface LicenseInfo {
  email: string;
  tier: LicenseTier;
  issuedAt: number;       // Unix timestamp
  expiresAt: number;      // Unix timestamp
  tokenId: string;        // jti — unique per key
  daysUntilExpiry: number;
  isExpired: boolean;
  renewalWarning: boolean; // true if < 7 days until expiry
}

export type LicenseResult =
  | { valid: true; info: LicenseInfo }
  | { valid: false; reason: 'INVALID_SIGNATURE' | 'EXPIRED' | 'MALFORMED' | 'WRONG_TIER' | 'NO_KEY' };

// ---------------------------------------------------------------------------
// In-memory license store (main process only)
// ---------------------------------------------------------------------------

let _currentLicense: LicenseInfo | null = null;

// ---------------------------------------------------------------------------
// Core validation
// ---------------------------------------------------------------------------

export async function validateLicense(key: string): Promise<LicenseResult> {
  if (!key || typeof key !== 'string' || key.trim().length === 0) {
    return { valid: false, reason: 'NO_KEY' };
  }

  const trimmed = key.trim();

  // If using placeholder key, allow a specific test JWT for development
  if (PUBLIC_KEY_PEM.includes('PLACEHOLDER_PUBLIC_KEY')) {
    return validateDevelopmentKey(trimmed);
  }

  try {
    const publicKey = await importSPKI(PUBLIC_KEY_PEM, 'RS256');
    const { payload } = await jwtVerify(trimmed, publicKey, {
      algorithms: ['RS256'],
    });

    const now = Math.floor(Date.now() / 1000);
    const exp = payload.exp ?? 0;
    const iat = payload.iat ?? 0;
    const sub = typeof payload.sub === 'string' ? payload.sub : '';
    const tier = typeof payload['tier'] === 'string' ? payload['tier'] : '';
    const jti = typeof payload.jti === 'string' ? payload.jti : '';

    if (tier !== 'pro') {
      return { valid: false, reason: 'WRONG_TIER' };
    }

    const isExpired = now > exp;
    if (isExpired) {
      return { valid: false, reason: 'EXPIRED' };
    }

    const daysUntilExpiry = Math.floor((exp - now) / 86400);

    const info: LicenseInfo = {
      email: sub,
      tier: 'pro',
      issuedAt: iat,
      expiresAt: exp,
      tokenId: jti,
      daysUntilExpiry,
      isExpired: false,
      renewalWarning: daysUntilExpiry <= 7,
    };

    _currentLicense = info;

    return { valid: true, info };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('expired')) return { valid: false, reason: 'EXPIRED' };
    if (message.includes('signature')) return { valid: false, reason: 'INVALID_SIGNATURE' };
    return { valid: false, reason: 'MALFORMED' };
  }
}

// ---------------------------------------------------------------------------
// Development mode — accepts a special test key when public key is placeholder
// ---------------------------------------------------------------------------

function validateDevelopmentKey(key: string): LicenseResult {
  // Test key for local development: "citadel-pro-dev-test"
  // This path is unreachable in production (public key will be real)
  if (key === 'citadel-pro-dev-test') {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + 30 * 86400; // 30 days from now
    const info: LicenseInfo = {
      email: 'dev@citadel.local',
      tier: 'pro',
      issuedAt: now,
      expiresAt: exp,
      tokenId: 'dev-test-token',
      daysUntilExpiry: 30,
      isExpired: false,
      renewalWarning: false,
    };
    _currentLicense = info;
    return { valid: true, info };
  }
  return { valid: false, reason: 'INVALID_SIGNATURE' };
}

// ---------------------------------------------------------------------------
// Runtime accessors (called from IPC handlers)
// ---------------------------------------------------------------------------

export function isPro(): boolean {
  if (_currentLicense === null) return false;
  if (_currentLicense.isExpired) return false;
  const now = Math.floor(Date.now() / 1000);
  if (now > _currentLicense.expiresAt) {
    // Expired since last check
    _currentLicense = { ..._currentLicense, isExpired: true };
    return false;
  }
  return _currentLicense.tier === 'pro';
}

export function getLicenseInfo(): LicenseInfo | null {
  return _currentLicense;
}

export function clearLicense(): void {
  _currentLicense = null;
}

// ---------------------------------------------------------------------------
// Persistence — store validated key in userData so it survives restarts
// ---------------------------------------------------------------------------

export function saveLicenseKey(userDataPath: string, key: string): void {
  const licenseFile = path.join(userDataPath, 'citadel-license.json');
  try {
    fs.writeFileSync(licenseFile, JSON.stringify({ key }), 'utf-8');
  } catch {
    // Non-fatal — license will need re-entry on next launch
  }
}

export function loadSavedLicense(userDataPath: string): string | null {
  const licenseFile = path.join(userDataPath, 'citadel-license.json');
  try {
    const raw = fs.readFileSync(licenseFile, 'utf-8');
    const parsed = JSON.parse(raw) as { key?: unknown };
    return typeof parsed.key === 'string' ? parsed.key : null;
  } catch {
    return null;
  }
}

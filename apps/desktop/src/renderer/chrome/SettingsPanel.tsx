import { useState, useEffect, useRef } from 'react';
import type { LicenseInfo, LicenseResult } from '../../shared/types.js';

interface SettingsPanelProps {
  onClose: () => void;
}

const ERROR_LABELS: Record<string, string> = {
  INVALID_SIGNATURE: 'Invalid license key — signature verification failed.',
  EXPIRED: 'This license key has expired. Renew at citadel.dev.',
  MALFORMED: 'License key format not recognized.',
  WRONG_TIER: 'This key does not include Pro access.',
  NO_KEY: 'Please enter a license key.',
};

function formatExpiry(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function isLicenseInfo(val: unknown): val is LicenseInfo {
  return (
    val !== null &&
    typeof val === 'object' &&
    'email' in (val as object) &&
    'tier' in (val as object)
  );
}

function isLicenseResult(val: unknown): val is LicenseResult {
  return (
    val !== null &&
    typeof val === 'object' &&
    'valid' in (val as object)
  );
}

const styles = {
  backdrop: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    zIndex: 99,
  },
  panel: {
    position: 'fixed' as const,
    top: 0,
    right: 0,
    bottom: 0,
    width: '320px',
    background: '#141414',
    borderLeft: '1px solid #2a2a2a',
    zIndex: 100,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    boxShadow: '-4px 0 24px rgba(0,0,0,0.6)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: '1px solid #1e1e1e',
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#e5e5e5',
    letterSpacing: '0.02em',
  },
  closeButton: {
    background: 'none',
    border: 'none',
    color: '#666',
    cursor: 'pointer',
    padding: '4px',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'color 120ms, background-color 120ms',
    lineHeight: 1,
    fontSize: '16px',
  },
  body: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '16px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px',
  },
  sectionLabel: {
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: '#555',
    marginBottom: '8px',
  },
  tierBadgePro: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 8px',
    borderRadius: '4px',
    background: 'rgba(167,139,250,0.12)',
    border: '1px solid rgba(167,139,250,0.3)',
    color: '#a78bfa',
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
  },
  tierBadgeFree: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 8px',
    borderRadius: '4px',
    background: 'rgba(85,85,85,0.15)',
    border: '1px solid #333',
    color: '#777',
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
  },
  infoCard: {
    background: '#1a1a1a',
    border: '1px solid #2a2a2a',
    borderRadius: '6px',
    padding: '12px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
  },
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '8px',
  },
  infoLabel: {
    fontSize: '11px',
    color: '#555',
    flexShrink: 0,
  },
  infoValue: {
    fontSize: '13px',
    color: '#ccc',
    textAlign: 'right' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    minWidth: 0,
  },
  renewalBanner: {
    padding: '10px 12px',
    background: 'rgba(245,158,11,0.08)',
    border: '1px solid rgba(245,158,11,0.25)',
    borderRadius: '6px',
    fontSize: '12px',
    color: '#f59e0b',
    lineHeight: '1.5',
  },
  input: {
    width: '100%',
    padding: '8px 12px',
    background: '#0a0a0a',
    border: '1px solid #2a2a2a',
    borderRadius: '6px',
    color: '#e5e5e5',
    fontSize: '13px',
    fontFamily: 'ui-monospace, "SF Mono", "Fira Code", monospace',
    boxSizing: 'border-box' as const,
    outline: 'none',
    transition: 'border-color 120ms',
  },
  inputFocus: {
    borderColor: '#444',
  },
  helperText: {
    fontSize: '11px',
    color: '#555',
    lineHeight: '1.5',
  },
  validateButton: {
    width: '100%',
    padding: '8px 16px',
    background: '#1e1e1e',
    border: '1px solid #333',
    borderRadius: '6px',
    color: '#e5e5e5',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'background-color 120ms, border-color 120ms',
  },
  validateButtonHover: {
    background: '#2a2a2a',
    borderColor: '#444',
  },
  validateButtonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  errorBox: {
    padding: '10px 12px',
    background: 'rgba(239,68,68,0.08)',
    border: '1px solid rgba(239,68,68,0.25)',
    borderRadius: '6px',
    color: '#f87171',
    fontSize: '12px',
    lineHeight: '1.5',
  },
  clearButton: {
    background: 'none',
    border: 'none',
    color: '#555',
    fontSize: '12px',
    cursor: 'pointer',
    padding: '4px 0',
    textDecoration: 'underline',
    textDecorationColor: '#333',
    transition: 'color 120ms',
  },
  loadingRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: '#555',
    fontSize: '13px',
  },
} as const;

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [loading, setLoading] = useState(true);
  const [licenseInfo, setLicenseInfo] = useState<LicenseInfo | null>(null);
  const [input, setInput] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [clearHovered, setClearHovered] = useState(false);
  const [validateHovered, setValidateHovered] = useState(false);
  const [closeHovered, setCloseHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch current license on mount
  useEffect(() => {
    void (async () => {
      const result = await window.citadel.getLicense();
      if (isLicenseInfo(result)) {
        setLicenseInfo(result);
      }
      setLoading(false);
    })();
  }, []);

  // Escape key closes panel
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Focus input when no license
  useEffect(() => {
    if (!loading && !licenseInfo) {
      inputRef.current?.focus();
    }
  }, [loading, licenseInfo]);

  async function handleValidate() {
    if (!input.trim() || validating) return;
    setValidating(true);
    setValidationError(null);

    const raw = await window.citadel.validateLicense(input.trim());
    setValidating(false);

    if (!isLicenseResult(raw)) {
      setValidationError('Unexpected response from license validation.');
      return;
    }

    if (raw.valid) {
      setLicenseInfo(raw.info);
      setInput('');
    } else {
      setValidationError(ERROR_LABELS[raw.reason] ?? 'License validation failed.');
    }
  }

  async function handleClear() {
    await window.citadel.clearLicense();
    setLicenseInfo(null);
    setValidationError(null);
    setInput('');
  }

  return (
    <>
      {/* Backdrop */}
      <div
        style={styles.backdrop}
        role="button"
        tabIndex={-1}
        aria-label="Close settings"
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-label="Settings"
        aria-modal="true"
        style={styles.panel}
      >
        {/* Header */}
        <div style={styles.header}>
          <span style={styles.headerTitle}>Settings</span>
          <button
            style={{
              ...styles.closeButton,
              ...(closeHovered ? { color: '#aaa', background: '#1e1e1e' } : {}),
            }}
            aria-label="Close settings"
            onMouseEnter={() => setCloseHovered(true)}
            onMouseLeave={() => setCloseHovered(false)}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={styles.body}>
          {/* License section */}
          <div>
            <div style={styles.sectionLabel}>License</div>

            {loading ? (
              <div style={styles.loadingRow}>
                <span>Loading…</span>
              </div>
            ) : licenseInfo ? (
              <>
                {/* Renewal warning */}
                {licenseInfo.renewalWarning && !licenseInfo.isExpired && (
                  <div style={{ ...styles.renewalBanner, marginBottom: '12px' }}>
                    Your license expires in {licenseInfo.daysUntilExpiry} day
                    {licenseInfo.daysUntilExpiry !== 1 ? 's' : ''}. Renew to
                    keep Pro access.{' '}
                    <button
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#f59e0b',
                        cursor: 'pointer',
                        padding: 0,
                        fontSize: '12px',
                        textDecoration: 'underline',
                      }}
                      onClick={() => void window.citadel.openExternal('https://citadel.dev/renew')}
                    >
                      Renew now
                    </button>
                  </div>
                )}

                {/* License info card */}
                <div style={styles.infoCard}>
                  <div style={styles.infoRow}>
                    <span style={styles.infoLabel}>Plan</span>
                    <span
                      style={
                        licenseInfo.tier === 'pro'
                          ? styles.tierBadgePro
                          : styles.tierBadgeFree
                      }
                    >
                      {licenseInfo.tier === 'pro' ? 'Pro' : 'Free'}
                    </span>
                  </div>
                  <div style={styles.infoRow}>
                    <span style={styles.infoLabel}>Account</span>
                    <span style={styles.infoValue}>{licenseInfo.email}</span>
                  </div>
                  <div style={styles.infoRow}>
                    <span style={styles.infoLabel}>Expires</span>
                    <span
                      style={{
                        ...styles.infoValue,
                        color: licenseInfo.isExpired
                          ? '#ef4444'
                          : licenseInfo.renewalWarning
                          ? '#f59e0b'
                          : '#ccc',
                      }}
                    >
                      {licenseInfo.isExpired
                        ? 'Expired'
                        : formatExpiry(licenseInfo.expiresAt)}
                    </span>
                  </div>
                </div>

                {/* Clear */}
                <div style={{ marginTop: '10px' }}>
                  <button
                    style={{
                      ...styles.clearButton,
                      ...(clearHovered ? { color: '#888' } : {}),
                    }}
                    onMouseEnter={() => setClearHovered(true)}
                    onMouseLeave={() => setClearHovered(false)}
                    onClick={() => void handleClear()}
                  >
                    Remove license key
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* Input */}
                <input
                  ref={inputRef}
                  type="password"
                  placeholder="Paste your license key…"
                  value={input}
                  style={{
                    ...styles.input,
                    ...(inputFocused ? styles.inputFocus : {}),
                    marginBottom: '8px',
                  }}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setInputFocused(false)}
                  onChange={(e) => {
                    setInput(e.target.value);
                    setValidationError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleValidate();
                    }
                  }}
                  disabled={validating}
                />

                {validationError && (
                  <div style={{ ...styles.errorBox, marginBottom: '8px' }}>
                    {validationError}
                  </div>
                )}

                <button
                  style={{
                    ...styles.validateButton,
                    ...(validateHovered && !validating && input.trim()
                      ? styles.validateButtonHover
                      : {}),
                    ...(validating || !input.trim()
                      ? styles.validateButtonDisabled
                      : {}),
                  }}
                  disabled={validating || !input.trim()}
                  onMouseEnter={() => setValidateHovered(true)}
                  onMouseLeave={() => setValidateHovered(false)}
                  onClick={() => void handleValidate()}
                >
                  {validating ? 'Validating…' : 'Activate License'}
                </button>

                <p style={{ ...styles.helperText, marginTop: '10px' }}>
                  Get a license key at{' '}
                  <button
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#a78bfa',
                      cursor: 'pointer',
                      padding: 0,
                      fontSize: '11px',
                      textDecoration: 'underline',
                    }}
                    onClick={() => void window.citadel.openExternal('https://citadel.dev/pro')}
                  >
                    citadel.dev/pro
                  </button>
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

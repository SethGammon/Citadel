#!/usr/bin/env node

/**
 * notification.js — Notification hook
 *
 * Fires for system-level events: permission prompts, idle alerts, auth
 * events (auth_required, auth_success, auth_failure), and elicitation dialogs.
 *
 * Key behaviors:
 *   - Auth events → elevated audit entry (these are security-relevant)
 *   - Idle alerts → log for diagnostics (agents going idle in long campaigns)
 *   - All notifications → telemetry for session health monitoring
 *
 * Design:
 *   - Observer only: always exit 0
 *   - Auth failures especially → audit log at medium severity
 *
 * Exit codes:
 *   0 = always
 */

'use strict';

const health = require('./harness-health-util');

// Notification types that warrant elevated audit entries
const AUDIT_TYPES = new Set(['auth_required', 'auth_failure', 'auth_error']);
const AUTH_TYPES = new Set(['auth_required', 'auth_success', 'auth_failure', 'auth_error']);

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    let event = {};
    try { event = JSON.parse(input); } catch { /* partial input ok */ }

    const notificationType = event.notification_type || event.type || 'unknown';
    const message = event.message || event.notification_message || null;
    const sessionId = event.session_id || null;

    health.increment('notification', 'count');

    health.logTiming('notification', 0, {
      event: 'notification',
      notification_type: notificationType,
      session_id: sessionId,
    });

    // Auth events → elevated audit (security-relevant, always log)
    if (AUTH_TYPES.has(notificationType)) {
      const severity = AUDIT_TYPES.has(notificationType) ? 'medium' : 'low';
      health.writeAuditLog('auth-notification', {
        notification_type: notificationType,
        message: message ? message.slice(0, 200) : null,
        severity,
      });
    }

    // Idle alerts → diagnostic log entry
    if (notificationType === 'idle' || notificationType === 'agent_idle') {
      health.writeAuditLog('idle-notification', {
        notification_type: notificationType,
        severity: 'low',
      });
    }

    process.exit(0);
  });
}

main();

#!/usr/bin/env node

/**
 * task-events.js — TaskCreated and TaskCompleted hooks
 *
 * Fires when Claude creates or completes a task (TaskCreate/TaskUpdate tools).
 * Logs task boundary events to telemetry so campaign timelines can be reconstructed.
 *
 * This is the sensor layer for observability — every task that starts and
 * finishes gets recorded, giving us phase duration, completion rates, and
 * a full activity timeline.
 */

const health = require('./harness-health-util');

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    let event = {};
    try { event = JSON.parse(input); } catch { /* partial input ok */ }

    // Determine which task event this is from the hook name or event type
    // Claude Code passes the hook event name in the input
    const hookEvent = event.hook_event_name || event.type || 'TaskEvent';
    const isCreated = hookEvent.toLowerCase().includes('created');
    // Underscore form: the hyphen form contains an sk- substring that
    // trips naive secret scanners.
    const eventType = isCreated ? 'task_created' : 'task_completed';

    const taskId = event.task_id || event.id || null;
    const taskTitle = event.title || event.task_title || null;
    const status = event.status || null;

    health.increment('task-events', eventType);

    // Write structured telemetry — used by dashboard to reconstruct timelines
    health.logTiming('task-events', 0, {
      event: eventType,
      task_id: taskId,
      title: taskTitle,
      status,
    });

    // Task completions that fail also go to audit
    if (!isCreated && status && status !== 'completed' && status !== 'done') {
      health.writeAuditLog('task-failed', {
        task_id: taskId,
        title: taskTitle,
        status,
      });
    }

    process.exit(0);
  });
}

main();

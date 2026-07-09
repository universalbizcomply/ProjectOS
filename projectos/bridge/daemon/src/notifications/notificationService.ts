/**
 * Notification service — pure. Maps events into internal notification objects (prompt ready,
 * review required, approval required, validation failed, worker offline, daemon restarted,
 * dashboard synced). No desktop/OS notifications are emitted — this is the internal contract
 * a future notifier would consume. Messages are redacted.
 */
import type { BridgeEvent, Notification, NotificationKind } from '../types.js';
import { redact } from '../utils/redact.js';

function notif(kind: NotificationKind, event: BridgeEvent, message: string): Notification {
  return { kind, project: event.project, phase: event.phase, at: event.at, message: redact(message) };
}

/** Derive zero or more notifications from a single event. */
export function notificationsForEvent(event: BridgeEvent): readonly Notification[] {
  switch (event.type) {
    case 'PROMPT_READY':
      return [notif('prompt-ready', event, `Prompt ready for ${event.phase}`)];
    case 'REPORT_CREATED':
      return [notif('report-ready', event, `Report ready for ${event.phase}`)];
    case 'REVIEW_READY':
      return [notif('review-required', event, `Review required for ${event.phase}`)];
    case 'EVIDENCE_CREATED':
      return event.decisionRequired
        ? [notif('approval-required', event, `Approval required for ${event.phase}`)]
        : [];
    case 'VALIDATION_COMPLETED':
      return event.payload?.['result'] === 'fail'
        ? [notif('validation-failed', event, `Validation failed for ${event.phase}`)]
        : [];
    case 'WORKER_OFFLINE':
      return [notif('worker-offline', event, `Worker ${event.worker ?? '?'} went offline`)];
    case 'DAEMON_STARTED':
      return event.payload?.['restart'] === true
        ? [notif('daemon-restarted', event, 'Daemon restarted; state recovered')]
        : [];
    case 'SYNC_COMPLETED':
      return [notif('dashboard-synced', event, 'Dashboard synchronised')];
    default:
      return [];
  }
}

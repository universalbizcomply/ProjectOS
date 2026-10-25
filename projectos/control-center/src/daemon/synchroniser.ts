/**
 * StatusSynchroniser — folds daemon snapshots/events into the store. It redacts every
 * free-text field (defence in depth) and writes only changed slices. The daemon stays the
 * source of truth: this never invents data, it mirrors.
 */
import { redact } from './redact.js';
import type { EventStream } from './eventStream.js';
import type { LiveStore } from './store.js';
import type {
  DaemonSnapshot,
  LiveEvent,
  LiveNotification,
  LivePhase,
  LiveProjectSummary,
  LiveWorker,
} from './types.js';

function scrubWorker(w: LiveWorker): LiveWorker {
  return {
    ...w,
    worker: redact(w.worker),
    ...(w.currentAction !== undefined ? { currentAction: redact(w.currentAction) } : {}),
  };
}

function scrubPhase(p: LivePhase): LivePhase {
  return {
    ...p,
    worker: redact(p.worker),
    blockers: p.blockers.map(redact),
    ...(p.branch !== undefined ? { branch: redact(p.branch) } : {}),
  };
}

function scrubProject(p: LiveProjectSummary): LiveProjectSummary {
  return {
    ...p,
    worker: redact(p.worker),
    ...(p.branch !== undefined ? { branch: redact(p.branch) } : {}),
  };
}

function scrubNotification(n: LiveNotification): LiveNotification {
  return { ...n, message: redact(n.message) };
}

function scrubEvent(e: LiveEvent): LiveEvent {
  return {
    ...e,
    ...(e.worker !== undefined ? { worker: redact(e.worker) } : {}),
  };
}

export class StatusSynchroniser {
  /** Replace the live slices from a full snapshot. */
  applySnapshot(store: LiveStore, snapshot: DaemonSnapshot): void {
    store.update({
      health: { ...snapshot.health },
      workers: snapshot.workers.map(scrubWorker),
      phases: snapshot.phases.map(scrubPhase),
      projects: snapshot.projects.map(scrubProject),
      notifications: snapshot.notifications.map(scrubNotification),
    });
  }

  /** Append one event to the viewer stream (unless paused) and commit the snapshot. */
  applyEvent(store: LiveStore, stream: EventStream, event: LiveEvent, paused: boolean): void {
    const scrubbed = scrubEvent(event);
    const next = stream.push(scrubbed);
    if (!paused) store.update({ events: next });
  }

  /** Prepend a single notification (used when a transport pushes them out-of-band). */
  applyNotification(store: LiveStore, notification: LiveNotification): void {
    const scrubbed = scrubNotification(notification);
    store.update({ notifications: [scrubbed, ...store.getState().notifications] });
  }
}

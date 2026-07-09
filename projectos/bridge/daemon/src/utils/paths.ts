/**
 * Bridge path builders — pure. Take a project root and produce the bridge folder/file paths.
 * No hardcoded project paths anywhere; roots always arrive from config/discovery.
 */
import {
  BRIDGE_DIR,
  BRIDGE_SUBDIRS,
  EVENT_LOG_FILE,
  GIT_DIR,
  PHASES_DIR,
  PROJECTOPS_DIR,
  STATE_FILE,
  WORKERS_DIR,
} from '../constants.js';

/** Join path segments with forward slashes (stable + comparable across OSes). */
export function joinPath(...segments: string[]): string {
  return segments
    .filter((s) => s.length > 0)
    .join('/')
    .replace(/\/+/g, '/');
}

export function projectopsDir(root: string): string {
  return joinPath(root, PROJECTOPS_DIR);
}

export function bridgeDir(root: string): string {
  return joinPath(root, PROJECTOPS_DIR, BRIDGE_DIR);
}

export function promptsDir(root: string): string {
  return joinPath(bridgeDir(root), BRIDGE_SUBDIRS.prompts);
}

export function reportsDir(root: string): string {
  return joinPath(bridgeDir(root), BRIDGE_SUBDIRS.reports);
}

export function evidenceDir(root: string): string {
  return joinPath(bridgeDir(root), BRIDGE_SUBDIRS.evidence);
}

export function eventsDir(root: string): string {
  return joinPath(bridgeDir(root), BRIDGE_SUBDIRS.events);
}

export function stateDir(root: string): string {
  return joinPath(bridgeDir(root), BRIDGE_SUBDIRS.state);
}

export function approvalsDir(root: string): string {
  return joinPath(bridgeDir(root), BRIDGE_SUBDIRS.approvals);
}

export function workersDir(root: string): string {
  return joinPath(projectopsDir(root), WORKERS_DIR);
}

export function phasesDir(root: string): string {
  return joinPath(projectopsDir(root), PHASES_DIR);
}

export function gitDir(root: string): string {
  return joinPath(root, GIT_DIR);
}

export function eventLogPath(root: string): string {
  return joinPath(eventsDir(root), EVENT_LOG_FILE);
}

export function statePath(root: string): string {
  return joinPath(stateDir(root), STATE_FILE);
}

/** The set of directories the daemon watches for one project. */
export function watchTargets(root: string): readonly string[] {
  return [
    promptsDir(root),
    reportsDir(root),
    evidenceDir(root),
    eventsDir(root),
    stateDir(root),
    approvalsDir(root),
    workersDir(root),
    phasesDir(root),
    gitDir(root),
  ];
}

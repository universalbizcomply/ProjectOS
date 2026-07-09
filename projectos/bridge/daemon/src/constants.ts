/**
 * ProjectOS Bridge Daemon — constants and defaults.
 *
 * All magic strings/numbers live here (coding-style: no magic numbers scattered).
 */
import type { DaemonConfig, PhaseStage } from './types.js';

/** Daemon version — bump on breaking changes to the runtime contract. */
export const DAEMON_VERSION = '0.1.0';

/** Bridge folder layout under each project's `.projectops/`. */
export const PROJECTOPS_DIR = '.projectops';
export const BRIDGE_DIR = 'bridge';

export const BRIDGE_SUBDIRS = {
  prompts: 'prompts',
  inbox: 'inbox',
  reports: 'reports',
  evidence: 'evidence',
  events: 'events',
  state: 'state',
  approvals: 'approvals',
} as const;

export const WORKERS_DIR = 'workers';
export const PHASES_DIR = 'phases';
export const GIT_DIR = '.git';

/** File names the daemon reads/writes (state + dashboard cache only — never business code). */
export const EVENT_LOG_FILE = 'event-log.jsonl';
export const STATE_FILE = 'state.json';
export const DASHBOARD_CACHE_FILE = 'dashboard-cache.json';
export const CONFIG_FILE = 'bridge.config.json';

/** Sentinel seq for daemon-internal events that never touch a persisted log. */
export const INTERNAL_SEQ = -1;

export const DEFAULT_CONFIG: DaemonConfig = {
  watchRoots: [],
  watchIntervalMs: 1000,
  debounceMs: 250,
  ignoredFolders: ['node_modules', 'dist', '.git', 'coverage', '.vercel'],
  dashboardSync: true,
  logLevel: 'INFO',
  plugins: [],
};

/** Config bounds — reject nonsense values, clamp to sane ranges. */
export const CONFIG_BOUNDS = {
  minIntervalMs: 100,
  maxIntervalMs: 60_000,
  minDebounceMs: 0,
  maxDebounceMs: 10_000,
} as const;

/**
 * The linear phase lifecycle, in order. The state machine only ever advances along this
 * spine or takes a defined branch (block / reject / resume) — it NEVER invents a transition.
 */
export const STAGE_ORDER: readonly PhaseStage[] = [
  'created',
  'ready',
  'implementing',
  'validating',
  'evidence',
  'awaiting_review',
  'approved',
  'ready_to_commit',
  'committed',
  'ready_to_push',
  'pushed',
  'closed',
];

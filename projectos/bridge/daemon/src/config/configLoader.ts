/**
 * Configuration loader — pure. Parses raw `bridge.config.json` content into a validated,
 * clamped DaemonConfig, filling defaults for anything missing. Never reads the filesystem
 * (the caller supplies the raw text), so it is fully deterministic and testable.
 */
import { CONFIG_BOUNDS, DEFAULT_CONFIG } from '../constants.js';
import type { DaemonConfig, LogLevel } from '../types.js';

const VALID_LOG_LEVELS: readonly LogLevel[] = [
  'INFO',
  'WARN',
  'ERROR',
  'EVENT',
  'SYNC',
  'VALIDATION',
  'RECOVERY',
  'ROTATION',
];

export interface ConfigResult {
  readonly config: DaemonConfig;
  readonly warnings: readonly string[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((v): v is string => typeof v === 'string');
}

/** Parse + validate raw config text. Malformed JSON falls back to defaults with a warning. */
export function loadConfig(rawText: string | null): ConfigResult {
  const warnings: string[] = [];
  if (rawText === null || rawText.trim().length === 0) {
    return { config: DEFAULT_CONFIG, warnings: ['config absent — using defaults'] };
  }

  let raw: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawText) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { config: DEFAULT_CONFIG, warnings: ['config not an object — using defaults'] };
    }
    raw = parsed as Record<string, unknown>;
  } catch {
    return { config: DEFAULT_CONFIG, warnings: ['config invalid JSON — using defaults'] };
  }

  const watchRoots = asStringArray(raw['watchRoots']) ?? [...DEFAULT_CONFIG.watchRoots];

  let watchIntervalMs = DEFAULT_CONFIG.watchIntervalMs;
  if (typeof raw['watchIntervalMs'] === 'number' && Number.isFinite(raw['watchIntervalMs'])) {
    const clamped = clamp(
      raw['watchIntervalMs'],
      CONFIG_BOUNDS.minIntervalMs,
      CONFIG_BOUNDS.maxIntervalMs,
    );
    if (clamped !== raw['watchIntervalMs']) warnings.push('watchIntervalMs clamped to bounds');
    watchIntervalMs = clamped;
  }

  let debounceMs = DEFAULT_CONFIG.debounceMs;
  if (typeof raw['debounceMs'] === 'number' && Number.isFinite(raw['debounceMs'])) {
    const clamped = clamp(raw['debounceMs'], CONFIG_BOUNDS.minDebounceMs, CONFIG_BOUNDS.maxDebounceMs);
    if (clamped !== raw['debounceMs']) warnings.push('debounceMs clamped to bounds');
    debounceMs = clamped;
  }

  const ignoredFolders = asStringArray(raw['ignoredFolders']) ?? [...DEFAULT_CONFIG.ignoredFolders];
  const plugins = asStringArray(raw['plugins']) ?? [...DEFAULT_CONFIG.plugins];

  const dashboardSync =
    typeof raw['dashboardSync'] === 'boolean' ? raw['dashboardSync'] : DEFAULT_CONFIG.dashboardSync;

  let logLevel = DEFAULT_CONFIG.logLevel;
  if (typeof raw['logLevel'] === 'string') {
    const candidate = raw['logLevel'] as LogLevel;
    if (VALID_LOG_LEVELS.includes(candidate)) logLevel = candidate;
    else warnings.push(`unknown logLevel "${raw['logLevel']}" — using ${logLevel}`);
  }

  const config: DaemonConfig = {
    watchRoots,
    watchIntervalMs,
    debounceMs,
    ignoredFolders,
    dashboardSync,
    logLevel,
    plugins,
  };
  return { config, warnings };
}

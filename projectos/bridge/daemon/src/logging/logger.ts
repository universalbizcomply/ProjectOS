/**
 * Structured logger — redacts every message and field before it reaches the sink, so a secret
 * can never be logged even if one slips into a payload. Levels: INFO/WARN/ERROR severity plus
 * category levels (EVENT/SYNC/VALIDATION/RECOVERY/ROTATION) that always emit above INFO.
 */
import type { LogLevel, LogLine } from '../types.js';
import { redact, redactValue } from '../utils/redact.js';

const RANK: Readonly<Record<LogLevel, number>> = {
  INFO: 10,
  EVENT: 15,
  SYNC: 15,
  VALIDATION: 15,
  RECOVERY: 15,
  ROTATION: 15,
  WARN: 20,
  ERROR: 30,
};

export type LogSink = (line: string) => void;

/** True if a line at `lineLevel` should emit given the configured minimum `configLevel`. */
export function shouldLog(configLevel: LogLevel, lineLevel: LogLevel): boolean {
  return RANK[lineLevel] >= RANK[configLevel];
}

/** Format a log line as a single redacted JSON string. */
export function formatLine(line: LogLine): string {
  const safe: Record<string, unknown> = {
    level: line.level,
    at: line.at,
    msg: redact(line.msg),
  };
  if (line.fields !== undefined) safe['fields'] = redactValue(line.fields);
  return JSON.stringify(safe);
}

export class Logger {
  readonly #sink: LogSink;
  #level: LogLevel;
  readonly #now: () => string;

  constructor(sink: LogSink, now: () => string, level: LogLevel = 'INFO') {
    this.#sink = sink;
    this.#now = now;
    this.#level = level;
  }

  setLevel(level: LogLevel): void {
    this.#level = level;
  }

  log(level: LogLevel, msg: string, fields?: Readonly<Record<string, unknown>>): void {
    if (!shouldLog(this.#level, level)) return;
    const line: LogLine = {
      level,
      at: this.#now(),
      msg,
      ...(fields !== undefined ? { fields } : {}),
    };
    this.#sink(formatLine(line));
  }

  info(msg: string, fields?: Readonly<Record<string, unknown>>): void {
    this.log('INFO', msg, fields);
  }
  warn(msg: string, fields?: Readonly<Record<string, unknown>>): void {
    this.log('WARN', msg, fields);
  }
  error(msg: string, fields?: Readonly<Record<string, unknown>>): void {
    this.log('ERROR', msg, fields);
  }
  event(msg: string, fields?: Readonly<Record<string, unknown>>): void {
    this.log('EVENT', msg, fields);
  }
}

/**
 * JSONL helpers — parse/serialise the append-only event log. Pure, tolerant of blank lines,
 * and never throws on a malformed line (it is skipped and reported to the caller).
 */

export interface ParsedJsonl<T> {
  readonly records: readonly T[];
  readonly skipped: number;
}

/** Parse JSONL text into records, skipping blank/malformed lines. */
export function parseJsonl<T = unknown>(text: string): ParsedJsonl<T> {
  const records: T[] = [];
  let skipped = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    try {
      records.push(JSON.parse(line) as T);
    } catch {
      skipped += 1;
    }
  }
  return { records, skipped };
}

/** Serialise one record to a single JSONL line (no trailing newline). */
export function toJsonlLine(record: unknown): string {
  return JSON.stringify(record);
}

/** Serialise records to JSONL text (trailing newline so appends stay line-aligned). */
export function toJsonl(records: readonly unknown[]): string {
  if (records.length === 0) return '';
  return records.map(toJsonlLine).join('\n') + '\n';
}

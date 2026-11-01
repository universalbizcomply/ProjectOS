// Origin: original ProjectOS code
/**
 * The instant, or `null`. `Date.parse` alone accepts `2026` and rolls 31 February into March, so the text
 * must be exactly what the parsed instant prints back as. The same rule as `taskEnvelope.ts`, which
 * keeps its own private copy: this phase may not edit that file.
 */
export function instantOf(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const at = Date.parse(value);
  return Number.isNaN(at) || new Date(at).toISOString() !== value ? null : at;
}

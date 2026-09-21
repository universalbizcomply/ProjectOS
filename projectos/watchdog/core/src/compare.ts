// ProjectOS Watchdog Core — constant-time comparison for shared credentials
// (ported from the JD reference, monitor-db.ts secretMatches).

export function constantTimeEqual(expected: string | undefined | null, provided: string | undefined | null): boolean {
  if (!expected || !provided) return false;
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(provided);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

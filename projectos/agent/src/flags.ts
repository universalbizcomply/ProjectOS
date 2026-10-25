/** Parsed CLI flags and small typed accessors. */
export type Flags = Readonly<Record<string, string | boolean>>;

export function str(flags: Flags, key: string, fallback = ''): string {
  const v = flags[key];
  return typeof v === 'string' ? v : fallback;
}

export function bool(flags: Flags, key: string): boolean {
  return flags[key] === true;
}

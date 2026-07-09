/**
 * Secret redaction — the daemon's hard guarantee that no token is ever logged or synced.
 *
 * Pure and defensive: applied to every log line's message + fields and to every value that
 * enters the dashboard cache. Matches on known token *shapes* (not just names) so an
 * accidentally-embedded value is caught even under an innocent-looking key.
 */

const REDACTED = '[REDACTED]';

/**
 * Token value patterns. Ordered longest/most-specific first. Each matches a *value* shape,
 * so redaction works even when the surrounding key is missing or misleading.
 */
const VALUE_PATTERNS: readonly RegExp[] = [
  /\bsbp_[A-Za-z0-9]{20,}\b/g, // Supabase PAT
  /\bsb_secret_[A-Za-z0-9_-]{15,}\b/g, // Supabase service key
  /\bsb_publishable_[A-Za-z0-9_-]{15,}\b/g, // Supabase publishable (public, but avoid echoing)
  /\bvcp_[A-Za-z0-9]{20,}\b/g, // Vercel token
  /\bgh[posru]_[A-Za-z0-9]{20,}\b/g, // GitHub token (ghp_/gho_/ghs_/ghr_/ghu_)
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, // GitHub fine-grained PAT
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{20,}\b/g, // Stripe secret/restricted key
  /\bre_[A-Za-z0-9]{20,}\b/g, // Resend API key
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, // JWT
];

/**
 * Key-based patterns: `SOMETHING_KEY = <value>` / `"token": "<value>"`. Redacts the value
 * portion when the key name signals a secret, regardless of value shape.
 */
const KEY_VALUE_PATTERN =
  /((?:service_role|access_token|api[_-]?key|secret|password|token|private[_-]?key)\s*["']?\s*[:=]\s*["']?)([^\s"',]{6,})/gi;

/** Redact a single string. */
export function redact(input: string): string {
  let out = input;
  for (const pat of VALUE_PATTERNS) {
    out = out.replace(pat, REDACTED);
  }
  out = out.replace(KEY_VALUE_PATTERN, (_m, prefix: string) => `${prefix}${REDACTED}`);
  return out;
}

/** True if a string still contains a recognisable secret shape (post-redaction check). */
export function containsSecret(input: string): boolean {
  return VALUE_PATTERNS.some((pat) => {
    pat.lastIndex = 0;
    return pat.test(input);
  });
}

/**
 * Deeply redact any JSON-serialisable value. Strings are scrubbed; objects/arrays are
 * walked; other primitives pass through. Returns a new value (immutability).
 */
export function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map((v) => redactValue(v));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactValue(v);
    }
    return out;
  }
  return value;
}

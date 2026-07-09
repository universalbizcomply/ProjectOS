/**
 * Client-side redaction — defence in depth. The daemon already redacts before anything leaves
 * it; the UI scrubs again so a secret can never reach the DOM even if a future transport
 * carried one. Mirrors the daemon's value-shape patterns.
 */
const REDACTED = '[REDACTED]';

const PATTERNS: readonly RegExp[] = [
  /\bsbp_[A-Za-z0-9]{20,}\b/g,
  /\bsb_secret_[A-Za-z0-9_-]{15,}\b/g,
  /\bsb_publishable_[A-Za-z0-9_-]{15,}\b/g,
  /\bvcp_[A-Za-z0-9]{20,}\b/g,
  /\bgh[posru]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{20,}\b/g,
  /\bre_[A-Za-z0-9]{20,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g,
];

/** Scrub any token-shaped value from a string. */
export function redact(input: string): string {
  let out = input;
  for (const pat of PATTERNS) out = out.replace(pat, REDACTED);
  return out;
}

/** True if a string still contains a recognisable secret shape. */
export function containsSecret(input: string): boolean {
  return PATTERNS.some((pat) => {
    pat.lastIndex = 0;
    return pat.test(input);
  });
}

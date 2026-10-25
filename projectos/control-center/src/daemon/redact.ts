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
  // PROVIDER MODEL KEYS. Every shape above is underscore-delimited and both providers ProjectOS
  // actually spends with are hyphen-delimited, so none of the above came close to either. The three
  // prefixed OpenAI families and the Anthropic family are self-delimiting; the legacy bare OpenAI form
  // has no prefix to lean on and takes a 40-character floor (real keys are 48). The bare form cannot
  // reach a prefixed one: its body excludes the hyphen, so `sk-ant-` and `sk-proj-` both stop it after
  // three or four characters. Mirrors `credentials/credential-shapes.cjs`; drift is refused by
  // `val-projectos-provider-key-shapes1a`.
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, // Anthropic (api03/admin01/sid01 - the variant tag is body, not pinned)
  /\bsk-proj-[A-Za-z0-9_-]{20,}\b/g, // OpenAI project key
  /\bsk-svcacct-[A-Za-z0-9_-]{20,}\b/g, // OpenAI service-account key
  /\bsk-admin-[A-Za-z0-9_-]{20,}\b/g, // OpenAI admin key
  /\bsk-[A-Za-z0-9]{40,}\b/g, // OpenAI legacy bare key
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

// Origin: original ProjectOS code
/**
 * A FILE THAT HOLDS A SECRET IS NOT INDEXED (PROJECTOS-PORT-SEARCH1A review round).
 *
 * An index copies text somewhere new and hands it back on request, so a credential in a document would be copied
 * and returned. These checks run at the index boundary, in `chunkRecordsOf`, so a caller that never used the walk
 * meets them too. The whole file is refused, and the report names the path and the reason and holds no secret.
 *
 * A false positive skips a document and says so, which is the safe way to be wrong.
 *
 * WHAT THIS CANNOT PROVE. It knows shapes and names. A password written as plain prose has neither, so it is indexed.
 * Pure.
 */

export type SensitiveReason = 'dot-segment' | 'credential-name' | 'secret-content';

/** A file or directory named for what it holds, bounded so `tokenizer` and `keyboard` do not match. */
const CREDENTIAL_NAME =
  /(?:^|[-_. ])(?:credentials?|creds|secrets?|passwords?|passwd|api[-_]?keys?|private[-_]?keys?|access[-_]?keys?|tokens?|id_(?:rsa|dsa|ecdsa|ed25519))(?:[-_. ]|$)/i;
const CREDENTIAL_EXTENSION = /\.(?:pem|key|p12|pfx|jks|keystore|kdbx)$/i;

const SECRET_SHAPES: readonly RegExp[] = [
  /-----BEGIN [A-Z0-9 ]+-----/,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}/,
  /\bAccountKey=[A-Za-z0-9+/]{40,}/,
  /\bgh[pousr]_[A-Za-z0-9]{36,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bxox[abeoprs]-[A-Za-z0-9-]{10,}/,
  /\bsk-(?:proj|svcacct|admin|ant)-[A-Za-z0-9_-]{20,}/,
  /\bsk-[A-Za-z0-9]{40,}/,
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/,
  /\bwhsec_[A-Za-z0-9]{16,}/,
  /\bsbp_[a-f0-9]{40,}/,
  /\bnpm_[A-Za-z0-9]{36}/,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/,
  /\bsb_secret_[A-Za-z0-9_-]{16,}/,
  /\bsb_publishable_[A-Za-z0-9_-]{16,}/,
  /\bvcp_[A-Za-z0-9]{20,}/,
  /\bre_[A-Za-z0-9_]{20,}/,
];

/**
 * The one dot directory a store citation may open with (PROJECTOS-MEMORY-STORES1A). Plan memory, execution records and
 * findings live under `.projectops/`, and a citation names the real file, so the path cannot be renamed to hide the dot. Only
 * the first segment, only that name, and only for a `memory` or `sessions` source: a document may not claim it.
 */
const STORE_ROOT_SEGMENT = '.projectops';
const STORE_SOURCES: readonly string[] = ['memory', 'sessions'];

/** Why this project-relative path is not indexed, or null. Each segment is judged, so a directory counts. */
export function sensitivePathProblem(path: string, source?: string): SensitiveReason | null {
  const all = path.split('/');
  const segments = all[0] === STORE_ROOT_SEGMENT && source !== undefined && STORE_SOURCES.includes(source) ? all.slice(1) : all;
  if (segments.some((segment) => segment.startsWith('.'))) return 'dot-segment';
  return segments.some((segment) => CREDENTIAL_NAME.test(segment) || CREDENTIAL_EXTENSION.test(segment)) ? 'credential-name' : null;
}

/**
 * A secret spelled in escapes is the same secret (fix round 1, M3). A findings record is JSON, and `\u0073k-ant-...` is
 * `sk-ant-...` once anything decodes it, so every shape below is asked of the text AND of the text with its escapes undone.
 * Bounded passes undo an escape of an escape. The same decoding the agent's credential vocabulary applies, and it covers
 * `\u{...}` and `\x..` as well.
 */
const MAX_UNESCAPE_PASSES = 4;

function characterOf(hex: string, whole: string): string {
  const code = Number.parseInt(hex, 16);
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole;
}

export function normaliseEscapedText(input: string): string {
  let text = input;
  for (let pass = 0; pass < MAX_UNESCAPE_PASSES; pass += 1) {
    const next = text
      .replace(/\\u\{([0-9a-fA-F]{1,6})\}/g, (whole, hex: string) => characterOf(hex, whole))
      .replace(/\\u([0-9a-fA-F]{4})/g, (whole, hex: string) => characterOf(hex, whole))
      .replace(/\\x([0-9a-fA-F]{2})/g, (whole, hex: string) => characterOf(hex, whole));
    if (next === text) return text;
    text = next;
  }
  return text;
}

export function sensitiveContentProblem(text: string): SensitiveReason | null {
  const decoded = normaliseEscapedText(text);
  return SECRET_SHAPES.some((shape) => shape.test(text) || (decoded !== text && shape.test(decoded))) ? 'secret-content' : null;
}

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
];

/** Why this project-relative path is not indexed, or null. Each segment is judged, so a directory counts. */
export function sensitivePathProblem(path: string): SensitiveReason | null {
  const segments = path.split('/');
  if (segments.some((segment) => segment.startsWith('.'))) return 'dot-segment';
  return segments.some((segment) => CREDENTIAL_NAME.test(segment) || CREDENTIAL_EXTENSION.test(segment)) ? 'credential-name' : null;
}

export function sensitiveContentProblem(text: string): SensitiveReason | null {
  return SECRET_SHAPES.some((shape) => shape.test(text)) ? 'secret-content' : null;
}

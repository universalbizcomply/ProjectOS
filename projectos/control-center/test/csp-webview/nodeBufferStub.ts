/**
 * Proof-only stand-in for `node:buffer`, the same kind of thing as src/shims/nodeCryptoStub.ts.
 *
 * `npm run build` fails at b0768486: `@projectos/core`'s barrel binds candidateEvidence.ts, which imports
 * `isUtf8` from `node:buffer`, and vite.config.ts aliases only `node:crypto`. The fix belongs in
 * vite.config.ts and src/shims, which are outside this phase's write paths, so docs/finish names it and
 * vite.proof.config.ts carries this alias for the proof alone. Nothing in the browser bundle calls it.
 */
export function isUtf8(): never {
  throw new Error('node:buffer is not available in the browser build; this call path should be unreachable here.');
}

// Origin: original ProjectOS code
/**
 * THE CREDENTIAL SCREEN APPLIED TO STORED TEXT (PROJECTOS-CONTEXT-MANAGER1A, review round 1, item 8).
 *
 * The agent's own `containsSecret` knows the shapes of keys and tokens. It does not know a credential that is written as a sentence of
 * configuration, which is how one lands in a note: `password = ...`, `"password": "..."`, a URL with a user and a password in it, a
 * bearer token in a pasted header, an AWS secret access key beside its name. This asks both. Every pattern is linear and bounded: no
 * adjacent quantifiers over the same characters, every repeat has an upper bound, and the value of an unquoted password must hold a
 * digit, so that "password: required" is a note and not a credential.
 *
 * It is the screen this phase hands the context manager (and only this phase: `authoringEvidence.ts` and the loader's screen are
 * shared and outside this phase's paths, so a shape added here is not added to them; the finish doc names that). A shape-list is not
 * proof of absence: a credential with no shape listed passes.
 */
import { containsSecret } from '../authoringEvidence.js';

const ASSIGNED_PASSWORD = /\b(?:password|passwd|pwd)\b["']?[ \t]{0,8}[:=][ \t]{0,8}["']?(?=[^\s"',;]{6})[^\s"',;]{0,200}\d[^\s"',;]{0,200}/i;
const QUOTED_PASSWORD = /["'](?:password|passwd|pwd)["'][ \t]{0,8}:[ \t]{0,8}"[^"\n]{6,200}"/i;
const URL_CREDENTIAL = /[a-z][a-z0-9+.-]{1,20}:\/\/[^\s:/@]{1,100}:[^\s@/]{3,200}@/i;
const BEARER_TOKEN = /\bBearer[ \t]{1,4}[A-Za-z0-9._~+/=-]{16,500}/;
const AWS_SECRET = /\baws[_ -]?secret[_ -]?(?:access[_ -]?)?key\b[^\n]{0,40}?[A-Za-z0-9/+=]{40}/i;

const SHAPES: readonly RegExp[] = [ASSIGNED_PASSWORD, QUOTED_PASSWORD, URL_CREDENTIAL, BEARER_TOKEN, AWS_SECRET];

/** True when the text holds a credential by the agent's vocabulary or by one of the shapes above. Anything that is not text is a yes. */
export function storedTextSecretScreen(text: string): boolean {
  if (typeof text !== 'string') return true;
  return containsSecret(text) || SHAPES.some((shape) => shape.test(text));
}

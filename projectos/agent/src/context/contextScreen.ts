// Origin: original ProjectOS code
/**
 * THE CREDENTIAL SCREEN APPLIED TO STORED TEXT (PROJECTOS-CONTEXT-MANAGER1A, review rounds 1 and 2).
 *
 * The agent's own `containsSecret` knows the shapes of keys and tokens. It does not know a credential that is written as a line of
 * configuration, which is how one lands in a note: `password = ...`, `DB_PASSWORD=...`, `"client_secret": "..."`, `token=...`, a
 * URL with a user and a password in it, a bearer token in a pasted header, an AWS secret access key beside its name. This asks both.
 *
 * WHAT IS A CREDENTIAL HERE. A key name (password, passwd, pwd, passphrase, pass, secret, secret access key, api key, token, private
 * key, access key) with NO letter-boundary before it (so `DB_PASSWORD`, `user_password` and `dbPassword` count) and ONLY an optional
 * quote, spaces and one `:` or `=` after it (so "the password policy is strict" and `max_tokens=4096` do not), followed by a value:
 *   - a quoted value of 6 to 200 characters, an escaped quote allowed;
 *   - an unquoted value of 6 to 200 characters that LOOKS like a credential: it holds a digit, one of `! @ # % ^ & * + / = ~`, a
 *     lower-case letter followed by an upper-case one, or a run of words joined by two `-`, `_` or `.` (so `password: required` is a
 *     note, and `password: Tr0ub4dor`, `CorrectHorse` and `correct-horse-battery` are not); or
 *   - an unquoted run of 32 to 200 characters of the base64 alphabet, whatever it looks like.
 * The value may start on the next line (YAML). A bearer token needs 16 characters and a digit or a case change; a URL user-info
 * runs to the LAST `@` before the host, so `p@ss` inside it is still caught.
 *
 * LINEAR. Every repeat has an upper bound, no two adjacent repeats range over the same characters, the shape tests run in code on the
 * (at most 200 character) value, and the loops move forward by at least the key they matched. The tests hold each pattern to a 262 KB
 * hostile text. It is the screen this phase hands the context manager (and only this phase: `authoringEvidence.ts` and the loader's
 * screen are shared and outside this phase's paths, so a shape added here is not added there; the finish doc says so). A shape list is
 * not proof of absence: a credential with no shape listed passes.
 */
import { containsSecret } from '../authoringEvidence.js';

const KEYS =
  '(?:password|passwd|pwd|passphrase|(?<![a-z])pass|secret(?:[_-]?access)?(?:[_-]?key)?|api[_-]?key|token|private[_-]?key|access[_-]?key)';
const ASSIGNMENT = new RegExp(
  `${KEYS}["']?[ \\t]{0,8}[:=][ \\t\\r\\n]{0,40}(?:"((?:[^"\\\\\\r\\n]|\\\\.){6,200})"|'((?:[^'\\\\\\r\\n]|\\\\.){6,200})'|([^\\s"',;]{6,200}))`,
  'gi',
);
const BEARER = /\bbearer[ \t]{1,4}([A-Za-z0-9._~+/=-]{16,500})/gi;
const URL_CREDENTIAL = /[a-z][a-z0-9+.-]{1,20}:\/\/[^\s/@:]{1,100}:[^\s/]{3,200}@/i;
const AWS_SECRET = /secret[_ -]?access[_ -]?key[^A-Za-z0-9/+=\n]{1,12}[A-Za-z0-9/+=]{40}/i;

const LOOKS_LIKE_A_CREDENTIAL = /[0-9!@#%^&*+/=~]|[a-z][A-Z]|[A-Za-z][-_.][A-Za-z]{1,40}[-_.][A-Za-z]/;
const BASE64_RUN = /^[A-Za-z0-9/+=_-]{32,200}$/;

function assignedCredential(text: string): boolean {
  ASSIGNMENT.lastIndex = 0;
  for (let found = ASSIGNMENT.exec(text); found !== null; found = ASSIGNMENT.exec(text)) {
    if (found[1] !== undefined || found[2] !== undefined) return true;
    const value = found[3] ?? '';
    if (LOOKS_LIKE_A_CREDENTIAL.test(value) || BASE64_RUN.test(value)) return true;
  }
  return false;
}

function bearerCredential(text: string): boolean {
  BEARER.lastIndex = 0;
  for (let found = BEARER.exec(text); found !== null; found = BEARER.exec(text)) {
    const token = found[1] ?? '';
    if (/[0-9]|[a-z][A-Z]/.test(token)) return true;
  }
  return false;
}

/** The patterns this screen is made of, by name, so a test can hold each one to hostile input. */
export const STORED_TEXT_SCREENS: Readonly<Record<'ASSIGNMENT' | 'BEARER' | 'URL_CREDENTIAL' | 'AWS_SECRET', (text: string) => boolean>> = Object.freeze({
  ASSIGNMENT: assignedCredential,
  BEARER: bearerCredential,
  URL_CREDENTIAL: (text: string) => URL_CREDENTIAL.test(text),
  AWS_SECRET: (text: string) => AWS_SECRET.test(text),
});

/** True when the text holds a credential by the agent's vocabulary or by one of the shapes above. Anything that is not text is a yes. */
export function storedTextSecretScreen(text: string): boolean {
  if (typeof text !== 'string') return true;
  return containsSecret(text) || assignedCredential(text) || bearerCredential(text) || URL_CREDENTIAL.test(text) || AWS_SECRET.test(text);
}

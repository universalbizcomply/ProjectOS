// Origin: original ProjectOS code
/**
 * The environment of a command: NAMES, never values, and never a name that changes what loads.
 *
 * A VALUE NEVER RIDES IN A REQUEST. A request names the environment variables the command may be given, and the runner's
 * own env port reads each value. So a secret is never in a request, a log or a hash, and what the owner decided on is a list
 * of names. An object that carries values is refused whole, not stripped to its keys.
 *
 * A NAME THAT CHANGES WHAT LOADS IS REFUSED. Variables that choose which program, library, module, certificate, proxy,
 * configuration or hook a process uses decide what really runs, so a request cannot set them: `PATH`, `PATHEXT`, `COMSPEC`,
 * `NODE_OPTIONS`, `NODE_PATH`, `LD_*`, `DYLD_*`, `PYTHON*`, `PERL5OPT`, `RUBYOPT`, `BASH_ENV`, `ENV`, any `*_PROXY`, `SSL_CERT_*`,
 * `GIT_*`, `NPM_CONFIG_*`, `JAVA_TOOL_OPTIONS` and the rest of `DENIED_ENV` below. A name that looks like a credential is
 * refused too, because a credential is released by the owner and is never an environment variable here. Names are compared
 * in upper case, because Windows folds case.
 *
 * Pure: no I/O.
 */

export const MAX_ENV_NAMES = 32;

export type EnvRefusal = 'ENV_NOT_NAMES' | 'ENV_TOO_MANY' | 'ENV_NAME_FORM' | 'ENV_DUPLICATE' | 'ENV_DENIED';

export type EnvNamesResult =
  | { readonly ok: true; readonly names: readonly string[] }
  | { readonly ok: false; readonly code: EnvRefusal; readonly name: string | null };

const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** Exact names, upper case. */
const DENIED_EXACT = new Set([
  'PATH', 'PATHEXT', 'COMSPEC', 'NODE_OPTIONS', 'NODE_PATH', 'NODE_EXTRA_CA_CERTS', 'NODE_TLS_REJECT_UNAUTHORIZED', 'PERL5OPT', 'PERL5LIB', 'RUBYOPT', 'RUBYLIB',
  'BASH_ENV', 'ENV', 'IFS', 'PS4', 'PROMPT_COMMAND', 'SHELLOPTS', 'BASHOPTS', 'JAVA_TOOL_OPTIONS', 'JDK_JAVA_OPTIONS', '_JAVA_OPTIONS', 'CLASSPATH',
  'CURL_CA_BUNDLE', 'REQUESTS_CA_BUNDLE', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SYSTEMROOT', 'WINDIR', 'TMPDIR', 'TEMP', 'TMP',
]);
/** Families, upper case. */
const DENIED_PATTERN = /^(?:LD_|DYLD_|PYTHON|SSL_CERT_|GIT_|NPM_CONFIG_)|_PROXY$|TOKEN|SECRET|PASSW|CREDENTIAL|API_?KEY|PRIVATE_?KEY/;

/** Why a name may not be requested, or `null`. */
export function deniedEnvName(name: string): EnvRefusal | null {
  if (!NAME.test(name)) return 'ENV_NAME_FORM';
  const folded = name.toUpperCase();
  return DENIED_EXACT.has(folded) || DENIED_PATTERN.test(folded) ? 'ENV_DENIED' : null;
}

/** The names, in one sorted list, or the first refusal. Anything but an array of names is `ENV_NOT_NAMES`. */
export function admitExecEnvNames(input: unknown): EnvNamesResult {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) return { ok: false, code: 'ENV_NOT_NAMES', name: null };
  if (input.length > MAX_ENV_NAMES) return { ok: false, code: 'ENV_TOO_MANY', name: null };
  const names: string[] = [];
  const seen = new Set<string>();
  for (const entry of input as readonly unknown[]) {
    if (typeof entry !== 'string') return { ok: false, code: 'ENV_NOT_NAMES', name: null };
    const refusal = deniedEnvName(entry);
    if (refusal !== null) return { ok: false, code: refusal, name: entry };
    if (seen.has(entry.toUpperCase())) return { ok: false, code: 'ENV_DUPLICATE', name: entry };
    seen.add(entry.toUpperCase());
    names.push(entry);
  }
  return { ok: true, names: Object.freeze(names.sort()) };
}

// Origin: original ProjectOS code
/**
 * The environment of a command: NAMES, never values, and only names from a short allow-list.
 *
 * A VALUE NEVER RIDES IN A REQUEST. A request names the environment variables the command may be given, and the runner's
 * own env port reads each value. So a secret is never in a request, a log or a hash, and what the owner decided on is a list
 * of names. An object that carries values is refused whole, not stripped to its keys.
 *
 * AN ALLOW-LIST, NOT A DENY-LIST. Only a small named set may be asked for: `LANG`, `LANGUAGE`, `TERM`, `TZ`, `COLORTERM`,
 * `NO_COLOR`, `CI` and `LC_<LETTERS>`. Every other name is `ENV_NOT_ALLOWED`, in the case it is written in (Windows folds
 * case, so `Lang` is refused rather than guessed at). A deny-list stays behind it as a second defence and names the loader,
 * hook, proxy, certificate, configuration and secret variables by family: `PATH`, `PATHEXT`, `COMSPEC`, `NODE_OPTIONS`,
 * `NODE_PATH`, `LD_*`, `DYLD_*`, `PYTHON*`, `PERL5OPT`, `PERLLIB`, `RUBYOPT`, `BASH_ENV`, `ENV`, any `*_PROXY`, `SSL_CERT_*`,
 * `SSLKEYLOGFILE`, `OPENSSL_CONF`, `GIT_*`, `NPM_CONFIG_*`, `PIP_*`, `GEM_*`, `JAVA_TOOL_OPTIONS`, `DOTNET_STARTUP_HOOKS`,
 * `COR_PROFILER`, `__COMPAT_LAYER`, `PSModulePath`, `EDITOR`, `PAGER`, `GOPROXY`, `SUPABASE_*`, `AWS_*`, `DATABASE_URL`,
 * `SSH_AUTH_SOCK`, `KUBECONFIG`, `DOCKER_HOST` and any name that looks like a credential.
 *
 * Pure: no I/O.
 */

export const MAX_ENV_NAMES = 32;

export type EnvRefusal = 'ENV_NOT_NAMES' | 'ENV_TOO_MANY' | 'ENV_NAME_FORM' | 'ENV_DUPLICATE' | 'ENV_DENIED' | 'ENV_NOT_ALLOWED';

export type EnvNamesResult =
  | { readonly ok: true; readonly names: readonly string[] }
  | { readonly ok: false; readonly code: EnvRefusal; readonly name: string | null };

const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** The only names a request may ask for. */
const ALLOWED_EXACT = new Set(['LANG', 'LANGUAGE', 'TERM', 'TZ', 'COLORTERM', 'NO_COLOR', 'CI']);
const ALLOWED_PATTERN = /^LC_[A-Z]{1,16}$/;

/** Exact names, upper case. */
const DENIED_EXACT = new Set([
  'PATH', 'PATHEXT', 'COMSPEC', 'NODE_OPTIONS', 'NODE_PATH', 'NODE_EXTRA_CA_CERTS', 'NODE_TLS_REJECT_UNAUTHORIZED', 'PERL5OPT', 'PERL5LIB', 'PERLLIB', 'RUBYOPT', 'RUBYLIB',
  'BASH_ENV', 'ENV', 'IFS', 'PS4', 'PROMPT_COMMAND', 'SHELLOPTS', 'BASHOPTS', 'JAVA_TOOL_OPTIONS', 'JDK_JAVA_OPTIONS', '_JAVA_OPTIONS', 'CLASSPATH',
  'CURL_CA_BUNDLE', 'REQUESTS_CA_BUNDLE', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SYSTEMROOT', 'WINDIR', 'TMPDIR', 'TEMP', 'TMP',
  'DATABASE_URL', 'SSH_AUTH_SOCK', 'KUBECONFIG', 'DOCKER_HOST', 'DOTNET_STARTUP_HOOKS', 'COR_PROFILER', 'SSLKEYLOGFILE', 'OPENSSL_CONF', '__COMPAT_LAYER', 'PSMODULEPATH',
  'EDITOR', 'VISUAL', 'PAGER', 'GOPROXY', 'GIT_ASKPASS', 'SSH_ASKPASS',
]);
/** Families, upper case. */
const DENIED_PATTERN = /^(?:LD_|DYLD_|PYTHON|SSL_CERT_|GIT_|NPM_CONFIG_|PIP_|GEM_|SUPABASE_|AWS_|DOTNET_|COR_|CORECLR_|KUBE|DOCKER_)|_PROXY$|TOKEN|SECRET|PASSW|CREDENTIAL|API_?KEY|PRIVATE_?KEY/;

/** Whether a name is on the allow-list, in the case it is written in. */
export const allowedEnvName = (name: string): boolean => ALLOWED_EXACT.has(name) || ALLOWED_PATTERN.test(name);

/** Why a name may not be requested, or `null`. The deny-list is read first, so a denied name says it is denied. */
export function deniedEnvName(name: string): EnvRefusal | null {
  if (!NAME.test(name)) return 'ENV_NAME_FORM';
  const folded = name.toUpperCase();
  if (DENIED_EXACT.has(folded) || DENIED_PATTERN.test(folded)) return 'ENV_DENIED';
  return allowedEnvName(name) ? null : 'ENV_NOT_ALLOWED';
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

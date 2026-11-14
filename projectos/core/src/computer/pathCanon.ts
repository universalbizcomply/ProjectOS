// Origin: original ProjectOS code
/**
 * One canonical spelling for an absolute executable path, or a refusal that says why it has none.
 *
 * AN ALLOWLIST MATCHES ONLY WHAT HAS ONE SPELLING. Two spellings of one file must not be two answers, and a spelling the
 * operating system would read as another file must not be matched as the file it looks like. So a path is either made
 * canonical here, or it is refused, and nothing in this directory matches a path that was refused:
 *
 * - case is folded for a drive or UNC path and kept for a POSIX one; separators are `/` after this;
 * - a `.` segment is dropped, and a `..` segment is REFUSED, not collapsed: collapsing it is only right when no segment
 *   before it is a link, and this module cannot see links, so it refuses rather than guess;
 * - a segment that ends in a dot or a space is refused, because Windows drops them and so names another file;
 * - an 8.3 short name (`PROGRA~1`) is refused, because it names a file whose long name this module cannot see;
 * - an alternate data stream, a device name (`con`, `nul`, `com1`) and the characters Windows reserves are refused;
 * - the extended-length prefix is read as the plain path it wraps (drive form or UNC form); any other form of it and every
 *   device-namespace prefix is a device path and is refused;
 * - a backslash in a POSIX-looking path is refused, because it is a separator on one system and a name on another;
 * - any character outside printable ASCII is refused, so a look-alike letter is never matched as the letter it imitates;
 * - a relative path, a drive-relative path and a `~` home prefix are refused: the resolver port supplies an absolute path.
 *
 * Pure: no I/O.
 */

export type PathStyle = 'posix' | 'windows';

export interface CanonicalPath {
  readonly path: string;
  readonly style: PathStyle;
  /** The root and then each segment, in the canonical case. */
  readonly segments: readonly string[];
  /** How many of the leading segments are the root: 0 for POSIX, 1 for a drive, 2 for a UNC server and share. */
  readonly rootLength: number;
}

export type PathRefusal =
  | 'NOT_TEXT'
  | 'EMPTY'
  | 'TOO_LONG'
  | 'CONTROL_CHARACTER'
  | 'NON_ASCII'
  | 'HOME_PREFIX'
  | 'NOT_ABSOLUTE'
  | 'DEVICE_PATH'
  | 'AMBIGUOUS_SEPARATOR'
  | 'DOT_DOT'
  | 'TRAILING_DOT_OR_SPACE'
  | 'SHORT_NAME'
  | 'STREAM_OR_RESERVED'
  | 'WILDCARD';

export type CanonicalPathResult = { readonly ok: true; readonly value: CanonicalPath } | { readonly ok: false; readonly refusal: PathRefusal };

export const MAX_PATH_CHARS = 4096;

const BACKSLASH = String.fromCharCode(92);
const DRIVE = /^([A-Za-z]):[\\/]/;
const SHORT_NAME = /^[^~.]{1,6}~[0-9]+(?:\.[^.]*)?$/;
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const WINDOWS_RESERVED = /[<>"|]/;
const EXTENDED_PREFIX = /^(?:\\\\\?\\|\/\/\?\/)/;
const DEVICE_PREFIX = /^(?:\\\\\.\\|\/\/\.\/)/;

const no = (refusal: PathRefusal): CanonicalPathResult => ({ ok: false, refusal });

interface Rooted {
  readonly style: PathStyle;
  readonly root: readonly string[];
  readonly rest: string;
}

/** Where a path starts and what follows, or a refusal. `rest` still holds separators of either kind. */
function splitRoot(raw: string): Rooted | PathRefusal {
  if (DEVICE_PREFIX.test(raw)) return 'DEVICE_PATH';
  const extended = EXTENDED_PREFIX.test(raw);
  const body = extended ? raw.replace(EXTENDED_PREFIX, '') : raw;
  const drive = DRIVE.exec(body);
  if (drive !== null) return { style: 'windows', root: [`${drive[1] as string}:`], rest: body.slice(2) };
  const unc = extended ? /^UNC[\\/]+([^\\/]+)[\\/]+([^\\/]+)(.*)$/i.exec(body) : /^[\\/]{2}([^\\/]+)[\\/]+([^\\/]+)(.*)$/.exec(body);
  if (unc !== null) return { style: 'windows', root: [unc[1] as string, unc[2] as string], rest: unc[3] as string };
  if (extended) return 'DEVICE_PATH';
  if (/^[\\/]{2}/.test(body)) return 'NOT_ABSOLUTE';
  if (body.startsWith('/')) return body.includes(BACKSLASH) ? 'AMBIGUOUS_SEPARATOR' : { style: 'posix', root: [], rest: body };
  return 'NOT_ABSOLUTE';
}

function segmentRefusal(segment: string, style: PathStyle, wildcards: boolean): PathRefusal | null {
  if (segment === '..') return 'DOT_DOT';
  if (/[. ]$/.test(segment)) return 'TRAILING_DOT_OR_SPACE';
  if (SHORT_NAME.test(segment)) return 'SHORT_NAME';
  if (!wildcards && /[*?]/.test(segment)) return 'WILDCARD';
  if (style === 'windows' && (segment.includes(':') || WINDOWS_RESERVED.test(segment) || WINDOWS_DEVICE.test(segment))) return 'STREAM_OR_RESERVED';
  return null;
}

/**
 * The canonical spelling of `raw`, or a refusal. `wildcards` lets `*` and `?` stand in a segment AFTER the root; it is for
 * allowlist patterns, never for the path of a command.
 */
export function canonicalPathOf(raw: unknown, options: { readonly wildcards?: boolean } = {}): CanonicalPathResult {
  if (typeof raw !== 'string') return no('NOT_TEXT');
  if (raw.length === 0) return no('EMPTY');
  if (raw.length > MAX_PATH_CHARS) return no('TOO_LONG');
  if (/[\u0000-\u001f\u007f]/.test(raw)) return no('CONTROL_CHARACTER');
  if (/[^ -~]/.test(raw)) return no('NON_ASCII');
  if (raw.startsWith('~')) return no('HOME_PREFIX');
  const wildcards = options.wildcards === true;
  const rooted = splitRoot(raw);
  if (typeof rooted === 'string') return no(rooted);
  if (rooted.root.some((part) => /[*?]/.test(part))) return no('WILDCARD');
  const parts = rooted.rest.split(rooted.style === 'windows' ? /[\\/]+/ : /\/+/).filter((part) => part !== '' && part !== '.');
  for (const part of parts) {
    const refused = segmentRefusal(part, rooted.style, wildcards);
    if (refused !== null) return no(refused);
  }
  if (parts.length === 0) return no('EMPTY');
  const fold = (text: string): string => (rooted.style === 'windows' ? text.toLowerCase() : text);
  const segments = [...rooted.root, ...parts].map(fold);
  const head = rooted.style === 'posix' ? '' : rooted.root.length === 2 ? `//${fold(rooted.root[0] as string)}/${fold(rooted.root[1] as string)}` : fold(rooted.root[0] as string);
  const path = `${head}/${parts.map(fold).join('/')}`;
  return { ok: true, value: Object.freeze({ path, style: rooted.style, segments: Object.freeze(segments), rootLength: rooted.root.length }) };
}

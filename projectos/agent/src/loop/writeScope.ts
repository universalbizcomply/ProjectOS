/**
 * Write scope judged AFTER a worker that cannot be given per-path grants. PROJECTOS-WORKER-CODEX-IMPLEMENTER1A.
 *
 * WHY THIS EXISTS. A Claude worker's write scope is preventative: the loop puts `Edit(path)`/`Write(path)`
 * grants on its argv and the CLI refuses any other write (`runner.ts` `writeGrant`, `withCorrectionGrants`).
 * Codex has no per-path grant: its workspace-write sandbox covers the whole checkout. So for a Codex
 * implementer the same grants are read here, from the argv the loop composed, and judged on what changed.
 *
 * DETECTIVE, NOT PREVENTATIVE, and said so. A write outside the grants has already happened when this sees
 * it. The caller refuses the run, names the paths, and leaves the tree for the owner; nothing is certified.
 *
 * WHAT IS COMPARED, before and after the run (every difference outside the grants is a breach):
 *  - every path git reports as changed, untracked or deleted, by status code and content (`hash-object
 *    --no-filters`), INCLUDING the loop's own gatekeeper asking records, which `computeCandidateIdentity`
 *    leaves out because they are not part of a candidate. A worker must not touch them either;
 *  - both paths of a rename: the origin is a removal;
 *  - every git-ignored path git lists at its collapsed level (`node_modules/`, `.env`, `dist/`), by name; an
 *    ignored FILE git lists by name is compared by content, and everything under `.projectops/` is expanded and
 *    compared file by file;
 *  - the repository's own configuration (`git config --local --list`), because a filter driver or a hook
 *    setting written into it would make the next git call run the worker's program;
 *  - HEAD, the index flags that hide a change from status (assume-unchanged, skip-worktree) and
 *    `.git/info/exclude`, because a commit, a flag or an exclude pattern would make an out-of-scope change
 *    invisible to the comparison above.
 *
 * GIT RUNS ISOLATED: no system or user configuration, no fsmonitor, no replace refs, and every filter driver
 * the repository configures is switched off at command scope (the same neutralisation the bounded local
 * candidate commit uses, enumerated here from the configuration as it is NOW, so a driver the worker added
 * is neutralised too). Paths are read with `-z`, so a name with a space, a quote or a non-ASCII character is
 * read as it is.
 *
 * KNOWN LIMITS. A write inside an existing ignored directory such as `node_modules/` is not seen; a path under
 * `.git` other than the state listed above is not seen; a write made and undone during the run is not seen;
 * Codex reads are not constrained at all (a read-only sandbox would not constrain them either). The real fix
 * for all of these is to run the worker in a scratch checkout (Stage 4.3), not to look harder afterwards.
 */
import { createHash } from 'node:crypto';
import type { ExecResult, System } from '../system.js';
import { grantedPaths } from './workers.js';

/** path -> `status|blob`, `ignored` or `ignored|blob` for an ignored entry, and fixed keys for git's own state. */
export type CandidateSnapshot = ReadonlyMap<string, string>;

/** The keys git's own state is recorded under. Each starts with `.git`, so none is ever a path a grant can cover. */
export const REPOSITORY_CONFIGURATION = '.git (repository configuration)';
export const REPOSITORY_HEAD = '.git (HEAD commit)';
export const REPOSITORY_EXCLUDES = '.git (info/exclude)';
export const INDEX_FLAG_PREFIX = '.git (index flag) ';

const FILE_WRITE_GRANT = /^(?:Write|Edit)\(.+\)$/;
/** Glob and brace syntax this module does not interpret: refused rather than read two ways. */
const UNSUPPORTED_SYNTAX = /[?[\]{}]|\*\*/;
/** Agent configuration and instruction paths for either provider: never in scope, even beneath a directory grant. */
const AGENT_CONTROL_SEGMENT = /^(?:\.git.*|\.claude|\.codex|\.agents|\.husky|\.vscode|\.cursor(?:rules)?|\.windsurf(?:rules)?|\.mcp\.json)$/i;
const AGENT_INSTRUCTION_FILE = /^(?:CLAUDE|AGENTS|GEMINI)(?:\.local|\.override)?\.md$/i;
const ABSOLUTE_PATH = /^(?:[A-Za-z]:|[\\/])/;
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;
const HASH_CHUNK = 100;

/** The scopes the write grants cover, or why one cannot be judged. Reads are not scopes. */
export function grantScopes(grants: readonly string[]): { readonly scopes: readonly string[]; readonly problems: readonly string[] } {
  const problems: string[] = [];
  const writes = grants.filter((g) => FILE_WRITE_GRANT.test(g));
  const scopes = grantedPaths(writes).map((s) => s.replace(/\\/g, '/').replace(/^\.[/]/, '').replace(/[/]+$/, ''));
  for (const scope of scopes) {
    if (scope === '' || scope === '.' || scope.startsWith('/') || /^[A-Za-z]:/.test(scope) || scope.split('/').includes('..')) {
      problems.push(`the write grant '${scope === '' ? '<empty>' : scope}' is not a path inside the checkout, so no scope can be judged from it`);
    } else if (UNSUPPORTED_SYNTAX.test(scope)) {
      problems.push(`the write grant '${scope}' uses glob syntax this check does not read; only a path, a directory or a single-segment '*' is accepted`);
    }
  }
  return { scopes, problems };
}

function globRegex(scope: string): RegExp {
  const body = scope.replace(/[.+^$()|\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${body}$`);
}

/** Is this repository-relative path inside one of the scopes? A prefix of a name is not a parent directory. */
export function pathInGrants(path: string, scopes: readonly string[]): boolean {
  const p = path.replace(/\\/g, '/');
  return scopes.some((s) => (s.includes('*') ? globRegex(s).test(p) : p === s || p.startsWith(`${s}/`)));
}

/** A path that steers an agent or git, whatever grant covers it: any `.git*`, `.claude`, `.codex`, `.agents`, CLAUDE.md, AGENTS(.override).md. */
export function isAgentControlPath(path: string): boolean {
  const segments = path.replace(/\\/g, '/').replace(/\/$/, '').split('/');
  return segments.some((seg) => AGENT_CONTROL_SEGMENT.test(seg)) || AGENT_INSTRUCTION_FILE.test(segments[segments.length - 1] ?? '');
}

function joinRepoPath(root: string, rel: string): string {
  return `${root}${root.endsWith('/') || root.endsWith('\\') ? '' : '/'}${rel}`;
}

interface StatusEntry {
  readonly code: string;
  readonly path: string;
  /** The original path of a rename or copy. */
  readonly origin: string | null;
}

/** Entries of `git status --porcelain=v1 -z`: `XY path`, and for a rename or copy the original path follows as its own token. */
function statusEntries(out: string): readonly StatusEntry[] {
  const tokens = out.split('\0');
  const entries: StatusEntry[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i] as string;
    if (t.length < 4) continue;
    const code = t.slice(0, 2);
    const renamed = code.includes('R') || code.includes('C');
    entries.push({ code, path: t.slice(3), origin: renamed ? (tokens[i + 1] ?? null) : null });
    if (renamed) i += 1;
  }
  return entries;
}

export type GitRun = (args: readonly string[]) => ExecResult;

const failed = (r: ExecResult): boolean => r.code !== 0 || r.failure !== undefined;

/** The command-scope overrides that switch off every filter driver the configuration defines, or null when they cannot be enumerated. */
function filterNeutralisers(run: GitRun): readonly string[] | null {
  const listed = run(['config', '--name-only', '--get-regexp', '^filter\\.']);
  if (listed.code === 1 && listed.stdout.trim() === '') return [];
  if (failed(listed)) return null;
  const names = new Set<string>();
  for (const line of listed.stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '')) {
    const m = /^filter\.(.+)\.[^.]+$/i.exec(line);
    if (m === null) continue;
    const name = String(m[1]);
    if (name === '' || name.includes('=') || /\s/.test(name)) return null;
    names.add(name);
  }
  return [...names].sort().flatMap((n) => ['-c', `filter.${n}.clean=`, '-c', `filter.${n}.smudge=`, '-c', `filter.${n}.process=`, '-c', `filter.${n}.required=false`]);
}

function digest(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Hash existing files raw (no filters), in chunks. False when git's answer is partial: a partial answer would compare equal to a smaller checkout. */
function hashInto(run: GitRun, paths: readonly string[], set: (path: string, blob: string) => void): boolean {
  for (let i = 0; i < paths.length; i += HASH_CHUNK) {
    const chunk = paths.slice(i, i + HASH_CHUNK);
    const hashed = run(['hash-object', '--no-filters', '-t', 'blob', '--', ...chunk]);
    const lines = hashed.stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
    if (failed(hashed) || lines.length !== chunk.length) return false;
    chunk.forEach((path, j) => set(path, lines[j] as string));
  }
  return true;
}

/**
 * Git run against `root` the way every read of a checkout here runs it: isolated (no system or user configuration, no
 * fsmonitor, no replace refs, no remote protocol), with every filter driver the repository configures NOW switched off at command
 * scope. Null when the drivers cannot be listed: a read that might run the worker's program is not made. Shared by the snapshot
 * below and by the scratch export (`scratchCheckout.ts`), so a checkout is never read two ways.
 */
export function isolatedGitRunner(sys: System, root: string): GitRun | null {
  const base = ['-C', root, '-c', 'core.fsmonitor=false', '-c', 'core.useReplaceRefs=false', '-c', 'protocol.allow=never'];
  const options = { isolatedGit: {}, maxOutputBytes: MAX_GIT_OUTPUT_BYTES };
  const neutralisers = filterNeutralisers((args) => sys.exec('git', [...base, ...args], options));
  if (neutralisers === null) return null;
  const run: GitRun = (args) => sys.exec('git', [...base, ...neutralisers, ...args], options);
  return run;
}

/** The checkout as a map, or null when it cannot be read completely. */
export function candidateSnapshot(sys: System, root: string): CandidateSnapshot | null {
  const run = isolatedGitRunner(sys, root);
  if (run === null) return null;
  const snapshot = new Map<string, string>();

  const config = run(['config', '--local', '--list', '-z']);
  if (failed(config)) return null;
  snapshot.set(REPOSITORY_CONFIGURATION, digest(config.stdout));

  const head = run(['rev-parse', 'HEAD']);
  if (failed(head)) return null;
  snapshot.set(REPOSITORY_HEAD, head.stdout.trim());

  const excludePath = run(['rev-parse', '--git-path', 'info/exclude']);
  const exclude = excludePath.stdout.trim();
  if (failed(excludePath) || exclude === '') return null;
  snapshot.set(REPOSITORY_EXCLUDES, digest(sys.readText(ABSOLUTE_PATH.test(exclude) ? exclude : joinRepoPath(root, exclude)) ?? ''));

  // An index flag hides a change from status; only the plain `H` (cached) tag is ordinary.
  const flags = run(['ls-files', '-v', '-z']);
  if (failed(flags)) return null;
  for (const token of flags.stdout.split('\0')) {
    if (token.length > 2 && token[0] !== 'H') snapshot.set(`${INDEX_FLAG_PREFIX}${token.slice(2)}`, token[0] as string);
  }

  const status = run(['status', '--porcelain=v1', '-z', '--ignore-submodules=dirty', '--untracked-files=all']);
  if (failed(status)) return null;
  const codes = new Map<string, string>();
  const present: string[] = [];
  for (const { code, path, origin } of statusEntries(status.stdout)) {
    if (origin !== null) snapshot.set(origin, `${code}|renamed-from`);
    codes.set(path, code);
    if (path.endsWith('/')) snapshot.set(path, `${code}|directory`);
    else if (!sys.exists(joinRepoPath(root, path))) snapshot.set(path, `${code}|deleted`);
    else present.push(path);
  }
  if (!hashInto(run, present, (path, blob) => snapshot.set(path, `${codes.get(path)}|${blob}`))) return null;

  // Ignored entries, at git's collapsed level: an ignored directory is one entry, not its thousand files.
  const ignored = run(['status', '--porcelain=v1', '-z', '--ignore-submodules=dirty', '--ignored', '--untracked-files=normal']);
  if (failed(ignored)) return null;
  const ignoredFiles = new Set<string>();
  for (const { code, path } of statusEntries(ignored.stdout)) {
    if (code !== '!!') continue;
    snapshot.set(path, 'ignored');
    if (!path.endsWith('/') && sys.exists(joinRepoPath(root, path))) ignoredFiles.add(path);
  }
  // Everything git ignores under `.projectops/` is expanded: records, caches and owner controls live there.
  const records = run(['status', '--porcelain=v1', '-z', '--ignore-submodules=dirty', '--ignored', '--untracked-files=all', '--', '.projectops']);
  if (failed(records)) return null;
  for (const { code, path } of statusEntries(records.stdout)) {
    if (code === '!!' && !path.endsWith('/') && sys.exists(joinRepoPath(root, path))) ignoredFiles.add(path);
  }
  if (!hashInto(run, [...ignoredFiles], (path, blob) => snapshot.set(path, `ignored|${blob}`))) return null;
  return snapshot;
}

/**
 * Every path whose state, content or presence differs between two snapshots and is outside the scopes, sorted.
 * A path that steers an agent or git (`.git*`, `.claude`, `.codex`, `.agents`, CLAUDE.md, AGENTS.md) is a breach
 * even beneath a directory grant, and so is any change to git's own state (every such key starts with `.git`).
 */
export function scopeBreaches(before: CandidateSnapshot, after: CandidateSnapshot, scopes: readonly string[]): readonly string[] {
  const changed: string[] = [];
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(path) === after.get(path)) continue;
    if (isAgentControlPath(path) || !pathInGrants(path, scopes)) changed.push(path);
  }
  return changed.sort();
}

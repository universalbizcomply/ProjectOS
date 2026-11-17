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
 * THE CANDIDATE IS THE LOOP'S OWN INSTRUMENT (`computeCandidateIdentity`), read under the same isolated git
 * environment the bounded local candidate commit uses: no system or user configuration, no fsmonitor, no
 * replace refs. Every path the candidate names, before and after, is compared by state, blob and mode.
 * Known limit: the candidate leaves out the loop's own gatekeeper asking records (`isAskingRecord`), so a
 * worker write to exactly those paths is not seen here.
 */
import type { System } from '../system.js';
import { computeCandidateIdentity } from './candidateIdentity.js';
import { grantedPaths } from './workers.js';

/** path -> `state|blob|mode`. */
export type CandidateSnapshot = ReadonlyMap<string, string>;

const FILE_WRITE_GRANT = /^(?:Write|Edit)\(.+\)$/;
/** Glob and brace syntax this module does not interpret: refused rather than read two ways. */
const UNSUPPORTED_SYNTAX = /[?[\]{}]|\*\*/;

/** The scopes the write grants cover, or why one cannot be judged. Reads are not scopes. */
export function grantScopes(grants: readonly string[]): { readonly scopes: readonly string[]; readonly problems: readonly string[] } {
  const problems: string[] = [];
  const writes = grants.filter((g) => FILE_WRITE_GRANT.test(g));
  const scopes = grantedPaths(writes).map((s) => s.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, ''));
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

/** The candidate as a map, or null when it cannot be read completely. */
export function candidateSnapshot(sys: System, root: string): CandidateSnapshot | null {
  const run = (args: readonly string[]) =>
    sys.exec(
      'git',
      ['-C', root, '-c', 'core.fsmonitor=false', '-c', 'core.useReplaceRefs=false', '-c', 'protocol.allow=never', ...args],
      { isolatedGit: {} },
    );
  const candidate = computeCandidateIdentity(sys, root, run);
  if (!candidate.ok) return null;
  return new Map(candidate.identity.entries.map((e) => [e.path, `${e.state}|${e.blob ?? ''}|${e.mode}`]));
}

/** Every path whose state, content or mode differs between two snapshots, outside the scopes, sorted. */
export function scopeBreaches(before: CandidateSnapshot, after: CandidateSnapshot, scopes: readonly string[]): readonly string[] {
  const changed: string[] = [];
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(path) !== after.get(path) && !pathInGrants(path, scopes)) changed.push(path);
  }
  return changed.sort();
}

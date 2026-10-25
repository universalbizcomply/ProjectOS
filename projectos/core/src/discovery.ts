/**
 * Project discovery: pure parsers over git metadata.
 *
 * These take raw strings (git remote URL, contents of .git/HEAD) and extract structured
 * info. The actual reading of files/running of git is done by a surface adapter (CLI);
 * keeping the parsing pure means it is fully unit-testable with no filesystem.
 */

export interface RepoRef {
  readonly host: string;
  readonly owner: string;
  readonly name: string;
  /** Canonical "owner/name" slug. */
  readonly slug: string;
}

/**
 * Parse a git remote URL (https or ssh) into a RepoRef.
 * Supports:
 *   https://github.com/owner/name.git
 *   git@github.com:owner/name.git
 */
export function parseRemoteUrl(url: string): RepoRef | null {
  const trimmed = url.trim();
  // ssh: git@host:owner/name(.git)
  const ssh = /^[^@]+@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/.exec(trimmed);
  if (ssh) {
    const [, host, owner, name] = ssh;
    return buildRef(host, owner, name);
  }
  // https/http: proto://host/owner/name(.git)
  const https = /^https?:\/\/(?:[^@]+@)?([^/]+)\/([^/]+)\/(.+?)(?:\.git)?$/.exec(trimmed);
  if (https) {
    const [, host, owner, name] = https;
    return buildRef(host, owner, name);
  }
  return null;
}

function buildRef(
  host: string | undefined,
  owner: string | undefined,
  name: string | undefined,
): RepoRef | null {
  if (!host || !owner || !name) return null;
  return { host, owner, name, slug: `${owner}/${name}` };
}

/**
 * Extract the current branch name from the contents of .git/HEAD.
 * Detached HEAD (a bare commit sha) returns null.
 */
export function currentBranchFromHead(headContents: string): string | null {
  const line = headContents.trim();
  const m = /^ref:\s*refs\/heads\/(.+)$/.exec(line);
  return m && m[1] ? m[1] : null;
}

/** Whether a branch is protected given the project's protected-branch list. */
export function isProtectedBranch(
  branch: string,
  protectedBranches: readonly string[],
): boolean {
  return protectedBranches.includes(branch);
}

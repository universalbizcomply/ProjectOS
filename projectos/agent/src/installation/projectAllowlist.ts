/**
 * Which governed projects this INSTALLATION will spend its own credential on.
 *
 * THE HOLE THIS CLOSES. The credential belongs to the installation; the `secrets-handling` receipt
 * that releases it lives in the GOVERNED PROJECT. So any repository the operator pointed ProjectOS at
 * could obtain the installation owner's key by committing two files into its own tree — a
 * `gatekeeper.json` naming the reference, and an APPROVE receipt it wrote itself. Both sides of that
 * decision sat on the untrusted side. This is the missing half: a policy the INSTALLATION commits,
 * naming the projects it is willing to spend on, which a governed project cannot write.
 *
 * TWO FACTORS, BOTH REQUIRED, NEITHER SUFFICIENT.
 *   - This allowlist says the installation is willing to spend on that project at all.
 *   - The project's own committed `secrets-handling` receipt says its owner approved credential use
 *     for the phase in hand.
 * A project can grant itself the second and never the first; the installation grants the first and
 * never the second. Both, or no credential is read.
 *
 * IT IS A POLICY, NOT AN OWNER RECEIPT. It carries no `decidedBy: Murad` and claims no owner
 * decision, because none was taken: the initial entry was authorised by the delegated technical
 * gatekeeper. Dressing a technical policy as an owner gate is exactly the laundering this codebase
 * refuses everywhere else.
 *
 * COMMITTED, OR IT IS NOTHING. Read from the installation's git object store — a working-tree
 * allowlist has no authority, which is what stops a process that can write the tree from adding
 * itself. Absent, unreadable, dirty or unparseable all refuse.
 *
 * Created in PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A under the gatekeeper ruling of 2026-08-20
 * (HIGH-1, credential scope).
 */
import { parseRemoteUrl } from '@projectos/core';
import type { System } from '../system.js';
import type { ProjectosRuntime } from '../nodeRuntimeRoot.js';

/** Where the policy lives, relative to the installation root. */
export const INSTALLATION_ALLOWLIST_REL = 'projectos/security/installation-project-allowlist.json';

export interface AllowlistDecision {
  readonly allowed: boolean;
  readonly reasons: readonly string[];
  /** The canonical repository identity this checkout resolved to, when it could be derived. */
  readonly repository: string | null;
}

function refuse(reasons: readonly string[], repository: string | null = null): AllowlistDecision {
  return { allowed: false, reasons, repository };
}

/**
 * The canonical identity of a checkout: `host/owner/name`, from its `origin` remote.
 *
 * ONE RULE, THE ONE THE REST OF THE SYSTEM ALREADY USES. `parseRemoteUrl` is what discovery and the
 * observation check parse remotes with, so a project cannot be one identity to the allowlist and
 * another to everything else. A checkout with no readable origin has no canonical identity and is
 * refused rather than matched on its `projectId` alone — the id is a string in a file the project
 * writes, and two projects may claim the same one.
 */
export function canonicalRepositoryIdentity(sys: System, root: string): string | null {
  const remote = sys.exec('git', ['-C', root, 'remote', 'get-url', 'origin']);
  if (remote.code !== 0) return null;
  const ref = parseRemoteUrl(remote.stdout.trim());
  return ref === null ? null : `${ref.host}/${ref.slug}`;
}

interface Entry {
  readonly projectId: unknown;
  readonly repository: unknown;
}

/**
 * May this installation spend its credential on this governed project?
 *
 * Every failure is a refusal, and each says which of the two questions failed — "the installation
 * does not allow this project" and "this project's owner has not approved" are different facts and an
 * operator fixes them in different places.
 */
export function installationAllowsProject(
  sys: System,
  runtime: ProjectosRuntime,
  governedRoot: string,
  projectId: string,
): AllowlistDecision {
  const rel = INSTALLATION_ALLOWLIST_REL;
  const install = runtime.installRoot;

  const logged = sys.exec('git', ['-C', install, 'log', '-1', '--format=%H', '--', rel]);
  if (logged.code !== 0 || logged.stdout.trim().length === 0) {
    return refuse([
      `this ProjectOS installation commits no credential allowlist (${rel}), so it authorises no ` +
        'project to spend its credential',
    ]);
  }
  const dirty = sys.exec('git', ['-C', install, 'diff', '--name-only', 'HEAD', '--', rel]);
  if (dirty.code !== 0 || dirty.stdout.trim().length > 0) {
    return refuse([
      'the installation credential allowlist has been changed in the working tree; only the committed ' +
        'policy carries authority, and an edited one carries none',
    ]);
  }
  // `HEAD:./<rel>` — the pathspec above resolves against `-C install`, and `<rev>:<path>` would
  // otherwise resolve against the top of the working tree.
  const shown = sys.exec('git', ['-C', install, 'show', `HEAD:./${rel}`]);
  if (shown.code !== 0 || shown.stdout.trim().length === 0) {
    return refuse(['the committed installation credential allowlist could not be read']);
  }

  let entries: readonly Entry[];
  let policy: Record<string, unknown>;
  try {
    const parsed = JSON.parse(shown.stdout) as Record<string, unknown>;
    policy = parsed;
    const list = parsed['projects'];
    if (!Array.isArray(list)) return refuse(['the installation credential allowlist declares no projects list']);
    entries = list as readonly Entry[];
  } catch {
    return refuse(['the committed installation credential allowlist is not readable JSON']);
  }
  if (policy['schemaVersion'] !== '1.0.0') {
    return refuse([`the installation credential allowlist has schemaVersion ${JSON.stringify(policy['schemaVersion'])}, expected "1.0.0"`]);
  }

  const repository = canonicalRepositoryIdentity(sys, governedRoot);
  if (repository === null) {
    return refuse([
      'this checkout has no readable `origin` remote, so its canonical repository identity cannot be ' +
        'established; a project id alone is a string the project writes about itself',
    ]);
  }

  const problems: string[] = [];
  for (const entry of entries) {
    const id = typeof entry.projectId === 'string' ? entry.projectId : '';
    const repo = typeof entry.repository === 'string' ? entry.repository : '';
    // NO WILDCARDS, EVER. An allowlist that can say "all" is not an allowlist, and a policy file is
    // exactly where that shortcut would be taken under time pressure.
    if (id === '*' || repo === '*' || id.includes('*') || repo.includes('*')) {
      problems.push('the installation credential allowlist contains a wildcard entry, which it may never do');
      continue;
    }
    if (id === projectId && repo.toLowerCase() === repository.toLowerCase()) {
      return problems.length > 0
        ? refuse(problems, repository)
        : { allowed: true, reasons: [], repository };
    }
  }
  if (problems.length > 0) return refuse(problems, repository);

  return refuse(
    [
      `this ProjectOS installation does not authorise project '${projectId}' at ${repository} to spend ` +
        'its credential',
      `  the allowlist is ${rel} in the installation, and only a committed entry counts`,
    ],
    repository,
  );
}

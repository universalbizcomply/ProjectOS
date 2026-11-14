// Origin: original ProjectOS code
/**
 * The website blocklist, loaded from committed bytes only (PROJECTOS-PORT-RESEARCH1A, C16).
 *
 * THIS FILE READS NOTHING. It is handed a `CommittedRead`, which answers a repository path with the text at HEAD and
 * the commit it was read at, or null. A working-tree read has no commit to give, so it is refused: the blocklist
 * cannot be edited in place and trusted. The path is judged first, so a caller cannot pick other bytes with `..` or an
 * absolute path. The file is `{ "schema": 1, "enabled": true, "mode": "block" | "allow", "domains": [...] }` (`mode` may be left out and
 * is `block`), and the policy is judged whole by
 * the core: one bad rule, or a flag that is not exactly true or false, refuses the load, where upstream failed open.
 *
 * `CommittedRead` has the shape the model broker's agent half uses. It is written out here because a research file
 * importing the broker's module would break that module's rule that nothing outside it imports it.
 */

import { createWebsitePolicy, type WebsitePolicy } from '@projectos/core';

export interface CommittedRead {
  (path: string): { readonly text: string; readonly commit: string } | null;
}

export type PolicyLoad = { readonly ok: true; readonly policy: WebsitePolicy; readonly commit: string } | { readonly ok: false; readonly problems: readonly string[] };

const POLICY_PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\.json$/;
const COMMIT = /^[0-9a-f]{40}$/;
const POLICY_SCHEMA = 1;
const MAX_POLICY_BYTES = 1_000_000;

const pathProblem = (path: unknown): string | null =>
  typeof path === 'string' && POLICY_PATH.test(path) && !path.split('/').some((segment) => segment === '.' || segment === '..') ? null : `${JSON.stringify(path)} is not a repository path to a .json file`;

export function loadCommittedWebsitePolicy(params: { readonly read: CommittedRead; readonly path: string }): PolicyLoad {
  const bad = pathProblem(params.path);
  if (bad !== null) return { ok: false, problems: [bad] };
  let found: ReturnType<CommittedRead>;
  try {
    found = params.read(params.path);
  } catch {
    return { ok: false, problems: [`${params.path} could not be read`] };
  }
  if (found === null || found === undefined) return { ok: false, problems: [`${params.path} has no committed copy`] };
  if (typeof found.commit !== 'string' || !COMMIT.test(found.commit) || typeof found.text !== 'string') return { ok: false, problems: [`${params.path} was not read at a commit`] };
  if (found.text.length > MAX_POLICY_BYTES) return { ok: false, problems: [`${params.path} is longer than ${MAX_POLICY_BYTES} characters`] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(found.text);
  } catch {
    return { ok: false, problems: ['the website policy text is not JSON'] };
  }
  const row = parsed as { schema?: unknown; enabled?: unknown; domains?: unknown; mode?: unknown } | null;
  if (typeof row !== 'object' || row === null || row.schema !== POLICY_SCHEMA) return { ok: false, problems: [`the website policy is not schema ${POLICY_SCHEMA}`] };
  const made = createWebsitePolicy({ enabled: row.enabled, domains: row.domains, ...(row.mode === undefined ? {} : { mode: row.mode }) }, `${params.path}@${found.commit.slice(0, 12)}`);
  return made.ok ? { ok: true, policy: made.policy, commit: found.commit } : { ok: false, problems: made.problems };
}

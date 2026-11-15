// Origin: original ProjectOS code
/**
 * WHAT THE CONTEXT MANAGER MAY TOUCH, AS PORTS (PROJECTOS-CONTEXT-MANAGER1A, plan 3.4).
 *
 * Everything the manager reads arrives through one of these, so a test (and a caller that is not the CLI) supplies its own and
 * the manager reaches no process, no clock and no file system around them:
 *
 *   git            asks git, in the project's checkout, through the runtime's one bound `git` (`gitRunnerOver`).
 *   fs             looks at the working tree with an `lstat`; the committed reader refuses a copy that differs from HEAD.
 *   clock          the time in whole milliseconds.
 *   secretScreen   the agent's credential vocabulary, answering exactly `false` for "holds none".
 *   isProxy        whether a value is a Proxy: core imports no `node:` module and cannot ask.
 *   readMemoryStore the working-tree provenance records of a memory store (who approved each entry).
 *   openIndex      opens the search index of ONE tenant's ONE project, or null. The manager passes it the envelope's pair.
 *   checkout       what THIS checkout is governed as (tenant and project), from the installation's tenant registry. The envelope's
 *                  pair must equal it, or nothing is read (review round 1, item 3).
 *   registry       the action registry, when the caller has one; the taint rule asks it, and answers the same without it.
 *   window         the token window a context file is held to; a constant unless a test passes a smaller one.
 *   drafter        what writes a compaction draft; deterministic selection unless a test passes another.
 *
 * A port that is missing is a refusal, never a default: `portsProblem` names the first one that is not usable.
 */
import {
  type ActionRegistry,
  type CompactionPlan,
  type ContextWindow,
  type MemoryResult,
  type MemoryStoreState,
  type MemoryTarget,
  type SearchIndexOwner,
} from '@projectos/core';
import { types } from 'node:util';
import { storedTextSecretScreen } from './contextScreen.js';
import { resumeNodeLinkCount } from './resumeNode.js';
import { readMemoryStore } from '../memory/memoryFiles.js';
import { nodeEntryProbe } from '../search/nodeHost.js';
import { documentFsOver, gitRunnerOver, searchClockOver, searchHeadOver, type DocumentFs, type GitRunner, type SearchClock } from '../search/ports.js';
import { nodeEnsureDirectory } from '../search/nodeHost.js';
import { openProjectSearchIndex, projectIndexLocation } from '../search/projectIndex.js';
import type { SearchIndex } from '../search/localIndex.js';
import type { System } from '../system.js';

/** What a compaction draft offers. `complete` is the question a partial summary fails; `stopReason` names why a model stopped. */
export interface ContextDraftOffer {
  readonly text: string;
  readonly complete?: boolean;
  readonly stopReason?: string;
}

/** What a checkout is governed as. */
export interface ContextCheckoutIdentity {
  readonly tenant: string;
  readonly project: string;
}

/** Why the installation could not say what a checkout is governed as, so the refusal can name the fix that belongs to that cause. */
export interface ContextCheckoutProblem {
  readonly cause: 'no-project-config' | 'registry-unreadable' | 'not-registered';
  /** The kernel's closed refusal code, when it gave one. */
  readonly code?: string;
}

export interface ContextManagerPorts {
  readonly git: GitRunner;
  readonly fs: DocumentFs;
  readonly clock: SearchClock;
  readonly secretScreen: (text: string) => boolean;
  readonly isProxy: (value: unknown) => boolean;
  readonly readMemoryStore: (target: MemoryTarget) => MemoryResult<MemoryStoreState>;
  /** The tenant and project this checkout is governed as, or why the installation cannot say (null says nothing). Anything but an identity refuses the run. */
  readonly checkout: () => ContextCheckoutIdentity | ContextCheckoutProblem | null;
  readonly openIndex: ((owner: SearchIndexOwner) => SearchIndex | null) | null;
  readonly registry: ActionRegistry | null;
  readonly window?: ContextWindow;
  readonly drafter?: (plan: CompactionPlan) => ContextDraftOffer;
  /** How many names a file has (PROJECTOS-RESUME1A), or null. Absent counts as one. A changed path with a second name is refused. */
  readonly linkCount?: (path: string) => number | null;
}

const isFunction = (value: unknown): boolean => typeof value === 'function';

/** The first port that cannot be used, or null. A missing port refuses: nothing is guessed in its place. */
export function portsProblem(ports: Partial<ContextManagerPorts> | null | undefined): string | null {
  if (ports === null || ports === undefined || typeof ports !== 'object') return 'ports';
  if (!isFunction(ports.git)) return 'git';
  if (ports.fs === undefined || ports.fs === null || !isFunction(ports.fs.readText) || !isFunction(ports.fs.listDir) || !isFunction(ports.fs.stat)) return 'fs';
  if (ports.clock === undefined || ports.clock === null || !isFunction(ports.clock.nowMs)) return 'clock';
  if (!isFunction(ports.secretScreen)) return 'secretScreen';
  if (!isFunction(ports.isProxy)) return 'isProxy';
  if (!isFunction(ports.readMemoryStore)) return 'readMemoryStore';
  if (!isFunction(ports.checkout)) return 'checkout';
  if (ports.openIndex !== null && !isFunction(ports.openIndex)) return 'openIndex';
  return null;
}

/** Where the per-project index files live, or null when the installation gives no state directory. */
export type ContextIndexDirectory = () => string | null;

/**
 * The ports of a real run. The index directory is the installation's, supplied by the caller: the project's own tree is where
 * a worker writes, so an index kept there could be replaced by one.
 */
export function nodeContextPorts(sys: System, root: string, indexDirectory: ContextIndexDirectory, checkout: () => ContextCheckoutIdentity | ContextCheckoutProblem | null): ContextManagerPorts {
  const git = gitRunnerOver(sys, root);
  const clock = searchClockOver(sys);
  return {
    git,
    fs: documentFsOver(sys, nodeEntryProbe),
    clock,
    secretScreen: storedTextSecretScreen,
    isProxy: (value) => types.isProxy(value),
    readMemoryStore: (target) => readMemoryStore(sys, root, target),
    checkout,
    openIndex: (owner) => {
      const directory = indexDirectory();
      if (directory === null) return null;
      // An index nobody built is not made here: opening one would write an empty file under the installation for nothing.
      const where = projectIndexLocation(directory, owner);
      if (!where.ok || !sys.exists(where.location)) return null;
      const opened = openProjectSearchIndex(directory, owner, { clock, ensureDirectory: nodeEnsureDirectory, head: searchHeadOver(git) });
      return opened.ok ? opened.index : null;
    },
    registry: null,
    linkCount: resumeNodeLinkCount,
  };
}

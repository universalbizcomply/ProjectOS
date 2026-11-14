// Origin: original ProjectOS code
/**
 * THE RUN'S HANDLE ON ITS STORED CONTEXT (PROJECTOS-CONTEXT-MANAGER1A, plan 3.4).
 *
 * `prepareRunContext` reads and writes nothing: it asks the manager what this run may be shown and returns a handle. The loop
 * then does three things with it, in this order, and each is a separate call so the loop's own ordering stays visible:
 *
 *   `record()`      append the retrieval to the ledger. No record, no file: the loop refuses the run if this fails.
 *   `place(n)`      before dispatch number n: write the context file from the handle's own copy (so what a worker did to the file
 *                   during an earlier attempt is gone), read it back, and record the placement. A file that cannot be recorded
 *                   is removed.
 *   `retire()`      as soon as the worker returns: remove the file. It is never in the changed paths the checks judge and never
 *                   in the candidate, because it is not there when either is asked. The ledger and the evidence are the record.
 *
 * The context file's path is derived from the brief's own path (the same rule `briefProvenanceProblems` holds the brief to), so
 * there is one derivation and a worker names none of it.
 *
 * WHAT THIS DOES NOT DO: it starts no worker, decides no stop, and writes nothing a worker reads except the one file.
 *
 * THE LEDGER IS NOT IN THE PROJECT TREE (review round 1, item 1). It lives under the INSTALLATION'S state directory
 * (`<state>/context-ledger/ledger-<hash of tenant and project>/`), the same place the spend ledger and the platform stop live. In the
 * tree it was an untracked file that git does not ignore and that `isFoldableRunRecord` (PROTECTED, `run.ts`) does not know, so every
 * governed project's next closure would have refused for "uncommitted changes that are not run-records", and the ledger would have been
 * part of the candidate. Outside the tree it leaves `git status` clean, and a worker (which holds write grants to named files inside
 * the project and nothing in the installation) cannot reach it: that is how far this goes toward a ledger whose whole directory is
 * deleted, and no further, since the owner and anything with the user's rights can still delete it, and a head hash kept elsewhere
 * is what would find that.
 *
 * NOTHING STORED, NO FILE. A run whose retrieval holds no item and no decision records the retrieval and places no file; the brief
 * names none (`hasContent`).
 *
 * PLACEMENT IS HYGIENIC. A file left by a killed earlier run is swept before the new one is created, the new one is created with a
 * create-if-absent write (which does not follow a link or a hard link that someone put there), and the envelope's expiry is asked again.
 */
import { briefPath, isSafeSessionId } from '../loop/session.js';
import { contextRetrievalKeyOf, sha256Hex, type ContextLedgerBody, type ContextLedgerDecision, type ContextLedgerItem, type ContextLedgerWithheld } from '@projectos/core';
import { appendContextLedger, contextLedgerRepairOf } from './contextLedger.js';
import { assembleRunContext, type RunContextRequest } from './contextManager.js';
import type { ContextManagerPorts } from './contextPorts.js';

/** What the run touches. A real `System` has all of it. */
export interface ContextRunSystem {
  now(): string;
  readText(path: string): string | null;
  writeText(path: string, content: string): void;
  exists(path: string): boolean;
  listDir(path: string): readonly string[];
  createExclusive(path: string, content: string): boolean;
  removeFile(path: string): boolean;
}

export interface PrepareRunContextInput {
  /** `admittedRunEnvelopeOf(ctx)`. */
  readonly envelope: unknown;
  readonly sessionId: string;
  readonly query: string;
  readonly dependsOn: readonly string[];
  readonly planMemoryPaths: readonly string[];
  readonly ports: ContextManagerPorts;
  /** The installation's state directory, where the ledger lives. Null when the installation gives none, which refuses the run. */
  readonly ledgerRoot: string | null;
}

/** What the run evidence says about the stored text the worker was shown. */
export interface StoredContextEvidence {
  readonly schema: 'projectos.stored-context/1';
  /** Relative to the project root. */
  readonly contextPath: string;
  readonly tenant: string;
  readonly domain: string;
  readonly project: string;
  readonly envelopeId: string;
  readonly headCommit: string;
  /** The ledger entry that recorded the retrieval, or null before it is recorded. */
  readonly ledger: { readonly seq: number; readonly entryHash: string } | null;
  /** The NEWEST entry the run wrote, so a ledger whose tail was cut after the run is seen. Null before anything is recorded. */
  readonly ledgerNewest: { readonly seq: number; readonly entryHash: string } | null;
  /** The hash of the file as placed, or null when nothing was stored and no file was placed. */
  readonly fileHash: string | null;
  readonly shown: readonly ContextLedgerItem[];
  readonly withheld: readonly ContextLedgerWithheld[];
  readonly omitted: readonly string[];
  readonly decisions: readonly ContextLedgerDecision[];
  readonly compactor: 'none' | 'deterministic-selection';
  readonly compactionId: string | null;
  readonly estimatedTokens: number;
  readonly taintsRun: boolean;
  /** The dispatches the file was placed for, in order. */
  readonly placedAttempts: readonly number[];
}

export type StepResult = { readonly ok: true } | { readonly ok: false; readonly detail: string };

export interface RunContext {
  /** The file the brief names. Absolute, in `.projectops/execution/`. */
  readonly contextPath: string;
  /** False when nothing is stored for this run: no file is placed, and the brief names none. */
  readonly hasContent: boolean;
  /** What the owner can do about what was withheld; printed with the run's other lines. */
  readonly advice: readonly string[];
  record(): StepResult;
  place(attempt: number): StepResult;
  retire(): StepResult;
  evidence(): StoredContextEvidence;
}

export type PrepareRunContext =
  | { readonly kind: 'none' }
  | { readonly kind: 'refused'; readonly lines: readonly string[] }
  | { readonly kind: 'ready'; readonly run: RunContext };

/** A rooted path: `/x`, `C:/x`, `C:\\x` or a UNC share. A relative one would put the ledger under whatever directory the process happens to stand in. */
export const isAbsoluteRoot = (path: unknown): path is string => typeof path === 'string' && /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(path);

/** The names a killed run leaves in the execution directory: exactly `<session id>.context.md`, and no other shape. */
const CONTEXT_FILE_NAME = /^[A-Za-z0-9_.-]{1,64}\.context\.md$/;

/**
 * Where one tenant's one project's ledger lives under the installation's state directory. The name is a hash of the pair, so no id
 * reaches a path and two projects never share a chain.
 */
export function contextLedgerDirectoryOf(ledgerRoot: string, tenant: string, project: string): string {
  if (!isAbsoluteRoot(ledgerRoot)) throw new Error('the ledger root is not an absolute path');
  const base = ledgerRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  return `${base}/context-ledger/ledger-${sha256Hex(JSON.stringify([tenant, project])).slice(0, 32)}`;
}
/** The one derivation of the context file's path: the brief's own path, read as the context file. `brief.ts` holds the brief to it. */
export const contextPathOf = (root: string, sessionId: string): string => briefPath(root, sessionId).replace(/\.brief\.json$/, '.context.md');
const refusalLines = (code: string, message: string): readonly string[] => [`REFUSED (${code}): ${message}`];

/** The time as `toISOString` writes it, which is the one spelling the envelope's expiry is compared in. A time that cannot be read stays as it is, and the key refuses it. */
function instantOf(now: string): string {
  const at = Date.parse(now);
  return Number.isNaN(at) ? now : new Date(at).toISOString();
}

/** A refusal that knows whose run it was is recorded, best effort: a ledger that is down must not hide why the run stopped. */
function recordRefusal(sys: ContextRunSystem, directory: string, request: RunContextRequest, code: string, key: { tenant: string; domain: string; project: string; envelopeId: string }): void {
  const body = {
    event: 'refused', sessionId: request.sessionId, tenant: key.tenant, domain: key.domain, project: key.project, envelopeId: key.envelopeId,
    headCommit: null, at: sys.now(), attempt: null, shown: [], withheld: [], omitted: [], decisions: [], compactor: 'none', compactionId: null,
    estimatedTokens: 0, taintsRun: false, fileHash: null, refusal: /^[A-Z][A-Z0-9_]{2,63}$/.test(code) ? code : 'CONTEXT_MANAGER_REFUSED',
  } as unknown as ContextLedgerBody;
  appendContextLedger(sys, directory, body);
}

/** Ask the manager what this run may be shown. Reads only, and the handle writes nothing until the loop says so. */
export function prepareRunContext(sys: ContextRunSystem, root: string, input: PrepareRunContextInput): PrepareRunContext {
  if (input.envelope === null || input.envelope === undefined) return { kind: 'none' };
  if (typeof input.sessionId !== 'string' || !isSafeSessionId(input.sessionId)) return { kind: 'refused', lines: refusalLines('CONTEXT_MANAGER_SESSION_INVALID', 'The session id does not make a safe file name, so no context file can be named.') };
  if (!isAbsoluteRoot(input.ledgerRoot)) {
    return {
      kind: 'refused',
      lines: refusalLines(
        'CONTEXT_NOT_RECORDED',
        'the installation gives no absolute state directory, so the retrieval cannot be recorded and no stored text is shown to a worker. Fix: the owner makes the installation state location available to the user who runs ProjectOS (LOCALAPPDATA on Windows, XDG_STATE_HOME or HOME elsewhere), then runs again.',
      ),
    };
  }
  const ledgerRoot = input.ledgerRoot;
  const request: RunContextRequest = { envelope: input.envelope, sessionId: input.sessionId, root, query: input.query, dependsOn: input.dependsOn, planMemoryPaths: input.planMemoryPaths, nowIso: instantOf(sys.now()) };
  const result = assembleRunContext(input.ports, request);
  if (result.kind === 'none') return { kind: 'none' };
  if (result.kind === 'refused') {
    if (result.key !== null) recordRefusal(sys, contextLedgerDirectoryOf(ledgerRoot, result.key.tenant, result.key.project), request, result.code, result.key);
    return { kind: 'refused', lines: refusalLines(result.code, result.message) };
  }

  const contextPath = contextPathOf(root, input.sessionId);
  const directory = contextLedgerDirectoryOf(ledgerRoot, result.key.tenant, result.key.project);
  const base = {
    sessionId: input.sessionId,
    tenant: result.key.tenant,
    domain: result.key.domain,
    project: result.key.project,
    envelopeId: result.key.envelopeId,
    headCommit: result.headCommit,
    shown: result.shown,
    withheld: result.withheld,
    omitted: result.omitted,
    decisions: result.decisions,
    compactor: result.compactor,
    compactionId: result.compactionId,
    estimatedTokens: result.estimatedTokens,
    taintsRun: result.taintsRun,
    fileHash: result.hasContent ? result.fileHash : null,
    refusal: null,
  } as const;
  let recorded: { readonly seq: number; readonly entryHash: string } | null = null;
  let newest: { readonly seq: number; readonly entryHash: string } | null = null;
  const placed: number[] = [];

  const append = (event: 'retrieved' | 'placed', attempt: number | null): StepResult & { entry?: { seq: number; entryHash: string } } => {
    const appended = appendContextLedger(sys, directory, { ...base, event, attempt, at: sys.now() } as ContextLedgerBody);
    if (!appended.ok) return { ok: false, detail: `the retrieval ledger refused the entry (${appended.code}). ${contextLedgerRepairOf(appended.code, directory)}` };
    newest = { seq: appended.entry.seq, entryHash: appended.entry.entryHash };
    return { ok: true, entry: newest };
  };

  // A run that was killed never retired its file, and an untracked file here is one the owner's records commit refuses. Only a regular file named
  // exactly `<session id>.context.md` goes, never this session's own (placement sweeps that), and never a link, a directory or any other name.
  const executionDirectory = contextPath.slice(0, contextPath.lastIndexOf('/'));
  const ownName = contextPath.slice(contextPath.lastIndexOf('/') + 1);
  const sweepStaleContextFiles = (): void => {
    try {
      for (const name of sys.listDir(executionDirectory)) {
        if (name === ownName || !CONTEXT_FILE_NAME.test(name)) continue;
        const where = `${executionDirectory}/${name}`;
        if (input.ports.fs.stat(where)?.kind === 'file') sys.removeFile(where);
      }
    } catch {
      // a directory that cannot be listed leaves nothing to sweep; the records commit says what it finds
    }
  };
  const run: RunContext = {
    contextPath,
    hasContent: result.hasContent,
    advice: result.advice,
    record() {
      if (recorded !== null) return { ok: true };
      sweepStaleContextFiles();
      const done = append('retrieved', null);
      if (!done.ok || done.entry === undefined) return { ok: false, detail: done.ok ? 'the retrieval was not recorded' : done.detail };
      recorded = done.entry;
      return { ok: true };
    },
    place(attempt) {
      if (recorded === null) return { ok: false, detail: 'the retrieval is not recorded, so no context file is placed' };
      if (!Number.isSafeInteger(attempt) || attempt < 1) return { ok: false, detail: 'the dispatch number is not a count' };
      if (!result.hasContent) return { ok: true };
      // The envelope is asked again at every placement: a run that outlives its envelope is not shown stored text.
      if (!contextRetrievalKeyOf(input.envelope, input.ports.isProxy, instantOf(sys.now())).ok) return { ok: false, detail: 'the run envelope has expired, so no stored text is placed. Fix: the owner starts a new run.' };
      try {
        // A file left by a killed earlier run is swept; the new one is created if absent, which does not follow a link or a hard link.
        sys.removeFile(contextPath);
        if (!sys.createExclusive(contextPath, result.fileText)) return { ok: false, detail: 'the context file could not be created, because something else holds that name. Fix: the owner removes it from the project tree and runs again.' };
        if (sys.readText(contextPath) !== result.fileText) {
          sys.removeFile(contextPath);
          return { ok: false, detail: 'the context file could not be read back as it was written' };
        }
      } catch {
        sys.removeFile(contextPath);
        return { ok: false, detail: 'the context file could not be written' };
      }
      const done = append('placed', attempt);
      if (!done.ok) {
        sys.removeFile(contextPath);
        return done;
      }
      placed.push(attempt);
      return { ok: true };
    },
    retire() {
      try {
        sys.removeFile(contextPath);
      } catch {
        // judged by whether it is still there
      }
      return sys.exists(contextPath) ? { ok: false, detail: 'the context file is still there after it was removed' } : { ok: true };
    },
    evidence() {
      return {
        schema: 'projectos.stored-context/1',
        contextPath: contextPath.startsWith(`${root}/`) ? contextPath.slice(root.length + 1) : contextPath,
        tenant: base.tenant,
        domain: base.domain,
        project: base.project,
        envelopeId: base.envelopeId,
        headCommit: base.headCommit,
        ledger: recorded,
        ledgerNewest: newest,
        fileHash: base.fileHash,
        shown: base.shown,
        withheld: base.withheld,
        omitted: base.omitted,
        decisions: base.decisions,
        compactor: base.compactor,
        compactionId: base.compactionId,
        estimatedTokens: base.estimatedTokens,
        taintsRun: base.taintsRun,
        placedAttempts: [...placed],
      };
    },
  };
  return { kind: 'ready', run };
}

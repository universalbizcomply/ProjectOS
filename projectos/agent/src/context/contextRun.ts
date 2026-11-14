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
 * WHAT THIS DOES NOT DO: it starts no worker, decides no stop, and writes nothing a worker reads except the one file. The ledger
 * is `.projectops/context-ledger/`; the loop writes it and nothing else does.
 */
import { join } from '../context.js';
import { briefPath, isSafeSessionId } from '../loop/session.js';
import type { ContextLedgerBody, ContextLedgerDecision, ContextLedgerItem, ContextLedgerWithheld } from '@projectos/core';
import { appendContextLedger } from './contextLedger.js';
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
  readonly fileHash: string;
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
  record(): StepResult;
  place(attempt: number): StepResult;
  retire(): StepResult;
  evidence(): StoredContextEvidence;
}

export type PrepareRunContext =
  | { readonly kind: 'none' }
  | { readonly kind: 'refused'; readonly lines: readonly string[] }
  | { readonly kind: 'ready'; readonly run: RunContext };

const ledgerDirectory = (root: string): string => join(root, '.projectops', 'context-ledger');
/** The one derivation of the context file's path: the brief's own path, read as the context file. `brief.ts` holds the brief to it. */
export const contextPathOf = (root: string, sessionId: string): string => briefPath(root, sessionId).replace(/\.brief\.json$/, '.context.md');
const refusalLines = (code: string, message: string): readonly string[] => [`REFUSED (${code}): ${message}`];

/** The time as `toISOString` writes it, which is the one spelling the envelope's expiry is compared in. A time that cannot be read stays as it is, and the key refuses it. */
function instantOf(now: string): string {
  const at = Date.parse(now);
  return Number.isNaN(at) ? now : new Date(at).toISOString();
}

/** A refusal that knows whose run it was is recorded, best effort: a ledger that is down must not hide why the run stopped. */
function recordRefusal(sys: ContextRunSystem, root: string, request: RunContextRequest, code: string, key: { tenant: string; domain: string; project: string; envelopeId: string }): void {
  const body = {
    event: 'refused', sessionId: request.sessionId, tenant: key.tenant, domain: key.domain, project: key.project, envelopeId: key.envelopeId,
    headCommit: null, at: sys.now(), attempt: null, shown: [], withheld: [], omitted: [], decisions: [], compactor: 'none', compactionId: null,
    estimatedTokens: 0, taintsRun: false, fileHash: null, refusal: /^[A-Z][A-Z0-9_]{2,63}$/.test(code) ? code : 'CONTEXT_MANAGER_REFUSED',
  } as unknown as ContextLedgerBody;
  appendContextLedger(sys, ledgerDirectory(root), body);
}

/** Ask the manager what this run may be shown. Reads only, and the handle writes nothing until the loop says so. */
export function prepareRunContext(sys: ContextRunSystem, root: string, input: PrepareRunContextInput): PrepareRunContext {
  if (input.envelope === null || input.envelope === undefined) return { kind: 'none' };
  if (typeof input.sessionId !== 'string' || !isSafeSessionId(input.sessionId)) return { kind: 'refused', lines: refusalLines('CONTEXT_MANAGER_SESSION_INVALID', 'The session id does not make a safe file name, so no context file can be named.') };
  const request: RunContextRequest = { envelope: input.envelope, sessionId: input.sessionId, root, query: input.query, dependsOn: input.dependsOn, planMemoryPaths: input.planMemoryPaths, nowIso: instantOf(sys.now()) };
  const result = assembleRunContext(input.ports, request);
  if (result.kind === 'none') return { kind: 'none' };
  if (result.kind === 'refused') {
    if (result.key !== null) recordRefusal(sys, root, request, result.code, result.key);
    return { kind: 'refused', lines: refusalLines(result.code, result.message) };
  }

  const contextPath = contextPathOf(root, input.sessionId);
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
    fileHash: result.fileHash,
    refusal: null,
  } as const;
  let recorded: { readonly seq: number; readonly entryHash: string } | null = null;
  const placed: number[] = [];

  const append = (event: 'retrieved' | 'placed', attempt: number | null): StepResult & { entry?: { seq: number; entryHash: string } } => {
    const appended = appendContextLedger(sys, ledgerDirectory(root), { ...base, event, attempt, at: sys.now() } as ContextLedgerBody);
    return appended.ok ? { ok: true, entry: { seq: appended.entry.seq, entryHash: appended.entry.entryHash } } : { ok: false, detail: `the retrieval ledger refused the entry (${appended.code})` };
  };

  const run: RunContext = {
    contextPath,
    record() {
      if (recorded !== null) return { ok: true };
      const done = append('retrieved', null);
      if (!done.ok || done.entry === undefined) return { ok: false, detail: done.ok ? 'the retrieval was not recorded' : done.detail };
      recorded = done.entry;
      return { ok: true };
    },
    place(attempt) {
      if (recorded === null) return { ok: false, detail: 'the retrieval is not recorded, so no context file is placed' };
      if (!Number.isSafeInteger(attempt) || attempt < 1) return { ok: false, detail: 'the dispatch number is not a count' };
      try {
        sys.writeText(contextPath, result.fileText);
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

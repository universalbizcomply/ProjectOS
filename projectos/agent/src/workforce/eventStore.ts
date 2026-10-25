/**
 * The workforce event log: append-only, hash-chained, written only by ProjectOS code.
 *
 * Every selection, grant, refusal, dispatch, result, fallback and leader decision is one event,
 * written HERE at the point where it happens — never by the leader session, which holds no handle to
 * this store (the engine interfaces in `engines.ts` receive data, not a `System`). Each event carries
 * the governed project, the leader generation, the digest of the event before it and its own digest,
 * so a changed, removed or reordered event breaks the chain, and `head.json` records the last digest,
 * so a truncated tail is detected too.
 *
 * BOUNDED. A log longer than the governance-owned `projection.maxEvents` is REFUSED and escalated,
 * never truncated: a leader rebuilt from half its history would act on a history that did not happen.
 *
 * OUTSIDE THE GOVERNED CHECKOUT. The store lives under the per-user installation state directory
 * (`workforceStateRoot` in `orchestrator.ts`), beside the degraded-mode ledger, keyed by repository and
 * project — never in the working tree a worker can write, where deleting three files would mint a fresh
 * leader with a spent ceiling reset to zero. The residual is the degraded ledger's: a process with the
 * user's own file access can still reach it.
 */
import type { System } from '../system.js';
import { canonicalJson, digestOf, PREFIXED_DIGEST } from './canonical.js';

export const EVENT_SCHEMA = 'projectos.workforce-event.v1';
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** One event, serialised, may not exceed this; a larger one is refused, never truncated. */
export const MAX_EVENT_BYTES = 256 * 1024;
/** The whole log may not exceed this (every append rewrites it); past it the store refuses and escalates. */
export const MAX_LOG_BYTES = 32 * 1024 * 1024;

/** A project id that makes a safe record name. Governance refuses any other at the accepted commit. */
export const isSafeProjectId = (id: string): boolean => PROJECT_ID.test(id);

export type WorkforceEventType =
  | 'leader-minted'
  | 'leader-takeover'
  | 'leader-lease-renewed'
  | 'objective-set'
  | 'facts-derived'
  | 'team-selected'
  | 'selection-refused'
  | 'grant-issued'
  | 'dispatch-refused'
  | 'task-dispatched'
  | 'result-recorded'
  | 'result-rejected'
  | 'task-failed'
  | 'task-escalated'
  | 'fallback-applied'
  | 'contradiction-recorded'
  | 'contradiction-resolved'
  | 'contradiction-escalated'
  | 'assignment-completed'
  | 'leader-decision-recorded'
  | 'leader-decision-refused'
  | 'dependency-declared'
  | 'evidence-recorded'
  | 'owner-decision-required'
  | 'panel-declared'
  | 'panel-refused'
  | 'leader-consulted'
  | 'governance-disagreement';

export interface WorkforceEvent {
  readonly schema: typeof EVENT_SCHEMA;
  readonly seq: number;
  readonly at: string;
  readonly projectId: string;
  readonly generation: number;
  readonly type: WorkforceEventType;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly prevDigest: string | null;
  readonly digest: string;
}

/** A refusal raised inside the workforce and returned — never swallowed — at its public edge. */
export class WorkforceRefusal extends Error {
  constructor(
    readonly code: string,
    readonly reason: string,
    readonly escalate = false,
  ) {
    super(`${code}: ${reason}`);
  }
}

export interface StorePaths {
  readonly dir: string;
  readonly events: string;
  readonly head: string;
  readonly lock: string;
  readonly leader: string;
}

export function storePaths(stateRoot: string, projectId: string): StorePaths {
  if (!PROJECT_ID.test(projectId)) throw new WorkforceRefusal('UNSAFE_PROJECT_ID', `'${projectId}' does not make a safe record name`);
  const dir = `${stateRoot.replace(/[\\/]+$/, '')}/${projectId}`;
  return { dir, events: `${dir}/events.jsonl`, head: `${dir}/head.json`, lock: `${dir}/store.lock`, leader: `${dir}/leader.json` };
}

function eventDigest(e: Omit<WorkforceEvent, 'digest'>): string {
  return digestOf(e);
}

export class WorkforceStore {
  readonly paths: StorePaths;
  private held = false;

  constructor(
    readonly sys: System,
    readonly stateRoot: string,
    readonly projectId: string,
    readonly maxEvents: number,
  ) {
    this.paths = storePaths(stateRoot, projectId);
  }

  /**
   * Run `fn` holding the store's exclusive lock. The filesystem decides who holds it (`wx` create),
   * so two ProjectOS processes can never interleave an append or a takeover. A lock left by a crash
   * is NOT broken automatically: the store refuses and says so, because a broken lock is how a second
   * leader would be minted.
   */
  withLock<T>(fn: () => T): T {
    if (this.held) return fn();
    if (!this.sys.createExclusive(this.paths.lock, JSON.stringify({ pid: process.pid, at: this.sys.now() }))) {
      throw new WorkforceRefusal(
        'STORE_BUSY',
        `the workforce store for '${this.projectId}' is held by another ProjectOS process (or a crash left ${this.paths.lock}); ` +
          'refusing rather than acting beside it',
        true,
      );
    }
    this.held = true;
    try {
      return fn();
    } finally {
      this.held = false;
      this.sys.removeFile(this.paths.lock);
    }
  }

  /** Every event, verified end to end; refuses on any break in the chain or past the bound. */
  readVerified(): readonly WorkforceEvent[] {
    const text = this.sys.readText(this.paths.events);
    const headText = this.sys.readText(this.paths.head);
    if (text === null || text === '') {
      if (headText !== null) throw new WorkforceRefusal('LEDGER_TRUNCATED', 'head.json exists but the event log is missing', true);
      return [];
    }
    const lines = text.split('\n').filter((l) => l.length > 0);
    if (lines.length > this.maxEvents) {
      throw new WorkforceRefusal(
        'LEDGER_BOUND_EXCEEDED',
        `the event log holds ${lines.length} events; the governance bound is ${this.maxEvents}. Refusing to rebuild a truncated history — escalate to the owner`,
        true,
      );
    }
    const events: WorkforceEvent[] = [];
    let prev: string | null = null;
    for (const [i, line] of lines.entries()) {
      let e: WorkforceEvent;
      try {
        e = JSON.parse(line) as WorkforceEvent;
      } catch {
        throw new WorkforceRefusal('LEDGER_CORRUPT', `event ${i + 1} is not JSON`, true);
      }
      const { digest, ...body } = e;
      if (
        e.schema !== EVENT_SCHEMA ||
        e.seq !== i + 1 ||
        e.prevDigest !== prev ||
        e.projectId !== this.projectId ||
        !PREFIXED_DIGEST.test(String(digest)) ||
        eventDigest(body) !== digest
      ) {
        throw new WorkforceRefusal('LEDGER_CHAIN_BROKEN', `event ${i + 1} does not continue the chain (changed, removed or reordered)`, true);
      }
      events.push(e);
      prev = digest;
    }
    let head: { seq?: unknown; digest?: unknown } | null = null;
    try {
      head = headText === null ? null : (JSON.parse(headText) as { seq?: unknown; digest?: unknown });
    } catch {
      head = null;
    }
    const last = events[events.length - 1];
    if (head === null || last === undefined || head.seq !== last.seq || head.digest !== last.digest) {
      throw new WorkforceRefusal('LEDGER_TRUNCATED', 'head.json does not name the last event: the log was truncated or replaced', true);
    }
    return events;
  }

  /** Append one event. Must hold the lock. Returns the event as written. */
  append(type: WorkforceEventType, generation: number, payload: Readonly<Record<string, unknown>>): WorkforceEvent {
    if (!this.held) throw new WorkforceRefusal('STORE_NOT_LOCKED', 'an append was attempted without the store lock');
    const events = this.readVerified();
    if (events.length + 1 > this.maxEvents) {
      throw new WorkforceRefusal('LEDGER_BOUND_EXCEEDED', `appending would exceed the governance bound of ${this.maxEvents} events`, true);
    }
    const last = events[events.length - 1];
    const body: Omit<WorkforceEvent, 'digest'> = {
      schema: EVENT_SCHEMA,
      seq: events.length + 1,
      at: this.sys.now(),
      projectId: this.projectId,
      generation,
      type,
      payload: JSON.parse(canonicalJson(payload)) as Record<string, unknown>,
      prevDigest: last === undefined ? null : last.digest,
    };
    const event: WorkforceEvent = { ...body, digest: eventDigest(body) };
    const line = canonicalJson(event) + '\n';
    const lineBytes = Buffer.byteLength(line, 'utf8');
    if (lineBytes > MAX_EVENT_BYTES) {
      throw new WorkforceRefusal('EVENT_TOO_LARGE', `a '${type}' event of ${lineBytes} bytes exceeds the bound of ${MAX_EVENT_BYTES}; it is refused, never truncated`);
    }
    const existing = this.sys.readText(this.paths.events) ?? '';
    if (Buffer.byteLength(existing, 'utf8') + lineBytes > MAX_LOG_BYTES) {
      throw new WorkforceRefusal('LEDGER_BOUND_EXCEEDED', `appending would take the event log past ${MAX_LOG_BYTES} bytes; escalate to the owner`, true);
    }
    this.replace(this.paths.events, existing + line);
    this.replace(this.paths.head, canonicalJson({ seq: event.seq, digest: event.digest }));
    return event;
  }

  /** Write through a temporary file and a rename, so a reader never sees half a record. */
  replace(path: string, content: string): void {
    const tmp = `${path}.tmp-${process.pid}`;
    this.sys.writeText(tmp, content);
    if (!this.sys.renameFile(tmp, path)) {
      this.sys.removeFile(tmp);
      throw new WorkforceRefusal('STORE_WRITE_FAILED', `could not move ${tmp} into place`, true);
    }
  }
}

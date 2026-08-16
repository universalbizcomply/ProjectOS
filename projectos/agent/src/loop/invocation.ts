/**
 * WHAT STARTED THIS WORKER.
 *
 * ProjectOS recorded which worker it started, the brief it was given and everything that happened
 * afterwards — but nothing about the invocation that started it. When a real Claude worker ran
 * against Dead Aisle on 2026-08-16 at 18:02:11Z, the session record could say the run was governed
 * and correct in every respect and still not answer the only question that mattered: WHO RAN IT.
 * Every other source was silent too, so the execution stayed unattributable. Windows process-creation
 * auditing would have answered it, but a governance system should not need the operating system's
 * audit policy switched on to know what it did itself.
 *
 * So a live run now writes this record BEFORE it spawns anything, and the session and the evidence
 * both carry its id. The chain a reviewer can follow afterwards is:
 *
 *     explicit `--execute` → invocation record → spawn → providerRef → session → evidence
 *
 * WHAT THIS DOES NOT ESTABLISH. It records the PROCESS that invoked ProjectOS: pid, parent pid, the
 * redacted command line and the working directory. It does not identify the human behind the
 * terminal, and no field here should ever be read as doing so. A parent pid names a process that may
 * be gone by the time anyone looks; it narrows an investigation, it does not close one.
 *
 * NO ENVIRONMENT VARIABLES, EVER. The environment is where credentials live, and a record written to
 * govern a run must not become the place they leak. Argv is captured because it is the invocation,
 * but it goes through the same credential-shaped redaction the worker arguments already use.
 *
 * Created in PROJECTOS-PHASE6-WORKER-PROVENANCE1A.
 */
import { createHash } from 'node:crypto';

import type { System } from '../system.js';
import { join } from '../context.js';
import { executionDir, assertSafeSessionId } from './session.js';

export const INVOCATION_SCHEMA_VERSION = '1.0.0';

/**
 * Argument shapes that must never be written down verbatim.
 *
 * Deliberately the same test the worker seam already applies to the arguments it refuses to pass on
 * — one rule, so a value the loop would not hand to a worker is also a value it will not record.
 */
const CREDENTIAL_SHAPED = /(api[_-]?key|token|secret|password|bearer)/i;

/** The redaction marker. Fixed text, so a reader can tell removal from an empty argument. */
export const REDACTED = '<redacted>';

/** The facts about the process that invoked ProjectOS. Injected so a test can be deterministic. */
export interface InvocationFacts {
  readonly pid: number;
  readonly ppid: number;
  readonly argv: readonly string[];
  readonly cwd: string;
}

export interface InvocationRecord {
  readonly schemaVersion: string;
  readonly invocationId: string;
  readonly createdAt: string;
  readonly projectId: string;
  readonly phaseId: string;
  readonly sessionId: string;
  readonly repository: {
    readonly root: string;
    readonly branch: string | null;
    readonly head: string | null;
  };
  /** Always `live`. A prepare-only run writes no invocation record because it spawns nothing. */
  readonly executionMode: 'live';
  readonly process: {
    readonly pid: number;
    readonly ppid: number;
    /** Credential-shaped arguments replaced, never the raw value. */
    readonly argv: readonly string[];
    readonly cwd: string;
  };
  readonly workerId: string;
  readonly workerKind: string;
  readonly brief: {
    readonly path: string;
    readonly briefId: string;
    readonly digest: string;
  };
}

export function invocationPath(root: string, sessionId: string): string {
  return join(executionDir(root), `${assertSafeSessionId(sessionId)}.invocation.json`);
}

/**
 * Redact credential-shaped arguments.
 *
 * Both halves of a `--flag value` pair go, because the flag NAME is what identifies the value: a
 * bare `--api-key` followed by an unremarkable-looking string would otherwise keep the string.
 */
export function redactArgv(argv: readonly string[]): readonly string[] {
  const out: string[] = [];
  let redactNext = false;
  for (const arg of argv) {
    if (redactNext) {
      out.push(REDACTED);
      redactNext = false;
      continue;
    }
    if (CREDENTIAL_SHAPED.test(arg)) {
      // `--token=abc` carries the value in the same argument; `--token abc` carries it in the next.
      out.push(arg.includes('=') ? `${arg.slice(0, arg.indexOf('='))}=${REDACTED}` : arg);
      redactNext = !arg.includes('=');
      continue;
    }
    out.push(arg);
  }
  return out;
}

/** A short, stable id for one invocation. Derived, so two runs of one session are distinguishable. */
export function invocationIdFor(sessionId: string, createdAt: string, pid: number): string {
  return createHash('sha256').update(`${sessionId}\n${createdAt}\n${pid}`).digest('hex').slice(0, 16);
}

export function digestOf(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

/** Write the record. Returns it, so the caller can bind the id into the session and the evidence. */
export function writeInvocation(sys: System, root: string, record: InvocationRecord): InvocationRecord {
  sys.writeText(invocationPath(root, record.sessionId), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

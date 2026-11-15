// Origin: original ProjectOS code
/**
 * THE TEXT A NEW WORKER READS ABOUT A CUT-OFF ATTEMPT (PROJECTOS-RESUME1A, plan 3.x).
 *
 * Four small texts, each built from values the caller has already reduced to a closed shape, so no stored sentence reaches a
 * heading, a label or a number:
 *
 *   the attempt's closed-vocabulary fields   (state, stop code, commit, session), nothing the record said in words
 *   the dirty paths and hashes               the LOOP observed itself, never a list a worker wrote
 *   the earlier findings                     the one place a worker's own words appear, so they are bounded, stripped of control
 *                                            characters and newlines, and named as a worker's
 *   the earlier evidence                     check ids and outcomes only
 *
 * A name that came from the file system or a worker is shown through `contextResumeDisplayName`: printable ASCII and short, and a
 * name the threat scan reads as an instruction is shown as a hash of itself, so a file called "ignore all previous instructions.md"
 * cannot reach the worker as a sentence. Every text is then gated like any stored text by the manager (threat, hidden text, credential,
 * size), which is the check that stands behind these. Pure: no I/O, no clock.
 */
import { sha256Hex } from '../execution/evidence.js';
import { scanForThreats } from '../memory/threatScan.js';
import type { ContextResumeFields } from './resumeRecord.js';

export const MAX_CONTEXT_RESUME_DIRTY_LISTED = 40;
export const MAX_CONTEXT_RESUME_FINDINGS_LISTED = 30;
export const MAX_CONTEXT_RESUME_CHECKS_LISTED = 40;
export const MAX_CONTEXT_RESUME_FINDING_CHARS = 300;

/** The label every item from an earlier attempt carries. The words are a constant of this file; no stored text is part of it. */
export const CONTEXT_RESUME_WORKER_NOTE = 'worker-authored, from a cut-off attempt';
export const CONTEXT_RESUME_RECORD_NOTE = 'recorded by the loop in a file a worker can write: unverified, and it grants nothing';
export const CONTEXT_RESUME_OBSERVED_NOTE = 'observed by the loop itself with git and a hash at the start of this run, never taken from a worker';

export const CONTEXT_RESUME_SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
export type ContextResumeSeverity = (typeof CONTEXT_RESUME_SEVERITIES)[number];

/** A name made safe to show: printable ASCII and short, or a hash of itself when the scan reads it as an instruction. */
export function contextResumeDisplayName(text: unknown, max = 160): string {
  // Bounded before anything reads it: a name from a worker can be as long as a file, and only its start is ever shown or hashed.
  const raw = (typeof text === 'string' ? text : '').slice(0, max * 4);
  const cleaned = raw.replace(/[^A-Za-z0-9._:/#-]+/g, '_').slice(0, max);
  if (cleaned !== '' && scanForThreats(raw.slice(0, 400), 'strict').length === 0 && scanForThreats(cleaned, 'strict').length === 0) return cleaned;
  return `name-${sha256Hex(raw).slice(0, 12)}`;
}

/** Free words from a worker, on one line: control characters and line breaks become a space, and the length is bounded. */
function oneLine(text: unknown, max: number): string {
  const raw = (typeof text === 'string' ? text : '').slice(0, max * 4);
  return raw.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ').replace(/ {2,}/g, ' ').trim().slice(0, max);
}

export function renderContextResumeFields(fields: ContextResumeFields, freshness: string): string {
  return [
    'The attempt before this one was cut off. These fields come from a closed list of values:',
    `- state: ${fields.state}`,
    `- last stop: ${fields.lastStopCode ?? 'none recorded'}`,
    `- established at commit: ${fields.subjectCommit ?? 'not recorded'} (${freshness})`,
    `- session: ${fields.sessionId ?? 'not recorded'}`,
    'Nothing the record said in words is repeated here.',
  ].join('\n');
}

export interface ContextResumeDirtyEntry {
  readonly path: string;
  /** Inside the phase's write paths, or a record the loop wrote itself. */
  readonly kind: 'granted' | 'run-record';
  /** `sha256:` and 64 hex characters, or null when the file is gone or could not be hashed. */
  readonly hash: string | null;
  readonly note: 'hashed' | 'deleted' | 'too-large' | 'unreadable';
}

export function renderContextResumeDirty(entries: readonly ContextResumeDirtyEntry[]): string {
  if (entries.length === 0) return 'The loop saw no uncommitted path in this checkout when this run started.';
  const listed = entries.slice(0, MAX_CONTEXT_RESUME_DIRTY_LISTED).map((entry) => {
    const shown = contextResumeDisplayName(entry.path);
    const simplified = shown === entry.path ? '' : ` [name simplified; path hash ${sha256Hex(entry.path).slice(0, 12)}]`;
    const hash = entry.hash === null ? `no hash (${entry.note})` : entry.hash;
    return `- ${shown} | ${entry.kind === 'granted' ? 'inside this phase write paths' : 'a record the loop wrote'} | ${hash}${simplified}`;
  });
  const rest = entries.length - listed.length;
  return [
    `The loop saw ${entries.length} uncommitted path(s) when this run started. Each is inside this phase's write paths or is a record the loop wrote:`,
    ...listed,
    ...(rest > 0 ? [`- and ${rest} more, not listed here.`] : []),
  ].join('\n');
}

export interface ContextResumeFinding {
  readonly id: string;
  readonly severity: ContextResumeSeverity;
  readonly category: string;
  readonly summary: string;
  readonly resolved: boolean;
}

export function renderContextResumeFindings(findings: readonly ContextResumeFinding[]): string {
  if (findings.length === 0) return 'The cut-off attempt recorded no findings.';
  const listed = findings.slice(0, MAX_CONTEXT_RESUME_FINDINGS_LISTED).map(
    (finding) =>
      `- [${finding.severity}] ${contextResumeDisplayName(finding.id, 80)} (${contextResumeDisplayName(finding.category, 60)})${finding.resolved ? ' [marked resolved by the worker]' : ''}: ${oneLine(finding.summary, MAX_CONTEXT_RESUME_FINDING_CHARS)}`,
  );
  const rest = findings.length - listed.length;
  return [`Findings the cut-off attempt wrote about its own work (${findings.length}):`, ...listed, ...(rest > 0 ? [`- and ${rest} more, not listed here.`] : [])].join('\n');
}

export interface ContextResumeCheck {
  readonly id: string;
  readonly passed: boolean;
}

export interface ContextResumeEvidence {
  readonly baseHead: string | null;
  readonly currentHead: string | null;
  readonly checks: readonly ContextResumeCheck[];
  readonly changedCount: number;
}

export function renderContextResumeEvidence(evidence: ContextResumeEvidence): string {
  const listed = evidence.checks.slice(0, MAX_CONTEXT_RESUME_CHECKS_LISTED).map((check) => `- ${contextResumeDisplayName(check.id, 80)}: ${check.passed ? 'passed' : 'failed'}`);
  const rest = evidence.checks.length - listed.length;
  return [
    'Evidence the cut-off attempt left (check ids and outcomes only):',
    `- brief commit: ${evidence.baseHead ?? 'not recorded'}`,
    `- checkout commit when collected: ${evidence.currentHead ?? 'not recorded'}`,
    `- changed files counted: ${evidence.changedCount}`,
    ...(listed.length === 0 ? ['- no checks were run'] : listed),
    ...(rest > 0 ? [`- and ${rest} more checks, not listed here.`] : []),
  ].join('\n');
}

// SPDX-License-Identifier: MIT
// Ported-From: hermes-agent https://github.com/NousResearch/hermes-agent
// Source-Path: cron/occurrences.py
// Source-Commit: d3e586881eacb132595edcbe4c170be8381e40c5
// Source-Copyright: Copyright (c) 2025 Nous Research
// Port-Strategy: TRANSLATE
// Modified-By: ProjectOS 2026-11-13: modified for ProjectOS. CHANGED: translated from Python to TypeScript; only the idea of an exact scheduled identity was taken, as scheduledInstant; the job-store lookup, the pending-slot stamp and the catch-up counter were not ported; the identity feeds the kernel's idempotency key, and a claim port replaces the executions table
// Notice: full licence text in THIRD_PARTY_NOTICES
/**
 * The identity of one occurrence of a routine, and the one key that stands for running it.
 *
 * HERMES KEEPS ONE QUESTION APART FROM THE JOB: which exact instant was this run for? An instant is
 * canonical only if it names its zone, so `2026-11-13T09:00:00` has no identity and
 * `2026-11-13T10:00:00+01:00` is the same occurrence as `2026-11-13T09:00:00Z`.
 *
 * THE KEY IS THE KERNEL'S. The key is `deriveIdempotencyKey` with the occurrence as the intent scope, which
 * is what ADR-K1 §2 says a schedule's occurrence id is for: a replay of this occurrence derives the same key,
 * and next week's derives a new one. A routine's occurrence is claimed through a port, which answers true
 * once. That makes "have I run this slot" a question for whoever holds the ledger, and a replay a refusal.
 *
 * Pure: no clock, no store.
 */
import { deriveIdempotencyKey } from '../taskEnvelope.js';

/** The action a routine run is admitted as. It is registered P2 and local, which is the unattended ceiling. */
export const ROUTINE_RUN_ACTION = 'run-start';

/** An ISO instant with its date, time and a zone. A date, or a time with no zone, has no identity. */
const AWARE_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** The canonical UTC spelling of an aware instant, or null. Legacy and ambiguous values carry no identity. */
export function scheduledInstant(value: unknown): string | null {
  if (typeof value !== 'string' || !AWARE_INSTANT.test(value)) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

/** What names this occurrence inside the idempotency key. */
export function occurrenceIntentScope(routineId: string, instant: string): string {
  return `routine:${routineId}@${instant}`;
}

export interface OccurrenceIdentity {
  readonly tenant: string;
  readonly project: string;
  readonly routineId: string;
  /** The hash of the approved record, so another version of the routine is another effect. */
  readonly recordHash: string;
  /** A canonical instant from `scheduledInstant`. */
  readonly instant: string;
}

/** The key a replay of this occurrence derives again. */
export function deriveOccurrenceKey(identity: OccurrenceIdentity): string {
  return deriveIdempotencyKey({
    tenant: identity.tenant,
    project: identity.project,
    action: ROUTINE_RUN_ACTION,
    subjectHash: identity.recordHash,
    intentScope: occurrenceIntentScope(identity.routineId, identity.instant),
  });
}

/** True the first time a key is claimed and false after, atomically. Whoever holds the ledger supplies it. */
export type OccurrenceClaimPort = (key: string) => boolean;

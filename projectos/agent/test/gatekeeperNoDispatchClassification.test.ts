/**
 * C11-W2-F8 — a refusal that happened before dispatch must be classified as one.
 *
 * THE DEFECT. The installation's committed allowlist decides whether it will spend its credential on
 * a governed project at all. The broker enforces that and refuses BEFORE it reserves or sends
 * anything — but it reports the refusal down the same channel as a failure mid-flight, and everything
 * arriving that way was read as `PROVIDER_UNAVAILABLE`. That is a cause which may have been
 * dispatched, so F6 conservatively RETAINS its reservation rather than releasing it.
 *
 * The consequence was concrete: a project the installation does not authorise accumulated a charge
 * for a call that provably never happened, and — once F7 required the broker's answered-record to
 * permit a retry, and that record does not exist on an installation whose broker never reserved
 * anything — the question could never be asked again either. The C11 witness was blocked by exactly
 * this, and no amount of retrying would have moved it.
 *
 * The rule now: ask the same committed policy on this side, before the broker is invoked. Not
 * authorised means not sent, so the outcome is `TRANSPORT_NOT_APPROVED` — already one of the causes
 * F6 releases on. The broker still enforces it independently; this only names the refusal correctly.
 */
import { describe, test, expect } from 'vitest';

import { submitToOpenAi, type HttpResponse } from '../src/loop/transports/openaiResponses.js';
import type { BrokeredTransport } from '../src/loop/transports/brokeredHttpPort.js';
import { unprovisionedResolver } from '../src/loop/credentialResolver.js';
import type { GatekeeperRequest } from '@projectos/core';

const REQUEST: GatekeeperRequest = {
  schemaVersion: '1.0.0',
  requestId: 'GKREQ-aaaaaaaaaaaaaaaaaaaaaaaa',
  projectId: 'acme',
  phaseId: 'ACME-P1A',
  subjectCommit: 'a'.repeat(40),
  ask: 'security-review',
  evidenceDigests: ['sha256:' + 'b'.repeat(64)],
  ownerOnlyActions: ['commit', 'push'],
};

/** Refuses by construction: the brokered route resolves nothing in this process. */
const NO_RESOLVER = unprovisionedResolver('the broker resolves the credential, never the agent');

/** Counts every dispatch attempt, so "no provider call" is measured rather than assumed. */
function countingBroker(response: HttpResponse): { transport: BrokeredTransport; calls: () => number } {
  let calls = 0;
  return {
    transport: {
      post: () => {
        calls += 1;
        return response;
      },
    },
    calls: () => calls,
  };
}

const config = (
  broker: BrokeredTransport,
  installationAllows?: () => { allowed: boolean; reasons: readonly string[] },
) => ({
  model: 'test-model',
  decidedBy: 'Grace',
  credentialRef: 'TEST_KEY',
  previousResponseId: null,
  broker: {
    transport: broker,
    governedRoot: 'C:/governed',
    projectId: 'acme',
    phaseId: 'ACME-P1A',
    ...(installationAllows === undefined ? {} : { installationAllows }),
  },
});

const NEVER_CALLED: HttpResponse = { kind: 'transport-error', detail: 'the broker should not have been reached' };

describe('C11-W2-F8 — an unauthorised project is refused before dispatch, and classified as such', () => {
  /**
   * [A] THE COMMITTED ALLOWLIST REFUSES, AND NOTHING IS SENT. The cause must be one that says so —
   * `TRANSPORT_NOT_APPROVED` — because that is what lets F6 release the reservation instead of
   * retaining a charge for a call nobody made.
   */
  test('A a refusal by the installation policy is TRANSPORT_NOT_APPROVED, with no provider call', () => {
    const broker = countingBroker(NEVER_CALLED);

    const outcome = submitToOpenAi(
      REQUEST,
      'evidence',
      config(broker.transport, () => ({
        allowed: false,
        reasons: ["this installation does not authorise project 'acme' at example/acme"],
      })),
      NO_RESOLVER,
      { post: () => NEVER_CALLED },
    );

    expect(outcome.kind).toBe('unavailable');
    if (outcome.kind !== 'unavailable') return;
    expect(outcome.cause).toBe('TRANSPORT_NOT_APPROVED');
    expect(outcome.reasons.join(' ')).toContain('no request was made');
    expect(outcome.reasons.join(' ')).toContain('does not authorise');
    // MEASURED, NOT ASSUMED: the broker was never invoked, so no provider could have been reached.
    expect(broker.calls()).toBe(0);
  });

  /** [B] An authorised project still goes to the broker exactly as before. */
  test('B an authorised project is dispatched normally', () => {
    const broker = countingBroker({ kind: 'transport-error', detail: 'network went away' });

    const outcome = submitToOpenAi(
      REQUEST,
      'evidence',
      config(broker.transport, () => ({ allowed: true, reasons: [] })),
      NO_RESOLVER,
      { post: () => NEVER_CALLED },
    );

    expect(broker.calls()).toBe(1);
    expect(outcome.kind).toBe('unavailable');
    if (outcome.kind !== 'unavailable') return;
    // AND A GENUINELY UNCERTAIN FAILURE STAYS UNCERTAIN. This is the conservative half: the request
    // left this process, so its cost is retained rather than released.
    expect(outcome.cause).toBe('PROVIDER_UNAVAILABLE');
  });

  /** [C] With no policy supplied the behaviour is unchanged — this adds a classification, not a gate. */
  test('C an absent policy check changes nothing', () => {
    const broker = countingBroker({ kind: 'transport-error', detail: 'network went away' });

    const outcome = submitToOpenAi(REQUEST, 'evidence', config(broker.transport), NO_RESOLVER, {
      post: () => NEVER_CALLED,
    });

    expect(broker.calls()).toBe(1);
    expect(outcome.kind === 'unavailable' && outcome.cause).toBe('PROVIDER_UNAVAILABLE');
  });
});

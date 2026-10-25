/**
 * Hybrid gatekeeper routing, piece by piece: which mode a project is in, the interactive port and
 * turn, the unattended (Host-attested) turn, and the evidence that keeps the two classes apart.
 *
 * The whole chain through `runLoop` is proven in `hybridVerticalSlice.test.ts`; this file pins each
 * refusal on its own, so a regression names the piece that broke.
 *
 * Created in PROJECTOS-HYBRID-GATEKEEPER-ROUTING1A.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  APPROVED_PILOT_POLICY,
  GATEKEEPER_DECISION_SCHEMA_VERSION,
  HOST_VERDICT_FOR,
  type GatekeeperVerdict,
  type HostReviewCall,
  type HostReviewOutcome,
  type HostReviewPort,
} from '@projectos/core';
import { nodeSystem, resolveBoundGit } from '../src/system.js';
import { resolveGatekeeperMode, nodeInteractivePort } from '../src/loop/gatekeeperHandoff.js';
import {
  takeInteractiveTurn,
  type InteractiveDecisionPort,
  type InteractiveHandoff,
} from '../src/loop/interactiveGatekeeper.js';
import { takeGatekeeperTurn, type GatekeeperTurnInput, type GatekeeperTurnDeps } from '../src/loop/gatekeeperTurn.js';
import { recordGatekeeperDecisionEvidence } from '../src/loop/gatekeeperConfig.js';
import { unprovisionedResolver } from '../src/loop/credentialResolver.js';

const GIT = resolveBoundGit(process.env) as string;
const NOW = '2026-09-10T12:00:00Z';
const SUBJECT = 'c4989eb0000000000000000000000000000000aa';
const ROOT = 'C:/fixture/hybrid';
const DELEGATE = 'ChatGPT';

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  made.push(d);
  return d;
}

function git(root: string, ...args: string[]): string {
  return execFileSync(GIT, ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' });
}

function repoWith(files: Record<string, string>): string {
  const root = tempDir('projectos-hybrid-mode-');
  git(root, 'init', '--quiet');
  git(root, 'config', 'user.email', 'hybrid@example.invalid');
  git(root, 'config', 'user.name', 'Hybrid');
  writeFileSync(join(root, 'README.md'), 'fixture\n');
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  git(root, 'add', '--all');
  git(root, 'commit', '--quiet', '-m', 'fixture');
  return root;
}

const GK_REL = '.projectops/gatekeeper.json';

function input(over: Partial<GatekeeperTurnInput> = {}): GatekeeperTurnInput {
  return {
    stop: { code: 'CONTINUATION_READY', detail: 'finished and sound' },
    projectId: 'hybrid',
    phaseId: 'HYBRID-PHASE-1',
    subjectCommit: SUBJECT,
    repositoryRoot: ROOT,
    evidenceText: 'checks pass; candidate sha256:abc',
    ownerOnlyActions: ['secrets-handling'],
    expectedDecider: DELEGATE,
    at: NOW,
    ...over,
  };
}

/** The ChatGPT gatekeeper's answer, built from the handoff exactly as the instructions say. */
function answer(h: InteractiveHandoff, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...h.decisionTemplate,
    decision: 'APPROVED_TO_PROCEED',
    reason: 'reviewed and sound',
    nextClaudeInstruction: 'continue',
    allowedActions: [],
    forbiddenActions: ['production-deploy'],
    ownerApprovalRequired: false,
    decidedAt: NOW,
    ...over,
  };
}

function fakePort(opts: { reply?: (h: InteractiveHandoff) => Record<string, unknown> | 'unreadable'; consume?: string; publish?: string } = {}) {
  const calls: string[] = [];
  const published: InteractiveHandoff[] = [];
  const port: InteractiveDecisionPort = {
    locations: (id) => ({ request: `q/${id}.request.json`, decision: `q/${id}.decision.json` }),
    publishRequest: (h) => {
      calls.push('publish');
      published.push(h as InteractiveHandoff);
      return opts.publish ?? 'written';
    },
    awaitDecision: () => {
      calls.push('await');
      const h = published[published.length - 1] as InteractiveHandoff;
      if (opts.reply === undefined) return { kind: 'absent' };
      const r = opts.reply(h);
      return r === 'unreadable' ? { kind: 'unreadable', detail: 'not JSON' } : { kind: 'present', record: r };
    },
    consumeDecision: () => {
      calls.push('consume');
      return opts.consume ?? 'consumed';
    },
  };
  return { port, calls, published };
}

function interactiveDeps(port: InteractiveDecisionPort, calls: string[], evidence: string = 'written') {
  const stamps: unknown[] = [];
  return {
    stamps,
    deps: {
      mode: 'interactive' as const,
      interactive: port,
      consumedDecisionIds: [] as string[],
      recordDecisionEvidence: (_r: unknown, p: unknown) => {
        calls.push('record');
        stamps.push(p);
        return evidence;
      },
    },
  };
}

// -------------------------------------------------------------------------------------------------

describe('resolveGatekeeperMode — the mode comes from the committed configuration', () => {
  it('a project with no gatekeeper configuration is INTERACTIVE', () => {
    const root = repoWith({});
    expect(resolveGatekeeperMode(nodeSystem, root)).toEqual({ ok: true, mode: 'interactive', source: 'default' });
  });

  it.each(['interactive', 'unattended'])('reads a committed mode of %s', (mode) => {
    const root = repoWith({ [GK_REL]: JSON.stringify({ schemaVersion: '1.0.0', mode }) });
    expect(resolveGatekeeperMode(nodeSystem, root)).toEqual({ ok: true, mode, source: 'committed' });
  });

  it('refuses a configured gatekeeper that declares no mode, rather than choosing one', () => {
    const root = repoWith({ [GK_REL]: JSON.stringify({ schemaVersion: '1.0.0', enabled: true }) });
    const r = resolveGatekeeperMode(nodeSystem, root);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toContain('declares no \\"mode\\"');
  });

  it('refuses an unknown mode', () => {
    const root = repoWith({ [GK_REL]: JSON.stringify({ mode: 'hybrid' }) });
    expect(resolveGatekeeperMode(nodeSystem, root).ok).toBe(false);
  });

  it('refuses a working-copy switch that is not committed — in either direction', () => {
    const root = repoWith({ [GK_REL]: JSON.stringify({ mode: 'interactive' }) });
    writeFileSync(join(root, GK_REL), JSON.stringify({ mode: 'unattended' }));
    const r = resolveGatekeeperMode(nodeSystem, root);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toContain('does not declare the committed mode');
  });

  it('refuses a configuration that exists only in the working copy', () => {
    const root = repoWith({});
    mkdirSync(join(root, '.projectops'), { recursive: true });
    writeFileSync(join(root, GK_REL), JSON.stringify({ mode: 'unattended' }));
    expect(JSON.stringify(resolveGatekeeperMode(nodeSystem, root))).toContain('not committed');
  });
});

describe('nodeInteractivePort — the question and the answer on disk', () => {
  const ID = 'GKREQ-0123456789abcdef01234567';
  const handoff = { requestId: ID } as unknown as InteractiveHandoff;

  it('publishes once, idempotently, and refuses to overwrite a different question', () => {
    const root = tempDir('projectos-hybrid-port-');
    const port = nodeInteractivePort(nodeSystem, root);
    expect(port.publishRequest(handoff)).toBe('written');
    expect(port.publishRequest(handoff)).toBe('already-published');
    expect(port.publishRequest({ ...handoff, stop: { code: 'X', detail: 'y' } } as InteractiveHandoff)).toContain('conflict');
  });

  it('refuses a question whose answer was planted before it was ever asked', () => {
    const root = tempDir('projectos-hybrid-port-');
    const port = nodeInteractivePort(nodeSystem, root);
    mkdirSync(join(root, '.projectops', 'gatekeeper-interactive'), { recursive: true });
    writeFileSync(join(root, port.locations(ID).decision), '{"decision":"APPROVED_TO_PROCEED"}');
    expect(port.publishRequest(handoff)).toContain('never asked');
    expect(existsSync(join(root, port.locations(ID).request))).toBe(false);
    // And the turn does not read the planted answer at all.
    const turned = takeInteractiveTurn(input(), {
      mode: 'interactive',
      interactive: { ...port, publishRequest: (h) => port.publishRequest({ ...h, requestId: ID }), awaitDecision: () => { throw new Error('must not be read'); } },
      consumedDecisionIds: [],
    });
    expect(turned.action.kind).toBe('owner');
    expect(JSON.stringify(turned.action)).toContain('never asked');
  });

  it('refuses a request id that could not have been derived', () => {
    const port = nodeInteractivePort(nodeSystem, tempDir('projectos-hybrid-port-'));
    expect(port.publishRequest({ requestId: '../escape' } as unknown as InteractiveHandoff)).toContain('refused');
    expect(port.awaitDecision('../escape').kind).toBe('unreadable');
    expect(port.consumeDecision('..\\escape')).not.toBe('consumed');
  });

  it('reports absent with no wait, then reads an answer — tolerating a byte-order mark', () => {
    const root = tempDir('projectos-hybrid-port-');
    const port = nodeInteractivePort(nodeSystem, root);
    expect(port.awaitDecision(ID)).toEqual({ kind: 'absent' });
    mkdirSync(join(root, '.projectops', 'gatekeeper-interactive'), { recursive: true });
    writeFileSync(join(root, port.locations(ID).decision), '﻿{"decision":"DO_NOT_PROCEED"}');
    expect(port.awaitDecision(ID)).toEqual({ kind: 'present', record: { decision: 'DO_NOT_PROCEED' } });
  });

  it('waits within its bound for an answer that arrives while the gate is open', () => {
    const root = tempDir('projectos-hybrid-port-');
    let slept = 0;
    const announced: unknown[] = [];
    const port = nodeInteractivePort(nodeSystem, root, {
      waitMs: 60_000,
      pollMs: 1_000,
      onWaiting: (where) => announced.push(where),
      sleep: () => {
        slept += 1;
        mkdirSync(join(root, '.projectops', 'gatekeeper-interactive'), { recursive: true });
        writeFileSync(join(root, '.projectops', 'gatekeeper-interactive', `${ID}.decision.json`), '{"decision":"AWAITING_OWNER"}');
      },
    });
    expect(port.awaitDecision(ID)).toEqual({ kind: 'present', record: { decision: 'AWAITING_OWNER' } });
    expect(slept).toBe(1);
    // Where to answer is announced once, as the wait begins — a waiting run prints nothing else.
    expect(announced).toEqual([port.locations(ID)]);
  });

  it('refuses an answer that is not a JSON object, or is oversized', () => {
    const root = tempDir('projectos-hybrid-port-');
    const port = nodeInteractivePort(nodeSystem, root);
    mkdirSync(join(root, '.projectops', 'gatekeeper-interactive'), { recursive: true });
    const path = join(root, port.locations(ID).decision);
    writeFileSync(path, '[1,2]');
    expect(port.awaitDecision(ID).kind).toBe('unreadable');
    writeFileSync(path, `{"x":"${'y'.repeat(70_000)}"}`);
    expect(port.awaitDecision(ID).kind).toBe('unreadable');
  });

  it('spends a decision exactly once', () => {
    const port = nodeInteractivePort(nodeSystem, tempDir('projectos-hybrid-port-'));
    expect(port.consumeDecision(ID)).toBe('consumed');
    expect(port.consumeDecision(ID)).toContain('already acted on');
  });
});

describe('takeInteractiveTurn', () => {
  it("does not ask about an owner's stop", () => {
    const { port, calls } = fakePort();
    const { deps } = interactiveDeps(port, calls);
    const r = takeInteractiveTurn(input({ stop: { code: 'OWNER_GATE', detail: 'push' } }), deps);
    expect(r.request).toBeNull();
    expect(calls).toEqual([]);
    expect(r.action.kind).toBe('owner');
  });

  it('WAITS when no decision has been supplied — no guess, no other reviewer, no degraded choice', () => {
    const { port, calls, published } = fakePort();
    const { deps } = interactiveDeps(port, calls);
    const r = takeInteractiveTurn(input(), deps);
    expect(calls).toEqual(['publish', 'await']);
    expect(r.action.kind).toBe('owner');
    const text = JSON.stringify(r.action);
    expect(text).toContain('WAITING FOR THE INTERACTIVE GATEKEEPER');
    expect(text).toContain('will not switch to unattended mode');
    expect(r.ownerChoices).toBeNull();
    expect(r.unavailabilityCause).toBeNull();
    expect(r.ledgerEntry).toBeNull();
    expect(r.checkedDecision).toBeNull();
    // The handoff tells the gatekeeper what it may answer and binds the answer to this request.
    const h = published[0] as InteractiveHandoff;
    expect(h.applicableVerdicts).toContain('APPROVED_TO_PROCEED');
    expect(h.decisionTemplate['decisionId']).toBe(`GKDEC-${h.requestId}`);
    expect(h.decisionTemplate['decidedBy']).toBe(DELEGATE);
    expect(h.request.ownerOnlyActions).toEqual(expect.arrayContaining(['secrets-handling', 'push', 'payment-or-live-charge']));
  });

  it('never answers a question it did not write itself — a byte-identical pre-planted request is refused unread', () => {
    const { port, calls } = fakePort({ publish: 'already-published', reply: (h) => answer(h) });
    const { deps } = interactiveDeps(port, calls);
    const r = takeInteractiveTurn(input(), deps);
    expect(r.action.kind).toBe('owner');
    expect(JSON.stringify(r.action)).toContain('cannot establish that it wrote it');
    // PROJECTOS-BOOT-CONTINUE1A: the way out is the governed flag, never deleting files by hand.
    expect(JSON.stringify(r.action)).toContain('--supersede-stale-request');
    expect(JSON.stringify(r.action)).toContain('never delete them by hand');
    expect(calls).toEqual(['publish']);
    expect(r.checkedDecision).toBeNull();
  });

  it('asks the same question under the same id as the unattended turn would', () => {
    const { port, calls, published } = fakePort();
    takeInteractiveTurn(input(), interactiveDeps(port, calls).deps);
    const host = fakeHost('APPROVED_TO_PROCEED');
    takeGatekeeperTurn(input(), unattendedDeps({ hostReview: host }));
    expect(published[0]?.requestId).toBe(host.calls[0]?.request.requestId);
    expect(published[0]?.requestDigest).toBe(host.calls[0]?.requestDigest);
  });

  it('applies an accepted decision: record, then spend, then proceed — stamped Interactive', () => {
    const { port, calls } = fakePort({ reply: (h) => answer(h) });
    const { deps, stamps } = interactiveDeps(port, calls);
    const r = takeInteractiveTurn(input(), deps);
    expect(calls).toEqual(['publish', 'await', 'record', 'consume']);
    expect(r.action.kind).toBe('proceed');
    expect(r.provenance).toBe('InteractiveGatekeeperDecision');
    expect(stamps).toEqual([{ kind: 'InteractiveGatekeeperDecision' }]);
    expect(r.checkedDecision?.problems).toEqual([]);
  });

  it('turns AMENDMENT_REQUIRED into a bounded retry instruction', () => {
    const { port, calls } = fakePort({ reply: (h) => answer(h, { decision: 'AMENDMENT_REQUIRED', nextClaudeInstruction: 'fix the test' }) });
    const r = takeInteractiveTurn(input(), interactiveDeps(port, calls).deps);
    expect(r.action).toEqual({ kind: 'retry', instruction: 'fix the test' });
  });

  it.each([
    ['a Host attestation field (relabel attempt)', { hostAttestation: { attestationId: 'a'.repeat(64) } }, "carries 'hostAttestation'"],
    ['a provenance claim', { provenance: 'HostIndependentProviderAttestation' }, "carries 'provenance'"],
    ['the implementer as decider', { decidedBy: 'Claude' }, 'not the recorded gatekeeper'],
    ['an owner-only grant', { allowedActions: ['payment-or-live-charge'] }, 'owner-only action'],
    ['another decision id', { decisionId: 'GKDEC-somethingelse0000' }, "this request's decision is"],
    ['another subject', { subjectCommit: 'f'.repeat(40) }, 'stale'],
    ['a verdict outside the vocabulary', { decision: 'LGTM' }, 'not one of the recognised verdicts'],
  ])('refuses a decision carrying %s, and never records or spends it', (_label, over, expected) => {
    const { port, calls } = fakePort({ reply: (h) => answer(h, over) });
    const { deps } = interactiveDeps(port, calls);
    const r = takeInteractiveTurn(input(), deps);
    expect(r.action.kind).toBe('owner');
    expect(JSON.stringify(r.action)).toContain(expected);
    expect(calls).not.toContain('record');
    expect(calls).not.toContain('consume');
    expect(r.checkedDecision).toBeNull();
    expect(r.provenance).toBeUndefined();
  });

  it('does not act when the decision could not be recorded, and does not spend it', () => {
    const { port, calls } = fakePort({ reply: (h) => answer(h) });
    const r = takeInteractiveTurn(input(), interactiveDeps(port, calls, 'conflict: different evidence').deps);
    expect(r.action.kind).toBe('owner');
    expect(JSON.stringify(r.action)).toContain('NOT acted on');
    expect(calls).not.toContain('consume');
  });

  it('does not act on a decision already spent', () => {
    const { port, calls } = fakePort({ reply: (h) => answer(h), consume: 'this decision was already acted on' });
    const r = takeInteractiveTurn(input(), interactiveDeps(port, calls).deps);
    expect(r.action.kind).toBe('owner');
    expect(JSON.stringify(r.action)).toContain('already acted on');
  });

  it('refuses an unreadable answer', () => {
    const { port, calls } = fakePort({ reply: () => 'unreadable' });
    const r = takeInteractiveTurn(input(), interactiveDeps(port, calls).deps);
    expect(r.action.kind).toBe('owner');
    expect(calls).not.toContain('record');
  });
});

// -------------------------------------------------------------------------------------------------

const RATE = { model: 'gpt-5.6-terra', inputMicroUsdPerMillion: 1_250_000, cachedInputMicroUsdPerMillion: 125_000, outputMicroUsdPerMillion: 10_000_000 };

function fakeHost(verdict: GatekeeperVerdict, over: { allowedActions?: string[]; attestation?: Record<string, unknown>; unavailable?: boolean } = {}) {
  const calls: HostReviewCall[] = [];
  const port: HostReviewPort & { calls: HostReviewCall[] } = {
    calls,
    review(call): HostReviewOutcome {
      calls.push(call);
      if (over.unavailable === true) {
        return { kind: 'unavailable', cause: 'PROVIDER_UNAVAILABLE', reasons: ['the provider did not answer'] };
      }
      const allowedActions = over.allowedActions ?? [];
      return {
        kind: 'attested',
        record: {
          schemaVersion: GATEKEEPER_DECISION_SCHEMA_VERSION,
          decisionId: `GKDEC-${call.request.requestId}`,
          projectId: call.request.projectId,
          phaseId: call.request.phaseId,
          subjectCommit: call.request.subjectCommit,
          requestDigest: call.requestDigest,
          decision: verdict,
          reason: 'independently reviewed',
          nextClaudeInstruction: 'continue',
          allowedActions,
          forbiddenActions: ['production-deploy'],
          ownerApprovalRequired: false,
          decidedBy: DELEGATE,
          decidedAt: NOW,
        },
        attestation: {
          schemaVersion: 1,
          attestationId: 'b'.repeat(64),
          requestCorrelation: call.correlation,
          providerResponseId: 'resp_host_1',
          provider: 'fake-provider',
          model: 'fake-model',
          verdict: HOST_VERDICT_FOR[verdict],
          allowedActions,
          ownerApprovalRequired: false,
          costMicroUsd: 4321,
          attestedAtEpochS: 1_788_000_000,
          ...over.attestation,
        },
        usage: { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 100 },
      };
    },
  };
  return port;
}

function unattendedDeps(over: Partial<GatekeeperTurnDeps> & { sent?: string[]; admitted?: string[]; stamps?: unknown[] } = {}): GatekeeperTurnDeps {
  const sent = over.sent ?? [];
  const admitted = over.admitted ?? [];
  const stamps = over.stamps ?? [];
  return {
    mode: 'unattended',
    transport: {
      transportId: 'openai-primary',
      kind: 'openai-responses',
      model: 'gpt-5.6-terra',
      capabilities: ['submit-request', 'receive-decision'],
      credentialRef: 'PROJECTOS_GATEKEEPER_OPENAI_KEY',
      commercialApproval: true,
    },
    availability: { reachable: true },
    resolver: unprovisionedResolver('never resolved in the agent'),
    http: {
      post(req: { body: string }) {
        sent.push(req.body);
        return { kind: 'transport-error', detail: 'must never be called in unattended mode' } as const;
      },
    },
    modelPolicy: APPROVED_PILOT_POLICY,
    rateCards: { 'gpt-5.6-terra': RATE, 'gpt-5.6-luna': RATE },
    budget: { warnAtMicroUsd: 2_000_000, hardStopAtMicroUsd: 5_000_000 },
    ledger: [],
    threadBinding: {
      schemaVersion: '1.0.0',
      projectId: 'hybrid',
      repositoryRoot: ROOT,
      providerThreadId: 'resp_7f3a9c2e5b81d40a',
      transportId: 'openai-primary',
      createdAt: '2026-09-01T21:00:00Z',
    },
    transportDecider: DELEGATE,
    consumedDecisionIds: [],
    admitSpend: (r) => {
      admitted.push(r.requestId);
      return { allowed: true, reasons: [] };
    },
    recordDecisionEvidence: (_record, provenance) => {
      stamps.push(provenance);
      return 'written';
    },
    ...over,
  } as GatekeeperTurnDeps;
}

describe('takeGatekeeperTurn in UNATTENDED mode — Host-attested, or nothing', () => {
  it('with no Host route composed, WAITS — reserving nothing and calling no provider', () => {
    const sent: string[] = [];
    const admitted: string[] = [];
    const r = takeGatekeeperTurn(input(), unattendedDeps({ sent, admitted }));
    expect(r.action.kind).toBe('owner');
    expect(r.unavailabilityCause).toBe('TRANSPORT_NOT_CONFIGURED');
    expect(JSON.stringify(r.action)).toContain('never falls back');
    expect(sent).toEqual([]);
    expect(admitted).toEqual([]);
    expect(r.ledgerEntry).toBeNull();
  });

  it('when the Host reports the provider unavailable, WAITS and calls nothing else', () => {
    const sent: string[] = [];
    const host = fakeHost('APPROVED_TO_PROCEED', { unavailable: true });
    const r = takeGatekeeperTurn(input(), unattendedDeps({ sent, hostReview: host }));
    expect(r.action.kind).toBe('owner');
    expect(r.unavailabilityCause).toBe('PROVIDER_UNAVAILABLE');
    expect(host.calls.length).toBe(1);
    expect(sent).toEqual([]);
  });

  it('applies an attested decision, stamped HostIndependentProviderAttestation with its attestation id', () => {
    const sent: string[] = [];
    const stamps: unknown[] = [];
    const host = fakeHost('APPROVED_TO_PROCEED');
    const r = takeGatekeeperTurn(input(), unattendedDeps({ sent, stamps, hostReview: host }));
    expect(r.action.kind).toBe('proceed');
    expect(r.provenance).toBe('HostIndependentProviderAttestation');
    expect(stamps).toEqual([{ kind: 'HostIndependentProviderAttestation', hostAttestationId: 'b'.repeat(64) }]);
    expect(sent).toEqual([]);
    expect(r.ledgerEntry?.costMicroUsd).toBeGreaterThan(0);
  });

  it('the rehearsal switch cannot route an unattended turn away from the Host', () => {
    const host = fakeHost('APPROVED_TO_PROCEED');
    let rehearsed = 0;
    takeGatekeeperTurn(
      input(),
      unattendedDeps({
        hostReview: host,
        rehearsalOnly: true,
        rehearsalReviewer: () => {
          rehearsed += 1;
          throw new Error('unreachable');
        },
      }),
    );
    expect(rehearsed).toBe(0);
  });

  it.each([
    ['for another request', { requestCorrelation: '0'.repeat(32) }, 'answers a different request'],
    ['with another verdict', { verdict: 'ChangesRequired' }, 'does not match the decision'],
    ['with other actions', { allowedActions: ['commit'] }, 'permits different actions'],
    ['with no known cost', { costMicroUsd: null }, 'states no known cost'],
  ])('refuses an attestation %s, and records nothing', (_label, attestation, expected) => {
    const stamps: unknown[] = [];
    const r = takeGatekeeperTurn(input(), unattendedDeps({ stamps, hostReview: fakeHost('APPROVED_TO_PROCEED', { attestation }) }));
    expect(r.action.kind).toBe('owner');
    expect(JSON.stringify(r.action)).toContain(expected);
    expect(stamps).toEqual([]);
    expect(r.provenance).toBeUndefined();
  });

  it('refuses an attested owner-only grant — the Host cannot manufacture owner authority', () => {
    const r = takeGatekeeperTurn(input(), unattendedDeps({ hostReview: fakeHost('APPROVED_TO_PROCEED', { allowedActions: ['production-deploy', 'payment-or-live-charge'] }) }));
    expect(r.action.kind).toBe('owner');
    expect(JSON.stringify(r.action)).toContain("grants 'payment-or-live-charge', which is an owner-only action");
  });
});

describe('decision evidence keeps the two classes apart', () => {
  it('records the provenance, and refuses to relabel the same decision under the other class', () => {
    const root = tempDir('projectos-hybrid-evidence-');
    const record = {
      decisionId: 'GKDEC-GKREQ-0123456789abcdef01234567',
      decision: 'APPROVED_TO_PROCEED',
      decidedBy: DELEGATE,
    };
    expect(recordGatekeeperDecisionEvidence(nodeSystem, root, record, { kind: 'InteractiveGatekeeperDecision' }).kind).toBe('written');
    const path = join(root, '.projectops', 'gatekeeper-decisions', 'GKDEC-GKREQ-0123456789abcdef01234567.json');
    expect(JSON.parse(readFileSync(path, 'utf8')).provenance).toBe('InteractiveGatekeeperDecision');
    const relabel = recordGatekeeperDecisionEvidence(nodeSystem, root, record, {
      kind: 'HostIndependentProviderAttestation',
      hostAttestationId: 'c'.repeat(64),
    });
    expect(relabel.kind).toBe('conflict');
    expect(JSON.parse(readFileSync(path, 'utf8')).provenance).toBe('InteractiveGatekeeperDecision');
  });

  it('leaves pre-hybrid evidence byte-identical when no provenance is stamped', () => {
    const root = tempDir('projectos-hybrid-evidence-');
    recordGatekeeperDecisionEvidence(nodeSystem, root, { decisionId: 'GKDEC-legacy0001', decision: 'DO_NOT_PROCEED' });
    const path = join(root, '.projectops', 'gatekeeper-decisions', 'GKDEC-legacy0001.json');
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, 'utf8')).not.toContain('provenance');
  });
});

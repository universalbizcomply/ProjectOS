/**
 * PROJECTOS-HOST-REVIEW-PATH1A — THE AGENT HALF, END TO END THROUGH THE REAL TURNS.
 *
 * WHAT IS REAL: the governed disposable project, git and its bare remote, the production composition
 * (`composeGatekeeper`), the canonical loop (`runLoop`), the production `reconcile` and `closure`
 * commands, spend admission and the cost ledger, the PRODUCTION Host review client, the strict core
 * codec and record verifier, and the EXISTING decision, closure-response and attestation checks.
 *
 * WHAT IS A FIXTURE: ProjectOSHost itself, simulated behind the real transport seam (its conformity to
 * the real Rust Host is proven against recorded bytes in `host-review-client.test.ts` and
 * `host-review-path-vectors.test.ts`), and the worker. No pipe is opened here, no provider is called, no
 * credential exists, nothing is spent. The isolated REAL-pipe round trip is `hostIpcTransport.e2e.test.ts`.
 *
 * Created in PROJECTOS-HOST-REVIEW-PATH1A.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { composeGatekeeper } from '../src/commands/run.js';
import { runLoop } from '../src/loop/runner.js';
import type { BrokeredCall } from '../src/loop/transports/brokeredHttpPort.js';
import { closure, closureRequest } from '../src/commands/closure.js';
import { reconcile } from '../src/commands/reconcile.js';
import { readClosureWait } from '../src/closureWait.js';
import { CLOSURE_INTERACTIVE_REL, GATEKEEPER_INTERACTIVE_REL } from '../src/loop/gatekeeperHandoff.js';
import { hostReviewClient } from '../src/loop/hostReviewClient.js';
import { HOST_REVIEW_TRANSPORT, type HostReviewActivation } from '../src/loop/hostReviewActivation.js';
import { fakeProjectosHost, type FakeHostBehaviour } from './support/fakeProjectosHost.js';
import * as slice from './support/verticalSliceWorld.js';
import * as cr from './support/closureReconcileWorld.js';

const FACTS = {
  repository: 'github.com/acme/host-review-path',
  planRef: 'plan-0123456789abcdef-0123456789ab',
  planDigest: '44'.repeat(32),
  delegationId: 'aa'.repeat(32),
  modelPolicy: 'approved-pilot-policy',
  credentialRef: 'PROJECTOS_GATEKEEPER_OPENAI_KEY',
};
/** The approved baseline both sides state, and the evidence digest both sides arrive at. */
const BASELINE_COMMIT = 'b45e11e0'.repeat(5);
const EVIDENCE_DIGEST = 'e1'.repeat(32);
const HOST_FACTS = { ...FACTS, baselineCommit: BASELINE_COMMIT, evidenceDigest: EVIDENCE_DIGEST };
/**
 * The agent's own reading of the candidate. These vertical proofs drive the REAL hybrid turns over
 * temporary worlds whose commits are fixtures, so the reading is stated rather than derived; deriving it
 * from a real repository is proven in `hostCandidateEvidence.test.ts`.
 */
const OWN_EVIDENCE = (): { digest: string } => ({ digest: EVIDENCE_DIGEST });
const ACTIVATION: HostReviewActivation = { transport: HOST_REVIEW_TRANSPORT, ...FACTS, baselineCommit: BASELINE_COMMIT, responseTimeoutSeconds: 30 };

function hostAndClient(behaviour: FakeHostBehaviour = 'approve', allowedActions?: readonly string[]) {
  const host = fakeProjectosHost({ facts: HOST_FACTS, behaviour, ...(allowedActions === undefined ? {} : { allowedActions }) });
  return { host, client: hostReviewClient({ activation: ACTIVATION, transport: host, candidateEvidence: OWN_EVIDENCE }) };
}

interface LedgerEntry {
  readonly requestId: string;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
}
function ledgerOf(root: string): readonly LedgerEntry[] {
  const path = join(root, '.projectops', 'gatekeeper-ledger.json');
  if (!existsSync(path)) return [];
  return (JSON.parse(readFileSync(path, 'utf8')) as { entries?: LedgerEntry[] }).entries ?? [];
}

// -------------------------------------------------------------------------------------------------

describe('`projectos run`, unattended, through the production Host review client', () => {
  it('a valid technical review proceeds through the ACTUAL hybrid turn to the governed continuation', () => {
    const sys = slice.fixedClock();
    const { w, adapters } = slice.started(sys, 'unattended');
    const { host, client } = hostAndClient();

    const run = slice.runOnce(sys, w, adapters, { hostReview: client });

    expect(run.states).toContain('AWAITING_GATE');
    expect(run.finalState).toBe('COMPLETE');
    expect(run.r.stop).toBeNull();
    expect(run.trace).toContain('gatekeeper decision provenance: HostIndependentProviderAttestation');
    expect(slice.committedAndPushed(w)).toContain('delivered.txt');
    // ONE exchange to learn the epoch, one to ask; ONE provider call; the question was the committed subject.
    expect(host.exchanges).toBe(2);
    expect(host.providerCalls).toBe(1);
    const [record] = [...host.outbox.values()].map(
      (b) => JSON.parse(b.toString('utf8')) as { declared: Record<string, string>; decision: { decisionId: string }; attestation: { attestationId: string } },
    );
    // PATH1B UNIT L: THE QUESTION WAS ABOUT THE WORK. The subject is the local candidate recorded on the
    // base before the review - not the base itself (the PATH1A defect: `subjectCommit` was the run-start
    // HEAD, so the Host framed a difference that did not contain the phase's output). It is the commit
    // that was then published, and it carries the worker's file.
    const subject = String(record!.declared['subjectCommit']);
    expect(subject).not.toBe(w.head);
    expect(slice.git(w.root, 'rev-list', '--parents', '-n', '1', subject).trim()).toBe(`${subject} ${w.head}`);
    expect(slice.git(w.root, 'diff', '--name-only', `${w.head}..${subject}`)).toContain('delivered.txt');
    expect(slice.git(w.root, 'rev-parse', `origin/${slice.BRANCH}`).trim()).toBe(subject);
    expect(run.trace).toContain('the reviewed local candidate');
    expect(record!.declared['phaseId']).toBe(slice.PHASE);
    // The evidence carries the HOST provenance and the Host's attestation id — and no interactive
    // question was ever written: there is no fallback between modes.
    const evidence = JSON.parse(
      readFileSync(join(w.root, '.projectops', 'gatekeeper-decisions', `${record!.decision.decisionId}.json`), 'utf8'),
    ) as Record<string, unknown>;
    expect(evidence['provenance']).toBe('HostIndependentProviderAttestation');
    expect(evidence['hostAttestationId']).toBe(record!.attestation.attestationId);
    expect(slice.interactiveFiles(w)).toEqual([]);
    // The call is on the ledger under ITS OWN request. (This harness drives `runLoop` without the
    // command's settle callback, so the entry is the admission's; settlement, and the rule that a settled
    // entry is never released, are proven in `hostReviewSpendSettlement.test.ts`.)
    expect(ledgerOf(w.root).map((e) => e.requestId)).toEqual([record!.declared['requestId']]);
  });

  it.each([
    // [behaviour, provider calls, whether the reservation survives]
    ['absent', 0, false],
    ['not-accepting', 0, false],
    ['policy-refused', 0, false],
    ['credential-unavailable', 0, false],
    ['provider-unavailable', 1, true],
    ['no-answer', 0, true],
    ['malformed-response', 1, true],
    ['missing-record', 1, true],
    ['tampered-record', 1, true],
  ] as const)('Host %s: the run WAITS, nothing is published, and the reservation follows the DISPATCH FACT', (behaviour, providerCalls, retained) => {
    const sys = slice.fixedClock();
    const { w, adapters } = slice.started(sys, 'unattended');
    const { host, client } = hostAndClient(behaviour);
    // Epoch 7 is the simulator's default; teach the client first so the case is about ONE exchange.
    host.behave('policy-refused');
    client.review({
      request: { schemaVersion: '1.0.0', requestId: 'GKREQ-warm-up', projectId: 'hybrid', phaseId: slice.PHASE, subjectCommit: w.head, ask: 'evidence-review', evidenceDigests: [], ownerOnlyActions: [] },
      requestDigest: `sha256:${'00'.repeat(32)}`,
      correlation: '00'.repeat(16),
      body: '{}',
    });
    host.behave(behaviour);

    const run = slice.runOnce(sys, w, adapters, { hostReview: client });

    expect(run.states).toContain('WAITING_OWNER');
    expect(run.finalState).toBe('BLOCKED');
    expect(run.trace).toContain('the gatekeeper could not be reached');
    // UNIT L: the candidate was committed locally BEFORE the question; nothing was published.
    slice.recordedLocallyNotPublished(w);
    expect(host.providerCalls).toBe(providerCalls);
    // NO FALLBACK of any kind: no interactive question, no in-process provider call (the composition's
    // resolver refuses by construction and would have thrown the run into a different refusal).
    expect(slice.interactiveFiles(w)).toEqual([]);
    const reservations = ledgerOf(w.root);
    if (retained) {
      // Money that MAY have been spent is never released on a guess: the estimate stands, unsettled.
      expect(reservations).toHaveLength(1);
      expect(reservations[0]!.usage).toMatchObject({ inputTokens: 0, outputTokens: 0 });
    } else {
      // Nothing can have been dispatched, so no estimate is left standing as provider spend.
      expect(reservations).toEqual([]);
    }
  });

  it.each([
    ['wrong-project', /is for project/],
    ['wrong-phase', /is for phase/],
    ['wrong-subject', /about other bytes is stale|names no valid subject/],
    ['wrong-request-digest', /an answer to a different question/],
    ['invalid-attestation', /answers a different request/],
  ] as const)('a Host answer with %s is REFUSED by the existing checks on the real turn, and the paid call stays on the ledger', (behaviour, why) => {
    const sys = slice.fixedClock();
    const { w, adapters } = slice.started(sys, 'unattended');
    const { host, client } = hostAndClient(behaviour);

    const run = slice.runOnce(sys, w, adapters, { hostReview: client });

    expect(run.finalState).not.toBe('COMPLETE');
    expect(run.trace).toMatch(why);
    slice.recordedLocallyNotPublished(w);
    expect(host.providerCalls).toBe(1);
    // THE PROVIDER WAS PAID, WHATEVER IT SAID: a refused ANSWER is not an unanswered call, so nothing
    // releases this request's entry.
    expect(ledgerOf(w.root)).toHaveLength(1);
  });
});

// -------------------------------------------------------------------------------------------------

describe('the Host route is composed ONLY when the COMMITTED configuration names it', () => {
  const block = { transport: HOST_REVIEW_TRANSPORT, ...FACTS, baselineCommit: BASELINE_COMMIT };
  const withBlock = (root: string, value: unknown, commit: boolean): void => {
    const path = join(root, '.projectops', 'gatekeeper.json');
    const config = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    writeFileSync(path, JSON.stringify({ ...config, hostReview: value }, null, 2));
    if (commit) {
      slice.git(root, 'add', '--all');
      slice.git(root, 'commit', '--quiet', '-m', 'owner names the Host review route');
    }
  };

  it('with NO block nothing is composed: the turn refuses before spend admission and creates no ledger file', () => {
    const sys = slice.fixedClock();
    const { w, adapters } = slice.started(sys, 'unattended');
    const composed = composeGatekeeper({ sys, root: w.root }, { gateWaitMinutes: 0 });
    expect(composed.ok && composed.gatekeeper?.mode === 'unattended' && composed.gatekeeper.hostReview).toBeUndefined();

    const run = slice.runOnce(sys, w, adapters);
    expect(run.finalState).toBe('BLOCKED');
    expect(run.trace).toContain('no Host review route is composed');
    expect(existsSync(join(w.root, '.projectops', 'gatekeeper-ledger.json'))).toBe(false);
  });

  it('a COMMITTED block composes the production client (constructed, never invoked here)', () => {
    const sys = slice.fixedClock();
    const { w } = slice.started(sys, 'unattended');
    withBlock(w.root, block, true);
    const composed = composeGatekeeper({ sys, root: w.root }, { gateWaitMinutes: 0 });
    expect(composed.ok).toBe(true);
    expect(composed.ok && composed.gatekeeper?.mode === 'unattended' && typeof composed.gatekeeper.hostReview?.review).toBe('function');
  });

  it('a COMMITTED block whose baseline is absent or is not an exact commit is refused, never defaulted', () => {
    for (const baselineCommit of [undefined, 'HEAD', 'main', 'refs/remotes/origin/main', 'b45e11e0', 'B45E11E0'.repeat(5)]) {
      const sys = slice.fixedClock();
      const { w } = slice.started(sys, 'unattended');
      const { baselineCommit: _dropped, ...rest } = block;
      withBlock(w.root, baselineCommit === undefined ? rest : { ...rest, baselineCommit }, true);
      const composed = composeGatekeeper({ sys, root: w.root }, { gateWaitMinutes: 0 });
      expect(composed.ok, String(baselineCommit)).toBe(false);
      expect(!composed.ok && composed.lines.join('\n')).toMatch(/HOST_REVIEW_MISCONFIGURED[\s\S]*baselineCommit is not an exact 40-character/);
    }
  });

  it('a working-copy block that is NOT committed activates nothing and is refused out loud', () => {
    const sys = slice.fixedClock();
    const { w } = slice.started(sys, 'unattended');
    withBlock(w.root, block, false);
    const composed = composeGatekeeper({ sys, root: w.root }, { gateWaitMinutes: 0 });
    expect(composed.ok).toBe(false);
    expect(!composed.ok && composed.lines.join('\n')).toMatch(/HOST_REVIEW_MISCONFIGURED[\s\S]*not COMMITTED/);
  });

  it.each([
    ['another transport', { ...block, transport: 'direct-provider' }, /no other Host route/],
    ['an unknown field', { ...block, apiKey: 'x' }, /unknown field 'apiKey'/],
    ['a malformed delegation id', { ...block, delegationId: 'AA' }, /delegationId is not 32 bytes/],
    ['an unbounded timeout', { ...block, responseTimeoutSeconds: 86_400 }, /responseTimeoutSeconds/],
    ['a non-object', 'projectos-host-local-ipc', /not an object/],
  ] as const)('a committed block with %s is a REFUSAL, never a silent "off"', (_n, value, why) => {
    const sys = slice.fixedClock();
    const { w } = slice.started(sys, 'unattended');
    withBlock(w.root, value, true);
    const composed = composeGatekeeper({ sys, root: w.root }, { gateWaitMinutes: 0 });
    expect(composed.ok).toBe(false);
    expect(!composed.ok && composed.lines.join('\n')).toMatch(why);
  });

  /**
   * PROJECTOS-FINISH-API-GATEKEEPER1A (owner decision of 2026-10-25, "Route 2 now"). The trusted installation
   * broker answers ONLY on the owner's committed opt-in (`"route": "installation-broker"`), composed in the
   * pre-hybrid shape (no `mode`), and the agent's own resolver still refuses by construction.
   */
  const brokerWorld = (sys: ReturnType<typeof slice.fixedClock>) => {
    const base = slice.world('unattended', { gatekeeper: null });
    // THE OWNER'S COMMITTED OPT-IN, with a thread binding naming this checkout.
    writeFileSync(join(base.root, '.projectops', 'gatekeeper.json'), JSON.stringify({ ...slice.gatekeeperConfig('unattended', base.root), route: 'installation-broker' }, null, 2));
    slice.git(base.root, 'add', '--all');
    slice.git(base.root, 'commit', '--quiet', '-m', 'owner opts in to the installation broker');
    slice.git(base.root, 'push', '--quiet', 'origin', `${slice.BRANCH}:${slice.BRANCH}`);
    const w = { ...base, head: slice.git(base.root, 'rev-parse', 'HEAD').trim() };
    let session = '';
    const adapters = slice.worker(w.root, () => session);
    session = slice.sessionFor(sys, w, adapters);
    return { w, adapters };
  };

  it('with NO Host block and NO broker opt-in, nothing is composed and the turn waits (ECC SECURITY M2)', () => {
    const sys = slice.fixedClock();
    const { w } = slice.started(sys, 'unattended');
    const composed = composeGatekeeper({ sys, root: w.root }, { gateWaitMinutes: 0 });
    if (!composed.ok || composed.gatekeeper === undefined || composed.gatekeeper.mode === 'interactive') throw new Error('unattended composition expected');
    expect(composed.gatekeeper.broker).toBeUndefined();
    expect(composed.gatekeeper.hostReview).toBeUndefined();
    expect(composed.gatekeeper.mode).toBe('unattended');
  });

  it('with the committed broker opt-in the trusted BROKER is composed in the pre-hybrid shape, and the agent can resolve no credential', () => {
    const sys = slice.fixedClock();
    const { w } = brokerWorld(sys);
    const composed = composeGatekeeper({ sys, root: w.root }, { gateWaitMinutes: 0 });
    if (!composed.ok || composed.gatekeeper === undefined || composed.gatekeeper.mode === 'interactive') throw new Error('unattended composition expected');
    const gk = composed.gatekeeper;
    expect(composed.mode).toBe('unattended');
    expect(gk.mode).toBeUndefined();
    expect(gk.hostReview).toBeUndefined();
    expect(gk.broker?.governedRoot).toBe(w.root);
    expect(typeof gk.broker?.transport.post).toBe('function');
    const resolved = gk.resolver.resolve('OPENAI_GATEKEEPER_KEY');
    expect(resolved.ok).toBe(false);
  });

  it('with the opt-in, a project NOT on the installation allowlist is refused before dispatch: nothing posted, no ledger', () => {
    const sys = slice.fixedClock();
    const { w, adapters } = brokerWorld(sys);
    const run = slice.runOnce(sys, w, adapters);
    expect(run.trace).toContain('does not authorise the governed project to spend its credential');
    expect(existsSync(join(w.root, '.projectops', 'gatekeeper-ledger.json'))).toBe(false);
  });

  it('with the opt-in, an ALLOWLISTED project reaches the broker exactly once, bound to its project, phase and root; the agent resolver is never asked', () => {
    const sys = slice.fixedClock();
    const { w, adapters } = brokerWorld(sys);
    const composed = composeGatekeeper({ sys, root: w.root }, { gateWaitMinutes: 0 });
    if (!composed.ok || composed.gatekeeper === undefined || composed.gatekeeper.mode === 'interactive') throw new Error('unattended composition expected');
    const base = composed.gatekeeper;
    const posts: BrokeredCall[] = [];
    let resolverAsked = 0;
    const gatekeeper = {
      ...base,
      resolver: { resolve: (ref: string) => { resolverAsked += 1; return base.resolver.resolve(ref); } },
      broker: {
        ...base.broker!,
        installationAllows: () => ({ allowed: true, reasons: [] }),
        transport: { post: (call: BrokeredCall) => { posts.push(call); return { kind: 'transport-error' as const, detail: 'test transport: no provider' }; } },
      },
    };
    const r = runLoop(sys, w.root, {
      adapters,
      expectedDecider: composed.expectedDecider,
      gatekeeper,
      invocation: { pid: 4242, ppid: 1717, argv: ['node', 'projectos.js', 'run', '--execute'], cwd: w.root },
    });
    expect(r.ok).toBe(true);
    expect(posts).toHaveLength(1);
    const call = posts[0]!;
    expect(call.kind).toBe('gatekeeper');
    expect(call.governedRoot).toBe(w.root);
    if (call.kind === 'gatekeeper') expect(call.phaseId).toBe(slice.PHASE);
    expect(call.credentialRef).toBe(composed.gatekeeper.transport?.credentialRef);
    expect(call.body).not.toMatch(/sk-[A-Za-z0-9]/);
    expect(resolverAsked).toBe(0);
  });

  it('a committed Host block AND the broker opt-in together are refused as ambiguous', () => {
    const sys = slice.fixedClock();
    const { w } = brokerWorld(sys);
    withBlock(w.root, block, true);
    const composed = composeGatekeeper({ sys, root: w.root }, { gateWaitMinutes: 0 });
    expect(composed.ok).toBe(false);
    expect(!composed.ok && composed.lines.join('\n')).toContain('GATEKEEPER_ROUTE_AMBIGUOUS');
  });

  it('with a COMMITTED Host block (no opt-in) the Host route is used and NO broker is composed', () => {
    const sys = slice.fixedClock();
    const { w } = slice.started(sys, 'unattended');
    withBlock(w.root, block, true);
    const composed = composeGatekeeper({ sys, root: w.root }, { gateWaitMinutes: 0 });
    if (!composed.ok || composed.gatekeeper === undefined || composed.gatekeeper.mode === 'interactive') throw new Error('unattended composition expected');
    expect(typeof composed.gatekeeper.hostReview?.review).toBe('function');
    expect(composed.gatekeeper.broker).toBeUndefined();
  });

  it('an INTERACTIVE project never composes a Host route, whatever the file says', () => {
    const sys = slice.fixedClock();
    const { w } = slice.started(sys, 'interactive');
    const composed = composeGatekeeper({ sys, root: w.root }, { gateWaitMinutes: 0 });
    expect(composed.ok && composed.mode).toBe('interactive');
    expect(composed.ok && composed.gatekeeper !== undefined && 'hostReview' in composed.gatekeeper).toBe(false);
  });
});

// -------------------------------------------------------------------------------------------------

describe('`projectos reconcile` and `projectos closure`, unattended, through the production Host review client', () => {
  it('reconcile discharges the debt on the Host attestation, with the Host provenance', () => {
    const w = cr.reconcileWorld('unattended');
    // A reconciliation grants nothing: in this world `commit` and `push` are owner-only, and an answer
    // granting them is refused by the existing floor (proven below).
    const { host, client } = hostAndClient('approve', []);

    const r = reconcile(w.ctx, cr.RECONCILE, { hostReview: client });

    expect(r.code, cr.text(r.lines)).toBe(0);
    expect(host.providerCalls).toBe(1);
    expect(cr.durableReconciliations()).toHaveLength(1);
    const [evidence] = cr.decisionEvidence(w.root);
    expect(evidence?.['provenance']).toBe('HostIndependentProviderAttestation');
    expect(evidence?.['hostAttestationId']).toMatch(/^[0-9a-f]{64}$/);
    expect(cr.filesIn(w.root, GATEKEEPER_INTERACTIVE_REL)).toEqual([]);
  });

  it('a Host answer GRANTING an owner-only action is refused by the existing owner floor, and the debt stands', () => {
    const w = cr.reconcileWorld('unattended');
    const { host, client } = hostAndClient('approve', ['commit', 'push']);
    const r = reconcile(w.ctx, cr.RECONCILE, { hostReview: client });
    expect(r.code).toBe(2);
    expect(cr.text(r.lines)).toMatch(/DECISION_REFUSED[\s\S]*owner-only action/);
    expect(host.providerCalls).toBe(1);
    expect(cr.durableReconciliations()).toEqual([]);
  });

  it('reconcile against a Host that is not accepting WAITS, and the debt stands', () => {
    const w = cr.reconcileWorld('unattended');
    const { host, client } = hostAndClient('not-accepting');
    const r = reconcile(w.ctx, cr.RECONCILE, { hostReview: client });
    expect(r.code).toBe(2);
    expect(cr.text(r.lines)).toContain('UNAVAILABLE');
    expect(host.providerCalls).toBe(0);
    expect(cr.durableReconciliations()).toEqual([]);
    expect(cr.filesIn(w.root, GATEKEEPER_INTERACTIVE_REL)).toEqual([]);
  });

  it('a valid closure review proceeds through the ACTUAL hybrid closure path to CLOSED', () => {
    const w = cr.world('unattended');
    cr.startAndDeliverPhase(w);
    const { host, client } = hostAndClient();

    const asked = closureRequest(w.ctx, { id: cr.PHASE, execute: true }, cr.hostClosureDeps(client));

    expect(asked.code, cr.text(asked.lines)).toBe(0);
    expect(host.providerCalls).toBe(1);
    expect(cr.text(asked.lines)).toContain('closure decision provenance: HostIndependentProviderAttestation');
    const wait = readClosureWait(w.ctx.sys, w.root, cr.PHASE);
    expect(wait.ok && wait.value?.provenance).toBe('HostIndependentProviderAttestation');
    expect(wait.ok && wait.value?.hostAttestationId).toMatch(/^[0-9a-f]{64}$/);
    const [record] = [...host.outbox.values()].map((b) => JSON.parse(b.toString('utf8')) as { ask: string; declared: Record<string, string> });
    expect(record!.ask).toBe('closure');
    expect(record!.declared['scope']).toBe('phase-closure');
    expect(cr.filesIn(w.root, CLOSURE_INTERACTIVE_REL)).toEqual([]);

    // THE OWNER STILL COMMITS, AND ONLY THEN DOES THE PHASE CLOSE. The attestation vouched that an
    // independent provider said "close"; it closed nothing.
    expect(cr.phaseRecord(w.root).status).toBe('awaiting_closure');
    cr.ownerCommits(w.root);
    const resumed = closure(w.ctx, { id: cr.PHASE }, ['resume']);
    expect(resumed.code, cr.text(resumed.lines)).toBe(0);
    expect(cr.phaseRecord(w.root).status).toBe('closed');
  });

  it.each([
    ['not-accepting', 'UNAVAILABLE'],
    ['provider-unavailable', 'UNAVAILABLE'],
    ['wrong-phase', 'ANSWER_REFUSED'],
    ['invalid-attestation', 'ANSWER_REFUSED'],
  ] as const)('a closure against a Host that is %s fails closed (%s): no decision is written', (behaviour, code) => {
    const w = cr.world('unattended');
    cr.startAndDeliverPhase(w);
    const { client } = hostAndClient(behaviour);
    const r = closureRequest(w.ctx, { id: cr.PHASE, execute: true }, cr.hostClosureDeps(client));
    expect(r.code).toBe(2);
    expect(cr.text(r.lines)).toContain(code);
    expect(existsSync(join(w.root, '.projectops', 'closure', 'decisions', `${cr.PHASE}.json`))).toBe(false);
    expect(cr.phaseRecord(w.root).status).toBe('awaiting_closure');
    expect(cr.filesIn(w.root, CLOSURE_INTERACTIVE_REL)).toEqual([]);
  });
});

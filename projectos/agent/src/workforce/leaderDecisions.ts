/**
 * What the project leader may DECIDE — and the long list of things it may not.
 *
 * The leader may sequence work, record operational notes, declare a panel within the contract, and
 * resolve a contradiction ONLY when no protected, critical or high-risk fact is involved. Everything
 * that needs authority — approving its own work or a specialist's protected action, deploying,
 * mutating production data, communicating, paying, using a credential, changing governance or the
 * workforce configuration, registry eligibility, selection policy or model policy, expanding scope,
 * accepting an unresolved critical or high risk, closing a phase, going around the gatekeeper or the
 * owner, minting authority, or widening the team — is refused by the gate that already owns it and
 * recorded. The leader's own instructions play no part in the refusal.
 */
import { validatePanelDeclaration } from './contracts.js';
import { currentTeam, openContradictions, panelState } from './dispatch.js';
import { WorkforceRefusal, type WorkforceStore } from './eventStore.js';
import { assertCurrentGeneration } from './leader.js';
import { requestProtectedAction, type ProtectedActionClass } from './protectedActions.js';
import { PROTECTED_FACTS, type RiskFact, type WorkforceGovernance } from './types.js';

export type LeaderDecisionKind =
  | 'sequence-tasks'
  | 'operational-note'
  | 'approve-own-work'
  | 'approve-protected-action'
  | 'approve-production-deployment'
  | 'approve-production-database-mutation'
  | 'approve-live-communication'
  | 'approve-payment-or-refund'
  | 'use-credential'
  | 'change-governance'
  | 'change-workforce-configuration'
  | 'change-registry-eligibility'
  | 'change-selection-policy'
  | 'change-model-policy'
  | 'expand-scope'
  | 'accept-risk'
  | 'close-phase'
  | 'bypass-gatekeeper'
  | 'bypass-owner'
  | 'mint-authority'
  | 'add-team-member';

/** Each prohibited decision and the protected class whose owning gate refuses it. */
export const PROHIBITED_DECISIONS: Readonly<Record<Exclude<LeaderDecisionKind, 'sequence-tasks' | 'operational-note'>, ProtectedActionClass>> = {
  'approve-own-work': 'self-approval',
  'approve-protected-action': 'self-approval',
  'approve-production-deployment': 'production-deployment',
  'approve-production-database-mutation': 'production-database-mutation',
  'approve-live-communication': 'live-communication',
  'approve-payment-or-refund': 'payment-or-refund',
  'use-credential': 'credential-use',
  'change-governance': 'governance-change',
  'change-workforce-configuration': 'workforce-configuration-change',
  'change-registry-eligibility': 'workforce-configuration-change',
  'change-selection-policy': 'workforce-configuration-change',
  'change-model-policy': 'workforce-configuration-change',
  'expand-scope': 'scope-expansion',
  'accept-risk': 'risk-acceptance',
  'close-phase': 'phase-closure',
  'bypass-gatekeeper': 'gate-bypass',
  'bypass-owner': 'gate-bypass',
  'mint-authority': 'authority-mint',
  'add-team-member': 'scope-expansion',
};

export type DecisionOutcome =
  | { readonly accepted: true; readonly kind: string }
  | { readonly accepted: false; readonly kind: string; readonly gate: string; readonly reason: string };

function locked<T>(store: WorkforceStore, generation: number, gov: WorkforceGovernance, fn: () => T): T | DecisionOutcome {
  try {
    return store.withLock(() => {
      assertCurrentGeneration(store, generation, store.sys.now(), gov.config.leader.leaseBoundMs);
      return fn();
    });
  } catch (e) {
    if (e instanceof WorkforceRefusal) return { accepted: false, kind: 'unknown', gate: 'leader', reason: `${e.code}: ${e.reason}` };
    throw e;
  }
}

/** Record a leader decision, or refuse it through the owning gate. */
export function recordLeaderDecision(
  store: WorkforceStore,
  gov: WorkforceGovernance,
  generation: number,
  decision: { readonly kind: unknown; readonly detail: unknown },
): DecisionOutcome {
  const kind = String(decision.kind);
  const detail = typeof decision.detail === 'string' ? decision.detail.slice(0, 2000) : '';
  return locked(store, generation, gov, (): DecisionOutcome => {
    if (kind === 'sequence-tasks' || kind === 'operational-note') {
      store.append('leader-decision-recorded', generation, { kind, detail });
      return { accepted: true, kind };
    }
    const cls = Object.prototype.hasOwnProperty.call(PROHIBITED_DECISIONS, kind)
      ? PROHIBITED_DECISIONS[kind as keyof typeof PROHIBITED_DECISIONS]
      : ('gate-bypass' as const);
    const verdict = requestProtectedAction({ actionClass: cls, requestedBy: 'project-leader', at: store.sys.now() });
    const reason = verdict.reasons.join('; ');
    store.append('leader-decision-refused', generation, { kind, gate: verdict.gate, reason, escalateTo: verdict.escalateTo });
    return { accepted: false, kind, gate: verdict.gate, reason };
  }) as DecisionOutcome;
}

/**
 * Resolve a contradiction. The leader may, with a recorded rationale, only when no protected fact is
 * on the team and neither side is CRITICAL or HIGH; otherwise it goes to the owner and nothing is
 * resolved here.
 */
export function resolveContradiction(
  store: WorkforceStore,
  gov: WorkforceGovernance,
  generation: number,
  input: { readonly contradictionId: string; readonly rationale: string },
): DecisionOutcome {
  return locked(store, generation, gov, (): DecisionOutcome => {
    const events = store.readVerified();
    const c = openContradictions(events).find((x) => x.contradictionId === input.contradictionId);
    if (c === undefined) return { accepted: false, kind: 'contradiction-resolution', gate: 'ledger', reason: 'no such open contradiction' };
    if (c.escalated) return { accepted: false, kind: 'contradiction-resolution', gate: 'owner', reason: 'this contradiction was escalated to the owner; only the owner’s recorded decision closes it' };
    if (input.rationale.trim().length === 0) return { accepted: false, kind: 'contradiction-resolution', gate: 'ledger', reason: 'a resolution needs a recorded rationale' };
    const rec = events.find((e) => e.type === 'contradiction-recorded' && e.payload['contradictionId'] === input.contradictionId);
    const severities = ((rec?.payload['results'] as { severity?: unknown }[] | undefined) ?? []).map((r) => String(r.severity));
    // THE FACTS ARE THE RECORDED TEAM'S, read from the events — never supplied by the caller.
    const teamFacts = (currentTeam(events, generation)?.riskFacts ?? []) as readonly RiskFact[];
    const protectedFacts = teamFacts.filter((f) => PROTECTED_FACTS.includes(f));
    const serious = severities.filter((sv) => sv === 'critical' || sv === 'high');
    if (protectedFacts.length > 0 || serious.length > 0) {
      const reason =
        `the leader may not resolve it: ${[...protectedFacts.map((f) => `protected fact '${f}'`), ...serious.map((sv) => `${sv} severity`)].join(', ')} ` +
        'is involved, so it goes to its owning gate or the owner';
      store.append('contradiction-escalated', generation, { contradictionId: input.contradictionId, to: 'owner', reason, question: `resolve contradiction ${input.contradictionId} on '${c.subject}'` });
      return { accepted: false, kind: 'contradiction-resolution', gate: 'owner', reason };
    }
    store.append('contradiction-resolved', generation, { contradictionId: input.contradictionId, rationale: input.rationale.slice(0, 2000) });
    return { accepted: true, kind: 'contradiction-resolution' };
  }) as DecisionOutcome;
}

/** A panel runs only after ProjectOS validates and records its complete declaration. */
export function declarePanel(store: WorkforceStore, gov: WorkforceGovernance, generation: number, declaration: unknown): DecisionOutcome {
  return locked(store, generation, gov, (): DecisionOutcome => {
    const problems = validatePanelDeclaration(declaration);
    if (problems.length === 0) {
      // GOVERNANCE CAPS what a leader may declare, and a panel is declared once per generation.
      const d = declaration as Record<string, number | string>;
      const caps = gov.config.panels;
      if (Number(d['maxRounds']) > caps.maxRounds) problems.push(`maxRounds exceeds the governance cap of ${caps.maxRounds}`);
      if (Number(d['costBudgetUnits']) > caps.maxCostUnits) problems.push(`costBudgetUnits exceeds the governance cap of ${caps.maxCostUnits}`);
      if (Number(d['contextBudgetBytes']) > caps.maxContextBytes) problems.push(`contextBudgetBytes exceeds the governance cap of ${caps.maxContextBytes}`);
      if (panelState(store.readVerified(), generation, String(d['panelId'])) !== null) problems.push(`panel '${String(d['panelId'])}' was already declared; a declaration is never reset`);
    }
    if (problems.length > 0) {
      store.append('panel-refused', generation, { panelId: String((declaration as Record<string, unknown> | null)?.['panelId'] ?? ''), reason: problems.join('; ') });
      return { accepted: false, kind: 'panel', gate: 'panel contract', reason: problems.join('; ') };
    }
    store.append('panel-declared', generation, { panel: declaration as Record<string, unknown> });
    return { accepted: true, kind: 'panel' };
  }) as DecisionOutcome;
}

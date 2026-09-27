/**
 * Dynamic minimum-team selection: ONE ProjectOS-owned deterministic function.
 *
 * Its only inputs are the task facts (derived by ProjectOS, supplemented raise-only by the leader),
 * the registry and the selection policy — with the configuration and model policy that say what a role
 * may do and on which model. The same inputs always produce the same team, and every member carries
 * the facts that required it. Declared risk facts force mandatory roles; the independent reviewer is
 * assigned by this same function, never by the leader. A role not eligible for the model that would
 * execute it is never selected; if it is mandatory the whole selection is refused rather than quietly
 * shrunk. A selection that exceeds a bound is reduced (supporting roles only, with a recorded reason)
 * or refused. No role is selected merely because it exists: only the policy's routes name candidates.
 */
import { digestOf } from './canonical.js';
import { resolveRoleModel } from './models.js';
import { effectiveRole, findEntry, type EffectiveRole } from './registry.js';
import type { TaskFacts } from './facts.js';
import { COST_CLASSES, RISK_FACTS, type WorkforceGovernance } from './types.js';

export type Assignment = 'contribute' | 'independent-review';

export interface TeamMember {
  readonly roleId: string;
  readonly roleVersion: number;
  readonly assignment: Assignment;
  readonly mandatory: boolean;
  readonly modelRef: string;
  readonly reasons: readonly string[];
}

export interface TeamSelection {
  readonly taskType: TaskFacts['taskType'];
  readonly riskLevel: TaskFacts['riskLevel'];
  readonly riskFacts: TaskFacts['riskFacts'];
  readonly members: readonly TeamMember[];
  readonly excluded: readonly { readonly roleId: string; readonly reason: string }[];
  readonly reductions: readonly string[];
  readonly independentReviewRequired: boolean;
  readonly versions: { readonly registry: string; readonly selectionPolicy: string; readonly modelPolicy: string; readonly config: string };
  readonly digests: {
    readonly inputs: string;
    readonly selection: string;
    readonly registry: string;
    readonly selectionPolicy: string;
    readonly modelPolicy: string;
    readonly config: string;
  };
}

export type SelectionOutcome =
  | { readonly ok: true; readonly team: TeamSelection }
  | { readonly ok: false; readonly code: string; readonly reasons: readonly string[] };

interface Candidate {
  readonly roleId: string;
  mandatory: boolean;
  readonly reasons: string[];
}

const costRank = (c: string): number => COST_CLASSES.indexOf(c as never);
const riskRank = (r: string): number => ['low', 'medium', 'high', 'critical'].indexOf(r);

/** Why this role may not serve, or null when it may; plus the model it would run on. */
function vet(role: EffectiveRole | undefined, gov: WorkforceGovernance): { readonly problem: string | null; readonly modelRef: string } {
  if (role === undefined) return { problem: 'not registered', modelRef: '' };
  if (!role.configured) return { problem: 'no ProjectOS configuration grants it anything', modelRef: '' };
  if (costRank(role.costClass) > costRank(gov.config.bounds.maxCostClass)) {
    return { problem: `cost class '${role.costClass}' exceeds the bound '${gov.config.bounds.maxCostClass}'`, modelRef: '' };
  }
  const model = resolveRoleModel(role, gov.modelPolicy);
  if (!model.ok) return { problem: `${model.code}: ${model.reason}`, modelRef: '' };
  return { problem: null, modelRef: model.modelRef };
}

export function selectTeam(facts: TaskFacts, gov: WorkforceGovernance): SelectionOutcome {
  const bounds = gov.config.bounds;
  if (riskRank(facts.criticality) > riskRank(bounds.maxCriticality)) {
    return {
      ok: false,
      code: 'CRITICALITY_ABOVE_BOUND',
      reasons: [`task criticality '${facts.criticality}' exceeds the workforce bound '${bounds.maxCriticality}'; it escalates to the owner`],
    };
  }
  const route = gov.selectionPolicy.taskTypes[facts.taskType];
  const order: Candidate[] = [];
  const add = (ids: readonly string[], mandatory: boolean, reason: string): void => {
    for (const roleId of ids) {
      const found = order.find((c) => c.roleId === roleId);
      if (found === undefined) order.push({ roleId, mandatory, reasons: [reason] });
      else {
        found.reasons.push(reason);
        found.mandatory = found.mandatory || mandatory;
      }
    }
  };
  add(route.roles, true, `mandatory for task type '${facts.taskType}'`);
  for (const fact of RISK_FACTS) {
    if (facts.riskFacts.includes(fact)) add(gov.selectionPolicy.factRoles[fact] ?? [], true, `required by declared fact '${fact}'`);
  }
  add(route.supportingRoles, false, `supporting role for task type '${facts.taskType}' (joins only within bounds)`);

  const roleOf = (id: string): EffectiveRole | undefined => {
    const entry = findEntry(gov.registry, id);
    return entry === undefined ? undefined : effectiveRole(entry, gov.config);
  };

  const refusals: string[] = [];
  const excluded: { roleId: string; reason: string }[] = [];
  const reductions: string[] = [];
  const members: TeamMember[] = [];
  for (const c of order) {
    const role = roleOf(c.roleId);
    const v = vet(role, gov);
    if (v.problem !== null || role === undefined) {
      if (c.mandatory) refusals.push(`mandatory role '${c.roleId}' cannot serve: ${v.problem ?? 'unknown'}`);
      else excluded.push({ roleId: c.roleId, reason: v.problem ?? 'unknown' });
      continue;
    }
    members.push({ roleId: c.roleId, roleVersion: role.version, assignment: 'contribute', mandatory: c.mandatory, modelRef: v.modelRef, reasons: c.reasons });
  }

  const review = gov.selectionPolicy.independentReview;
  const reviewRequired =
    review.requiredAtRisk.includes(facts.riskLevel) || facts.riskFacts.some((f) => review.requiredForFacts.includes(f));
  if (reviewRequired) {
    const lists: { key: string; ids: readonly string[] }[] = [];
    for (const fact of RISK_FACTS) {
      const ids = facts.riskFacts.includes(fact) ? review.reviewers[fact] : undefined;
      if (ids !== undefined) lists.push({ key: `fact '${fact}'`, ids });
    }
    lists.push({ key: 'the default reviewer list', ids: review.reviewers.default ?? [] });
    const contributors = new Set(members.map((m) => m.roleId));
    let chosen: TeamMember | null = null;
    const passedOver: string[] = [];
    for (const list of lists) {
      for (const id of list.ids) {
        if (chosen !== null) break;
        if (contributors.has(id)) {
          passedOver.push(`'${id}' contributes to this work, so it cannot review it independently`);
          continue;
        }
        const role = roleOf(id);
        const v = vet(role, gov);
        if (v.problem !== null || role === undefined) {
          passedOver.push(`'${id}': ${v.problem ?? 'unknown'}`);
          continue;
        }
        if (!role.review) {
          passedOver.push(`'${id}' is not configured as a review role`);
          continue;
        }
        const why = reviewRequiredReason(facts, review.requiredAtRisk, review.requiredForFacts);
        chosen = { roleId: id, roleVersion: role.version, assignment: 'independent-review', mandatory: true, modelRef: v.modelRef, reasons: [`independent reviewer (${why}), from ${list.key}`] };
      }
    }
    if (chosen === null) refusals.push(`an independent reviewer is required and none can serve: ${passedOver.join('; ') || 'no candidates'}`);
    else members.push(chosen);
  }

  const maxTeam = Math.min(route.maxTeam, bounds.maxTeamSize);
  while (members.length > maxTeam) {
    const idx = members.map((m) => !m.mandatory && m.assignment === 'contribute').lastIndexOf(true);
    if (idx < 0) break;
    const [dropped] = members.splice(idx, 1);
    if (dropped !== undefined) reductions.push(`supporting role '${dropped.roleId}' dropped: the team would exceed its bound of ${maxTeam}`);
  }
  if (members.length > maxTeam) refusals.push(`the mandatory team (${members.length}) exceeds its bound of ${maxTeam}`);
  if (refusals.length > 0) return { ok: false, code: 'SELECTION_REFUSED', reasons: refusals };

  const versions = {
    registry: gov.registry.registryVersion,
    selectionPolicy: gov.selectionPolicy.policyVersion,
    modelPolicy: gov.modelPolicy.policyVersion,
    config: gov.config.configVersion,
  };
  const inputs = digestOf({
    facts: { taskType: facts.taskType, riskLevel: facts.riskLevel, riskFacts: facts.riskFacts, criticality: facts.criticality },
    digests: gov.digests,
  });
  const body = { taskType: facts.taskType, members, excluded, reductions, independentReviewRequired: reviewRequired, versions };
  return {
    ok: true,
    team: {
      taskType: facts.taskType,
      riskLevel: facts.riskLevel,
      riskFacts: facts.riskFacts,
      members,
      excluded,
      reductions,
      independentReviewRequired: reviewRequired,
      versions,
      digests: {
        inputs,
        selection: digestOf(body),
        registry: gov.digests.registry,
        selectionPolicy: gov.digests.selectionPolicy,
        modelPolicy: gov.digests.modelPolicy,
        config: gov.digests.config,
      },
    },
  };
}

function reviewRequiredReason(facts: TaskFacts, atRisk: readonly string[], forFacts: readonly string[]): string {
  const hits = facts.riskFacts.filter((f) => forFacts.includes(f)).map((f) => `fact '${f}'`);
  if (atRisk.includes(facts.riskLevel)) hits.unshift(`risk '${facts.riskLevel}'`);
  return `required by ${hits.join(', ')}`;
}

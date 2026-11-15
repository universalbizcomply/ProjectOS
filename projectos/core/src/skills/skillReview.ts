// Origin: original ProjectOS code
/**
 * THE INDEPENDENT REVIEW IS A PORT THAT ANSWERS EXACTLY `true` (PROJECTOS-SKILLS-ADOPT1A, plan 3.2).
 *
 * PROMOTING A SKILL IS AN ACTION, AND IT IS A PROPOSAL UNTIL SOMEONE WHO IS NOT THE AUTHOR HAS ANSWERED FOR IT. The registry's
 * `approve` (P5) is the action; this file is the question. A decision record by itself is not that answer: it is a file, and an
 * actor label is a string until the kernel issues it (PORT-SKILLS1A, "Limits"). So the answer comes from a VERIFIER the caller
 * injects, asked once with a frozen claim that names exactly what is being vouched for:
 *
 *   the action (`approve`, P5), the tenant and the project, the skill's name, the sha-256 of its package, the hash of the proposal
 *   the reviewer read, who wrote it and in which session, and who reviewed it and in which session.
 *
 * Only the boolean `true` is an answer. A throw, a Promise, `1`, `"true"` and an object are not, and a missing verifier is not
 * one either: with none, nothing is promoted and nothing is loaded (`SKILL_REVIEW_VERIFIER_MISSING`).
 *
 * THERE IS NO PRODUCTION VERIFIER YET, AND THIS FILE DOES NOT PRETEND THERE IS. The reviewer's identity is not kernel-issued and the
 * pin is not signed, so no implementation can honestly answer for the owner. It is the same position as the memory-delete owner
 * verifier (`retention.ts`): the port, a fake in the tests, and a refusal until an owner-presence verifier exists.
 *
 * THE SAME QUESTION IS ASKED AGAIN WHEN A SKILL IS LOADED (`purpose: 'load'`), over the facts the committed pin records, so a
 * hand-written promoted record that no reviewer ever answered for is not read (PORT-SKILLS1A, "BINDING: sign the pin or
 * kernel-issue the actor before any loader reads a promoted skill").
 *
 * A PROMOTION NEEDS AN ATTESTATION MADE HERE. The proposals a verifier answered `true` for are registered by identity in a
 * `WeakMap`; `promoteSkill` reads it. A copy, a file and a JSON round-trip are not in it. `recordSkillAttestation` and
 * `skillAttestationOf` are not exported from the core barrel.
 *
 * Pure: no I/O. The verifier is the caller's.
 */
import type { Role } from '../types.js';
import { skillOk, skillRefused, type SkillResult } from './refusal.js';
import { SKILL_ORIGINS, snapshotSkillActor, type SkillOrigin } from './skillOrigin.js';

/** The registry's `approve`, P5: what a promotion is. Pinned against `security/action-registry.json` by the validator. */
export const SKILL_APPROVE_ACTION = Object.freeze({ id: 'approve', class: 'P5' } as const);
/** The registry's `skill-load`, P1: loading a promoted, hash-pinned skill into a run's context file. */
export const SKILL_LOAD_ACTION = Object.freeze({ id: 'skill-load', class: 'P1' } as const);

export const SKILL_REVIEW_PURPOSES = ['promotion', 'load'] as const;
export type SkillReviewPurpose = (typeof SKILL_REVIEW_PURPOSES)[number];

/** Whose project this is, from the checkout's own registration. Never read from a request, a proposal or a skill. */
export interface SkillBinding {
  readonly tenant: string;
  readonly project: string;
}

/** What a review vouches for. Every field is a closed shape, because the verifier may act on them. */
export interface SkillReviewFacts {
  readonly name: string;
  readonly packageHash: string;
  readonly proposalHash: string;
  readonly author: string;
  readonly authorSession: string;
  readonly reviewer: string;
  readonly reviewerRole: Role;
  readonly reviewerSession: string;
  /** Where the text came from, and the rules it passed: the verifier sees both (PROJECTOS-SKILLS-ADOPT1A, review round 1, M4). */
  readonly origin: SkillOrigin;
  readonly rulesVersion: string;
  /** When the review was recorded. */
  readonly reviewedAt: string;
}

export interface SkillReviewClaim extends SkillReviewFacts, SkillBinding {
  readonly action: typeof SKILL_APPROVE_ACTION.id;
  readonly actionClass: typeof SKILL_APPROVE_ACTION.class;
  readonly purpose: SkillReviewPurpose;
}

/** The injected check. It must answer exactly `true`; the one thing it may not be is the caller's own say-so. */
export type SkillReviewVerifier = (claim: SkillReviewClaim) => boolean;

const LABEL = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/;
const SCOPE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SKILL_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
const RULES_VERSION = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,63}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const ROLE_NAMES: readonly string[] = ['owner', 'advisor', 'implementer'];

const isText = (value: unknown): value is string => typeof value === 'string';
const is = (pattern: RegExp, value: unknown): value is string => isText(value) && pattern.test(value);
const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** The binding, read once into a frozen copy, or null. A getter answers differently the second time it is read. */
export function skillBindingOf(raw: unknown): SkillBinding | null {
  try {
    if (raw === null || typeof raw !== 'object') return null;
    const tenant = Object.getOwnPropertyDescriptor(raw, 'tenant');
    const project = Object.getOwnPropertyDescriptor(raw, 'project');
    if (tenant === undefined || project === undefined || !('value' in tenant) || !('value' in project)) return null;
    return is(SCOPE_ID, tenant.value) && is(SCOPE_ID, project.value) ? Object.freeze({ tenant: tenant.value, project: project.value }) : null;
  } catch {
    return null;
  }
}

/**
 * The claim for one review, or the reason there is none. The author does not review, and not under another spelling of the
 * same label or in the session that wrote it. A refusal quotes none of the values.
 */
export function skillReviewClaimOf(purpose: SkillReviewPurpose, rawBinding: unknown, facts: SkillReviewFacts): SkillResult<SkillReviewClaim> {
  const binding = skillBindingOf(rawBinding);
  if (binding === null) return skillRefused('SKILL_BINDING_INVALID', 'The review names no tenant and project of this checkout, so no one is asked.');
  const whole =
    (purpose === 'promotion' || purpose === 'load') &&
    is(SKILL_NAME, facts.name) &&
    is(HASH, facts.packageHash) &&
    is(HASH, facts.proposalHash) &&
    is(LABEL, facts.author) &&
    is(LABEL, facts.authorSession) &&
    is(LABEL, facts.reviewer) &&
    is(LABEL, facts.reviewerSession) &&
    isText(facts.reviewerRole) &&
    ROLE_NAMES.includes(facts.reviewerRole) &&
    isText(facts.origin) &&
    (SKILL_ORIGINS as readonly string[]).includes(facts.origin) &&
    is(RULES_VERSION, facts.rulesVersion) &&
    is(INSTANT, facts.reviewedAt);
  if (!whole) return skillRefused('SKILL_BINDING_INVALID', 'The review does not name the skill, its hashes, its author and its reviewer, each as a closed shape, so no one is asked.');
  if (same(facts.reviewer, facts.author) || same(facts.reviewerSession, facts.authorSession)) {
    return skillRefused('SKILL_NOT_INDEPENDENT', 'The author of a skill, or the session that wrote it, does not review it.');
  }
  return skillOk(
    Object.freeze({
      action: SKILL_APPROVE_ACTION.id,
      actionClass: SKILL_APPROVE_ACTION.class,
      purpose,
      tenant: binding.tenant,
      project: binding.project,
      name: facts.name,
      packageHash: facts.packageHash,
      proposalHash: facts.proposalHash,
      author: facts.author,
      authorSession: facts.authorSession,
      reviewer: facts.reviewer,
      reviewerRole: facts.reviewerRole,
      reviewerSession: facts.reviewerSession,
      origin: facts.origin,
      rulesVersion: facts.rulesVersion,
      reviewedAt: facts.reviewedAt,
    }),
  );
}

/** Ask once. Only the boolean `true` is an answer; a throw, a Promise and every other value is not. */
export function askSkillReviewVerifier(verifier: unknown, claim: SkillReviewClaim): SkillResult<SkillReviewClaim> {
  if (typeof verifier !== 'function') {
    return skillRefused('SKILL_REVIEW_VERIFIER_MISSING', 'There is no verifier that can answer for the reviewer, so nothing is promoted or loaded. The owner supplies one, then asks again.');
  }
  let answer: unknown;
  try {
    answer = (verifier as SkillReviewVerifier)(claim);
  } catch {
    answer = undefined;
  }
  return answer === true ? skillOk(claim) : skillRefused('SKILL_REVIEW_NOT_VERIFIED', 'The verifier did not vouch for this review of this package, so it stays a proposal.');
}

/** The proposals a verifier vouched for, by identity, with the claim it answered. A copy of one is not in here. */
const ATTESTED: WeakMap<object, SkillReviewClaim> = new WeakMap();

/** Not exported from the barrel. `attestSkillReview` is the one caller. */
export function skillAttestationOf(subject: object): SkillReviewClaim | undefined {
  return ATTESTED.get(subject);
}

/** What `attestSkillReview` needs to know of a decided proposal. */
export interface SkillReviewSubject {
  readonly name: string;
  readonly packageHash: string;
  readonly proposalHash: string;
  readonly tenant: string | null;
  readonly project: string | null;
  readonly origin: SkillOrigin;
  readonly rulesVersion: string;
  readonly decision: { readonly at: string } | null;
  readonly provenance: { readonly author: string; readonly session: string };
}

export interface SkillReviewer {
  readonly actor: string;
  readonly role: Role;
  readonly session: string;
}

/**
 * Ask the verifier about one approved proposal and, only when it answers `true`, register that object as attested. The claim is
 * built from the proposal's own hashes and the checkout's binding, never from anything the reviewer or the proposal text says.
 */
export function attestSkillReview(subject: SkillReviewSubject, rawReviewer: unknown, binding: unknown, verifier: unknown): SkillResult<SkillReviewClaim> {
  // The reviewer is read once, from data: a getter that answers twice differently is no one.
  const reviewer = snapshotSkillActor(rawReviewer);
  if (reviewer === null) return skillRefused('SKILL_PROVENANCE', 'A review names a plain reviewer, role and session as data, so no one is asked.');
  const claim = skillReviewClaimOf('promotion', binding, {
    name: subject.name,
    packageHash: subject.packageHash,
    proposalHash: subject.proposalHash,
    author: subject.provenance.author,
    authorSession: subject.provenance.session,
    reviewer: reviewer.actor,
    reviewerRole: reviewer.role,
    reviewerSession: reviewer.session,
    origin: subject.origin,
    rulesVersion: subject.rulesVersion,
    reviewedAt: subject.decision?.at ?? '',
  });
  if (!claim.ok) return claim;
  // THE PROPOSAL WAS MADE FOR ONE TENANT AND PROJECT, and only the checkout of that project may review it.
  if (subject.tenant === null || subject.project === null) {
    return skillRefused('SKILL_BINDING_INVALID', 'This proposal was made with no tenant and project, so no one is asked. Fix: the owner re-proposes it through a door that is given the checkout.');
  }
  if (claim.value.tenant !== subject.tenant || claim.value.project !== subject.project) {
    return skillRefused('SKILL_NOT_THIS_CHECKOUT', 'This proposal was made for another tenant or project than this checkout. Fix: the owner re-proposes it from the checkout of the project it is for.');
  }
  const answered = askSkillReviewVerifier(verifier, claim.value);
  if (answered.ok) ATTESTED.set(subject, answered.value);
  return answered;
}

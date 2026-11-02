// SPDX-License-Identifier: MIT
// Ported-From: hermes-agent https://github.com/NousResearch/hermes-agent
// Source-Path: tools/write_approval.py
// Source-Commit: d3e586881eacb132595edcbe4c170be8381e40c5
// Source-Copyright: Copyright (c) 2025 Nous Research
// Port-Strategy: ADAPT
// Modified-By: ProjectOS 2026-11-01: modified for ProjectOS. CHANGED: adapted through the memory proposal rules, which carry this credit; every write staged and decided, now by an independent reviewer rather than the owner alone, over a package and not an entry
// SPDX-License-Identifier: MIT
// Ported-From: oh-my-hermes https://github.com/rlaope/oh-my-hermes
// Source-Path: src/plugin_bundle/omh/memory_admission.py
// Source-Commit: 612a1cd9c44a19ecddcd263865e40e8c3910a514
// Source-Copyright: Copyright (c) 2026 oh-my-hermes contributors
// Port-Strategy: ADAPT
// Modified-By: ProjectOS 2026-11-01: modified for ProjectOS. CHANGED: the mandatory reviewed hash, adapted through the memory proposal rules, which carry this credit
// Notice: full licence text in THIRD_PARTY_NOTICES
/**
 * A skill is proposed, and it is promoted by nobody who proposed it.
 *
 * The refused behaviour is an agent that writes its own skills and a background job that rewrites them. Here
 * an agent may only propose. Promotion needs three things, and none stands in for another:
 *
 *  1. A validator pass, over the exact text, at proposal and again at promotion.
 *  2. An independent review: an advisor or the owner, as a different actor, in a different session.
 *  3. A hash pin. The review names the hash it read, and the pin names the package it promoted, so one
 *     changed byte anywhere is stale.
 *
 * WHAT A SKILL CANNOT DO. Nothing in here reads a skill's text to decide anything. A file that says it was
 * reviewed, a frontmatter key that says `approved: true`, a line that says the owner agreed: each is text, and
 * text has no route to `state`, `decision` or the pin. The only inputs to a decision are the caller the kernel
 * supplied and the hash that caller reviewed.
 *
 * WHAT A PROMOTION IS NOT. It lets one package be read as data. It is not a gate receipt, grants no tool, and
 * proves nothing about a phase, a plan or a decision.
 *
 * Everything here is pure. The agent persists what it returns.
 */
import { createHash } from 'node:crypto';
import { ROLES, type Role } from '../types.js';
import type { HashPinnedOutcome, HashPinnedProposal } from '../memory/hashPinned.js';
import { skillOk, skillRefused, type SkillRefused, type SkillResult } from './refusal.js';
import { skillPackageHash, validateSkillPackage, type SkillFile, type SkillValidation } from './skillPackage.js';

export const SKILL_PROPOSAL_STATES = ['pending', 'approved', 'promoted', 'rejected'] as const;
export type SkillProposalState = (typeof SKILL_PROPOSAL_STATES)[number];
export type SkillDecisionOutcome = HashPinnedOutcome;

/** Who may review. An implementer never does, whoever it is. */
export const SKILL_REVIEWER_ROLES: readonly Role[] = ['advisor', 'owner'];

const SKILL_PROPOSAL_SCHEMA = 'projectos.skill-proposal/1';
const PROMOTED_SKILL_SCHEMA = 'projectos.promoted-skill/1';
const PROPOSAL_ID = /^skl-[0-9a-f]{24}$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
/** A closed shape, because these values reach a prompt and a file name. Text would need its own scan. */
const ACTOR_LABEL = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

/** Who is acting, from the kernel. Never read from a request, a proposal or a skill. */
export interface SkillActor {
  readonly actor: string;
  readonly role: Role;
  readonly session: string;
}

export interface SkillProvenance {
  readonly author: string;
  readonly authorRole: Role;
  readonly session: string;
  readonly proposedAt: string;
}

interface SkillProposalBody {
  readonly name: string;
  readonly description: string;
  readonly version: string | null;
  readonly files: readonly SkillFile[];
  readonly packageHash: string;
  /** The active package this replaces, or null for a new name. Any other active package makes this stale. */
  readonly supersedes: string | null;
  /** What the validator wants the reviewer to read. Recomputed, never trusted from a file. */
  readonly advisories: readonly string[];
  readonly rulesVersion: string;
  readonly provenance: SkillProvenance;
}

export interface SkillProposal extends SkillProposalBody, HashPinnedProposal<SkillProposalState> {
  readonly schema: typeof SKILL_PROPOSAL_SCHEMA;
}

/** The record of one promotion. A skill with no whole pin is not promoted. */
export interface SkillPin {
  readonly name: string;
  readonly packageHash: string;
  readonly rulesVersion: string;
  readonly supersedes: string | null;
  readonly proposalId: string;
  readonly proposalHash: string;
  readonly author: string;
  readonly authorRole: Role;
  readonly authorSession: string;
  readonly proposedAt: string;
  readonly reviewedBy: string;
  readonly reviewerRole: Role;
  readonly reviewerSession: string;
  readonly reviewedAt: string;
}

export interface PromotedSkill {
  readonly schema: typeof PROMOTED_SKILL_SCHEMA;
  readonly description: string;
  readonly version: string | null;
  readonly files: readonly SkillFile[];
  readonly pin: SkillPin;
}

export interface SkillProposalInput {
  readonly files: readonly SkillFile[];
  readonly author: string;
  readonly authorRole: Role;
  readonly session: string;
  readonly proposedAt: string;
}

const isText = (value: unknown): value is string => typeof value === 'string';
const isHash = (value: unknown): value is string => isText(value) && HASH.test(value);
const isRole = (value: unknown): value is Role => isText(value) && (ROLES as readonly string[]).includes(value);
const isActor = (value: unknown): value is string => isText(value) && ACTOR_LABEL.test(value);
const isInstant = (value: unknown): value is string => isText(value) && ISO_INSTANT.test(value);
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const orderedFiles = (files: readonly SkillFile[]): readonly SkillFile[] => [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
/** Labels are compared the way a person reads them, so a change of case is not a second reviewer. */
const sameActor = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
const advisoriesOf = (validation: SkillValidation): readonly string[] => validation.advisory.map((finding) => `${finding.rule} ${finding.file}:${finding.line}`);

function hashBody(body: SkillProposalBody): string {
  const fields = [
    SKILL_PROPOSAL_SCHEMA,
    body.name,
    body.description,
    body.version,
    body.packageHash,
    body.supersedes,
    body.advisories,
    body.rulesVersion,
    body.provenance.author,
    body.provenance.authorRole,
    body.provenance.session,
    body.provenance.proposedAt,
  ];
  return `sha256:${createHash('sha256').update(JSON.stringify(fields), 'utf8').digest('hex')}`;
}

const idOf = (proposalHash: string): string => `skl-${proposalHash.slice('sha256:'.length, 'sha256:'.length + 24)}`;

function provenanceProblem(fields: { readonly author: unknown; readonly authorRole: unknown; readonly session: unknown; readonly proposedAt: unknown }): string | null {
  if (!isActor(fields.author)) return 'an author';
  if (!isRole(fields.authorRole)) return 'an author role';
  if (!isActor(fields.session)) return 'a session';
  if (!isInstant(fields.proposedAt)) return 'a time';
  return null;
}

function validationRefusal(validation: SkillValidation): SkillRefused {
  const first = validation.blocking[0];
  return skillRefused('SKILL_FAILED_VALIDATION', `This package failed ${validation.blocking.length} rule(s), first ${first?.rule ?? 'unknown'}. It cannot be promoted.`, first?.rule, validation.blocking);
}

/** Turn proposed text into a proposal. A package that fails the validator is not proposed at all. */
export function buildSkillProposal(input: SkillProposalInput, activeHash: string | null): SkillResult<SkillProposal> {
  const missing = provenanceProblem(input);
  if (missing !== null) return skillRefused('SKILL_PROVENANCE', `A skill proposal must name ${missing}.`);
  const validation = validateSkillPackage(input.files);
  if (!validation.passed) return validationRefusal(validation);
  const body: SkillProposalBody = {
    name: validation.name ?? '',
    description: validation.description ?? '',
    version: validation.version,
    files: orderedFiles(input.files),
    packageHash: skillPackageHash(input.files),
    supersedes: activeHash,
    advisories: advisoriesOf(validation),
    rulesVersion: validation.rulesVersion,
    provenance: { author: input.author, authorRole: input.authorRole, session: input.session, proposedAt: input.proposedAt },
  };
  const proposalHash = hashBody(body);
  return skillOk({ ...body, schema: SKILL_PROPOSAL_SCHEMA, id: idOf(proposalHash), proposalHash, state: 'pending', decision: null });
}

/** Null when this proposal is what it says it is. It says nothing about whether it still passes. */
function integrityProblem(proposal: SkillProposal): string | null {
  if (proposal.schema !== SKILL_PROPOSAL_SCHEMA) return 'its schema is not one this version reads';
  if (proposal.packageHash !== skillPackageHash(proposal.files)) return 'its pin is not the hash of its files';
  if (proposal.proposalHash !== hashBody(proposal)) return 'its hash does not match what it says';
  if (proposal.id !== idOf(proposal.proposalHash)) return 'its id does not match its hash';
  return null;
}

/**
 * Everything that must hold before a decision or a promotion, asked again each time.
 *
 * The rules can change between a proposal and its review, and a proposal is only a file, so nothing the file
 * says about itself is taken: the pass, the name and what the reviewer is told are all worked out afresh.
 */
export function checkSkillProposal(proposal: SkillProposal, activeHash: string | null): SkillResult<SkillValidation> {
  const problem = integrityProblem(proposal);
  if (problem !== null) return skillRefused('SKILL_TAMPERED', `That proposal is not valid: ${problem}.`);
  const validation = validateSkillPackage(proposal.files);
  if (!validation.passed) return validationRefusal(validation);
  if (validation.name !== proposal.name || validation.description !== proposal.description || validation.version !== proposal.version) {
    return skillRefused('SKILL_TAMPERED', 'That proposal is not valid: its name or description is not the one in its SKILL.md.');
  }
  if (JSON.stringify(advisoriesOf(validation)) !== JSON.stringify(proposal.advisories) || validation.rulesVersion !== proposal.rulesVersion) {
    return skillRefused('SKILL_STALE', 'The rules now say something else about this package. Propose it again, so the reviewer reads what holds.');
  }
  if (activeHash !== proposal.supersedes) {
    return skillRefused('SKILL_STALE', 'The active skill changed since this was proposed, so it was not promoted. Propose it again.');
  }
  return skillOk(validation);
}

/** A file or list read back from JSON, every field checked. */
function filesFrom(raw: unknown): readonly SkillFile[] | null {
  if (!Array.isArray(raw)) return null;
  const files = raw.flatMap((file: unknown) => (isRecord(file) && isText(file['path']) && isText(file['text']) ? [{ path: file['path'], text: file['text'] }] : []));
  return files.length === raw.length ? files : null;
}

const isNullableText = (value: unknown): value is string | null => value === null || isText(value);
const isTextList = (value: unknown): value is readonly string[] => Array.isArray(value) && value.every(isText);

/**
 * A proposal read back from a file, or the reason it is not one.
 *
 * ONLY A PENDING PROPOSAL IS READ. The hash covers what was proposed and not what became of it, so a file's
 * state and decision prove nothing. A file marked approved is refused, because that state is never written.
 */
export function readSkillProposal(raw: unknown): SkillResult<SkillProposal> {
  const refuse = (why: string): SkillResult<SkillProposal> => skillRefused('SKILL_TAMPERED', `That proposal is not valid: ${why}.`);
  if (!isRecord(raw)) return refuse('it is not a record');
  const provenance = isRecord(raw['provenance']) ? raw['provenance'] : {};
  const { author, authorRole, session, proposedAt } = provenance;
  const missing = provenanceProblem({ author, authorRole, session, proposedAt });
  if (missing !== null) return refuse(`it does not name ${missing}`);
  const files = filesFrom(raw['files']);
  const { id, name, description, version, packageHash, supersedes, advisories, rulesVersion, proposalHash, state } = raw;
  if (
    raw['schema'] !== SKILL_PROPOSAL_SCHEMA ||
    files === null ||
    !isText(id) ||
    !PROPOSAL_ID.test(id) ||
    !isHash(proposalHash) ||
    !isHash(packageHash) ||
    !isText(name) ||
    !isText(description) ||
    !isNullableText(version) ||
    !(supersedes === null || isHash(supersedes)) ||
    !isTextList(advisories) ||
    !isText(rulesVersion) ||
    !isText(state) ||
    !(SKILL_PROPOSAL_STATES as readonly string[]).includes(state)
  ) {
    return refuse('a field is missing or the wrong type');
  }
  const proposal: SkillProposal = {
    schema: SKILL_PROPOSAL_SCHEMA,
    id,
    proposalHash,
    state: 'pending',
    decision: null,
    name,
    description,
    version,
    files,
    packageHash,
    supersedes,
    advisories,
    rulesVersion,
    provenance: { author: author as string, authorRole: authorRole as Role, session: session as string, proposedAt: proposedAt as string },
  };
  const problem = integrityProblem(proposal);
  if (problem !== null) return refuse(problem);
  if (state === 'approved') return refuse('it is marked approved, and that state is never written');
  if (state !== 'pending') return skillRefused('SKILL_ALREADY_DECIDED', `Proposal ${id} is already ${state}.`);
  return (raw['decision'] ?? null) === null ? skillOk(proposal) : refuse('it is pending and carries a decision');
}

/** Why this actor may not review this author's proposal, or null. Asked of a pin as well as a decision. */
function independenceProblem(reviewer: SkillActor, author: { readonly author: string; readonly session: string }): string | null {
  if (!SKILL_REVIEWER_ROLES.includes(reviewer.role)) return `A skill is reviewed by an advisor or the owner, not '${reviewer.role}'.`;
  if (sameActor(reviewer.actor, author.author)) return 'The author of a skill does not review it.';
  if (sameActor(reviewer.session, author.session)) return 'A review in the session that proposed the skill is not independent.';
  return null;
}

/**
 * The proposals `decideSkillProposal` approved, by identity.
 *
 * APPROVAL IS NOT DATA. A state field can be written by anyone who can write the object, so the proof is that
 * this module produced this exact object. A copy, or a file, is not in here and promotes nothing.
 */
const APPROVED_HERE = new WeakSet<SkillProposal>();
/** Who approved each of those objects. Held here, for the same reason. */
const REVIEWERS = new WeakMap<SkillProposal, SkillActor>();

/**
 * One reviewer's decision on one proposal, over the hash that reviewer read.
 *
 * `reviewedHash` is mandatory, so a decision cannot be recorded against text nobody read. A rejection needs
 * the same independence, because an author rejecting and re-proposing would otherwise shop for a reviewer
 * with no record of it. This is a pure transform: it says what was decided and promotes nothing.
 */
export function decideSkillProposal(proposal: SkillProposal, outcome: SkillDecisionOutcome, reviewer: SkillActor, at: string, reviewedHash: string, activeHash: string | null): SkillResult<SkillProposal> {
  if (proposal.state !== 'pending') return skillRefused('SKILL_ALREADY_DECIDED', `Proposal ${proposal.id} is already ${proposal.state}.`);
  if (!isActor(reviewer.actor) || !isActor(reviewer.session) || !isInstant(at)) {
    return skillRefused('SKILL_PROVENANCE', 'A decision must name its reviewer, session and time.');
  }
  const independent = independenceProblem(reviewer, proposal.provenance);
  if (independent !== null) return skillRefused('SKILL_NOT_INDEPENDENT', independent);
  if (reviewedHash !== proposal.proposalHash) {
    return skillRefused('SKILL_STALE', 'This is not the proposal that was reviewed. Read it again and decide again.');
  }
  const checked = checkSkillProposal(proposal, activeHash);
  if (outcome === 'approved' && !checked.ok) return checked;
  const decided: SkillProposal = { ...proposal, state: outcome, decision: { outcome, by: reviewer.role, at, proposalHash: proposal.proposalHash } };
  if (outcome === 'approved') {
    APPROVED_HERE.add(decided);
    REVIEWERS.set(decided, reviewer);
  }
  return skillOk(decided);
}

/** What an approved proposal becomes. The only function that yields a promoted skill. */
export function promoteSkill(proposal: SkillProposal, activeHash: string | null): SkillResult<PromotedSkill> {
  const reviewer = REVIEWERS.get(proposal);
  const decision = proposal.decision;
  if (!APPROVED_HERE.has(proposal) || reviewer === undefined || decision === null) {
    return skillRefused('SKILL_NOT_APPROVED', `Proposal ${proposal.id} has not been approved by an independent reviewer, so nothing is promoted.`);
  }
  const checked = checkSkillProposal(proposal, activeHash);
  if (!checked.ok) return checked;
  const { provenance } = proposal;
  return skillOk({
    schema: PROMOTED_SKILL_SCHEMA,
    description: proposal.description,
    version: proposal.version,
    files: proposal.files,
    pin: {
      name: proposal.name,
      packageHash: proposal.packageHash,
      rulesVersion: proposal.rulesVersion,
      supersedes: proposal.supersedes,
      proposalId: proposal.id,
      proposalHash: proposal.proposalHash,
      author: provenance.author,
      authorRole: provenance.authorRole,
      authorSession: provenance.session,
      proposedAt: provenance.proposedAt,
      reviewedBy: reviewer.actor,
      reviewerRole: reviewer.role,
      reviewerSession: reviewer.session,
      reviewedAt: decision.at,
    },
  });
}

/** Whether this is a whole pin, every field, naming a review that was independent. */
export function isSkillPin(value: unknown): value is SkillPin {
  if (!isRecord(value)) return false;
  const { name, packageHash, rulesVersion, supersedes, proposalId, proposalHash, author, authorRole, authorSession, proposedAt, reviewedBy, reviewerRole, reviewerSession, reviewedAt } = value;
  if (
    !isText(name) ||
    !isHash(packageHash) ||
    !isText(rulesVersion) ||
    !(supersedes === null || isHash(supersedes)) ||
    !isText(proposalId) ||
    !PROPOSAL_ID.test(proposalId) ||
    !isHash(proposalHash) ||
    !isActor(author) ||
    !isRole(authorRole) ||
    !isActor(authorSession) ||
    !isInstant(proposedAt) ||
    !isActor(reviewedBy) ||
    !isRole(reviewerRole) ||
    !isActor(reviewerSession) ||
    !isInstant(reviewedAt)
  ) {
    return false;
  }
  return independenceProblem({ actor: reviewedBy, role: reviewerRole, session: reviewerSession }, { author, session: authorSession }) === null;
}

/**
 * A promoted skill as it stands, or why it may not be read.
 *
 * ONE CHANGED BYTE IS STALE. The hash is taken again over the text held now and compared with the pin. Then the
 * validator runs again, because a promoted skill that today's rules refuse must not reach a prompt either.
 */
export function checkPromotedSkill(raw: unknown): SkillResult<PromotedSkill> {
  const refuse = (why: string): SkillResult<PromotedSkill> => skillRefused('SKILL_TAMPERED', `That promoted skill is not valid: ${why}.`);
  if (!isRecord(raw) || raw['schema'] !== PROMOTED_SKILL_SCHEMA) return refuse('it is not a promoted skill');
  const files = filesFrom(raw['files']);
  const { pin, description, version } = raw;
  if (files === null || !isSkillPin(pin) || !isText(description) || !isNullableText(version)) return refuse('it has no whole, independent pin');
  if (skillPackageHash(files) !== pin.packageHash) {
    return skillRefused('SKILL_STALE', `Skill ${pin.name} is not the text that was promoted. It is not read. Propose the change.`);
  }
  const validation = validateSkillPackage(files);
  if (!validation.passed) return validationRefusal(validation);
  if (validation.name !== pin.name || validation.description !== description || validation.version !== version) {
    return refuse('its name or description is not the one in its SKILL.md');
  }
  return skillOk({ schema: PROMOTED_SKILL_SCHEMA, description, version, files, pin });
}

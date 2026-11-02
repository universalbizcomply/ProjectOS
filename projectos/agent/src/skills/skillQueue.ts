// SPDX-License-Identifier: MIT
// Ported-From: hermes-agent https://github.com/NousResearch/hermes-agent
// Source-Path: tools/write_approval.py; tools/memory_tool_store.py
// Source-Commit: d3e586881eacb132595edcbe4c170be8381e40c5
// Source-Copyright: Copyright (c) 2025 Nous Research
// Port-Strategy: ADAPT
// Modified-By: ProjectOS 2026-11-01: modified for ProjectOS. CHANGED: adapted through the memory queue and memory files, which carry this credit; staging, the temporary file and rename, and the create-if-absent lock now hold one skill package; promotion written whole in one rename
// SPDX-License-Identifier: MIT
// Ported-From: oh-my-hermes https://github.com/rlaope/oh-my-hermes
// Source-Path: src/plugin_bundle/omh/memory_admission.py
// Source-Commit: 612a1cd9c44a19ecddcd263865e40e8c3910a514
// Source-Copyright: Copyright (c) 2026 oh-my-hermes contributors
// Port-Strategy: ADAPT
// Modified-By: ProjectOS 2026-11-01: modified for ProjectOS. CHANGED: the read, check and write under one lock, adapted through the memory queue, which carries this credit
// Notice: full licence text in THIRD_PARTY_NOTICES
/**
 * The skill queue: the only code that writes a promoted skill.
 *
 *   .projectops/skills/proposals/<id>.json   every proposal, pending or decided
 *   .projectops/skills/promoted/<name>.json  one promoted package and its pin, written whole
 *
 * AN AGENT ONLY PROPOSES. `proposeSkill` touches nothing that is read as a skill. `reviewAndPromoteSkill` is the
 * one route to `promoted/`, and it reads, checks and writes under one hold of the lock: a check made outside the
 * lock is advisory, because the active skill could change between the check and the save. No function here
 * patches a promoted skill. A change is a new proposal, and it names the hash it replaces.
 *
 * NO DOWNLOAD AND NO INSTALL. The text arrives from the caller, as a list of paths and text, and `SKILL.md` keeps
 * its exact bytes in the record. Nothing here reaches a network, walks a folder it was pointed at, or runs on a
 * timer. An imported skill is proposed like any other and reviewed like any other.
 *
 * A PROMOTED SKILL IS ONE FILE. Pin and text land in one rename, so a reader never sees a new text beside an old
 * pin, and a file added beside it counts for nothing, because only what the record holds is read.
 *
 * THE CALLER'S IDENTITY IS NOT PART OF THE REQUEST. The kernel supplies `SkillActor`. It stays what the caller
 * asserts until owner proof exists, so independence holds only as far as that does.
 */
import {
  buildSkillProposal,
  checkPromotedSkill,
  decideSkillProposal,
  promoteSkill,
  readSkillProposal,
  renderSkillBlock,
  skillOk,
  skillRefused,
  type PromotedSkill,
  type SkillActor,
  type SkillDecisionOutcome,
  type SkillFile,
  type SkillPromptBlock,
  type SkillProposal,
  type SkillRefused,
  type SkillResult,
} from '@projectos/core';
import { containsSecret } from '../authoringEvidence.js';
import { join, projectopsDir } from '../context.js';
import type { System } from '../system.js';

const LOCK_FILENAME = '.skills.lock';
const PROPOSAL_ID = /^skl-[0-9a-f]{24}$/;
/** The name rule in the linter, asked again here because this value becomes a path. */
const SKILL_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** What may wait for review at once, so a loop cannot bury the queue a reviewer has to read. */
const MAX_PENDING_PROPOSALS = 50;

export function skillsDir(root: string): string {
  return join(projectopsDir(root), 'skills');
}

const proposalsDir = (root: string): string => join(skillsDir(root), 'proposals');
const proposalPath = (root: string, id: string): string => join(proposalsDir(root), `${id}.json`);
export const promotedSkillPath = (root: string, name: string): string => join(skillsDir(root), 'promoted', `${name}.json`);
const asFile = (record: unknown): string => `${JSON.stringify(record, null, 2)}\n`;

/** Credentials never enter a skill, and the agent's own vocabulary is what recognises one. */
function credentialRefusal(files: readonly SkillFile[]): SkillRefused | null {
  return files.some((file) => containsSecret(file.text)) ? skillRefused('SKILL_CREDENTIAL', 'That package holds a credential. Nothing was proposed, and it is not repeated here.') : null;
}

function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Temp file and rename, so a reader never sees a partial file. */
function writeWhole(sys: System, path: string, content: string): boolean {
  const temporary = `${path}.tmp`;
  try {
    sys.writeText(temporary, content);
  } catch {
    sys.removeFile(temporary);
    return false;
  }
  if (sys.renameFile(temporary, path)) return true;
  sys.removeFile(temporary);
  return false;
}

/** Do one read-check-write with nobody else inside. The body's answer stands if the lock will not release. */
function underSkillLock<T>(sys: System, root: string, body: () => SkillResult<T>): SkillResult<T> {
  const lock = join(skillsDir(root), LOCK_FILENAME);
  if (!sys.createExclusive(lock, `{"heldSince":"${sys.now()}"}\n`)) {
    return sys.exists(lock)
      ? skillRefused('SKILL_LOCKED', `Another process is writing skills; nothing changed. If none is, ${lock} was left by one that died and must be removed.`)
      : skillRefused('SKILL_WRITE_FAILED', `${skillsDir(root)} could not be written, so nothing was changed.`);
  }
  let result: SkillResult<T> = skillRefused('SKILL_WRITE_FAILED', 'The skill write did not run.');
  let released = false;
  try {
    result = body();
  } finally {
    released = sys.removeFile(lock);
  }
  return released ? result : { ...result, warning: `The skill lock ${lock} could not be released; later writes will refuse until it is removed.` };
}

/** The promoted skill by this name, as it stands, or null when there is none. Stale text is refused, not null. */
export function loadPromotedSkill(sys: System, root: string, name: string): SkillResult<PromotedSkill | null> {
  if (!SKILL_NAME.test(name)) return skillRefused('SKILL_NOT_FOUND', 'That is not a skill name.');
  const path = promotedSkillPath(root, name);
  const text = sys.readText(path);
  if (text === null) return sys.exists(path) ? skillRefused('SKILL_UNREADABLE', `${path} exists but could not be read.`) : skillOk(null);
  const raw = parsedJson(text);
  if (raw === undefined) return skillRefused('SKILL_UNREADABLE', `${path} is not valid JSON, so it is not read.`);
  const checked = checkPromotedSkill(raw);
  if (!checked.ok) return checked;
  return checked.value.pin.name === name ? skillOk(checked.value) : skillRefused('SKILL_TAMPERED', `The file named ${name} holds another skill.`);
}

/**
 * The hash a new proposal must name. A stale active skill counts as itself: its pin says what it was, and a
 * replacement of it is exactly what a reviewer should see. Only an unreadable record stops a proposal.
 */
function activeHash(sys: System, root: string, name: string): SkillResult<string | null> {
  const loaded = loadPromotedSkill(sys, root, name);
  if (loaded.ok) return skillOk(loaded.value?.pin.packageHash ?? null);
  if (loaded.refusal.code !== 'SKILL_STALE' && loaded.refusal.code !== 'SKILL_FAILED_VALIDATION') return loaded;
  const raw = parsedJson(sys.readText(promotedSkillPath(root, name)) ?? '') as { readonly pin?: { readonly packageHash?: unknown } } | undefined;
  const hash = raw?.pin?.packageHash;
  return typeof hash === 'string' ? skillOk(hash) : skillRefused('SKILL_UNREADABLE', `The active skill ${name} has no pin to replace.`);
}

export interface SkillProposalRequest {
  /** The whole package, `SKILL.md` first or last. Imported text arrives the same way. */
  readonly files: readonly SkillFile[];
}

/** Record a proposed skill for review. Nothing that is read as a skill is touched. */
export function proposeSkill(sys: System, root: string, caller: SkillActor, request: SkillProposalRequest): SkillResult<SkillProposal> {
  if (listPendingSkillProposals(sys, root).pending.length >= MAX_PENDING_PROPOSALS) {
    return skillRefused('SKILL_QUEUE_FULL', `${MAX_PENDING_PROPOSALS} proposals are already waiting for review. Nothing was proposed.`);
  }
  const input = { files: request.files, author: caller.actor, authorRole: caller.role, session: caller.session, proposedAt: sys.now() };
  const probe = buildSkillProposal(input, null);
  if (!probe.ok) return probe;
  const credential = credentialRefusal(request.files);
  if (credential !== null) return credential;
  const active = activeHash(sys, root, probe.value.name);
  if (!active.ok) return active;
  const proposal = buildSkillProposal(input, active.value);
  if (!proposal.ok) return proposal;
  return sys.createExclusive(proposalPath(root, proposal.value.id), asFile(proposal.value))
    ? proposal
    : skillRefused('SKILL_WRITE_FAILED', `Proposal ${proposal.value.id} could not be recorded.`);
}

export function loadSkillProposal(sys: System, root: string, id: string): SkillResult<SkillProposal> {
  if (!PROPOSAL_ID.test(id)) return skillRefused('SKILL_NOT_FOUND', 'That is not a skill proposal id.');
  const text = sys.readText(proposalPath(root, id));
  if (text === null) return skillRefused('SKILL_NOT_FOUND', `There is no proposal ${id}.`);
  const raw = parsedJson(text);
  if (raw === undefined) return skillRefused('SKILL_TAMPERED', `Proposal ${id} is not valid JSON.`);
  const proposal = readSkillProposal(raw);
  if (proposal.ok && proposal.value.id !== id) return skillRefused('SKILL_TAMPERED', `The file named ${id} holds another proposal.`);
  return proposal;
}

export interface SkillProposalListing {
  readonly pending: readonly SkillProposal[];
  /** Files in the queue that did not read back as a proposal. Named, never dropped silently. */
  readonly unreadable: readonly string[];
}

/** Everything awaiting review, oldest first. */
export function listPendingSkillProposals(sys: System, root: string): SkillProposalListing {
  const ids = sys
    .listDir(proposalsDir(root))
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length));
  const read = ids.map((id) => ({ id, result: loadSkillProposal(sys, root, id) }));
  return {
    pending: read.flatMap(({ result }) => (result.ok ? [result.value] : [])).sort((a, b) => a.provenance.proposedAt.localeCompare(b.provenance.proposedAt)),
    unreadable: read.flatMap(({ id, result }) => (result.ok || result.refusal.code === 'SKILL_ALREADY_DECIDED' ? [] : [id])),
  };
}

export interface SkillReviewRequest {
  readonly id: string;
  /** The hash the reviewer read. Mandatory: a decision over unread text is not a decision. */
  readonly reviewedHash: string;
}

function decided(sys: System, root: string, caller: SkillActor, request: SkillReviewRequest, outcome: SkillDecisionOutcome): SkillResult<SkillProposal> {
  const proposal = loadSkillProposal(sys, root, request.id);
  if (!proposal.ok) return proposal;
  const active = activeHash(sys, root, proposal.value.name);
  if (!active.ok) return active;
  return decideSkillProposal(proposal.value, outcome, caller, sys.now(), request.reviewedHash, active.value);
}

function land(sys: System, root: string, approved: SkillProposal): SkillResult<PromotedSkill> {
  const active = activeHash(sys, root, approved.name);
  if (!active.ok) return active;
  const promoted = promoteSkill(approved, active.value);
  if (!promoted.ok) return promoted;
  if (!writeWhole(sys, promotedSkillPath(root, approved.name), asFile(promoted.value))) {
    return skillRefused('SKILL_WRITE_FAILED', 'The promoted skill could not be written. The proposal stays pending.');
  }
  // THE SKILL HAS LANDED. From here "failed" and "pending" would both be false.
  return writeWhole(sys, proposalPath(root, approved.id), asFile({ ...approved, state: 'promoted' }))
    ? promoted
    : skillRefused('SKILL_LANDED_INCOMPLETE', `The skill landed, but proposal ${approved.id} could not be marked. Do not review it again.`);
}

/** An independent reviewer approves one proposal, and it is promoted, or it is not promoted at all. */
export function reviewAndPromoteSkill(sys: System, root: string, caller: SkillActor, request: SkillReviewRequest): SkillResult<PromotedSkill> {
  return underSkillLock(sys, root, () => {
    const approved = decided(sys, root, caller, request, 'approved');
    if (!approved.ok) return approved;
    const credential = credentialRefusal(approved.value.files);
    return credential ?? land(sys, root, approved.value);
  });
}

/** An independent reviewer rejects one proposal. It stays on file, decided, and nothing lands. */
export function rejectSkillProposal(sys: System, root: string, caller: SkillActor, request: SkillReviewRequest): SkillResult<SkillProposal> {
  return underSkillLock(sys, root, () => {
    const rejected = decided(sys, root, caller, request, 'rejected');
    if (!rejected.ok) return rejected;
    return writeWhole(sys, proposalPath(root, request.id), asFile(rejected.value))
      ? rejected
      : skillRefused('SKILL_WRITE_FAILED', `Proposal ${request.id} could not be marked rejected.`);
  });
}

/** The fenced block for one promoted skill. The only way skill text leaves this module for a prompt. */
export function loadSkillBlock(sys: System, root: string, name: string): SkillResult<SkillPromptBlock> {
  const loaded = loadPromotedSkill(sys, root, name);
  if (!loaded.ok) return loaded;
  if (loaded.value === null) return skillRefused('SKILL_NOT_FOUND', `There is no promoted skill ${name}.`);
  // A record is only a file, and core cannot run this check. The memory review asked for it at the prompt too.
  return credentialRefusal(loaded.value.files) ?? renderSkillBlock(loaded.value);
}

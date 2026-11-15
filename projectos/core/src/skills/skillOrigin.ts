// Origin: original ProjectOS code
/**
 * THE KERNEL SETS A SKILL'S ORIGIN (PROJECTOS-SKILLS-ADOPT1A, plan 3.2, the PORT-SKILLS1A binding carry-forward).
 *
 * Until now `origin` ("proposed" or "imported") was a field of the request, defaulting to `proposed`, so whoever built the
 * request chose it. It is the one fact a reviewer uses to decide how hard to look at outside text, so it cannot be something the
 * caller says. It is now an OBJECT THIS FILE MINTS, registered where only this file can reach, in the shape of
 * `memory/committedProof.ts`:
 *
 *   `proposedSkillOrigin(actor)`  the door a worker's proposal comes through. Always `proposed`.
 *   `importedSkillOrigin(actor)`  the door an owner brings outside text in through. Only the owner passes it.
 *
 * Neither takes an origin as an argument, so there is nothing to supply. A mark is bound to the facts it was minted for (the
 * origin, the author, the author's role and session): `buildSkillProposal` reads the author from the mark and from nowhere else,
 * so a mark for one actor cannot be spent as another. A plain object, a copy, a `structuredClone`, a JSON round-trip and an object
 * that inherits from a mark are not in the registry, and an input that offers one is refused (`SKILL_ORIGIN_NOT_KERNEL`).
 *
 * WHAT THIS CANNOT PROVE. The registry is in-process: code that can import this file can mint, which is the trust the rest of
 * core has. And the ACTOR a door is given is still what the kernel's caller asserts (PORT-SKILLS1A, "Limits"). What this stops is
 * data (a request, a findings record, a stored proposal) choosing its own origin.
 *
 * Pure: no I/O.
 */
import type { Role } from '../types.js';
import { skillOk, skillRefused, type SkillResult } from './refusal.js';

/** Where the text came from. An import is text from outside, so only the owner brings one in. */
export const SKILL_ORIGINS = ['proposed', 'imported'] as const;
export type SkillOrigin = (typeof SKILL_ORIGINS)[number];

/** What a door is given: who is acting, from the kernel. Never read from a request, a proposal or a skill. */
export interface SkillOriginActor {
  readonly actor: string;
  readonly role: Role;
  readonly session: string;
}

/** An origin the kernel set, for one author. Frozen, and only a registered object is one. */
export interface SkillOriginMark {
  readonly origin: SkillOrigin;
  readonly author: string;
  readonly authorRole: Role;
  readonly session: string;
}

const MINTED: WeakSet<object> = new WeakSet();

/** Whether the actor names itself, its role and its session as text. The closed label shapes are asked where a proposal is built, once, for every door. */
const isWholeActor = (actor: unknown): actor is SkillOriginActor => {
  if (actor === null || typeof actor !== 'object') return false;
  const { actor: name, role, session } = actor as Partial<Record<keyof SkillOriginActor, unknown>>;
  return typeof name === 'string' && typeof role === 'string' && typeof session === 'string';
};

function mint(origin: SkillOrigin, actor: SkillOriginActor): SkillOriginMark {
  const mark: SkillOriginMark = Object.freeze({ origin, author: actor.actor, authorRole: actor.role, session: actor.session });
  MINTED.add(mark);
  return mark;
}

/** The mark for a proposal a worker or an advisor made. */
export function proposedSkillOrigin(actor: unknown): SkillResult<SkillOriginMark> {
  if (!isWholeActor(actor)) return skillRefused('SKILL_PROVENANCE', 'A skill origin is minted for an actor that names itself, its role and its session.');
  return skillOk(mint('proposed', actor));
}

/** The mark for text the owner brings in from outside. Anyone else is refused. */
export function importedSkillOrigin(actor: unknown): SkillResult<SkillOriginMark> {
  if (!isWholeActor(actor)) return skillRefused('SKILL_PROVENANCE', 'A skill origin is minted for an actor that names itself, its role and its session.');
  if (actor.role !== 'owner') return skillRefused('SKILL_NOT_OWNER', 'Only the owner brings a skill in from outside.');
  return skillOk(mint('imported', actor));
}

/** Is this exactly an object one of the doors above made? A look-alike is not. */
export function isSkillOriginMark(value: unknown): value is SkillOriginMark {
  return typeof value === 'object' && value !== null && MINTED.has(value);
}

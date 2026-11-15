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

/**
 * THE ACTOR IS READ ONCE, FROM DATA, INTO A FROZEN COPY. A getter answers differently the second time it is read (an actor whose role is
 * `implementer` on the first read and `owner` on the second passed the import door's owner check and was minted as whatever it said last),
 * so an accessor property, an inherited property and anything that is not a plain object are refused, and the door works from the copy alone.
 * A transparent Proxy needs a port core does not have (named residual). Null is a refusal. Not exported from the barrel.
 */
export function snapshotSkillActor(value: unknown): SkillOriginActor | null {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const read = (key: string): unknown => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined && 'value' in descriptor ? (descriptor.value as unknown) : undefined;
    };
    const name = read('actor');
    const role = read('role');
    const session = read('session');
    return typeof name === 'string' && typeof role === 'string' && typeof session === 'string' ? Object.freeze({ actor: name, role: role as Role, session }) : null;
  } catch {
    return null;
  }
}

function mint(origin: SkillOrigin, actor: SkillOriginActor): SkillOriginMark {
  const mark: SkillOriginMark = Object.freeze({ origin, author: actor.actor, authorRole: actor.role, session: actor.session });
  MINTED.add(mark);
  return mark;
}

/** The mark for a proposal a worker or an advisor made. */
export function proposedSkillOrigin(raw: unknown): SkillResult<SkillOriginMark> {
  const actor = snapshotSkillActor(raw);
  if (actor === null) return skillRefused('SKILL_PROVENANCE', 'A skill origin is minted for a plain actor that names itself, its role and its session as data.');
  return skillOk(mint('proposed', actor));
}

/** The mark for text the owner brings in from outside. Anyone else is refused. */
export function importedSkillOrigin(raw: unknown): SkillResult<SkillOriginMark> {
  const actor = snapshotSkillActor(raw);
  if (actor === null) return skillRefused('SKILL_PROVENANCE', 'A skill origin is minted for a plain actor that names itself, its role and its session as data.');
  if (actor.role !== 'owner') return skillRefused('SKILL_NOT_OWNER', 'Only the owner brings a skill in from outside.');
  return skillOk(mint('imported', actor));
}

/** Is this exactly an object one of the doors above made? A look-alike is not. */
export function isSkillOriginMark(value: unknown): value is SkillOriginMark {
  return typeof value === 'object' && value !== null && MINTED.has(value);
}

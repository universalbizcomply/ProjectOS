// Origin: original ProjectOS code
/**
 * THE KERNEL RECORDS WHAT IT MINTED, WHERE A WORKER CANNOT WRITE (PROJECTOS-SKILLS-ADOPT1A, review round 1, M1).
 *
 * The origin and the author of a proposal are minted in memory (`skillOrigin.ts`), but a proposal is then written as a file under
 * `.projectops/skills/proposals/` in the project tree, where a worker with file access can write a whole, self-consistent one of its own: a pending
 * proposal that claims `imported` and an owner as its author, with the right hash. A file is not a mint. So the queue records the hash of every
 * proposal it makes, in the INSTALLATION'S state directory (the one the retrieval ledger uses, outside the project tree and outside what a worker's
 * write grant names), and a review of a proposal whose hash the kernel did not record is refused (`SKILL_NOT_MINTED`).
 *
 *   `<state>/skill-mint/mint-<hash of tenant and project>/<proposal hash, hex>.json`   one small file per proposal, created exclusively
 *
 * KEYED BY TENANT AND PROJECT, as a collision-proof hash of the JSON pair, so another project's mint is not this one's. The proposal hash itself
 * covers the tenant and project, so a mint for one project's proposal names no other's.
 *
 * NOTHING LANDS IN THE PROJECT TREE. The mint is made before the proposal file and is never removed. It is created with an exclusive create, which
 * does not follow a link that someone put at the name, and what is read back must equal what would have been written, byte for byte: a truncated
 * file, a link's target and a planted file are each "not minted".
 *
 * WHAT THIS DOES NOT PROVE. Anyone who can write the installation's state directory can mint (the ledger has the same limit), and an owner's
 * proposal door that passes no `SkillStatePorts` records no mint, so its proposals cannot be reviewed until it does.
 */
import { createHash } from 'node:crypto';
import { skillBindingOf, skillRefused, skillOk, type SkillResult } from '@projectos/core';
import type { System } from '../system.js';

/** What the queue needs to mint and to check a mint. `stateDir` is absolute, or null when the installation gives none. */
export interface SkillStatePorts {
  /** The tenant and project this checkout is governed as. Anything but an identity refuses. */
  readonly checkout: () => unknown;
  readonly stateDir: string | null;
}

const ABSOLUTE = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/;
const PROPOSAL_HASH = /^sha256:([0-9a-f]{64})$/;

const NO_STATE_FIX =
  'Fix: the owner makes the installation state location available to the user who runs ProjectOS (LOCALAPPDATA on Windows, XDG_STATE_HOME or HOME elsewhere), then proposes again.';

/** The binding this checkout is governed as, read once, or null. */
function bindingOf(ports: SkillStatePorts): { readonly tenant: string; readonly project: string } | null {
  try {
    return skillBindingOf(ports.checkout());
  } catch {
    return null;
  }
}

function mintPathOf(ports: SkillStatePorts, binding: { readonly tenant: string; readonly project: string }, proposalHash: string): string | null {
  const hex = PROPOSAL_HASH.exec(proposalHash)?.[1];
  if (hex === undefined || typeof ports.stateDir !== 'string' || !ABSOLUTE.test(ports.stateDir)) return null;
  const base = ports.stateDir.replace(/\\/g, '/').replace(/\/+$/, '');
  return `${base}/skill-mint/mint-${createHash('sha256').update(JSON.stringify([binding.tenant, binding.project]), 'utf8').digest('hex').slice(0, 32)}/${hex}.json`;
}

const contentOf = (binding: { readonly tenant: string; readonly project: string }, proposalHash: string): string =>
  `${JSON.stringify({ schema: 'projectos.skill-mint/1', tenant: binding.tenant, project: binding.project, proposalHash })}\n`;

/** Record that the kernel minted this proposal for this checkout. Refused, with the fix named, when there is no identity or no state directory. */
export function recordSkillMint(sys: Pick<System, 'createExclusive' | 'readText'>, ports: SkillStatePorts, proposalHash: string): SkillResult<true> {
  const binding = bindingOf(ports);
  if (binding === null) {
    return skillRefused('SKILL_BINDING_INVALID', 'The checkout names no tenant and project, so the proposal cannot be recorded as minted here. Fix: the owner runs ProjectOS from the registered checkout of the project, then proposes again.');
  }
  const path = mintPathOf(ports, binding, proposalHash);
  if (path === null) return skillRefused('SKILL_WRITE_FAILED', `The installation gives no absolute state directory, so the proposal cannot be recorded as minted. ${NO_STATE_FIX}`);
  const content = contentOf(binding, proposalHash);
  if (sys.createExclusive(path, content) || sys.readText(path) === content) return skillOk(true);
  return skillRefused('SKILL_WRITE_FAILED', `The mint record ${path} could not be written, so nothing was proposed. Fix: the owner checks the installation state directory (permissions, disk), then proposes again.`);
}

/** Whether the kernel minted this proposal for THIS checkout. A file that is not exactly what the queue writes, a link and an absent file are all no. */
export function isSkillMinted(sys: Pick<System, 'readText'>, ports: SkillStatePorts, proposalHash: string): boolean {
  const binding = bindingOf(ports);
  if (binding === null) return false;
  const path = mintPathOf(ports, binding, proposalHash);
  if (path === null) return false;
  try {
    return sys.readText(path) === contentOf(binding, proposalHash);
  } catch {
    return false;
  }
}

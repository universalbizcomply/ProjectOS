// Origin: original ProjectOS code
/**
 * THE RECORDS THE LOOP'S OWN LIFECYCLE WRITES, FOR A RESUME TO RECOGNISE (PROJECTOS-RESUME1A).
 *
 * A cut-off run leaves more than its execution records in the tree: the plan's state file is REWRITTEN (a tracked file, so `git status`
 * shows it modified), and a run with a gatekeeper leaves decision, interactive, thread and ledger files. None is in any phase's
 * `writePaths`, and none is the worker's work, so a resume that refused them would refuse every real governed project with a fix nobody
 * can apply. This is the set the entrypoint's own record fold (`isFoldableRunRecord` in `commands/run.ts`, protected and not edited)
 * commits as ProjectOS's own, taken from the same constants and the same shapes: the state file from `programmeStateTailPaths`, the
 * gatekeeper folders and files from their own modules. The two decision-folder name shapes below are copied from that function, because
 * it holds them inline; `val-projectos-resume1a` compares this file's text with `run.ts` so a change there cannot pass unseen.
 *
 * A NAME IS NOT A PROOF. A worker that can write the project tree can write a file with any of these names, and that is why the resume
 * only LISTS them, with a hash, and decides nothing from them: the write grant is judged on the candidate, not here.
 */
import { programmeStateTailPaths } from '../closureGate.js';
import type { GovernedContext } from '../governedContext.js';
import { GATEKEEPER_DECISIONS_REL, GATEKEEPER_LEDGER_REL, GATEKEEPER_THREAD_REL } from '../loop/gatekeeperConfig.js';
import { GATEKEEPER_INTERACTIVE_REL, INTERACTIVE_RECORD_FILENAME } from '../loop/gatekeeperHandoff.js';

/** The shape of a gatekeeper decision file's name, as `isFoldableRunRecord` spells it. */
export const RESUME_DECISION_RECORD_NAME = /^[A-Za-z0-9_-]{4,128}\.json$/;

export interface ResumeLoopRecords {
  readonly paths: readonly string[];
  readonly folders: readonly { readonly dir: string; readonly name: RegExp }[];
}

export function resumeLoopRecordsOf(context: GovernedContext): ResumeLoopRecords {
  return {
    paths: [GATEKEEPER_THREAD_REL, GATEKEEPER_LEDGER_REL, ...programmeStateTailPaths(context)],
    folders: [
      { dir: GATEKEEPER_DECISIONS_REL, name: RESUME_DECISION_RECORD_NAME },
      { dir: GATEKEEPER_INTERACTIVE_REL, name: INTERACTIVE_RECORD_FILENAME },
    ],
  };
}

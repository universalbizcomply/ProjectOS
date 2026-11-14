// Origin: original ProjectOS code
/**
 * STORED TEXT TAINTS THE RUN IT IS SHOWN TO (PROJECTOS-CONTEXT-MANAGER1A, plan 3.4).
 *
 * A text a worker read can carry instructions somebody else wrote, and memory is no exception: the approvals rule says a tool
 * result taints a run unless the kernel names it as a confined read of the run's OWN state, and that memory and history do not
 * launder taint, because a tainted run can write a note and a later run reading the note would then be clean. So the context
 * file is read as a tool named here, with an EMPTY list of own-state tools, and the rule answers.
 *
 * THE ANSWER IS "TAINTED" EITHER WAY. With a registry the question goes to `toolResultTaintsRun`; without one (the loop is not
 * handed the installation's registry) the answer is `true`, the safe side, and it is the answer the rule gives. What this does
 * NOT do is start a guard or record the content on one: `startRunGuard` and `recordOutsideContent` are not public, and the loop's
 * own taint wiring belongs to the phase that mediates every tool call (Stage 4.1). The taint is recorded in the ledger and the
 * evidence, where the owner and a reviewer can read it.
 *
 * This is the ONLY place in the agent that names the approvals rules.
 */
import { toolResultTaintsRun, type ActionRegistry } from '@projectos/core';

/** The name the context file is read under. Not a registered action: a read of stored notes is not a boundary crossing. */
export const STORED_CONTEXT_TOOL = 'stored-context-read';

/** The kernel names no own-state tool: memory is not one. */
const NO_OWN_STATE_TOOLS: readonly string[] = Object.freeze([]);

/** Does showing the stored context taint the run? Always: nothing stored is exempt. */
export function storedContextTaintsRun(registry: ActionRegistry | null): boolean {
  if (registry === null) return true;
  try {
    return toolResultTaintsRun(registry, STORED_CONTEXT_TOOL, NO_OWN_STATE_TOOLS) !== false;
  } catch {
    return true;
  }
}

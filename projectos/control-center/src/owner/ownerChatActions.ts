/**
 * Owner Chat — action recognition, kept deliberately separate from `ownerChatModel.ts`.
 *
 * `ownerChatModel.ts` is pure and SNAPSHOT-ONLY by design (owner directive, PROJECTOS-V3-OWNER-CHAT1A):
 * it never has a side effect and never carries anything beyond an `OwnerControlModel`, which is what
 * keeps it fully deterministic and unit-testable. Dispatching a real governed command is a side
 * effect, so it does not belong inside that responder — but leaving the chat purely explanatory
 * ("only you can authorise them") for actions that are NOT owner-only was leaving genuine
 * capability on the table. Product Completion asked for the chat to be "genuinely actionable if
 * within current architecture"; this is that, scoped narrowly.
 *
 * This module recognises a SMALL, fixed set of action phrases against the LIVE `GovernedProjection`
 * (not the narrower `OwnerControlModel`) and returns a suggested governed command — never dispatches
 * one itself. `OwnerChat.tsx` renders the suggestion as an explicit button in the chat bubble; only a
 * real click sends anything, through the same `requestGovernedCommand` every other governed surface
 * uses, so the runtime's own authority checks apply exactly as they do everywhere else. Typing a
 * sentence never executes anything by itself — that would make an accidental turn of phrase into a
 * real spend or a real state change, which button-only surfaces elsewhere in this app deliberately
 * avoid too.
 *
 * ONLY covers actions that are already governed and NOT owner-only: starting the already-approved
 * next phase, and activating a plan that already has exactly one committed, unambiguous approval.
 * Nothing here can approve anything, touch a protected action, or guess between multiple candidates —
 * an ambiguous or absent target returns null, same as the content responder's "unknown" fallback.
 */
import type { GovernedCommandArgs, GovernedVerb } from '../governed/governedCommands';
import type { GovernedProjection } from '../governed/types';

export interface ChatAction {
  readonly verb: GovernedVerb;
  readonly args: GovernedCommandArgs;
  readonly label: string;
}

const START_PHRASES: readonly string[] = [
  'start the phase', 'start execution', 'start governed execution', 'begin execution',
  'begin the phase', 'run the phase', 'kick off the phase', 'start working', 'get started',
];

const ACTIVATE_PHRASES: readonly string[] = [
  'activate the plan', 'activate my plan', 'activate plan', 'activate this plan',
  'activate the approved plan',
];

/**
 * Stopping. "Pause" is included on purpose and is NOT a lie by another name: stopping a governed run
 * keeps its session, and Resume picks that session up again, so pause and stop are the same
 * operation from the owner's side. There is no separate pause verb to offer and inventing one that
 * silently mapped to stop would be worse.
 */
const STOP_PHRASES: readonly string[] = [
  'stop the run', 'stop work', 'stop execution', 'stop the phase', 'stop it', 'stop now',
  'pause the run', 'pause work', 'pause execution', 'pause it', 'pause the phase', 'hold on',
  'halt execution', 'halt the run',
];

/** Resuming a session that stopped. Only ever offered against a real resumable session. */
const RESUME_PHRASES: readonly string[] = [
  'resume the run', 'resume work', 'resume execution', 'resume the phase', 'carry on',
  'continue the run', 'continue work', 'pick up where', 'start again',
];

function normalize(question: string): string {
  return ` ${question.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
}

function matchesAny(padded: string, phrases: readonly string[]): boolean {
  return phrases.some((p) => padded.includes(` ${p} `));
}

/**
 * The one action a free-text question can suggest, or null. `runActive` and `live` together decide
 * feasibility — a start is never suggested while a run is already active, and activation is only
 * ever suggested when exactly one draft has a committed approval, never a guess among several.
 */
export function matchActionIntent(question: string, live: GovernedProjection, runActive: boolean): ChatAction | null {
  if (typeof question !== 'string' || question.trim() === '') return null;
  const padded = normalize(question);

  const phase = live.activePhase ?? live.nextStartablePhase;

  // STOPPING comes first, and is offered ONLY while something is actually running. A "stop" button
  // over an idle project is a control that must refuse, which teaches the owner to distrust the ones
  // that work.
  if (runActive && phase !== null && matchesAny(padded, STOP_PHRASES)) {
    return {
      verb: 'run.stop',
      args: { phaseId: phase.phaseId },
      label: `Stop work on ${phase.phaseId}`,
    };
  }

  if (!runActive) {
    if (phase !== null && phase.startable && matchesAny(padded, START_PHRASES)) {
      return { verb: 'run.start', args: { phaseId: phase.phaseId }, label: `Start governed execution for ${phase.phaseId}` };
    }
    // RESUMING needs a real session to resume, and an unambiguous one. `sessions` arrives
    // newest-first from the projection; a resumable session is one whose worker exited while its
    // phase did not finish. With none, this suggests nothing rather than guessing a session id.
    if (phase !== null && matchesAny(padded, RESUME_PHRASES)) {
      const resumable = live.sessions.filter(
        (s) => s.phaseId === phase.phaseId && s.state === 'exited',
      );
      const newest = resumable[0];
      if (newest !== undefined) {
        return {
          verb: 'run.resume',
          args: { phaseId: phase.phaseId, sessionId: newest.sessionId },
          label: `Resume ${newest.sessionId}`,
        };
      }
    }
  }

  if (matchesAny(padded, ACTIVATE_PHRASES)) {
    const approved = live.planDrafts.filter((d) => d.decisionState === 'approved');
    if (approved.length === 1) {
      const draft = approved[0]!;
      return {
        verb: 'plan.activate',
        args: { draftId: draft.draftId, decisionId: draft.decisionId as string },
        label: `Activate plan ${draft.draftId}`,
      };
    }
  }

  return null;
}

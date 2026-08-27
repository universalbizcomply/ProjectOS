/**
 * WHAT THE OWNER SAID, AND WHICH GOVERNED VERB — IF ANY — ANSWERS IT.
 *
 * THIS IS NOT A NATURAL-LANGUAGE ROUTER THAT INVENTS AUTHORITY. It resolves a sentence to one of
 * the sixteen verbs that already exist, to a piece of navigation, or to a refusal that says why.
 * It cannot produce a verb the channel does not have, and it never widens what a verb may do: the
 * arguments it returns are the same identifiers the screens would have supplied by pressing a
 * button, and every question of authority is still answered on the trusted side.
 *
 * WHY IT REFUSES OUT LOUD. "Command not recognised" teaches an owner nothing. When ProjectOS cannot
 * do something the refusal names what would have to happen and who does it — which is the same
 * answer the product gives everywhere else it cannot act.
 *
 * WHAT IT DELIBERATELY WILL NOT DO. There is no verb that revises a plan, none that accepts a file
 * and none that probes a provider. Sentences asking for those resolve to a refusal that says so,
 * rather than to a best guess at something adjacent.
 *
 * Pure: same text and same projection in, same intent out. No clock, no I/O.
 *
 * Created in PROJECTOS-CONTROL-CENTER-UX-ARCHITECTURE1A.
 */
import type { GovernedProjection } from '../governed/types';
import { buildPlansModel } from './planStateModel';

/** Where an utterance can go. */
export type Intent =
  /** Dispatch a governed verb with these arguments. */
  | { kind: 'command'; verb: string; args: Readonly<Record<string, string>>; say: string }
  /** Answer from what is already known. Nothing is dispatched. */
  | { kind: 'answer'; lines: readonly string[] }
  /** Move the owner somewhere. Nothing is dispatched. */
  | { kind: 'navigate'; to: 'plans' | 'activity' | 'projects'; say: string }
  /** ProjectOS cannot do it, and says what would have to change. */
  | { kind: 'refusal'; lines: readonly string[] }
  /** Start the objective flow; the panel below the composer takes it from here. */
  | { kind: 'objective'; say: string };

const has = (t: string, ...words: string[]): boolean => words.some((w) => t.includes(w));

/**
 * Resolve one utterance.
 *
 * Order matters: the most specific and most consequential readings are tested first, so "why is
 * this blocked" is never swallowed by the word "this" appearing in a continue phrase.
 */
export function resolveIntent(raw: string, state: GovernedProjection | null): Intent {
  const t = raw.trim().toLowerCase();
  if (t === '') return { kind: 'refusal', lines: ['Type what you would like ProjectOS to do.'] };

  if (state === null) {
    return {
      kind: 'refusal',
      lines: [
        'ProjectOS has not reported on a project yet, so there is nothing to act on.',
        'Open a project first.',
      ],
    };
  }

  const model = buildPlansModel(state);
  const active = model.rows.find((r) => r.kind === 'active') ?? null;
  const undecided = model.rows.find((r) => r.kind === 'draft' && r.needsOwnerDecision) ?? null;

  // ── Things ProjectOS genuinely cannot do. Named before anything adjacent can catch them. ──
  if (has(t, 'upload', 'attach', 'this file', 'this document', 'use this doc')) {
    return {
      kind: 'refusal',
      lines: [
        'ProjectOS cannot take files yet.',
        'Nothing in the governed command channel carries one, so there is no safe way to accept it.',
      ],
    };
  }
  if (has(t, 'change step', 'modify step', 'edit the plan', 'revise', 'change the plan')) {
    return {
      kind: 'refusal',
      lines: [
        'An approved plan cannot be changed from here.',
        'There is no governed command that revises a plan, so the honest route is a new proposal, which you would approve in its place.',
      ],
    };
  }
  if (has(t, 'close this phase', 'close the phase', 'close it')) {
    return {
      kind: 'refusal',
      lines: [
        'Closing work is yours alone, and it is not done from here.',
        'ProjectOS records the evidence; the decision to close stays outside the product.',
      ],
    };
  }

  // ── Reading what is already known. Nothing is dispatched for these. ──
  if (has(t, 'why', 'blocked', 'stuck', "what's wrong", 'what is wrong')) {
    const reasons = active === null ? [] : active.reasons;
    if (reasons.length > 0) return { kind: 'answer', lines: reasons };
    if (state.blockers.length > 0) return { kind: 'answer', lines: state.blockers };
    return { kind: 'answer', lines: ['Nothing is blocked. ' + state.nextSafeAction] };
  }
  if (has(t, 'what happened', 'what is happening', "what's happening", 'show me what', 'activity')) {
    return { kind: 'navigate', to: 'activity', say: 'Opening what has happened.' };
  }
  if (has(t, 'open the plan', 'open plan', 'show the plan', 'see the plan', 'the active plan')) {
    return { kind: 'navigate', to: 'plans', say: 'Opening the plan.' };
  }
  /*
   * SPENDING IS ANSWERED, NOT NAVIGATED TO — because Health does not exist yet.
   *
   * Sending the owner to a destination that has not been built would land them on an empty canvas,
   * which is a worse answer than the figures themselves. The numbers below are the ledger's own,
   * re-stated and never estimated; when Health lands this becomes navigation.
   */
  if (has(t, 'spend', 'budget', 'cost', 'health', 'connections')) {
    const g = state.gatekeeperStatus;
    if (!g.configured || g.budget === null) {
      return { kind: 'answer', lines: ['No spending limit is configured for this project.'] };
    }
    const usd = (micro: number): string => `$${(Math.max(0, micro) / 1_000_000).toFixed(2)}`;
    return {
      kind: 'answer',
      lines: [
        `Spent this month: ${usd(g.budget.spentThisMonthMicroUsd)} of ${usd(g.budget.hardStopAtMicroUsd)}.`,
        g.budget.status === 'STOPPED'
          ? 'The limit has been reached, so nothing that costs money will run.'
          : g.budget.status === 'WARNING'
            ? 'This is past the warning point.'
            : 'This is within the limit.',
      ],
    };
  }
  if (has(t, 'switch project', 'another project', 'other project', 'projects')) {
    return { kind: 'navigate', to: 'projects', say: 'Opening your projects.' };
  }

  // ── The owner's decision on a proposal. The verb exists; the surface asks a second question. ──
  if (has(t, 'approve')) {
    if (undecided === null) {
      return { kind: 'refusal', lines: ['There is no proposal waiting for your decision.'] };
    }
    return {
      kind: 'command',
      verb: 'plan.decide',
      args: { draftId: undecided.id, decision: 'approve' },
      say: 'Recording your approval.',
    };
  }
  if (has(t, 'reject', 'decline')) {
    if (undecided === null) {
      return { kind: 'refusal', lines: ['There is no proposal waiting for your decision.'] };
    }
    return {
      kind: 'command',
      verb: 'plan.decide',
      args: { draftId: undecided.id, decision: 'reject' },
      say: 'Recording your rejection.',
    };
  }

  // ── Starting something new. This creates a PROPOSAL and nothing else. ──
  if (has(t, 'start something new', 'new plan', 'start a new', 'i want to')) {
    return { kind: 'objective', say: 'Tell ProjectOS what you want to achieve.' };
  }

  // ── Execution. Offered only when the model produced a real action for it. ──
  if (has(t, 'pause', 'stop')) {
    const pause = active?.actions.find((a) => a.id === 'pause' && a.verb === 'run.stop') ?? null;
    if (pause === null) return { kind: 'refusal', lines: ['Nothing is running, so there is nothing to pause.'] };
    return { kind: 'command', verb: pause.verb!, args: pause.args, say: 'Asking ProjectOS to pause.' };
  }
  if (has(t, 'continue', 'resume', 'carry on', 'keep going', 'run', 'start')) {
    const go = active?.actions.find((a) => a.id === 'resume' || (a.id === 'pause' && a.verb === 'run.start')) ?? null;
    if (go === null) {
      return {
        kind: 'refusal',
        lines: active === null ? ['There is no active plan to continue.'] : active.reasons.length > 0 ? active.reasons : ['There is nothing to continue right now.'],
      };
    }
    if (!go.enabled) {
      return { kind: 'refusal', lines: [go.disabledReason ?? 'ProjectOS cannot do that right now.'] };
    }
    return { kind: 'command', verb: go.verb!, args: go.args, say: 'Asking ProjectOS to continue.' };
  }

  return {
    kind: 'refusal',
    lines: [
      'ProjectOS did not understand that.',
      'Try: continue this plan · why is this blocked · show me what happened · start something new.',
    ],
  };
}

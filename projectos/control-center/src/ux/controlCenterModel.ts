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
import type { GovernedVerb, GovernedCommandArgs } from './../governed/governedCommands';
import { buildPlansModel } from './planStateModel';

/** Where an utterance can go. */
export type Intent =
  /** Dispatch a governed verb with these arguments. */
  /**
   * Dispatch a governed verb. Typed as the CLOSED verb union rather than a string, so a verb this
   * file could never send cannot be written here in the first place — the compiler refuses it
   * before the runtime has to.
   */
  | {
      kind: 'command';
      verb: GovernedVerb;
      args: GovernedCommandArgs;
      say: string;
      /** True when the owner must answer a second question before this is sent. */
      confirm: string | null;
    }
  /** Answer from what is already known. Nothing is dispatched. */
  | { kind: 'answer'; lines: readonly string[] }
  /** Move the owner somewhere. Nothing is dispatched. */
  | { kind: 'navigate'; to: 'plans' | 'activity' | 'projects' | 'health'; say: string }
  /** ProjectOS cannot do it, and says what would have to change. */
  | { kind: 'refusal'; lines: readonly string[] }
  /** Start the objective flow; the panel below the composer takes it from here. */
  | { kind: 'objective'; say: string };

/**
 * WORD MATCHING, NOT SUBSTRING MATCHING — and the difference is a real command.
 *
 * `includes` made "I'm running late", "let's restart the conversation" and "we went nonstop" all
 * match `run`, `start` and `stop`. Two of those resolve to `run.start`, which spends real money,
 * and one to `run.stop`, which force-kills a running process tree. A word the owner did not say is
 * not an instruction they gave.
 *
 * Tokenising rather than building a regex from the word: nothing here is ever compiled from input,
 * so there is no escaping to get wrong and no pattern to inject.
 */
const tokens = (t: string): readonly string[] =>
  // Apostrophes are dropped rather than split on, so "don't" is one word and negation is seen.
  t.replace(/['’]/g, '').split(/[^a-z0-9]+/).filter((w) => w !== '');

/** Phrases are matched as phrases; single words must appear as whole words. */
const has = (t: string, ...words: string[]): boolean => {
  const tok = tokens(t);
  return words.some((w) => (w.includes(' ') ? t.includes(w) : tok.includes(w)));
};

/** "not approve", "do not approve", "never approve" — a refusal, not an approval. */
const NEGATIONS: readonly string[] = ['not', 'never', 'dont', 'cannot', 'cant', 'wont', 'no'];
const negated = (t: string, word: string): boolean => {
  const tok = tokens(t);
  const at = tok.indexOf(word);
  if (at < 0) return false;
  // Any negation within the four tokens before it — "I do not want to approve this".
  return tok.slice(Math.max(0, at - 4), at).some((w) => NEGATIONS.includes(w));
};

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
  // Word matching means an inflection is a DIFFERENT word: "uploaded" is not "upload".
  if (has(t, 'upload', 'uploaded', 'uploading', 'attach', 'attachment', 'this file', 'this document')) {
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

  /*
   * ACTION WORDS WIN OVER NAVIGATION PHRASES, and the order below is the whole reason.
   *
   * "Approve the active plan" contains "the active plan". With the reading branches first, that
   * sentence resolved to "open the plan": the owner's approval was never dispatched, no
   * confirmation appeared, and the transcript said "Opening the plan." — which looked like it had
   * worked. Anything that names a thing to DO is therefore resolved before anything that merely
   * names a place to LOOK.
   */
  // ── The owner's decision on a proposal. The verb exists; the surface asks a second question. ──
  if (has(t, 'approve') && !negated(t, 'approve') && !has(t, 'disapprove')) {
    if (undecided === null) {
      return { kind: 'refusal', lines: ['There is no proposal waiting for your decision.'] };
    }
    return {
      kind: 'command',
      verb: 'plan.decide',
      args: { draftId: undecided.id, decision: 'approve' },
      say: 'Recording your approval.',
      confirm: 'Approve this plan? This permanently records your decision. It does not start the work.',
    };
  }
  if (has(t, 'reject', 'decline', 'disapprove') || negated(t, 'approve')) {
    if (undecided === null) {
      return { kind: 'refusal', lines: ['There is no proposal waiting for your decision.'] };
    }
    return {
      kind: 'command',
      verb: 'plan.decide',
      args: { draftId: undecided.id, decision: 'reject' },
      say: 'Recording your rejection.',
      confirm: 'Reject this plan? This permanently records your rejection.',
    };
  }

  /*
   * SPENDING AND CONNECTIONS, AHEAD OF THE ACTION BRANCHES — because they were unreachable behind
   * them. "What did this run cost" contains the word `run` and was routed into execution; "I want
   * to know what I've spent" matched the phrase `i want to` and was routed into objective intake.
   * Both are ordinary ways to ask about money, and neither reached the screen that answers it. A
   * sentence naming spend, cost, budget, health or connections is a question about the system, so
   * it is resolved as one first.
   */
  if (has(t, 'spend', 'spending', 'spent', 'budget', 'cost', 'costs', 'health', 'connections', 'connection')) {
    return { kind: 'navigate', to: 'health', say: 'Opening health and usage.' };
  }

  // ── Starting something new. This creates a PROPOSAL and nothing else. ──
  if (has(t, 'start something new', 'new plan', 'start a new', 'i want to')) {
    return { kind: 'objective', say: 'Tell ProjectOS what you want to achieve.' };
  }

  // ── Execution. Offered only when the model produced a real action for it. ──
  /*
   * The owner may well SAY "pause". ProjectOS answers truthfully: there is no pause, only a stop.
   */
  if (has(t, 'pause', 'stop', 'halt')) {
    const stop = active?.actions.find((a) => a.id === 'stop') ?? null;
    if (stop === null) return { kind: 'refusal', lines: ['Nothing is running, so there is nothing to stop.'] };
    return {
      kind: 'command',
      verb: stop.verb!,
      args: stop.args,
      say: 'Stopping the run.',
      /*
       * IT DOES NOT PROMISE A RESUME, because a resume is not always available.
       *
       * `run.stop` force-kills the whole process tree, and the loop persists its session record at
       * exactly one point — AFTER a worker attempt returns (`runner.ts:849`). A run stopped during
       * its first attempt therefore never writes one, and `--resume --session` refuses such an id
       * outright (`NO_SUCH_SESSION`, `runner.ts:375`). Where a record does exist a resume is
       * genuinely accepted, and the Resume control appears on its own for exactly that case — so
       * the honest thing here is to promise only what is always true.
       */
      confirm:
        'Stop the run? This ends it rather than holding it. Everything already recorded is kept, and you can start the work again.',
    };
  }
  if (has(t, 'continue', 'resume', 'carry on', 'keep going', 'run', 'start')) {
    const go = active?.actions.find((a) => a.id === 'resume' || a.id === 'start') ?? null;
    if (go === null) {
      return {
        kind: 'refusal',
        lines: active === null ? ['There is no active plan to continue.'] : active.reasons.length > 0 ? active.reasons : ['There is nothing to continue right now.'],
      };
    }
    if (!go.enabled) {
      return { kind: 'refusal', lines: [go.disabledReason ?? 'ProjectOS cannot do that right now.'] };
    }
    return {
      kind: 'command',
      verb: go.verb!,
      args: go.args,
      say: 'Asking ProjectOS to continue.',
      // Real execution, and real spend. A sentence is not a press, so it is confirmed.
      confirm:
        go.id === 'resume'
          ? 'Continue this plan? ProjectOS will rejoin the last session and carry on working.'
          : 'Start this plan? ProjectOS will begin working, which may spend from your budget.',
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
  if (has(t, 'switch project', 'another project', 'other project', 'projects')) {
    return { kind: 'navigate', to: 'projects', say: 'Opening your projects.' };
  }

  return {
    kind: 'refusal',
    lines: [
      'ProjectOS did not understand that.',
      'Try: continue this plan · why is this blocked · show me what happened · start something new.',
    ],
  };
}

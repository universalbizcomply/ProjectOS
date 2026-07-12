/**
 * Owner Chat — a deterministic, offline natural-language responder over the owner snapshot.
 *
 * The owner asks free-form, plain-language questions; answers are built ONLY from the local
 * OwnerControlModel. There is NO AI model, NO network, and NO metered API (governance constraint) — yet
 * the responder is meant to feel natural, so it uses a local scored intent engine: each intent has a
 * weighted lexicon of synonyms/phrases, the question is tokenised, every intent is scored, and the
 * best-scoring intent(s) answer. A strongly co-mentioned second intent is answered too (e.g. "status
 * and progress"). Pure function: same model + question → same answer, fully unit-testable, and it can
 * never surface anything the snapshot does not already contain.
 * Created in PROJECTOS-V3-OWNER-CHAT1A; natural-language engine per owner directive.
 */

import {
  buildOwnerControlView,
  type OwnerControlModel,
  type OwnerControlView,
} from './ownerModel';

export type ChatIntent =
  | 'greeting'
  | 'status'
  | 'progress'
  | 'decisions'
  | 'risks'
  | 'blockers'
  | 'next'
  | 'safety'
  | 'phase'
  | 'restricted'
  | 'help'
  | 'unknown';

export interface ChatAnswer {
  readonly intent: ChatIntent;
  /** Every intent the responder recognised, best first (for transparency/tests). */
  readonly matchedIntents: readonly ChatIntent[];
  readonly answer: string;
  readonly suggestions: readonly string[];
}

export const BASE_SUGGESTIONS: readonly string[] = [
  'What is the plan status?',
  'How far along are we?',
  'What decisions need me?',
  'What is the next safe action?',
  'Is anything blocked?',
];

// Content intents can be combined (a question may ask for two at once); the others answer alone.
const CONTENT_INTENTS: ReadonlySet<ChatIntent> = new Set<ChatIntent>([
  'status', 'progress', 'decisions', 'risks', 'blockers', 'next', 'safety', 'phase',
]);

/**
 * Per-intent lexicon. A term containing a space is a phrase (matched against the padded question and
 * weighted higher); a single term is matched as a whole word token. Priority order (earlier = wins ties)
 * puts the more specific/actionable intents first.
 */
const LEXICON: ReadonlyArray<{ intent: ChatIntent; terms: readonly string[] }> = [
  { intent: 'greeting', terms: ['hello', 'hi', 'hey', 'hiya', 'yo', 'greetings', 'good morning', 'good afternoon', 'good evening'] },
  { intent: 'help', terms: ['help', 'options', 'commands', 'capabilities', 'what can you', 'what can i ask', 'how do i use', 'what do you do'] },
  { intent: 'restricted', terms: ['can you', 'could you', 'would you', 'will you', 'do it for me', 'on my behalf', 'you approve', 'owner only', 'permission', 'permissions', 'are you allowed', 'instead of me'] },
  { intent: 'decisions', terms: ['decision', 'decisions', 'decide', 'approve', 'approval', 'approvals', 'sign off', 'signoff', 'authorise', 'authorize', 'waiting on me', 'waiting for me', 'need me', 'needs me', 'my approval', 'awaiting'] },
  { intent: 'blockers', terms: ['block', 'blocked', 'blocker', 'blockers', 'blocking', 'stuck', 'stopped', 'impediment', 'held up', 'holding up', 'in the way', 'cannot proceed', 'why can'] },
  { intent: 'risks', terms: ['risk', 'risks', 'risky', 'danger', 'dangerous', 'concern', 'concerns', 'worry', 'worried', 'threat', 'threats', 'exposure'] },
  { intent: 'progress', terms: ['progress', 'complete', 'completed', 'completion', 'percent', 'percentage', 'done', 'how far', 'far along', 'how much', 'velocity', 'pace', 'milestone', 'milestones'] },
  { intent: 'next', terms: ['next', 'action', 'actions', 'recommend', 'recommendation', 'proceed', 'what now', 'what should', 'what do i do', 'next step', 'next steps', 'move forward', 'go ahead', 'should i do'] },
  { intent: 'safety', terms: ['safe', 'safety', 'secret', 'secrets', 'production', 'api', 'provider', 'providers', 'live', 'deployed', 'frozen', 'is it safe'] },
  { intent: 'phase', terms: ['phase', 'phases', 'stage', 'stages', 'step', 'steps', 'where are we', 'where am i', 'which phase', 'currently on'] },
  { intent: 'status', terms: ['status', 'plan', 'state', 'standing', 'situation', 'overview', 'summary', 'health', 'how is', 'how are things', 'where do things stand'] },
];

const PHRASE_WEIGHT = 3;
const WORD_WEIGHT = 2;
const MIN_SCORE = WORD_WEIGHT; // at least one whole-word or phrase hit

interface Scored {
  readonly intent: ChatIntent;
  readonly score: number;
  readonly priority: number;
}

/** Lowercase and replace every run of non-alphanumerics with a single space (so punctuation never
 * breaks a phrase or word boundary). */
function normalize(q: string): string {
  return q.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokenize(norm: string): ReadonlySet<string> {
  return new Set(norm.split(' ').filter(Boolean));
}

/** Score one intent: phrases matched against the padded string, single terms against word tokens. */
function scoreIntent(terms: readonly string[], padded: string, words: ReadonlySet<string>): number {
  let score = 0;
  for (const term of terms) {
    if (term.includes(' ')) {
      if (padded.includes(` ${term} `)) score += PHRASE_WEIGHT;
    } else if (words.has(term)) {
      score += WORD_WEIGHT;
    }
  }
  return score;
}

/** Rank intents for a question, best first. Empty when nothing clears the threshold. */
export function rankIntents(question: string): readonly ChatIntent[] {
  const norm = normalize(question);
  if (!norm) return [];
  const padded = ` ${norm} `;
  const words = tokenize(norm);
  const scored: Scored[] = [];
  LEXICON.forEach((entry, priority) => {
    const score = scoreIntent(entry.terms, padded, words);
    if (score >= MIN_SCORE) scored.push({ intent: entry.intent, score, priority });
  });
  scored.sort((a, b) => (b.score - a.score) || (a.priority - b.priority));
  return scored.map((s) => s.intent);
}

function list(items: readonly string[], empty: string): string {
  if (items.length === 0) return empty;
  return items.map((i) => `• ${i}`).join('\n');
}

/** Build the answer text for a single intent from the view/model. */
function answerFor(intent: ChatIntent, view: OwnerControlView, model: OwnerControlModel): string {
  switch (intent) {
    case 'greeting':
      return `Hello. ${view.whereYouAre} Ask me about status, progress, decisions, risks, blockers, or the next safe action.`;
    case 'help':
      return (
        'You can ask about: the plan status, how far along the project is, what decisions need you, ' +
        'current risks and blockers, the next safe action, the safety state, or which actions are owner-only.'
      );
    case 'status':
      return `Plan status is ${view.planStatus}. ${view.whereYouAre}`;
    case 'progress':
      return `${view.completionLabel}. ${
        model.activePhase ? `Currently on ${model.activePhase}.` : `Next up is ${model.nextRecommendedPhase ?? 'to be decided'}.`
      }`;
    case 'decisions':
      return view.hasDecisions
        ? `There ${view.decisionsRequired.length === 1 ? 'is 1 decision' : `are ${view.decisionsRequired.length} decisions`} waiting for you:\n${list(
            view.decisionsRequired.map((d) => `${d.title} — ${d.detail}`),
            '',
          )}`
        : 'Nothing is waiting on your approval right now.';
    case 'risks':
      return `Current risks:\n${list(view.risks, 'No current risks are recorded.')}`;
    case 'blockers':
      return view.blockers.length
        ? `These are blocking progress:\n${list(view.blockers, '')}`
        : 'Nothing is blocked right now.';
    case 'next':
      return `The next safe action is: ${view.nextSafeAction}`;
    case 'safety':
      return `Safety state — ${view.safetyBadges.map((b) => b.label).join(' · ')}.`;
    case 'phase':
      return view.whereYouAre;
    case 'restricted':
      return (
        'These actions are owner-only and I cannot perform them for you: ' +
        `${model.restrictedActions.join(', ') || 'none listed'}. ` +
        'ProjectOS and Claude can prepare and explain them, but only you can authorise them.'
      );
    default:
      return (
        "I can only answer from this project's current status. Try asking about the plan status, " +
        'progress, decisions, risks, blockers, or the next safe action.'
      );
  }
}

/**
 * Build a deterministic answer to an owner question from the model. Pure. Recognises free-form natural
 * language via the scored intent engine, and answers a strongly co-mentioned second content intent too.
 */
export function answerOwnerQuestion(model: OwnerControlModel, question: string): ChatAnswer {
  const view = buildOwnerControlView(model);
  const ranked = rankIntents(typeof question === 'string' ? question : '');

  if (ranked.length === 0) {
    return { intent: 'unknown', matchedIntents: [], answer: answerFor('unknown', view, model), suggestions: BASE_SUGGESTIONS };
  }

  const primary = ranked[0]!;
  const segments = [answerFor(primary, view, model)];
  const matched: ChatIntent[] = [primary];

  // If the primary is a content intent and a distinct content intent was also clearly asked, answer both.
  if (CONTENT_INTENTS.has(primary)) {
    const secondary = ranked.find((i) => i !== primary && CONTENT_INTENTS.has(i));
    if (secondary) {
      segments.push(answerFor(secondary, view, model));
      matched.push(secondary);
    }
  }

  return { intent: primary, matchedIntents: matched, answer: segments.join('\n\n'), suggestions: BASE_SUGGESTIONS };
}

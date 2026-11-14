// Origin: original ProjectOS code
/**
 * The step-capped research loop (PROJECTOS-PORT-RESEARCH1A, C16): every answer cites what was fetched, or there is none.
 *
 * ONE STEP IS ONE ACTION. A planner (a model, behind a port) is shown the question, the fenced evidence so far and
 * the refusals so far, and answers with one action: search, fetch or answer. Every action, including a malformed
 * one and an answer that is refused, uses a step. The loop ends when an answer is admitted or when the step cap is
 * reached, and a run that reaches the cap ends in `STEP_CAP`, not in a guess.
 *
 * THE CAPS ARE OURS. A caller may ask for fewer steps than the ceiling and never more; a count that is not a whole
 * number is refused, not clamped. The deadline is read from the injected clock through a guard that refuses a clock that
 * goes backwards. At most `MAX_SOURCES` pages are kept per run.
 *
 * AN ANSWER IS ADMITTED BY CODE THAT ALREADY EXISTS. The planner's citations name a page path and lines. The project
 * is the run's, never the planner's. Each fetched page is a hit in that project (`hitOfPage`) and the answer goes
 * through `admitCitedAnswer`, so an answer with no citation, or one citing a page that was not fetched or lines it
 * does not have, is refused and the planner is told why, in a closed code.
 *
 * THE PLANNER'S WORDS AND THE PAGES' ARE DATA. Pages reach the planner only fenced (`evidence.ts`). The refusals it is
 * told are built from closed codes and reasons, never from page text. What the planner returns is judged for shape
 * and acts on nothing but this loop's own three actions: no URL, tool name or project taken from a page can do
 * anything but be offered to the guard as a fetch.
 *
 * Pure: the planner, the network, DNS, the clock and the grant are injected.
 */

import { admitCitedAnswer, type CitedAnswer, type CitedSearchHit, type SearchCitation } from '../search/citation.js';
import { renderResearchEvidence, renderSearchResults, hitOfPage } from './evidence.js';
import { isResearchScope } from './pageCache.js';
import { createClockGuard, type ResearchScope } from './ports.js';
import { researchRefused, type ResearchRefusal } from './refusal.js';
import { createSpendBook, type SpendGrant } from './searchBudget.js';
import { runWebSearch } from './searchRuntime.js';
import type { WebSearchProvider } from './searchProvider.js';
import { fetchPage, type FetchedPage, type FetchPageDeps } from './webFetch.js';

export const DEFAULT_MAX_STEPS = 6;
export const MAX_STEPS_CEILING = 12;
export const MAX_SOURCES = 8;
export const DEFAULT_DEADLINE_MS = 120_000;
export const MAX_DEADLINE_MS = 600_000;
export const MAX_ANSWER_CHARS = 20_000;
export const MAX_CITATIONS = 20;
export const MAX_QUESTION_CHARS = 2000;
const NOTES_KEPT = 8;
const SEARCHES_SHOWN = 3;

export interface PlannerView {
  readonly question: string;
  readonly step: number;
  readonly stepsLeft: number;
  /** Fetched pages, each fenced as untrusted and numbered by line. */
  readonly evidence: readonly string[];
  /** The latest search results, each fenced as untrusted. */
  readonly searchResults: readonly string[];
  /** What went wrong so far, in closed codes. Never text from a page. */
  readonly notes: readonly string[];
}

export type PlannerPort = (view: PlannerView) => Promise<unknown>;

export interface ResearchRequest {
  readonly scope: ResearchScope;
  readonly question: unknown;
  readonly budget?: { readonly maxMicroUsd?: unknown };
  readonly maxSteps?: unknown;
  readonly deadlineMs?: unknown;
}

export interface ResearchDeps extends FetchPageDeps {
  readonly providers: readonly WebSearchProvider[];
  readonly grant: SpendGrant;
  readonly planner: PlannerPort;
}

export interface CitedSource {
  readonly path: string;
  readonly url: string;
  readonly contentSha256: string;
}

export interface ResearchOutcome {
  readonly answer: CitedAnswer;
  /** The pages the answer cites, with what each said when it was fetched. */
  readonly sources: readonly CitedSource[];
}

export type ResearchRun = ({ readonly ok: true; readonly value: ResearchOutcome } | { readonly ok: false; readonly refusal: ResearchRefusal }) & {
  readonly steps: number;
  readonly spentMicroUsd: number;
};

const isWhole = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;

function limitsOf(request: ResearchRequest): { readonly maxSteps: number; readonly deadlineMs: number } | null {
  const steps = request.maxSteps === undefined ? DEFAULT_MAX_STEPS : request.maxSteps;
  const deadline = request.deadlineMs === undefined ? DEFAULT_DEADLINE_MS : request.deadlineMs;
  if (!isWhole(steps, 1, Number.MAX_SAFE_INTEGER) || !isWhole(deadline, 1, Number.MAX_SAFE_INTEGER)) return null;
  return { maxSteps: Math.min(steps, MAX_STEPS_CEILING), deadlineMs: Math.min(deadline, MAX_DEADLINE_MS) };
}

const refusedRun = (code: Parameters<typeof researchRefused>[0], message: string, steps: number, spentMicroUsd: number, detail: Parameters<typeof researchRefused>[2] = {}): ResearchRun => ({
  ...researchRefused(code, message, detail),
  steps,
  spentMicroUsd,
});

interface Cited {
  readonly path?: unknown;
  readonly startLine?: unknown;
  readonly endLine?: unknown;
}

/** The planner's answer, judged: its citations get the run's project, and are held to a count. */
function answerOf(action: { readonly text?: unknown; readonly citations?: unknown }, project: string): { readonly text?: string; readonly citations: readonly SearchCitation[] } | string {
  if (typeof action.text !== 'string' || action.text.length > MAX_ANSWER_CHARS) return 'answer-malformed';
  const given = action.citations;
  if (given !== undefined && (!Array.isArray(given) || given.length > MAX_CITATIONS)) return 'answer-malformed';
  const citations: SearchCitation[] = [];
  for (const item of (given ?? []) as readonly Cited[]) {
    if (typeof item !== 'object' || item === null || typeof item.path !== 'string') return 'answer-malformed';
    citations.push({ project, path: item.path, startLine: item.startLine as number, endLine: item.endLine as number });
  }
  return { text: action.text, citations };
}

const noteOf = (label: string, refusal: ResearchRefusal): string => `${label}: ${refusal.code}${refusal.reason === undefined ? '' : `/${refusal.reason}`}`;

export async function runResearch(request: ResearchRequest, deps: ResearchDeps): Promise<ResearchRun> {
  if (!isResearchScope(request.scope)) return refusedRun('BAD_SCOPE', 'a research request needs a tenant and a project', 0, 0);
  const limits = limitsOf(request);
  const question = request.question;
  if (limits === null || typeof question !== 'string' || question.trim() === '' || question.length > MAX_QUESTION_CHARS || /\p{Cc}/u.test(question)) {
    return refusedRun('INVALID_REQUEST', 'the question, the step count and the deadline must be usable', 0, 0);
  }
  const clock = createClockGuard(deps.clock);
  const startedAt = clock.now();
  if (startedAt === null) return refusedRun('BAD_CLOCK', 'the clock did not give a usable time', 0, 0);
  const scope = request.scope;
  const spend = createSpendBook(request.budget);
  const pages = new Map<string, FetchedPage>();
  const evidence: string[] = [];
  let searchResults: (readonly string[])[] = [];
  let notes: string[] = [];
  const note = (text: string): void => void (notes = [...notes, text].slice(-NOTES_KEPT));

  for (let step = 1; step <= limits.maxSteps; step += 1) {
    const now = clock.now();
    if (now === null) return refusedRun('BAD_CLOCK', 'the clock did not give a usable time', step - 1, spend.spent());
    if (now - startedAt > limits.deadlineMs) return refusedRun('DEADLINE', 'the research ran past its deadline', step - 1, spend.spent());
    let action: unknown;
    try {
      action = await deps.planner({ question, step, stepsLeft: limits.maxSteps - step + 1, evidence: [...evidence], searchResults: searchResults.slice(-SEARCHES_SHOWN).flat(), notes: [...notes] });
    } catch {
      return refusedRun('PLANNER_FAILED', 'the planner failed', step - 1, spend.spent());
    }
    const row = action as { kind?: unknown; query?: unknown; providerId?: unknown; url?: unknown; text?: unknown; citations?: unknown } | null;
    const kind = typeof row === 'object' && row !== null ? row.kind : undefined;

    if (kind === 'search' && row !== null) {
      const found = await runWebSearch(
        { scope, query: row.query, ...(row.providerId === undefined ? {} : { providerId: row.providerId }) },
        { providers: deps.providers, spend, grant: deps.grant },
      );
      if (found.ok) searchResults = [...searchResults, renderSearchResults(found.value.provider, found.value.results)].slice(-SEARCHES_SHOWN);
      else note(noteOf('search refused', found.refusal));
    } else if (kind === 'fetch' && row !== null) {
      if (pages.size >= MAX_SOURCES) {
        note('fetch refused: TOO_MANY_SOURCES');
      } else {
        const fetched = await fetchPage({ scope, url: row.url }, deps);
        if (!fetched.ok) {
          note(noteOf('fetch refused', fetched.refusal));
        } else if (!pages.has(fetched.value.page.sourcePath)) {
          pages.set(fetched.value.page.sourcePath, fetched.value.page);
          evidence.push(renderResearchEvidence(fetched.value.page));
        }
      }
    } else if (kind === 'answer' && row !== null) {
      const made = answerOf(row, scope.project);
      if (typeof made === 'string') {
        note(`answer refused: ${made}`);
      } else {
        const hits: CitedSearchHit[] = [];
        for (const page of pages.values()) {
          const hit = hitOfPage(page, scope.project);
          if (hit.ok) hits.push(hit.hit);
        }
        const admitted = admitCitedAnswer(made, hits);
        if (admitted.ok) {
          const cited = new Set(admitted.answer.citations.map((citation) => citation.path));
          const sources = [...pages.values()].filter((page) => cited.has(page.sourcePath)).map((page) => ({ path: page.sourcePath, url: page.finalUrl, contentSha256: page.contentSha256 }));
          return { ok: true, value: { answer: admitted.answer, sources }, steps: step, spentMicroUsd: spend.spent() };
        }
        note(`answer refused: ${admitted.reason}`);
      }
    } else {
      note('action refused: ACTION_MALFORMED');
    }
  }
  return refusedRun('STEP_CAP', `the research reached its step cap of ${limits.maxSteps} without a cited answer`, limits.maxSteps, spend.spent());
}

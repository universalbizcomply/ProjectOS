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
 * goes backwards, and it is ENFORCED MID-STEP: every wait (the planner, a search, a name lookup, a fetch) is made through the
 * injected timer with at most the time the run has left, so a hung port ends the run with `TIMEOUT` or `DEADLINE`, not never.
 * At most `MAX_SOURCES` pages are kept per run.
 *
 * A FETCH MUST COME FROM THE RUN. The planner may ask only for an address typed in the question or listed in this run's
 * screened search results (`urlProvenance.ts`), so a page cannot tell it to fetch an address that carries the evidence out. A
 * run touches at most `MAX_HOSTS_PER_RUN` hosts.
 *
 * THE PLANNER IS A PAID CALL. Each call re-sends the evidence, so it is charged to the run's spend book by its size, and
 * asked of the grant, before it is made. A free planner (both prices zero) needs no budget.
 *
 * AN ANSWER IS ADMITTED BY CODE THAT ALREADY EXISTS, AND THEN FILTERED. The planner's citations name a page path and lines. The
 * project is the run's, never the planner's. Each fetched page is a hit in that project (`hitOfPage`) and the answer goes
 * through `admitCitedAnswer`. The admitted text then passes `filterAnswerText`, which defangs every address that is not a cited
 * source (`answerFilter.ts`).
 *
 * THE PLANNER'S WORDS AND THE PAGES' ARE DATA. Pages reach the planner only fenced (`evidence.ts`). The refusals it is
 * told are built from closed codes and ONE neutral reason for everything about an address, a name or DNS: the exact code
 * goes in the audit record this run returns, and never to the model, so it is not an oracle for what is inside a network.
 *
 * Pure: the planner, the network, DNS, the timer, the clock and the grant are injected.
 */

import { admitCitedAnswer, type CitedAnswer, type CitedSearchHit, type SearchCitation } from '../search/citation.js';
import { filterAnswerText } from './answerFilter.js';
import { renderResearchEvidence, renderSearchResults, hitOfPage } from './evidence.js';
import { isResearchScope } from './pageCache.js';
import { createClockGuard, type ResearchScope, type TimerPort } from './ports.js';
import { researchRefused, type ResearchRefusal, type UrlRefusalReason } from './refusal.js';
import { createSpendBook, reservePaidQuery, type SpendGrant } from './searchBudget.js';
import { runWebSearch } from './searchRuntime.js';
import type { WebSearchProvider } from './searchProvider.js';
import { callWithin, timeoutOf, type ResearchTimeouts } from './timing.js';
import { canonicalOf, listedUrlsOf, urlProvenanceProblem } from './urlProvenance.js';
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
const AUDIT_KEPT = 200;

export interface PlannerView {
  readonly question: string;
  readonly step: number;
  readonly stepsLeft: number;
  /** Fetched pages, each fenced as untrusted and numbered by line. */
  readonly evidence: readonly string[];
  /** The latest search results, each fenced as untrusted. */
  readonly searchResults: readonly string[];
  /** What went wrong so far, in closed codes. Never text from a page, and never the exact reason for an address or DNS refusal. */
  readonly notes: readonly string[];
}

/** `signal` is aborted when the run's wait for this call ends; the planner must stop on it. */
export type PlannerPort = (view: PlannerView, signal?: AbortSignal) => Promise<unknown>;

/** What one planner call costs, in whole micro-USD: a base, and a price per thousand characters sent. Both zero: a free planner. */
export interface PlannerPrice {
  readonly baseMicroUsd: number;
  readonly perKiloCharMicroUsd: number;
}

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
  readonly plannerPrice: PlannerPrice;
  readonly timer: TimerPort;
}

export interface CitedSource {
  readonly path: string;
  readonly url: string;
  readonly contentSha256: string;
}

export interface ResearchOutcome {
  /** The admitted answer, with its text filtered: addresses that are not cited sources are defanged. Show it as plain text. */
  readonly answer: CitedAnswer;
  /** The pages the answer cites, with what each said when it was fetched. */
  readonly sources: readonly CitedSource[];
  /** How many spans the filter removed from the text. */
  readonly removedFromAnswer: number;
}

/** One refusal, with its exact code and reason. For the people who audit a run, never for the planner. */
export interface AuditEntry {
  readonly step: number;
  readonly action: 'planner' | 'search' | 'fetch' | 'answer' | 'run';
  readonly code: string;
  readonly reason?: string;
}

export type ResearchRun = ({ readonly ok: true; readonly value: ResearchOutcome } | { readonly ok: false; readonly refusal: ResearchRefusal }) & {
  readonly steps: number;
  readonly spentMicroUsd: number;
  readonly audit: readonly AuditEntry[];
};

const isWhole = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;

function limitsOf(request: ResearchRequest): { readonly maxSteps: number; readonly deadlineMs: number } | null {
  const steps = request.maxSteps === undefined ? DEFAULT_MAX_STEPS : request.maxSteps;
  const deadline = request.deadlineMs === undefined ? DEFAULT_DEADLINE_MS : request.deadlineMs;
  if (!isWhole(steps, 1, Number.MAX_SAFE_INTEGER) || !isWhole(deadline, 1, Number.MAX_SAFE_INTEGER)) return null;
  return { maxSteps: Math.min(steps, MAX_STEPS_CEILING), deadlineMs: Math.min(deadline, MAX_DEADLINE_MS) };
}

const priceUsable = (price: PlannerPrice | undefined): price is PlannerPrice =>
  typeof price === 'object' && price !== null && isWhole(price.baseMicroUsd, 0, Number.MAX_SAFE_INTEGER) && isWhole(price.perKiloCharMicroUsd, 0, Number.MAX_SAFE_INTEGER);

/** The cost of showing the planner this much text: the base, and a price for each thousand characters. */
const plannerCostOf = (price: PlannerPrice, chars: number): number => price.baseMicroUsd + Math.ceil(chars / 1000) * price.perKiloCharMicroUsd;

const refusedRun = (code: Parameters<typeof researchRefused>[0], message: string, steps: number, spentMicroUsd: number, audit: readonly AuditEntry[], detail: Parameters<typeof researchRefused>[2] = {}): ResearchRun => ({
  ...researchRefused(code, message, detail),
  steps,
  spentMicroUsd,
  audit,
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

/** Reasons about the network are one reason to the planner. Reasons about the shape of the request it made are its own business. */
const PLANNER_MAY_KNOW: ReadonlySet<UrlRefusalReason> = new Set<UrlRefusalReason>([
  'invalid-url', 'not-http-scheme', 'userinfo-in-url', 'ambiguous-authority', 'credential-in-query', 'blocked-port', 'not-listed', 'url-too-long', 'too-many-hosts', 'website-policy', 'unknown-policy',
]);

const reasonForPlanner = (reason: UrlRefusalReason | undefined): string => (reason === undefined ? '' : `/${PLANNER_MAY_KNOW.has(reason) ? reason : 'not-fetchable'}`);

const noteOf = (label: string, refusal: ResearchRefusal): string => `${label}: ${refusal.code}${refusal.code === 'URL_REFUSED' ? reasonForPlanner(refusal.reason) : refusal.reason === undefined ? '' : `/${refusal.reason}`}`;

export async function runResearch(request: ResearchRequest, deps: ResearchDeps): Promise<ResearchRun> {
  if (!isResearchScope(request.scope)) return refusedRun('BAD_SCOPE', 'a research request needs a tenant and a project', 0, 0, []);
  const limits = limitsOf(request);
  const question = request.question;
  if (limits === null || typeof question !== 'string' || question.trim() === '' || question.length > MAX_QUESTION_CHARS || /\p{Cc}/u.test(question) || !priceUsable(deps.plannerPrice)) {
    return refusedRun('INVALID_REQUEST', 'the question, the step count, the deadline and the planner price must be usable', 0, 0, []);
  }
  const clock = createClockGuard(deps.clock);
  const startedAt = clock.now();
  if (startedAt === null) return refusedRun('BAD_CLOCK', 'the clock did not give a usable time', 0, 0, []);
  const scope = request.scope;
  const spend = createSpendBook(request.budget);
  const pages = new Map<string, FetchedPage>();
  const evidence: string[] = [];
  const listed = new Set<string>(listedUrlsOf(question));
  const hosts = new Set<string>();
  const audit: AuditEntry[] = [];
  let searchResults: (readonly string[])[] = [];
  let notes: string[] = [];
  const note = (text: string): void => void (notes = [...notes, text].slice(-NOTES_KEPT));
  const record = (entry: AuditEntry): void => void (audit.length < AUDIT_KEPT && audit.push(entry));
  const refuse = (code: Parameters<typeof researchRefused>[0], message: string, step: number, detail: Parameters<typeof researchRefused>[2] = {}): ResearchRun => refusedRun(code, message, step, spend.spent(), audit, detail);

  for (let step = 1; step <= limits.maxSteps; step += 1) {
    const now = clock.now();
    if (now === null) return refuse('BAD_CLOCK', 'the clock did not give a usable time', step - 1);
    if (now - startedAt > limits.deadlineMs) return refuse('DEADLINE', 'the research ran past its deadline', step - 1);
    // Every wait below is at most what the run has left, so a hung port cannot outlast the deadline.
    const left = Math.max(1, Math.floor(limits.deadlineMs - (now - startedAt)));
    const timeouts: Partial<ResearchTimeouts> = {
      dnsMs: Math.min(timeoutOf(deps.timeouts, 'dnsMs'), left),
      fetchMs: Math.min(timeoutOf(deps.timeouts, 'fetchMs'), left),
      searchMs: Math.min(timeoutOf(deps.timeouts, 'searchMs'), left),
      plannerMs: Math.min(timeoutOf(deps.timeouts, 'plannerMs'), left),
    };
    const stepDeps = { ...deps, timeouts };
    const ended = (what: string): ResearchRun => {
      const after = clock.now();
      return after === null || after - startedAt >= limits.deadlineMs
        ? refuse('DEADLINE', `the research ran past its deadline while ${what}`, step - 1)
        : refuse('TIMEOUT', `${what} did not answer in time`, step - 1);
    };

    const view: PlannerView = { question, step, stepsLeft: limits.maxSteps - step + 1, evidence: [...evidence], searchResults: searchResults.slice(-SEARCHES_SHOWN).flat(), notes: [...notes] };
    const chars = view.question.length + [...view.evidence, ...view.searchResults, ...view.notes].reduce((sum, text) => sum + text.length, 0);
    const cost = plannerCostOf(deps.plannerPrice, chars);
    if (cost > 0) {
      const gate = await reservePaidQuery(spend, deps.grant, { scope, provider: 'planner', microUsd: cost });
      if (gate !== null) {
        record({ step, action: 'planner', code: gate.refusal.code });
        return refuse(gate.refusal.code, gate.refusal.message, step - 1);
      }
    }
    let thrown = false;
    const planned = await callWithin(deps.timer, timeouts.plannerMs as number, async (signal) => {
      try {
        return { action: await deps.planner(view, signal) };
      } catch {
        thrown = true;
        return null;
      }
    });
    if (planned.kind === 'timeout') {
      record({ step, action: 'planner', code: 'TIMEOUT' });
      return ended('the planner');
    }
    if (planned.kind === 'error' || thrown || planned.value === null) {
      record({ step, action: 'planner', code: 'PLANNER_FAILED' });
      return refuse('PLANNER_FAILED', 'the planner failed', step - 1);
    }
    const action: unknown = planned.value.action;
    const row = action as { kind?: unknown; query?: unknown; providerId?: unknown; url?: unknown; text?: unknown; citations?: unknown } | null;
    const kind = typeof row === 'object' && row !== null ? row.kind : undefined;

    if (kind === 'search' && row !== null) {
      const found = await runWebSearch(
        { scope, query: row.query, ...(row.providerId === undefined ? {} : { providerId: row.providerId }) },
        { providers: deps.providers, spend, grant: deps.grant, timer: deps.timer, timeouts },
      );
      if (found.ok) {
        searchResults = [...searchResults, renderSearchResults(found.value.provider, found.value.results)].slice(-SEARCHES_SHOWN);
        for (const result of found.value.results) {
          const canonical = canonicalOf(result.url);
          if (canonical !== null && listed.size < 400) listed.add(canonical);
        }
        for (const drop of found.value.dropped) {
          note(`search result dropped: ${drop.why}`);
          record({ step, action: 'search', code: 'RESULT_DROPPED', reason: drop.why });
        }
      } else {
        note(noteOf('search refused', found.refusal));
        record({ step, action: 'search', code: found.refusal.code });
        if (found.refusal.code === 'TIMEOUT') return ended('the search');
      }
    } else if (kind === 'fetch' && row !== null) {
      const problem = urlProvenanceProblem(row.url, listed, deps.policy, hosts);
      if (problem !== null) {
        note(`fetch refused: URL_REFUSED${reasonForPlanner(problem)}`);
        record({ step, action: 'fetch', code: 'URL_REFUSED', reason: problem });
      } else if (pages.size >= MAX_SOURCES) {
        note('fetch refused: TOO_MANY_SOURCES');
        record({ step, action: 'fetch', code: 'TOO_MANY_SOURCES' });
      } else {
        const host = new URL(canonicalOf(row.url as string) as string).hostname;
        hosts.add(host);
        const fetched = await fetchPage({ scope, url: row.url }, stepDeps);
        if (!fetched.ok) {
          note(noteOf('fetch refused', fetched.refusal));
          record({ step, action: 'fetch', code: fetched.refusal.code, ...(fetched.refusal.reason === undefined ? {} : { reason: fetched.refusal.reason }) });
          if (fetched.refusal.code === 'TIMEOUT') return ended('a fetch');
        } else if (!pages.has(fetched.value.page.sourcePath)) {
          pages.set(fetched.value.page.sourcePath, fetched.value.page);
          evidence.push(renderResearchEvidence(fetched.value.page));
        }
      }
    } else if (kind === 'answer' && row !== null) {
      const made = answerOf(row, scope.project);
      if (typeof made === 'string') {
        note(`answer refused: ${made}`);
        record({ step, action: 'answer', code: made });
      } else {
        const hits: CitedSearchHit[] = [];
        for (const page of pages.values()) {
          const hit = hitOfPage(page, scope.project);
          if (hit.ok) hits.push(hit.hit);
        }
        const admitted = admitCitedAnswer(made, hits);
        if (admitted.ok) {
          const cited = new Set(admitted.answer.citations.map((citation) => citation.path));
          const citedPages = [...pages.values()].filter((page) => cited.has(page.sourcePath));
          const sources = citedPages.map((page) => ({ path: page.sourcePath, url: page.finalUrl, contentSha256: page.contentSha256 }));
          const filtered = filterAnswerText(admitted.answer.text, citedPages.flatMap((page) => [page.finalUrl, page.requestedUrl]));
          return {
            ok: true,
            value: { answer: { text: filtered.text, citations: admitted.answer.citations }, sources, removedFromAnswer: filtered.removed },
            steps: step,
            spentMicroUsd: spend.spent(),
            audit,
          };
        }
        note(`answer refused: ${admitted.reason}`);
        record({ step, action: 'answer', code: admitted.reason });
      }
    } else {
      note('action refused: ACTION_MALFORMED');
      record({ step, action: 'run', code: 'ACTION_MALFORMED' });
    }
  }
  return refuse('STEP_CAP', `the research reached its step cap of ${limits.maxSteps} without a cited answer`, limits.maxSteps);
}

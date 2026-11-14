// Origin: original ProjectOS code
/**
 * A paid search is a paid call (PROJECTOS-PORT-RESEARCH1A, C16): a P3 action, so it needs a budget and a grant.
 *
 * THE BOOK BELONGS TO THE RUN. It is made by the research run from the budget the owner set, and nothing a caller
 * passes in can say what has been spent: there is no `spent` to hand in, and a price is the provider's own. A paid
 * query is refused when
 *   - there is no budget, or it is not a whole positive number of micro-USD (`BUDGET_REQUIRED`);
 *   - no grant answers exactly `true` for it, and a grant that throws is not a grant (`NO_GRANT`);
 *   - its price on top of what is already reserved is over the budget (`OVER_BUDGET`).
 * All three are asked BEFORE the provider is called, and the cost is reserved before the call, so two queries cannot
 * both fit a budget that holds one. A reservation is given back only when the provider failed before it could have
 * sent anything.
 *
 * THE BUDGET HAS A CEILING. `MAX_RUN_BUDGET_MICRO_USD` is the most a run may be given, whatever its request says, so a caller that
 * asks for a budget of the whole safe-integer range gets the ceiling. Planner calls are charged to the same book (`researchLoop.ts`).
 *
 * WHAT THIS CANNOT PROVE. What the provider really billed, and what the owner has spent across runs: the book is per run. A
 * cross-run ledger belongs to the grant: the Brave adapter is not enabled without a ledger port that answers exactly true,
 * and the planner's grant is asked for every call. Reconciliation with what was billed is a later phase.
 */

import type { ResearchScope } from './ports.js';
import { researchRefused } from './refusal.js';

export interface SpendBook {
  /** Null when the run has no usable budget. A paid query is refused then. */
  readonly capMicroUsd: number | null;
  readonly spent: () => number;
  readonly reserve: (microUsd: number) => boolean;
  readonly release: (microUsd: number) => void;
}

export interface SpendRequest {
  readonly scope: ResearchScope;
  readonly provider: string;
  readonly microUsd: number;
}

/** True only when answered with exactly `true`. */
export type SpendGrant = (request: SpendRequest) => boolean | Promise<boolean>;

/** The most a run may be given, in micro-USD: two dollars. A request cannot raise it. */
export const MAX_RUN_BUDGET_MICRO_USD = 2_000_000;
const ceiling = (value: number): number => Math.min(value, MAX_RUN_BUDGET_MICRO_USD);

const isMicro = (value: unknown, min: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min;

export function createSpendBook(budget: unknown): SpendBook {
  const asked = (budget as { maxMicroUsd?: unknown } | null | undefined)?.maxMicroUsd;
  const capMicroUsd = isMicro(asked, 1) ? ceiling(asked) : null;
  let reserved = 0;
  return {
    capMicroUsd,
    spent: () => reserved,
    reserve: (microUsd) => {
      if (capMicroUsd === null || !isMicro(microUsd, 1) || reserved + microUsd > capMicroUsd) return false;
      reserved += microUsd;
      return true;
    },
    release: (microUsd) => {
      if (isMicro(microUsd, 1)) reserved = Math.max(0, reserved - microUsd);
    },
  };
}

async function granted(grant: SpendGrant, request: SpendRequest): Promise<boolean> {
  try {
    return (await grant(request)) === true;
  } catch {
    return false;
  }
}

/** Reserve a paid query's price, or refuse. The budget is asked first, then the grant, then the room. */
export async function reservePaidQuery(book: SpendBook, grant: SpendGrant, request: SpendRequest) {
  if (book.capMicroUsd === null) return researchRefused('BUDGET_REQUIRED', 'a paid search needs a budget of whole micro-USD');
  if (!(await granted(grant, request))) return researchRefused('NO_GRANT', 'no spend grant confirms this paid search');
  if (!book.reserve(request.microUsd)) return researchRefused('OVER_BUDGET', 'this paid search does not fit the budget that is left');
  return null;
}

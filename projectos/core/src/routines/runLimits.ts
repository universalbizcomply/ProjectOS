// Origin: original ProjectOS code
/**
 * The limits that bound one routine run and one routine's spend. All are constants: a record has no field for
 * any of them, so admitting a record can never raise one.
 *
 * UNITS. Every amount here is in US cents. The kernel's envelope and the model broker count in micro-USD, so the
 * wiring converts at the one place the two meet (1 cent = 10,000 micro-USD) and never inside this module.
 *
 * THESE NUMBERS WERE CHOSEN IN REVIEW ROUND 1 OF THIS PHASE, NOT TAKEN FROM A SOURCE. Upstream has no per-run
 * ceiling and no catch-up window. They are conservative starting points for the owner to confirm; changing one is a
 * reviewed change to this file and to its validator, never a setting.
 *
 * Pure: no I/O.
 */

/** A run whose scheduled slot is older than this is dropped, not caught up: it would run a stale reminder. */
export const ROUTINE_CATCH_UP_WINDOW_MS = 30 * 60 * 1000;

/** The most one run of one routine may be budgeted, in cents. */
export const MAX_RUN_BUDGET_CENTS = 500;

/** The span over which one routine's admitted spend is added up. */
export const ROUTINE_BUDGET_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The most one routine may be budgeted across `ROUTINE_BUDGET_WINDOW_MS`, in cents. */
export const MAX_ROUTINE_WINDOW_BUDGET_CENTS = 2000;

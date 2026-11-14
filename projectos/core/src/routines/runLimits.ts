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

/**
 * How long a run that was admitted and never released still holds its routine's in-flight guard. The guard is released
 * by the caller when the run ends; a run that crashes never does, and without a limit it would block the routine for
 * ever. After this long the guard no longer blocks, so a crashed run costs the routine at most this much. A run that
 * really takes longer than this may be overlapped by the next one, which is the price of not blocking for ever.
 */
export const ROUTINE_RUN_LEASE_MS = 60 * 60 * 1000;

/** The most one tenant's project may be budgeted across all its routines in `ROUTINE_BUDGET_WINDOW_MS`, in cents. */
export const MAX_PROJECT_WINDOW_BUDGET_CENTS = 5000;

// Origin: original ProjectOS code
/**
 * The limits that bound delegation, messages and queue items. All are constants: no agent record, request or message has a
 * field for any of them, so admitting one can never raise one.
 *
 * THESE NUMBERS WERE CHOSEN HERE, NOT TAKEN FROM A SOURCE. The delegation source is flat by default (one level, ten children
 * at once, a configured ceiling with no upper bound), and a configured ceiling is exactly what a record must not hold. They
 * are conservative starting points for the owner to confirm; changing one is a reviewed change to this file and to its
 * validator, never a setting.
 *
 * Pure: no I/O.
 */

/** The root is depth 0. A delegate at this depth is a leaf and cannot delegate. */
export const MAX_DELEGATION_DEPTH = 2;

/** The most children one parent may ever have, finished ones included. */
export const MAX_CHILDREN_PER_PARENT = 5;

/** The most delegates live at once in one tenant's project. */
export const MAX_LIVE_DELEGATES_PER_PROJECT = 10;

/** The most nodes, roots and delegates, one tenant's project may hold. Past it a registration is refused, never evicted. */
export const MAX_DELEGATION_NODES_PER_PROJECT = 60;

/**
 * How long a delegate may stay live before it is treated as lost. A lost delegate is unknown for good: it may have acted,
 * so it is never treated as not having run.
 */
export const DELEGATION_LEASE_MS = 30 * 60 * 1000;

/** The highest class a delegate's envelope may carry. P4 has no grant to give and P5 is the owner's, so neither is delegated. */
export const DELEGATED_CLASS_CEILING = 'P3';

/** The longest goal handed to a delegate, in characters. */
export const MAX_GOAL_CHARS = 4000;

/** The longest delegate output kept, in characters. The rest is cut and the cut is stated. */
export const MAX_DELEGATE_OUTPUT_CHARS = 20_000;

/** The longest agent-to-agent message body, in characters. */
export const MAX_MESSAGE_CHARS = 8000;

/** How many agents one project may hold. Past it a record is refused, never evicted. */
export const MAX_AGENTS_PER_PROJECT = 50;

/** The most grants and message recipients one agent record may name. */
export const MAX_AGENT_GRANTS = 32;
export const MAX_MESSAGE_RECIPIENTS = 16;

/** How long a claimed queue item may run before it is treated as abandoned, and how many times one may be claimed. */
export const QUEUE_LEASE_MS = 15 * 60 * 1000;
export const MAX_QUEUE_ATTEMPTS = 3;

/** The most route bindings one resolve call reads. A longer list is refused, never read in part. */
export const MAX_ROUTE_BINDINGS = 200;
